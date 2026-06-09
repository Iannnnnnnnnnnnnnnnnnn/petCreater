const canvas = document.getElementById('petCanvas');
const context = canvas.getContext('2d');

let pet = null;
let spritesheet = null;
let sourceImages = {};
let renderMode = 'atlas';
let currentStateName = 'idle';
let currentFrame = 0;
let lastFrameAt = 0;
let animationRequest = null;
let clickTimer = null;
let hoverIdleTimer = null;
let idleSlowTimer = null;
let behaviorTimer = null;
let isDragging = false;
let dragStarted = false;
let dragStartPoint = null;
let lastDragDirection = null;
let lastDragScreenX = null;
let suppressNextClick = false;
let isPointerInside = false;
let waitForLeaveBeforeWaiting = false;
let waitingLoopsRemaining = 0;
let currentFpsOverride = null;
let petScale = 1;
let frameSequences = {};
let frameBounds = {};
let stateRenderModes = {};
let currentHitSquare = null;
let isMousePassthrough = false;
let lastUserActivityAt = Date.now();
let lastKnownBattery = null;
let clickHistory = [];
let isScreenInactive = document.hidden;
let forceBatteryTired = false;

const DEFAULT_CANVAS_WIDTH = 192;
const DEFAULT_CANVAS_HEIGHT = 208;
const IDLE_SLOW_DELAY_MS = 8000;
const FRAME_ALPHA_THRESHOLD = 8;
const CLICK_BURST_WINDOW_MS = 900;
const SINGLE_CLICK_RESOLVE_MS = 360;
const DOUBLE_CLICK_RESOLVE_MS = 260;
const SINGLE_CLICK_FPS_OVERRIDE = 4;
const TRIPLE_CLICK_COUNT = 3;
const BEHAVIOR_POLL_MS = 30000;
const USER_IDLE_EVENT_MS = 5 * 60 * 1000;
const PASSIVE_STATES = new Set(['tired', 'sleeping', 'sleepy']);

function stateConfig(name) {
  return pet && pet.states && pet.states[name] ? pet.states[name] : null;
}

function interactionState(name) {
  return pet && pet.interactions ? pet.interactions[name] : null;
}

function resolveAction(actionName) {
  if (!pet) {
    return null;
  }

  const fallbackChain = pet.actionFallbacks && pet.actionFallbacks[actionName]
    ? pet.actionFallbacks[actionName]
    : [actionName, 'idle'];

  return fallbackChain.find((stateName) => stateConfig(stateName)) || 'idle';
}

function playState(name, options = {}) {
  const resolvedName = resolveAction(name);
  if (!resolvedName) {
    return;
  }

  if (currentStateName !== resolvedName || options.restart) {
    currentStateName = resolvedName;
    currentFrame = 0;
    lastFrameAt = 0;
  }

  currentFpsOverride = options.fpsOverride || null;
}

function playInteraction(name, options = {}) {
  const targetState = interactionState(name);
  if (targetState) {
    playState(targetState, { restart: true, ...options });
  }
}

function isLateNight(now = new Date()) {
  const hour = now.getHours();
  return hour >= 23 || hour < 6;
}

function isUserInactive() {
  return Date.now() - lastUserActivityAt >= USER_IDLE_EVENT_MS && !isDragging;
}

function resolvePassiveState(now = new Date()) {
  if (!isScreenInactive && !isUserInactive()) {
    return 'idle';
  }
  if (forceBatteryTired || (lastKnownBattery && lastKnownBattery.low)) {
    return 'tired';
  }
  if (isScreenInactive) {
    return 'sleeping';
  }
  if (isUserInactive() && isLateNight(now)) {
    return 'sleepy';
  }
  return 'idle';
}

function applyPassiveState(options = {}) {
  if (!pet || isDragging) {
    return;
  }

  const nextState = resolvePassiveState();
  if (nextState === 'idle') {
    if (PASSIVE_STATES.has(currentStateName) || options.force) {
      playState('idle', { restart: currentStateName !== 'idle' });
    }
    return;
  }

  if (currentStateName !== nextState || options.force) {
    playState(nextState, { restart: true });
  }
}

function clearIdleSlowTimer() {
  if (idleSlowTimer) {
    clearTimeout(idleSlowTimer);
    idleSlowTimer = null;
  }
}

function scheduleIdleSlow(delay = IDLE_SLOW_DELAY_MS) {
  clearIdleSlowTimer();
  if (!pet || isPointerInside || isDragging) {
    return;
  }

  idleSlowTimer = setTimeout(() => {
    if (pet && !isPointerInside && !isDragging) {
      startSlowIdle();
    }
  }, delay);
}

