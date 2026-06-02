const canvas = document.getElementById('petCanvas');
const context = canvas.getContext('2d');
const emptyPanel = document.getElementById('emptyPanel');
const installButton = document.getElementById('installButton');

let pet = null;
let spritesheet = null;
let currentStateName = 'idle';
let currentFrame = 0;
let lastFrameAt = 0;
let animationRequest = null;
let clickTimer = null;
let isDragging = false;
let dragStarted = false;
let dragStartPoint = null;
let suppressNextClick = false;

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
}

function playInteraction(name) {
  const targetState = interactionState(name);
  if (targetState) {
    playState(targetState, { restart: true });
  }
}

function clearCanvas() {
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function renderFrame(now) {
  animationRequest = requestAnimationFrame(renderFrame);
  if (!pet || !spritesheet || !spritesheet.complete) {
    clearCanvas();
    return;
  }

  const state = stateConfig(currentStateName) || stateConfig('idle');
  const fps = Number(state.fps || 6);
  const frameDuration = 1000 / fps;

  if (!lastFrameAt) {
    lastFrameAt = now;
  }

  if (now - lastFrameAt >= frameDuration) {
    currentFrame += 1;
    lastFrameAt = now;

    if (currentFrame >= Number(state.frames || 1)) {
      if (state.loop !== false) {
        currentFrame = 0;
      } else {
        playState(state.next || 'idle', { restart: true });
      }
    }
  }

  const activeState = stateConfig(currentStateName) || state;
  const cellWidth = Number(pet.cellWidth || 192);
  const cellHeight = Number(pet.cellHeight || 208);
  const sourceX = currentFrame * cellWidth;
  const sourceY = Number(activeState.row || 0) * cellHeight;

  canvas.width = cellWidth;
  canvas.height = cellHeight;
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

  if (!pet) {
    canvas.hidden = true;
    emptyPanel.hidden = false;
    clearCanvas();
    return;
  }

  emptyPanel.hidden = true;
  canvas.hidden = false;
  spritesheet = await loadSpritesheet(pet);
  playState('idle', { restart: true });
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

  if (event.screenX >= dragStartPoint.screenX) {
    playInteraction('draggingRight');
  } else {
    playInteraction('draggingLeft');
  }
}

function handlePointerUp() {
  if (dragStarted) {
    window.petApi.dragEnd();
    playInteraction('dragEnd');
  }

  isDragging = false;
  dragStarted = false;
  dragStartPoint = null;
  canvas.classList.remove('dragging');
}

function handleClick() {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    playInteraction('click');
  }, 220);
}

function handleDoubleClick() {
  clearTimeout(clickTimer);
  playInteraction('doubleClick');
}

function handleContextMenu(event) {
  event.preventDefault();
  playInteraction('rightClick');
  window.petApi.showContextMenu();
}

async function boot() {
  installButton.addEventListener('click', async () => {
    const installedPet = await window.petApi.installPetFromDialog();
    if (installedPet) {
      await setPet(installedPet);
    }
  });

  canvas.addEventListener('mousedown', handlePointerDown);
  window.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseup', handlePointerUp);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('dblclick', handleDoubleClick);
  canvas.addEventListener('mouseenter', () => playInteraction('hover'));
  canvas.addEventListener('mouseleave', () => {
    if (!isDragging) {
      playState('idle');
    }
  });
  window.addEventListener('contextmenu', handleContextMenu);

  window.petApi.onPetChanged((changedPet) => {
    setPet(changedPet).catch((error) => {
      console.error(error);
    });
  });

  await setPet(await window.petApi.getActivePet());
  if (!animationRequest) {
    animationRequest = requestAnimationFrame(renderFrame);
  }
}

boot().catch((error) => {
  console.error(error);
});
