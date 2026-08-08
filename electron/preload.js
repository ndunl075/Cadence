'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cadence', {
  report: (provider) => ipcRenderer.invoke('cadence:report', provider),
  refresh: (provider) => ipcRenderer.invoke('cadence:refresh', provider),
  setProvider: (provider) => ipcRenderer.invoke('cadence:provider', provider),
  settings: () => ipcRenderer.invoke('cadence:settings'),
  saveSettings: (patch) => ipcRenderer.invoke('cadence:settings:set', patch),
  close: () => ipcRenderer.send('cadence:close'),
  minimize: () => ipcRenderer.send('cadence:minimize'),
  onTick: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('cadence:tick', listener);
    return () => ipcRenderer.removeListener('cadence:tick', listener);
  },
});
