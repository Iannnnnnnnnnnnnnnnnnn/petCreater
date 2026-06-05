const { app, BrowserWindow, Menu, dialog, ipcMain, powerMonitor, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let mainWindow = null;
let settingsWindow = null;
let dragSession = null;
let petCycleTimer = null;
let systemBehaviorTimer = null;
let wasSystemIdle = false;

const BASE_WINDOW_WIDTH = 260;
const BASE_WINDOW_HEIGHT = 310;
const MIN_PET_SCALE = 0.7;
const MAX_PET_SCALE = 1.8;
const DEFAULT_CYCLE_INTERVAL_SECONDS = 60;
const MIN_CYCLE_INTERVAL_SECONDS = 10;
const MAX_CYCLE_INTERVAL_SECONDS = 86400;
const SYSTEM_IDLE_EVENT_SECONDS = 5 * 60;
const SYSTEM_BEHAVIOR_POLL_MS = 30000;

const DEFAULT_STATES = {
  idle: { row: 0, frames: 6, fps: 3, loop: true },
  'running-right': { row: 1, frames: 8, fps: 12, loop: true },
  'running-left': { row: 2, frames: 8, fps: 12, loop: true },
  waving: { row: 3, frames: 6, fps: 8, loop: false, next: 'idle' },
  jumping: { row: 4, frames: 6, fps: 8, loop: false, next: 'idle' },
  failed: { row: 5, frames: 6, fps: 6, loop: false, next: 'idle' },
  waiting: { row: 6, frames: 6, fps: 4, loop: true },
  running: { row: 7, frames: 6, fps: 8, loop: true },
  review: { row: 8, frames: 6, fps: 3, loop: true }
};

const DEFAULT_INTERACTIONS = {
  click: 'waving',
  doubleClick: 'jumping',
  wheelUp: 'jumping',
  wheelDown: 'failed',
  hover: 'review',
  longPress: 'long-press',
  clickHead: 'pet-head',
  clickBody: 'pet-body',
  clickFeet: 'pet-feet',
  clickBurst: 'surprised',
  dragStart: 'running',
  draggingRight: 'running-right',
  draggingLeft: 'running-left',
  dragEnd: 'idle',
  dragLand: 'landing',
  userIdle: 'sleeping',
  screenLocked: 'sleeping',
  screenUnlocked: 'waving',
  morning: 'waving',
  lateNight: 'sleepy',
  batteryLow: 'tired',
  batteryCharging: 'waving',
  batteryFull: 'celebrating'
};

const DEFAULT_ACTION_FALLBACKS = {
  'long-press': ['long-press', 'pet-head', 'review', 'waiting', 'idle'],
  'pet-head': ['pet-head', 'waving', 'review', 'idle'],
  'pet-body': ['pet-body', 'waving', 'idle'],
  'pet-feet': ['pet-feet', 'jumping', 'idle'],
  surprised: ['surprised', 'jumping', 'failed', 'idle'],
  landing: ['landing', 'jumping', 'waiting', 'idle'],
  sleeping: ['sleeping', 'waiting', 'idle'],
  sleepy: ['sleepy', 'sleeping', 'waiting', 'idle'],
  tired: ['tired', 'failed', 'waiting', 'idle'],
  celebrating: ['celebrating', 'waving', 'jumping', 'idle'],
  drinking: ['drinking', 'waving', 'idle'],
  eating: ['eating', 'waving', 'idle'],
  thinking: ['thinking', 'review', 'waiting', 'idle'],
  idle: ['idle'],
  waving: ['waving', 'idle'],
  jumping: ['jumping', 'idle'],
  failed: ['failed', 'waiting', 'idle'],
  waiting: ['waiting', 'idle'],
  review: ['review', 'waiting', 'idle'],
  running: ['running', 'idle'],
  'running-right': ['running-right', 'running', 'idle'],
  'running-left': ['running-left', 'running', 'idle']
};

function userDataPath(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

function petsRoot() {
  return userDataPath('pets');
}

function settingsPath() {
  return userDataPath('settings.json');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function isPathInside(childPath, parentPath) {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function sanitizeId(value) {
  return String(value || 'custom-pet')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'custom-pet';
}

function readSettings() {
  try {
    return readJson(settingsPath());
  } catch (_error) {
    return {};
  }
}

function saveSettings(settings) {
  writeJson(settingsPath(), settings);
}

function clampCycleIntervalSeconds(seconds) {
  const numericSeconds = Number(seconds);
  if (!Number.isFinite(numericSeconds)) {
    return DEFAULT_CYCLE_INTERVAL_SECONDS;
  }

  return Math.min(
    MAX_CYCLE_INTERVAL_SECONDS,
    Math.max(MIN_CYCLE_INTERVAL_SECONDS, Math.round(numericSeconds))
  );
}

function clampPetScale(scale) {
  const numericScale = Number(scale);
  if (!Number.isFinite(numericScale)) {
    return 1;
  }

  return Math.min(MAX_PET_SCALE, Math.max(MIN_PET_SCALE, Number(numericScale.toFixed(2))));
}

function getPetScale() {
  return clampPetScale(readSettings().petScale || 1);
}

function applyWindowScale(scale) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setSize(
    Math.round(BASE_WINDOW_WIDTH * scale),
    Math.round(BASE_WINDOW_HEIGHT * scale),
    false
  );
}

function setPetScale(scale) {
  const nextScale = clampPetScale(scale);
  saveSettings({ ...readSettings(), petScale: nextScale });
  applyWindowScale(nextScale);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('view:scale-changed', nextScale);
  }
}

function getCycleSettings() {
  const installedPetIds = new Set(listPets().map((pet) => pet.id));
  const settings = readSettings();
  const petIds = Array.isArray(settings.cyclePetIds)
    ? settings.cyclePetIds.filter((petId) => installedPetIds.has(petId))
    : [];

  return {
    enabled: Boolean(settings.cycleEnabled) && petIds.length >= 2,
    petIds,
    intervalSeconds: clampCycleIntervalSeconds(settings.cycleIntervalSeconds)
  };
}

function getSettingsSnapshot() {
  const cycle = getCycleSettings();
  return {
    petScale: getPetScale(),
    cycleEnabled: cycle.enabled,
    cyclePetIds: cycle.petIds,
    cycleIntervalSeconds: cycle.intervalSeconds,
    pets: listPets().map((pet) => ({
      id: pet.id,
      displayName: pet.displayName,
      description: pet.description,
      selected: cycle.petIds.includes(pet.id)
    }))
  };
}

function clearPetCycleTimer() {
  if (petCycleTimer) {
    clearInterval(petCycleTimer);
    petCycleTimer = null;
  }
}

function normalizeStates(rawStates = {}) {
  const states = { ...DEFAULT_STATES };
  for (const [name, state] of Object.entries(rawStates || {})) {
    states[name] = { ...(states[name] || {}), ...state };
  }

  if (states.idle && Number(states.idle.fps) === 6) {
    states.idle.fps = DEFAULT_STATES.idle.fps;
  }
  if (states.waiting && Number(states.waiting.fps) === 6) {
    states.waiting.fps = DEFAULT_STATES.waiting.fps;
  }
  if (states.review && Number(states.review.fps) === 6) {
    states.review.fps = DEFAULT_STATES.review.fps;
  }

  return states;
}

function normalizeInteractions(rawInteractions = {}) {
  const interactions = { ...DEFAULT_INTERACTIONS, ...(rawInteractions || {}) };
  delete interactions.rightClick;

  if (interactions.wheelDown === 'waving') {
    interactions.wheelDown = DEFAULT_INTERACTIONS.wheelDown;
  }

  return interactions;
}

function normalizeActionFallbacks(rawFallbacks = {}) {
  const fallbacks = { ...DEFAULT_ACTION_FALLBACKS };
  for (const [action, chain] of Object.entries(rawFallbacks || {})) {
    if (Array.isArray(chain) && chain.length) {
      fallbacks[action] = [...new Set([...chain, 'idle'])];
    }
  }
  return fallbacks;
}

function normalizeStateSources(states, spritesheetPath) {
  const normalizedStates = {};
  for (const [name, state] of Object.entries(states || {})) {
    normalizedStates[name] = {
      ...state,
      source: state.source || spritesheetPath
    };
  }
  return normalizedStates;
}

function collectPetSources(rawPet, spritesheetPath) {
  const sources = new Set([spritesheetPath]);
  for (const state of Object.values(rawPet.states || {})) {
    if (state && state.source) {
      sources.add(state.source);
    }
  }
  return [...sources];
}

function copyRelativeFile(sourceDir, targetDir, relativePath) {
  const sourceFile = path.resolve(sourceDir, relativePath);
  const targetFile = path.resolve(targetDir, relativePath);
  if (!isPathInside(sourceFile, sourceDir)) {
    throw new Error(`素材路径不允许跳出素材目录：${relativePath}`);
  }
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`所选文件夹缺少素材文件：${relativePath}`);
  }

  ensureDir(path.dirname(targetFile));
  fs.copyFileSync(sourceFile, targetFile);
}