function markInteraction() {
  lastUserActivityAt = Date.now();
  waitForLeaveBeforeWaiting = true;
  waitingLoopsRemaining = 0;
  clearIdleSlowTimer();
  if (PASSIVE_STATES.has(currentStateName)) {
    playState('idle', { restart: true });
  }
}

function startSlowIdle() {
  waitForLeaveBeforeWaiting = false;
  waitingLoopsRemaining = 0;
  clearIdleSlowTimer();
  playState('idle', { restart: true, fpsOverride: 1 });
}

function startWaitingWindDown(loopCount = 2) {
  waitForLeaveBeforeWaiting = false;
  waitingLoopsRemaining = loopCount;
  clearIdleSlowTimer();
  playState('waiting', { restart: true });
}

function finishOneShot(nextStateName) {
  if (nextStateName === 'idle' && waitForLeaveBeforeWaiting) {
    if (isPointerInside) {
      playInteraction('hover');
    } else {
      startWaitingWindDown(2);
    }
    return;
  }

  playState(nextStateName, { restart: true });
  if (nextStateName === 'idle') {
    scheduleIdleSlow();
  }
}

function pulseClass(name, duration = 180) {
  canvas.classList.remove(name);
  void canvas.offsetWidth;
  canvas.classList.add(name);
  window.setTimeout(() => {
    canvas.classList.remove(name);
  }, duration);
}

function clearCanvas() {
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function resizeCanvas(width, height) {
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }

  canvas.style.width = `${Math.round(width * petScale)}px`;
  canvas.style.height = `${Math.round(height * petScale)}px`;
}

function drawImageContained(image, targetWidth, targetHeight) {
  const scale = Math.min(targetWidth / image.naturalWidth, targetHeight / image.naturalHeight);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const x = Math.round((targetWidth - width) / 2);
  const y = Math.round((targetHeight - height) / 2);

  clearCanvas();
  context.drawImage(image, x, y, width, height);
}

function stateCellWidth(state) {
  return Number(state.cellWidth || pet.cellWidth || DEFAULT_CANVAS_WIDTH);
}

function stateCellHeight(state) {
  return Number(state.cellHeight || pet.cellHeight || DEFAULT_CANVAS_HEIGHT);
}

function getStateSource(state) {
  return state.source || pet.spritesheetPath;
}

function getStateImage(state) {
  return sourceImages[getStateSource(state)] || spritesheet;
}

function hasStateFrames(image, state) {
  const row = Number(state.row || 0);
  const frames = Number(state.frames || 1);
  const cellWidth = stateCellWidth(state);
  const cellHeight = stateCellHeight(state);

  return image.naturalWidth >= frames * cellWidth && image.naturalHeight >= (row + 1) * cellHeight;
}

