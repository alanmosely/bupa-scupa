const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'scupa',
  Object.freeze({
    call: (command, options) => ipcRenderer.invoke('scupa:call', command, options),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      ipcRenderer.on('scupa:progress', handler);
      return () => ipcRenderer.removeListener('scupa:progress', handler);
    },
  }),
);