function normalizePet(rawPet, installedDir) {
  const spritesheetPath = rawPet.spritesheetPath || 'spritesheet.webp';
  const spritesheetAbsolutePath = path.resolve(installedDir, spritesheetPath);
  const states = normalizeStateSources(normalizeStates(rawPet.states), spritesheetPath);
  const sources = {};
  for (const sourcePath of collectPetSources({ states }, spritesheetPath)) {
    const absolutePath = path.resolve(installedDir, sourcePath);
    sources[sourcePath] = {
      path: sourcePath,
      absolutePath,
      url: pathToFileURL(absolutePath).toString()
    };
  }

  return {
    id: sanitizeId(rawPet.id),
    displayName: rawPet.displayName || rawPet.name || rawPet.id || 'Custom Pet',
    description: rawPet.description || '',
    schemaVersion: Number(rawPet.schemaVersion || 1),
    installedDir,
    spritesheetPath,
    spritesheetAbsolutePath,
    spritesheetUrl: pathToFileURL(spritesheetAbsolutePath).toString(),
    sources,
    cellWidth: Number(rawPet.cellWidth || 192),
    cellHeight: Number(rawPet.cellHeight || 208),
    states,
    interactions: normalizeInteractions(rawPet.interactions),
    actionFallbacks: normalizeActionFallbacks(rawPet.actionFallbacks)
  };
}