function getFrameBounds(image, sourceX, sourceY, cellWidth, cellHeight) {
  if (
    sourceX < 0 ||
    sourceY < 0 ||
    sourceX + cellWidth > image.naturalWidth ||
    sourceY + cellHeight > image.naturalHeight
  ) {
    return null;
  }

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = cellWidth;
  sampleCanvas.height = cellHeight;
  const sampleContext = sampleCanvas.getContext('2d');
  sampleContext.drawImage(image, sourceX, sourceY, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
  const pixels = sampleContext.getImageData(0, 0, cellWidth, cellHeight).data;
  let minX = cellWidth;
  let minY = cellHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const alpha = pixels[((y * cellWidth + x) * 4) + 3];
      if (alpha <= FRAME_ALPHA_THRESHOLD) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function buildFrameMetadata(nextPet) {
  const sequences = {};
  const bounds = {};
  const renderModes = {};

  for (const [stateName, state] of Object.entries(nextPet.states || {})) {
    const image = sourceImages[getStateSource(state)];
    if (!image) {
      continue;
    }

    const configuredFrameCount = Number(state.frames || 1);
    const row = Number(state.row || 0);
    const cellWidth = Number(state.cellWidth || nextPet.cellWidth || DEFAULT_CANVAS_WIDTH);
    const cellHeight = Number(state.cellHeight || nextPet.cellHeight || DEFAULT_CANVAS_HEIGHT);
    const visibleFrames = [];
    const validFrames = [];
    bounds[stateName] = {};
    renderModes[stateName] = hasStateFrames(image, state) ? 'atlas' : 'single-image';

    for (let frame = 0; frame < configuredFrameCount; frame += 1) {
      const sourceX = frame * cellWidth;
      const sourceY = row * cellHeight;
      if (sourceX + cellWidth <= image.naturalWidth && sourceY + cellHeight <= image.naturalHeight) {
        validFrames.push(frame);
      }
      const frameBound = getFrameBounds(image, sourceX, sourceY, cellWidth, cellHeight);
      if (frameBound) {
        visibleFrames.push(frame);
        bounds[stateName][frame] = frameBound;
      }
    }

    sequences[stateName] = visibleFrames.length ? visibleFrames : validFrames;
  }

  return { sequences, bounds, renderModes };
}

function getFrameSequence(stateName, state) {
  const sequence = frameSequences[stateName];
  if (sequence && sequence.length) {
    return sequence;
  }

  return Array.from({ length: Number(state.frames || 1) }, (_value, index) => index);
}

function getEffectiveFrameCount(stateName, state) {
  return Math.max(1, getFrameSequence(stateName, state).length);
}

function getHitSquareForFrame(stateName, frame, fallbackWidth, fallbackHeight) {
  const bounds = frameBounds[stateName] && frameBounds[stateName][frame]
    ? frameBounds[stateName][frame]
    : { x: 0, y: 0, width: fallbackWidth, height: fallbackHeight };
  const side = Math.max(bounds.width, bounds.height);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const x = Math.max(0, centerX - side / 2);
  const y = Math.max(0, centerY - side / 2);

  return {
    x,
    y,
    width: side,
    height: side
  };
}

function pointInCurrentHitSquare(clientX, clientY) {
  if (!currentHitSquare || canvas.hidden) {
    return false;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;
  const hitX = canvasRect.left + currentHitSquare.x * scaleX;
  const hitY = canvasRect.top + currentHitSquare.y * scaleY;
  const hitWidth = currentHitSquare.width * scaleX;
  const hitHeight = currentHitSquare.height * scaleY;

  return (
    clientX >= hitX &&
    clientX <= hitX + hitWidth &&
    clientY >= hitY &&
    clientY <= hitY + hitHeight
  );
}

function pointToHitSquarePosition(clientX, clientY) {
  if (!currentHitSquare || canvas.hidden) {
    return null;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;
  const hitX = canvasRect.left + currentHitSquare.x * scaleX;
  const hitY = canvasRect.top + currentHitSquare.y * scaleY;
  const hitWidth = currentHitSquare.width * scaleX;
  const hitHeight = currentHitSquare.height * scaleY;

  return {
    x: (clientX - hitX) / hitWidth,
    y: (clientY - hitY) / hitHeight
  };
}

function setMousePassthrough(passthrough) {
  if (isMousePassthrough === passthrough) {
    return;
  }

  isMousePassthrough = passthrough;
  window.petApi.setMousePassthrough(passthrough);
}

function updateMousePassthrough(event) {
  if (!pet || isDragging) {
    setMousePassthrough(false);
    return;
  }

  const isInsideHitSquare = pointInCurrentHitSquare(event.clientX, event.clientY);
  setMousePassthrough(!isInsideHitSquare);

  if (isInsideHitSquare && !isPointerInside) {
    isPointerInside = true;
    clearTimeout(hoverIdleTimer);
    clearIdleSlowTimer();
    waitForLeaveBeforeWaiting = true;
    playInteraction('hover');
  }

  if (!isInsideHitSquare && isPointerInside) {
    isPointerInside = false;
    clearTimeout(hoverIdleTimer);
    if (!isDragging) {
      hoverIdleTimer = setTimeout(() => startWaitingWindDown(2), 180);
    }
  }
}

function renderFrame(now) {
  animationRequest = requestAnimationFrame(renderFrame);
  if (!pet) {
    return;
  }

  const state = stateConfig(currentStateName) || stateConfig('idle');
  const stateImage = getStateImage(state);
  if (!stateImage || !stateImage.complete) {
    return;
  }

  if (stateRenderModes[currentStateName] === 'single-image') {
    const targetWidth = Math.min(Math.max(stateImage.naturalWidth, 120), 260);
    const targetHeight = Math.min(Math.max(stateImage.naturalHeight, 120), 300);
    resizeCanvas(targetWidth, targetHeight);
    currentHitSquare = { x: 0, y: 0, width: targetWidth, height: targetHeight };
    drawImageContained(stateImage, targetWidth, targetHeight);
    return;
  }

  const fps = Number(currentFpsOverride || state.fps || 6);
  const frameDuration = 1000 / fps;
  const frameCount = getEffectiveFrameCount(currentStateName, state);

  if (!lastFrameAt) {
    lastFrameAt = now;
  }

  if (now - lastFrameAt >= frameDuration) {
    currentFrame += 1;
    lastFrameAt = now;

    if (currentFrame >= frameCount) {
      if (state.loop !== false) {
        currentFrame = 0;
        if (currentStateName === 'waiting' && waitingLoopsRemaining > 0) {
          waitingLoopsRemaining -= 1;
          if (waitingLoopsRemaining === 0) {
            startSlowIdle();
          }
        }
      } else {
        finishOneShot(state.next || 'idle');
      }
    }
  }

  const activeState = stateConfig(currentStateName) || state;
  const cellWidth = stateCellWidth(activeState);
  const cellHeight = stateCellHeight(activeState);
  const frameSequence = getFrameSequence(currentStateName, activeState);
  const sourceFrame = frameSequence[currentFrame] ?? 0;
  const sourceX = sourceFrame * cellWidth;
  const sourceY = Number(activeState.row || 0) * cellHeight;

  resizeCanvas(cellWidth, cellHeight);
  currentHitSquare = getHitSquareForFrame(currentStateName, sourceFrame, cellWidth, cellHeight);
  clearCanvas();
  context.drawImage(
    stateImage,
    sourceX,
    sourceY,
    cellWidth,
    cellHeight,
    0,
    0,
    cellWidth,
    cellHeight
  );
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('素材图片加载失败'));
    image.src = url;
  });
}

async function loadPetSources(nextPet) {
  const images = {};
  const entries = Object.entries(nextPet.sources || {
    [nextPet.spritesheetPath]: { url: nextPet.spritesheetUrl }
  });

  await Promise.all(entries.map(async ([sourcePath, source]) => {
    images[sourcePath] = await loadImage(source.url);
  }));

  return images;
}

async function setPet(nextPet) {
  pet = nextPet;
  spritesheet = null;
  sourceImages = {};
  frameSequences = {};
  frameBounds = {};
  stateRenderModes = {};
  currentHitSquare = null;
  setMousePassthrough(false);
  renderMode = 'atlas';
  currentFrame = 0;
  lastFrameAt = 0;
  currentFpsOverride = null;
  waitForLeaveBeforeWaiting = false;
  waitingLoopsRemaining = 0;
  clearIdleSlowTimer();
  clickHistory = [];
  clearCanvas();

  if (!pet) {
    canvas.hidden = true;
    clearCanvas();
    return;
  }

  canvas.hidden = false;

  try {
    sourceImages = await loadPetSources(pet);
    spritesheet = sourceImages[pet.spritesheetPath];
    const metadata = buildFrameMetadata(pet);
    frameSequences = metadata.sequences;
    frameBounds = metadata.bounds;
    stateRenderModes = metadata.renderModes;
    renderMode = stateRenderModes.idle || 'atlas';
    playState('idle', { restart: true });
    scheduleIdleSlow();
  } catch (error) {
    console.error(error);
    pet = null;
    canvas.hidden = true;
  }
}

function handlePointerDown(event) {
  if (!pet || event.button !== 0 || !pointInCurrentHitSquare(event.clientX, event.clientY)) {
    return;
  }

  dragStartPoint = {
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: event.clientX,
    clientY: event.clientY
  };
  dragStarted = false;
  isDragging = true;
  lastDragDirection = null;
  lastDragScreenX = event.screenX;
  markInteraction();
  canvas.setPointerCapture && canvas.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (!isDragging || !dragStartPoint) {
    return;
  }

  const deltaX = event.clientX - dragStartPoint.clientX;
  const deltaY = event.clientY - dragStartPoint.clientY;
  const distance = Math.hypot(deltaX, deltaY);

  if (!dragStarted && distance >= 6) {
    dragStarted = true;
    suppressNextClick = true;
    canvas.classList.add('dragging');
    window.petApi.dragStart(dragStartPoint);
    playInteraction('dragStart');
  }

  if (!dragStarted) {
    return;
  }

  window.petApi.dragMove({ screenX: event.screenX, screenY: event.screenY });

  const dragDeltaX = event.screenX - lastDragScreenX;
  lastDragScreenX = event.screenX;
  if (Math.abs(dragDeltaX) < 2) {
    return;
  }

  const nextDirection = dragDeltaX > 0 ? 'right' : 'left';
  if (nextDirection === lastDragDirection) {
    return;
  }

  lastDragDirection = nextDirection;
  if (nextDirection === 'right') {
    playInteraction('draggingRight');
  } else {
    playInteraction('draggingLeft');
  }
}

function handlePointerUp() {
  if (dragStarted) {
    window.petApi.dragEnd();
    pulseClass('drop', 180);
    playInteraction('dragEnd');
  }

  isDragging = false;
  dragStarted = false;
  dragStartPoint = null;
  lastDragDirection = null;
  lastDragScreenX = null;
  canvas.classList.remove('dragging');
}

function handleClick(event) {
  if (!isPointerInside) {
    return;
  }

  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  markInteraction();
  const now = Date.now();
  clickHistory = [...clickHistory.filter((time) => now - time <= CLICK_BURST_WINDOW_MS), now];

  if (clickHistory.length >= TRIPLE_CLICK_COUNT) {
    clearTimeout(clickTimer);
    clickHistory = [];
    pulseClass('double-tap', 260);
    playInteraction('tripleClick');
    return;
  }

  clearTimeout(clickTimer);
  const resolveDelay = clickHistory.length >= 2 ? DOUBLE_CLICK_RESOLVE_MS : SINGLE_CLICK_RESOLVE_MS;
  clickTimer = setTimeout(() => {
    const clickCount = clickHistory.length;
    clickHistory = [];
    if (clickCount >= 2) {
      pulseClass('double-tap', 260);
      playInteraction('doubleClick');
      return;
    }
    pulseClass('tap', 160);
    playInteraction('click', { fpsOverride: SINGLE_CLICK_FPS_OVERRIDE });
  }, resolveDelay);
}

function handleContextMenu(event) {
  event.preventDefault();
  if (!pointInCurrentHitSquare(event.clientX, event.clientY)) {
    return;
  }

  window.petApi.showContextMenu();
}

function handleWheel(event) {
  if (!pet || !pointInCurrentHitSquare(event.clientX, event.clientY)) {
    return;
  }

  event.preventDefault();
  markInteraction();
  if (event.deltaY < 0) {
    pulseClass('double-tap', 240);
    playInteraction('wheelUp');
    return;
  }

  pulseClass('tap', 180);
  playInteraction('wheelDown');
}

function checkTimeBehavior(now = new Date()) {
  applyPassiveState({ force: isLateNight(now) && isUserInactive() });
}

async function checkBatteryBehavior() {
  if (!navigator.getBattery) {
    applyPassiveState();
    return;
  }

  const battery = await navigator.getBattery();
  const level = Math.round(battery.level * 100);
  const nextBattery = {
    charging: battery.charging,
    low: !battery.charging && level <= 20,
    full: battery.charging && level >= 95
  };

  lastKnownBattery = nextBattery;
  forceBatteryTired = forceBatteryTired && !nextBattery.charging;
  applyPassiveState({ force: nextBattery.low || nextBattery.full });
}

function checkIdleBehavior() {
  applyPassiveState({ force: isUserInactive() });
}

function startBehaviorPolling() {
  clearInterval(behaviorTimer);
  behaviorTimer = setInterval(() => {
    checkIdleBehavior();
    checkTimeBehavior();
    checkBatteryBehavior().catch((error) => console.error(error));
  }, BEHAVIOR_POLL_MS);
}

function handleVisibilityChange() {
  isScreenInactive = document.hidden;
  applyPassiveState({ force: true });
}

function handleSystemEvent(eventName) {
  if (eventName === 'screenLocked') {
    isScreenInactive = true;
  } else if (eventName === 'screenUnlocked') {
    isScreenInactive = false;
    lastUserActivityAt = Date.now();
  } else if (eventName === 'batteryLow') {
    forceBatteryTired = true;
  } else if (eventName === 'batteryCharging') {
    forceBatteryTired = false;
  } else if (eventName === 'userIdle') {
    lastUserActivityAt = Date.now() - USER_IDLE_EVENT_MS;
  }

  applyPassiveState({ force: true });
}

async function boot() {
  canvas.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('mousemove', updateMousePassthrough);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('click', handleClick);
  window.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('wheel', handleWheel, { passive: false });
  document.addEventListener('visibilitychange', handleVisibilityChange);

  window.petApi.onPetChanged((changedPet) => {
    setPet(changedPet).catch((error) => {
      console.error(error);
    });
  });

  petScale = await window.petApi.getScale();
  window.petApi.onScaleChanged((scale) => {
    petScale = scale;
  });
  window.petApi.onSystemEvent(handleSystemEvent);

  const activePet = await window.petApi.getActivePet();
  await setPet(activePet);
  if (!activePet) {
    const installedPet = await window.petApi.installPetFromDialog();
    if (installedPet) {
      await setPet(installedPet);
    }
  }

  if (!animationRequest) {
    animationRequest = requestAnimationFrame(renderFrame);
  }
  startBehaviorPolling();
}

boot().catch((error) => {
  console.error(error);
});
