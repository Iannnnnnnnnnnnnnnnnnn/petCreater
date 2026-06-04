const scaleRange = document.getElementById('scaleRange');
const scaleValue = document.getElementById('scaleValue');
const cycleEnabled = document.getElementById('cycleEnabled');
const intervalValue = document.getElementById('intervalValue');
const intervalUnit = document.getElementById('intervalUnit');
const petList = document.getElementById('petList');
const saveButton = document.getElementById('saveButton');
const cancelButton = document.getElementById('cancelButton');
const saveStatus = document.getElementById('saveStatus');

let settingsSnapshot = null;
let previewTimer = null;

function secondsToDisplay(seconds) {
  if (seconds % 3600 === 0) {
    return { value: seconds / 3600, unit: 'hours' };
  }
  if (seconds % 60 === 0) {
    return { value: seconds / 60, unit: 'minutes' };
  }
  return { value: seconds, unit: 'seconds' };
}

function displayToSeconds(value, unit) {
  const numericValue = Math.max(1, Number(value) || 1);
  if (unit === 'hours') {
    return numericValue * 3600;
  }
  if (unit === 'minutes') {
    return numericValue * 60;
  }
  return numericValue;
}

function selectedPetIds() {
  return [...petList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((checkbox) => checkbox.value);
}

function updateCycleControlState() {
  const enabled = cycleEnabled.checked;
  intervalValue.disabled = !enabled;
  intervalUnit.disabled = !enabled;
  for (const checkbox of petList.querySelectorAll('input[type="checkbox"]')) {
    checkbox.disabled = !enabled;
  }
}

function updateIntervalConstraints() {
  intervalValue.min = intervalUnit.value === 'seconds' ? '10' : '1';
}

function renderPetList(pets) {
  petList.replaceChildren();
  cycleEnabled.disabled = pets.length < 2;

  if (!pets.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '暂无已安装形象';
    petList.appendChild(empty);
    return;
  }

  for (const pet of pets) {
    const label = document.createElement('label');
    label.className = 'pet-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = pet.id;
    checkbox.checked = pet.selected;

    const name = document.createElement('span');
    name.className = 'pet-name';
    name.textContent = pet.displayName;

    label.append(checkbox, name);
    petList.appendChild(label);
  }
}

function renderSettings(snapshot) {
  settingsSnapshot = snapshot;
  const scalePercent = Math.round(snapshot.petScale * 100);
  const interval = secondsToDisplay(snapshot.cycleIntervalSeconds);

  scaleRange.value = String(scalePercent);
  scaleValue.textContent = `${scalePercent}%`;
  cycleEnabled.checked = snapshot.cycleEnabled;
  intervalValue.value = String(interval.value);
  intervalUnit.value = interval.unit;
  renderPetList(snapshot.pets);
  updateIntervalConstraints();
  updateCycleControlState();
}

function showStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? '#b3261e' : '#137333';
}

scaleRange.addEventListener('input', () => {
  const scalePercent = Number(scaleRange.value);
  scaleValue.textContent = `${scalePercent}%`;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    window.petApi.previewScale(scalePercent / 100);
  }, 40);
});

cycleEnabled.addEventListener('change', updateCycleControlState);
intervalUnit.addEventListener('change', updateIntervalConstraints);

saveButton.addEventListener('click', async () => {
  const petIds = selectedPetIds();
  if (cycleEnabled.checked && petIds.length < 2) {
    showStatus('循环至少需要选择两个形象', true);
    return;
  }

  saveButton.disabled = true;
  try {
    const saved = await window.petApi.savePreferences({
      petScale: Number(scaleRange.value) / 100,
      cycleEnabled: cycleEnabled.checked,
      cyclePetIds: petIds,
      cycleIntervalSeconds: displayToSeconds(intervalValue.value, intervalUnit.value)
    });
    renderSettings(saved);
    showStatus('已保存');
  } catch (error) {
    showStatus(error.message || '保存失败', true);
  } finally {
    saveButton.disabled = false;
  }
});

cancelButton.addEventListener('click', () => {
  window.petApi.closeSettings();
});

window.petApi.getSettings()
  .then(renderSettings)
  .catch((error) => showStatus(error.message || '设置加载失败', true));