function readInstalledPet(petId) {
  const dir = path.join(petsRoot(), sanitizeId(petId));
  const manifestPath = path.join(dir, 'pet.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const pet = normalizePet(readJson(manifestPath), dir);
  if (!fs.existsSync(pet.spritesheetAbsolutePath)) {
    return null;
  }

  return pet;
}

function listPets() {
  ensureDir(petsRoot());
  return fs.readdirSync(petsRoot(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readInstalledPet(entry.name))
    .filter(Boolean)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function getActivePet() {
  const settings = readSettings();
  const installedPets = listPets();
  if (settings.activePetId) {
    const active = installedPets.find((pet) => pet.id === settings.activePetId);
    if (active) {
      return active;
    }
  }
  return installedPets[0] || null;
}

function selectPet(petId, options = {}) {
  const pet = readInstalledPet(petId);
  if (!pet) {
    return null;
  }

  saveSettings({ ...readSettings(), activePetId: pet.id });
  broadcastPetChanged();
  if (options.restartCycle !== false) {
    restartPetCycle();
  }
  return pet;
}

function switchToNextCyclePet() {
  const cycle = getCycleSettings();
  if (!cycle.enabled) {
    clearPetCycleTimer();
    return;
  }

  const active = getActivePet();
  const activeIndex = active ? cycle.petIds.indexOf(active.id) : -1;
  const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % cycle.petIds.length : 0;
  selectPet(cycle.petIds[nextIndex], { restartCycle: false });
}

function restartPetCycle() {
  clearPetCycleTimer();
  const cycle = getCycleSettings();
  if (!cycle.enabled) {
    return;
  }

  petCycleTimer = setInterval(switchToNextCyclePet, cycle.intervalSeconds * 1000);
}

function validateSourcePetDir(sourceDir) {
  const manifestPath = path.join(sourceDir, 'pet.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('所选文件夹缺少 pet.json');
  }

  const rawPet = readJson(manifestPath);
  const petId = sanitizeId(rawPet.id || path.basename(sourceDir));
  const spritesheetPath = rawPet.spritesheetPath || 'spritesheet.webp';
  const sourcePaths = collectPetSources(rawPet, spritesheetPath);

  for (const sourcePath of sourcePaths) {
    const sourceFile = path.resolve(sourceDir, sourcePath);
    if (!isPathInside(sourceFile, sourceDir)) {
      throw new Error(`素材路径不允许跳出素材目录：${sourcePath}`);
    }
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`所选文件夹缺少素材文件：${sourcePath}`);
    }
  }

  return { rawPet, petId, spritesheetPath, sourcePaths };
}

function installPet(sourceDir) {
  const { rawPet, petId, spritesheetPath, sourcePaths } = validateSourcePetDir(sourceDir);
  const targetDir = path.join(petsRoot(), petId);

  ensureDir(targetDir);
  for (const sourcePath of sourcePaths) {
    copyRelativeFile(sourceDir, targetDir, sourcePath);
  }

  const states = normalizeStateSources(normalizeStates(rawPet.states), spritesheetPath);
  const installedPet = {
    ...rawPet,
    id: petId,
    schemaVersion: Number(rawPet.schemaVersion || 1),
    displayName: rawPet.displayName || rawPet.name || petId,
    spritesheetPath,
    cellWidth: Number(rawPet.cellWidth || 192),
    cellHeight: Number(rawPet.cellHeight || 208),
    states,
    interactions: normalizeInteractions(rawPet.interactions),
    actionFallbacks: normalizeActionFallbacks(rawPet.actionFallbacks)
  };

  writeJson(path.join(targetDir, 'pet.json'), installedPet);
  saveSettings({ ...readSettings(), activePetId: petId });
  restartPetCycle();
  return readInstalledPet(petId);
}

function broadcastPetChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pet:changed', getActivePet());
  }
}

