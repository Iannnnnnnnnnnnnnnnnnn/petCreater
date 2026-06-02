const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getActivePet: () => ipcRenderer.invoke('pet:get-active'),
  installPetFromDialog: () => ipcRenderer.invoke('pet:install-dialog'),
  listPets: () => ipcRenderer.invoke('pet:list'),
  selectPet: (petId) => ipcRenderer.invoke('pet:select', petId),
  getScale: () => ipcRenderer.invoke('view:get-scale'),
  showContextMenu: () => ipcRenderer.invoke('pet:show-menu'),
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
