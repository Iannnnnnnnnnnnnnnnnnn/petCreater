const canvas = document.getElementById('petCanvas');
const context = canvas.getContext('2d');

let pet = null;
let spritesheet = null;
let renderMode = 'atlas';
let currentStateName = 'idle';
let currentFrame = 0;
let lastFrameAt = 0;
let animationRequest = null;
let clickTimer = null;
let hoverIdleTimer = null;
let idleSlowTimer = null;
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

const DEFAULT_CANVAS_WIDTH = 192;
const DEFAULT_CANVAS_HEIGHT = 208;
const IDLE_SLOW_DELAY_MS = 8000;
const FRAME_ALPHA_SAMPLE_STEP = 4;

function stateConfig(name) {
  return pet && pet.states && pet.states[name] ? pet.states[name] : null;
}

function interactionState(name) {
  return pet && pet.interactions ? pet.interactions[name] : null;
}

function playState(name, options = {}) {
  if (!pet || !name || !stateConfig(name)) {
    name = 'idle';
  }

  if (currentStateName !== name || options.restart) {
    currentStateName = name;
    currentFrame = 0;
    lastFrameAt = 0;
  }

  currentFpsOverride = options.fpsOverride || null;
}

function playInteraction(name) {
  const targetState = interactionState(name);
  if (targetState) {
    playState(targetState, { restart: true });
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
  waitForLeaveBeforeWaiting = true;
  waitingLoopsRemaining = 0;
  clearIdleSlowTimer();
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

function hasAtlasFrames(image, nextPet) {
  const states = nextPet.states || {};
  const maxRow = Math.max(...Object.values(states).map((state) => Number(state.row || 0)));
  const maxFrames = Math.max(...Object.values(states).map((state) => Number(state.frames || 1)));
  const cellWidth = Number(nextPet.cellWidth || DEFAULT_CANVAS_WIDTH);
  const cellHeight = Number(nextPet.cellHeight || DEFAULT_CANVAS_HEIGHT);

  return image.naturalWidth >= maxFrames * cellWidth && image.naturalHeight >= (maxRow + 1) * cellHeight;
}

function isFrameVisible(image, sourceX, sourceY, cellWidth, cellHeight) {
  if (
    sourceX < 0 ||
    sourceY < 0 ||
    sourceX + cellWidth > image.naturalWidth ||
    sourceY + cellHeight > image.naturalHeight
  ) {
    return false;
  }

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = cellWidth;
  sampleCanvas.height = cellHeight;
  const sampleContext = sampleCanvas.getContext('2d');
  sampleContext.drawImage(image, sourceX, sourceY, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
  const pixels = sampleContext.getImageData(0, 0, cellWidth, cellHeight).data;

  for (let i = 3; i < pixels.length; i += 4 * FRAME_ALPHA_SAMPLE_STEP) {
    if (pixels[i] > 8) {
      return true;
    }
  }

  return false;
}

function buildFrameSequences(image, nextPet) {
  const sequences = {};
  const cellWidth = Number(nextPet.cellWidth || DEFAULT_CANVAS_WIDTH);
  const cellHeight = Number(nextPet.cellHeight || DEFAULT_CANVAS_HEIGHT);

  for (const [stateName, state] of Object.entries(nextPet.states || {})) {
    const configuredFrameCount = Number(state.frames || 1);
    const row = Number(state.row || 0);
    const visibleFrames = [];
    const validFrames = [];

    for (let frame = 0; frame < configuredFrameCount; frame += 1) {
      const sourceX = frame * cellWidth;
      const sourceY = row * cellHeight;
      if (sourceX + cellWidth <= image.naturalWidth && sourceY + cellHeight <= image.naturalHeight) {
        validFrames.push(frame);
      }
      if (isFrameVisible(image, sourceX, sourceY, cellWidth, cellHeight)) {
        visibleFrames.push(frame);
      }
    }

    sequences[stateName] = visibleFrames.length ? visibleFrames : validFrames;
  }

  return sequences;
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

function renderFrame(now) {
  animationRequest = requestAnimationFrame(renderFrame);
  if (!pet || !spritesheet || !spritesheet.complete) {
    return;
  }

  if (renderMode === 'single-image') {
    const targetWidth = Math.min(Math.max(spritesheet.naturalWidth, 120), 260);
    const targetHeight = Math.min(Math.max(spritesheet.naturalHeight, 120), 300);
    resizeCanvas(targetWidth, targetHeight);
    drawImageContained(spritesheet, targetWidth, targetHeight);
    return;
  }

  const state = stateConfig(currentStateName) || stateConfig('idle');
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
  const cellWidth = Number(pet.cellWidth || 192);
  const cellHeight = Number(pet.cellHeight || 208);
  const frameSequence = getFrameSequence(currentStateName, activeState);
  const sourceFrame = frameSequence[currentFrame] ?? 0;
  const sourceX = sourceFrame * cellWidth;
  const sourceY = Number(activeState.row || 0) * cellHeight;

  resizeCanvas(cellWidth, cellHeight);
  clearCanvas();
  context.drawImage(
    spritesheet,
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

function loadSpritesheet(nextPet) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('素材图片加载失败'));
    image.src = nextPet.spritesheetUrl;
  });
}

async function setPet(nextPet) {
  pet = nextPet;
  spritesheet = null;
  frameSequences = {};
  renderMode = 'atlas';
  currentFrame = 0;
  lastFrameAt = 0;
  currentFpsOverride = null;
  waitForLeaveBeforeWaiting = false;
  waitingLoopsRemaining = 0;
  clearIdleSlowTimer();
  clearCanvas();

  if (!pet) {
    canvas.hidden = true;
    clearCanvas();
    return;
  }

  canvas.hidden = false;

  try {
    spritesheet = await loadSpritesheet(pet);
    renderMode = hasAtlasFrames(spritesheet, pet) ? 'atlas' : 'single-image';
    frameSequences = renderMode === 'atlas' ? buildFrameSequences(spritesheet, pet) : {};
    playState('idle', { restart: true });
    scheduleIdleSlow();
  } catch (error) {
    console.error(error);
    pet = null;
    canvas.hidden = true;
  }
}

function handlePointerDown(event) {
  if (!pet || event.button !== 0) {
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
    if (isPointerInside) {
      playInteraction('hover');
    } else {
      startWaitingWindDown(2);
    }
  }

  isDragging = false;
  dragStarted = false;
  dragStartPoint = null;
  lastDragDirection = null;
  lastDragScreenX = null;
  canvas.classList.remove('dragging');
}

function handleClick() {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    markInteraction();
    pulseClass('tap', 160);
    playInteraction('click');
  }, 220);
}

function handleDoubleClick() {
  clearTimeout(clickTimer);
  markInteraction();
  pulseClass('double-tap', 260);
  playInteraction('doubleClick');
}

function handleContextMenu(event) {
  event.preventDefault();
  window.petApi.showContextMenu();
}

function handleWheel(event) {
  if (!pet) {
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

async function boot() {
  canvas.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('dblclick', handleDoubleClick);
  canvas.addEventListener('mouseenter', () => {
    isPointerInside = true;
    clearTimeout(hoverIdleTimer);
    clearIdleSlowTimer();
    waitForLeaveBeforeWaiting = true;
    playInteraction('hover');
  });
  canvas.addEventListener('mouseleave', () => {
    isPointerInside = false;
    clearTimeout(hoverIdleTimer);
    if (!isDragging) {
      hoverIdleTimer = setTimeout(() => startWaitingWindDown(2), 180);
    }
  });
  window.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('wheel', handleWheel, { passive: false });

  window.petApi.onPetChanged((changedPet) => {
    setPet(changedPet).catch((error) => {
      console.error(error);
    });
  });

  petScale = await window.petApi.getScale();
  window.petApi.onScaleChanged((scale) => {
    petScale = scale;
  });

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
}

boot().catch((error) => {
  console.error(error);
});