function broadcastSystemEvent(eventName) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system:event', eventName);
  }
}

function startSystemBehaviorPolling() {
  clearInterval(systemBehaviorTimer);
  systemBehaviorTimer = setInterval(() => {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds >= SYSTEM_IDLE_EVENT_SECONDS && !wasSystemIdle) {
      wasSystemIdle = true;
      broadcastSystemEvent('userIdle');
    }

    if (idleSeconds < 5 && wasSystemIdle) {
      wasSystemIdle = false;
      broadcastSystemEvent('screenUnlocked');
    }
  }, SYSTEM_BEHAVIOR_POLL_MS);
}

async function chooseAndInstallPet() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择包含 pet.json 和 spritesheet.webp 的文件夹',
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  try {
    const pet = installPet(result.filePaths[0]);
    broadcastPetChanged();
    return pet;
  } catch (error) {
    dialog.showErrorBox('安装桌宠失败', error.message);
    return null;
  }
}

function showPetMenu() {
  const pets = listPets();
  const active = getActivePet();
  const currentScale = getPetScale();
  const petItems = pets.length
    ? pets.map((pet) => ({
      label: pet.displayName,
      type: 'radio',
      checked: active && active.id === pet.id,
      click: () => {
        selectPet(pet.id);
      }
    }))
    : [{ label: '暂无已安装桌宠', enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: '安装本地桌宠素材', click: chooseAndInstallPet },
    { type: 'separator' },
    { label: '切换桌宠', submenu: petItems },
    { type: 'separator' },
    {
      label: `桌宠设置（${Math.round(currentScale * 100)}%）`,
      click: openSettingsWindow
    },
    { type: 'separator' },
    {
      label: '保持置顶',
      type: 'checkbox',
      checked: mainWindow ? mainWindow.isAlwaysOnTop() : true,
      click: (item) => {
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(item.checked, 'screen-saver');
        }
      }
    },
    {
      label: '打开本地素材目录',
      click: () => {
        ensureDir(petsRoot());
        shell.openPath(petsRoot());
      }
    },
    { type: 'separator' },
    { label: '退出', role: 'quit' }
  ]);

  menu.popup({ window: mainWindow });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 460,
    height: 620,
    minWidth: 420,
    minHeight: 540,
    title: 'PetCreater 设置',
    parent: mainWindow,
    modal: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings', 'index.html'));
}

