const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listDevices: () => ipcRenderer.invoke('list-devices'),
  pushFile: (deviceId, remotePath) => ipcRenderer.invoke('push-file', { deviceId, remotePath }),
  listFolder: (deviceId, path) => ipcRenderer.invoke('list-folder', { deviceId, path }),
  pullFileForPreview: (deviceId, remotePath) => ipcRenderer.invoke('pull-file-for-preview', { deviceId, remotePath }),
  downloadSelectedFiles: (deviceId, filesToDownload) => ipcRenderer.invoke('download-selected-files', deviceId, filesToDownload),
  downloadFile: (deviceId, remotePath) => ipcRenderer.invoke('download-file', { deviceId, remotePath }),
  removeFile: (deviceId, remotePath) => ipcRenderer.invoke('remove-file', { deviceId, remotePath }),
  cleanupPreviewFile: (localPath) => ipcRenderer.invoke('cleanup-preview-file', localPath),
});
