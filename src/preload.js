const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getActivePet: () => ipcRenderer.invoke('pet:get-active'),
  installPetFromDialog: () => ipcRenderer.invoke('pet:install-dialog'),
  listPets: () => ipcRenderer.invoke('pet:list'),
  selectPet: (petId) => ipcRenderer.invoke('pet:select', petId),
  getScale: () => ipcRenderer.invoke('view:get-scale'),
  showContextMenu: () => ipcRenderer.invoke('pet:show-menu'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  previewScale: (scale) => ipcRenderer.invoke('settings:preview-scale', scale),
  savePreferences: (preferences) => ipcRenderer.invoke('settings:save', preferences),
  closeSettings: () => ipcRenderer.invoke('settings:close'),
  setMousePassthrough: (passthrough) => ipcRenderer.send('window:set-mouse-passthrough', passthrough),
  dragStart: (point) => ipcRenderer.send('window:drag-start', point),
  dragMove: (point) => ipcRenderer.send('window:drag-move', point),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  onPetChanged: (callback) => {
    ipcRenderer.on('pet:changed', (_event, pet) => callback(pet));
  },
  onScaleChanged: (callback) => {
    ipcRenderer.on('view:scale-changed', (_event, scale) => callback(scale));
  }
});