function createWindow() {
  const scale = getPetScale();
  mainWindow = new BrowserWindow({
    width: Math.round(BASE_WINDOW_WIDTH * scale),
    height: Math.round(BASE_WINDOW_HEIGHT * scale),
    minWidth: 180,
    minHeight: 180,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('pet:get-active', () => getActivePet());
ipcMain.handle('pet:list', () => listPets());
ipcMain.handle('pet:install-dialog', () => chooseAndInstallPet());
ipcMain.handle('pet:show-menu', () => showPetMenu());
ipcMain.handle('view:get-scale', () => getPetScale());
ipcMain.handle('settings:get', () => getSettingsSnapshot());
ipcMain.handle('settings:preview-scale', (_event, scale) => {
  setPetScale(scale);
  return getPetScale();
});
ipcMain.handle('settings:save', (_event, preferences) => {
  const installedPetIds = new Set(listPets().map((pet) => pet.id));
  const cyclePetIds = Array.isArray(preferences.cyclePetIds)
    ? [...new Set(preferences.cyclePetIds)].filter((petId) => installedPetIds.has(petId))
    : [];
  const cycleEnabled = Boolean(preferences.cycleEnabled) && cyclePetIds.length >= 2;
  const settings = readSettings();

  saveSettings({
    ...settings,
    petScale: clampPetScale(preferences.petScale),
    cycleEnabled,
    cyclePetIds,
    cycleIntervalSeconds: clampCycleIntervalSeconds(preferences.cycleIntervalSeconds)
  });
  setPetScale(preferences.petScale);
  restartPetCycle();
  return getSettingsSnapshot();
});
ipcMain.handle('settings:close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});
ipcMain.handle('pet:select', (_event, petId) => {
  return selectPet(petId);
});

ipcMain.on('window:set-mouse-passthrough', (_event, passthrough) => {
  if (!mainWindow || mainWindow.isDestroyed() || dragSession) {
    return;
  }

  mainWindow.setIgnoreMouseEvents(Boolean(passthrough), { forward: true });
});

ipcMain.on('window:drag-start', (_event, point) => {
  if (!mainWindow) {
    return;
  }
  const [windowX, windowY] = mainWindow.getPosition();
  dragSession = {
    startMouseX: Number(point.screenX),
    startMouseY: Number(point.screenY),
    startWindowX: windowX,
    startWindowY: windowY
  };
  mainWindow.setIgnoreMouseEvents(false);
});

ipcMain.on('window:drag-move', (_event, point) => {
  if (!mainWindow || !dragSession) {
    return;
  }

  const nextX = Math.round(dragSession.startWindowX + Number(point.screenX) - dragSession.startMouseX);
  const nextY = Math.round(dragSession.startWindowY + Number(point.screenY) - dragSession.startMouseY);
  mainWindow.setPosition(nextX, nextY, false);
});

ipcMain.on('window:drag-end', () => {
  dragSession = null;
});

app.whenReady().then(() => {
  ensureDir(petsRoot());
  createWindow();
  restartPetCycle();
  startSystemBehaviorPolling();

  powerMonitor.on('lock-screen', () => broadcastSystemEvent('screenLocked'));
  powerMonitor.on('unlock-screen', () => broadcastSystemEvent('screenUnlocked'));
  powerMonitor.on('suspend', () => broadcastSystemEvent('screenLocked'));
  powerMonitor.on('resume', () => broadcastSystemEvent('screenUnlocked'));
  powerMonitor.on('on-battery', () => broadcastSystemEvent('batteryLow'));
  powerMonitor.on('on-ac', () => broadcastSystemEvent('batteryCharging'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
