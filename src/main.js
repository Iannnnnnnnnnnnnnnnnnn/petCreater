const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let mainWindow = null;
let dragSession = null;

const BASE_WINDOW_WIDTH = 260;
const BASE_WINDOW_HEIGHT = 310;
const MIN_PET_SCALE = 0.7;
const MAX_PET_SCALE = 1.8;
const PET_SCALE_STEP = 0.1;

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
  dragStart: 'running',
  draggingRight: 'running-right',
  draggingLeft: 'running-left',
  dragEnd: 'idle'
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

function normalizePet(rawPet, installedDir) {
  const spritesheetPath = rawPet.spritesheetPath || 'spritesheet.webp';
  const spritesheetAbsolutePath = path.resolve(installedDir, spritesheetPath);

  return {
    id: sanitizeId(rawPet.id),
    displayName: rawPet.displayName || rawPet.name || rawPet.id || 'Custom Pet',
    description: rawPet.description || '',
    spritesheetPath,
    spritesheetAbsolutePath,
    spritesheetUrl: pathToFileURL(spritesheetAbsolutePath).toString(),
    cellWidth: Number(rawPet.cellWidth || 192),
    cellHeight: Number(rawPet.cellHeight || 208),
    states: normalizeStates(rawPet.states),
    interactions: normalizeInteractions(rawPet.interactions)
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

function validateSourcePetDir(sourceDir) {
  const manifestPath = path.join(sourceDir, 'pet.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('所选文件夹缺少 pet.json');
  }

  const rawPet = readJson(manifestPath);
  const petId = sanitizeId(rawPet.id || path.basename(sourceDir));
  const spritesheetPath = rawPet.spritesheetPath || 'spritesheet.webp';
  const spritesheetSource = path.resolve(sourceDir, spritesheetPath);

  if (!fs.existsSync(spritesheetSource)) {
    throw new Error(`所选文件夹缺少素材文件：${spritesheetPath}`);
  }

  return { rawPet, petId, spritesheetSource };
}

function installPet(sourceDir) {
  const { rawPet, petId, spritesheetSource } = validateSourcePetDir(sourceDir);
  const targetDir = path.join(petsRoot(), petId);
  const spritesheetName = path.basename(spritesheetSource);

  ensureDir(targetDir);
  fs.copyFileSync(spritesheetSource, path.join(targetDir, spritesheetName));

  const installedPet = {
    ...rawPet,
    id: petId,
    displayName: rawPet.displayName || rawPet.name || petId,
    spritesheetPath: spritesheetName,
    cellWidth: Number(rawPet.cellWidth || 192),
    cellHeight: Number(rawPet.cellHeight || 208),
    states: normalizeStates(rawPet.states),
    interactions: normalizeInteractions(rawPet.interactions)
  };

  writeJson(path.join(targetDir, 'pet.json'), installedPet);
  saveSettings({ ...readSettings(), activePetId: petId });
  return readInstalledPet(petId);
}

function broadcastPetChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pet:changed', getActivePet());
  }
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
        saveSettings({ ...readSettings(), activePetId: pet.id });
        broadcastPetChanged();
      }
    }))
    : [{ label: '暂无已安装桌宠', enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: '安装本地桌宠素材', click: chooseAndInstallPet },
    { type: 'separator' },
    { label: '切换桌宠', submenu: petItems },
    { type: 'separator' },
    {
      label: `大小：${Math.round(currentScale * 100)}%`,
      submenu: [
        {
          label: '放大',
          click: () => setPetScale(currentScale + PET_SCALE_STEP)
        },
        {
          label: '缩小',
          click: () => setPetScale(currentScale - PET_SCALE_STEP)
        },
        {
          label: '重置大小',
          click: () => setPetScale(1)
        }
      ]
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
ipcMain.handle('pet:select', (_event, petId) => {
  const pet = readInstalledPet(petId);
  if (!pet) {
    return null;
  }
  saveSettings({ ...readSettings(), activePetId: pet.id });
  broadcastPetChanged();
  return pet;
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
