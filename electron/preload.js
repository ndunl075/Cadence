'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cadence', {
  state: () => ipcRenderer.invoke('cadence:state'),
  report: (provider) => ipcRenderer.invoke('cadence:report', provider),
  refresh: (provider) => ipcRenderer.invoke('cadence:refresh', provider),
  setProvider: (provider) => ipcRenderer.invoke('cadence:provider', provider),
  setMetric: (metric) => ipcRenderer.invoke('cadence:metric', metric),
  setPinned: (pinned) => ipcRenderer.invoke('cadence:pin', pinned),
  close: () => ipcRenderer.send('cadence:close'),
  minimize: () => ipcRenderer.send('cadence:minimize'),
  onTick: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('cadence:tick', listener);
    return () => ipcRenderer.removeListener('cadence:tick', listener);
  },
});
