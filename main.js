const { app, BrowserWindow, ipcMain, dialog, protocol, session } = require('electron');
const path = require('path');
const adb = require('adbkit');
const fs = require('fs');
const stream = require('stream');
const { promisify } = require('util');
const JSZip = require('jszip');
const pipeline = promisify(stream.pipeline);

// Keep track of temporary files for cleanup
const tempPreviewFiles = new Set();
const client = adb.createClient();

async function listDevices() {
  const devices = await client.listDevices();
  return devices.map(d => d.id);
}

async function listFolderOnDevice(deviceId, remotePath) {
  try {
    const entries = await client.readdir(deviceId, remotePath);
    // Convert Dirent objects to a simpler format for sending over IPC
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      size: entry.size,
      mtime: entry.mtime,
    }));
  } catch (error) {
    console.error(`Error listing folder ${remotePath} on ${deviceId}:`, error);
    return { error: error.message || `Failed to list directory ${remotePath}` };
  }
}

async function pullFileToBuffer(deviceId, remotePath) {
  try {
    const transfer = await client.pull(deviceId, remotePath);
    return new Promise((resolve, reject) => {
      const chunks = [];
      transfer.on('data', (chunk) => chunks.push(chunk));
      transfer.on('end', () => resolve(Buffer.concat(chunks)));
      transfer.on('error', reject);
    });
  } catch (error) {
    console.error(`Error pulling file ${remotePath} to buffer from ${deviceId}:`, error);
    throw error;
  }
}
async function pushFileToDevice(deviceId, localPath, remotePath) {
  return client.push(deviceId, localPath, remotePath);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the index.html of the app.
  // In development, load from Vite dev server.
  // In production, load the built HTML file.
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173'); // Default Vite port, adjust if needed
  } else {
    win.loadFile(path.join(__dirname, 'dist/renderer/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  // Adjust Content Security Policy to allow custom video protocol and other necessary sources
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Build CSP directives programmatically for clarity
    const cspDirectives = {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // MUI often uses inline styles
      "img-src": ["'self'", "data:"],             // For base64 image previews
      "media-src": ["'self'", "atom-video:"],     // Crucial for your video previews
      "font-src": ["'self'"],                     // If you use custom fonts loaded locally
      "connect-src": ["'self'"],                  // Default connect-src
    };

    if (process.env.NODE_ENV === 'development') {
      cspDirectives["script-src"].push("'unsafe-eval'"); // For Vite HMR
      cspDirectives["connect-src"].push("ws://localhost:5173"); // For Vite HMR WebSocket
    }

    const cspString = Object.entries(cspDirectives)
      .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
      .join('; ');

    details.responseHeaders['Content-Security-Policy'] = [cspString];
    callback({ responseHeaders: details.responseHeaders });
  });

  // Register a custom protocol to serve temporary video files.
  // This helps with webSecurity restrictions when loading file:/// URLs from http:// origins.
  protocol.registerFileProtocol('atom-video', (request, callback) => {
    // request.url will be like 'atom-video://unique-filename.mp4'
    // We need to extract 'unique-filename.mp4'
    // console.log('[atom-video] Received request URL:', request.url);
    let filenameComponent = request.url.substr('atom-video://'.length);
    try {
      filenameComponent = decodeURIComponent(filenameComponent);
    } catch (e) {
      console.error('[atom-video] Error decoding URI component:', filenameComponent, e);
      callback({ error: -2 }); // net::ERR_FAILED
      return;
    }
    const tempDir = app.getPath('temp');
    const filePath = path.join(tempDir, path.normalize(filenameComponent)); // Normalize to prevent path traversal issues

    // console.log(`[atom-video] Attempting to serve: ${filePath} (from filename: ${filenameComponent})`);
    // Ensure the file path is within the expected temp directory for security
    if (filePath.startsWith(tempDir) && fs.existsSync(filePath)) {
      // console.log('[atom-video] Serving file:', filePath);
      callback({ path: filePath });
    } else {
      console.error(`[atom-video] File not found or access blocked: ${filePath}. Exists: ${fs.existsSync(filePath)}`);
      callback({ error: -6 }); // -6 is net::ERR_FILE_NOT_FOUND
    }
  });

  ipcMain.handle('list-devices', async () => {
    return await listDevices();
  });

  ipcMain.handle('push-file', async (_, { deviceId, remotePath }) => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] });
      if (canceled || filePaths.length === 0) {
        return { success: false, error: 'File selection cancelled.' };
      }
      const localPath = filePaths[0];
      // adbkit's push handles appending basename if remotePath ends with '/'
      const transfer = await pushFileToDevice(deviceId, localPath, remotePath);
      return new Promise((resolve) => {
        transfer.on('end', () => resolve({ success: true }));
        transfer.on('error', (err) => {
          console.error('Transfer error:', err);
          resolve({ success: false, error: err.message || 'Transfer failed' });
        });
      });
    } catch (error) {
      console.error('Error in push-file handler:', error);
      return { success: false, error: error.message || 'An unexpected error occurred during push operation.' };
    }
  });

  ipcMain.handle('list-folder', async (_, { deviceId, path: folderPath }) => {
    if (!deviceId || !folderPath) return { error: 'Device ID and path are required.' };
    return await listFolderOnDevice(deviceId, folderPath);
  });

  ipcMain.handle('pull-file-for-preview', async (_, { deviceId, remotePath }) => {
    const lowerRemotePath = remotePath.toLowerCase();

    // Handle video files by saving to a temporary local path
    if (lowerRemotePath.endsWith('.mp4') || lowerRemotePath.endsWith('.webm') || lowerRemotePath.endsWith('.ogg') || lowerRemotePath.endsWith('.ogv')) {
      const tempDir = app.getPath('temp');
      const uniqueFileName = `${Date.now()}-${path.basename(remotePath)}`;
      const localTempPath = path.join(tempDir, uniqueFileName);

      try {
        const transfer = await client.pull(deviceId, remotePath);
        await pipeline(transfer, fs.createWriteStream(localTempPath));
        tempPreviewFiles.add(localTempPath); // Track for cleanup

        let mimeType = 'application/octet-stream'; // Fallback
        if (lowerRemotePath.endsWith('.mp4')) mimeType = 'video/mp4';
        else if (lowerRemotePath.endsWith('.webm')) mimeType = 'video/webm';
        else if (lowerRemotePath.endsWith('.ogg') || lowerRemotePath.endsWith('.ogv')) mimeType = 'video/ogg';
        
        console.log(`[pull-file-for-preview] Video saved to temp path: ${localTempPath}, uniqueFileName for URL: ${uniqueFileName}`);
        // Return a URL using the custom protocol, and the actual path for cleanup
        return { success: true, videoUrl: `atom-video://${encodeURIComponent(uniqueFileName)}`, localTempPathForCleanup: localTempPath, mimeType: mimeType };
      } catch (pullError) {
        console.error(`Error pulling video file ${remotePath} to temp path ${localTempPath}:`, pullError);
        return { success: false, error: `Failed to pull video to temporary location: ${pullError.message}` };
      }
    } 
    // Handle image files with base64 data (existing method)
    else if (lowerRemotePath.endsWith('.jpg') || lowerRemotePath.endsWith('.jpeg') || lowerRemotePath.endsWith('.png') || lowerRemotePath.endsWith('.gif') || lowerRemotePath.endsWith('.bmp') || lowerRemotePath.endsWith('.webp')) {
      try {
        const buffer = await pullFileToBuffer(deviceId, remotePath);
        let mimeType = 'application/octet-stream'; // Fallback
        if (lowerRemotePath.endsWith('.jpg') || lowerRemotePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (lowerRemotePath.endsWith('.png')) mimeType = 'image/png';
        else if (lowerRemotePath.endsWith('.gif')) mimeType = 'image/gif';
        else if (lowerRemotePath.endsWith('.bmp')) mimeType = 'image/bmp';
        else if (lowerRemotePath.endsWith('.webp')) mimeType = 'image/webp';
        
        return { success: true, data: buffer.toString('base64'), mimeType: mimeType };
      } catch (error) {
        console.error('Error in pull-file-for-preview (image) handler:', error);
        return { success: false, error: error.message || 'Failed to pull image for preview.' };
      }
    } 
    // File type not supported for direct preview
    else {
      return { success: false, error: 'File type not supported for direct preview via this method.' };
    }
  });

  ipcMain.handle('download-file', async (_, { deviceId, remotePath }) => {
    try {
      const defaultName = path.basename(remotePath);
      const { canceled, filePath: localSavePath } = await dialog.showSaveDialog({
        title: 'Save File As',
        defaultPath: defaultName,
      });
      if (canceled || !localSavePath) return { success: false, error: 'Download cancelled.' };

      const transfer = await client.pull(deviceId, remotePath);
      await pipeline(transfer, fs.createWriteStream(localSavePath));
      return { success: true, path: localSavePath };
    } catch (error) {
      console.error('Error in download-file handler:', error);
      return { success: false, error: error.message || 'Failed to download file.' };
    }
  });

  ipcMain.handle('download-selected-files', async (_, deviceId, filesToDownload) => {
    if (!deviceId || !filesToDownload || filesToDownload.length === 0) {
      return { success: false, error: 'No files or device specified for download.' };
    }

    const { canceled, filePath: zipSavePath } = await dialog.showSaveDialog({
      title: 'Save Selected Files as ZIP',
      defaultPath: 'selected_files.zip',
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
    });

    if (canceled || !zipSavePath) {
      return { success: false, error: 'ZIP download cancelled.' };
    }

    const zip = new JSZip();
    try {
      for (const file of filesToDownload) {
        if (file.key.endsWith('/')) continue; // Skip directories explicitly
        const fileBuffer = await pullFileToBuffer(deviceId, file.key);
        // Use the relative path from the initial browsing point or a simpler name
        // For simplicity, using basename. For full path structure, more logic is needed.
        const fileNameInZip = path.basename(file.key);
        zip.file(fileNameInZip, fileBuffer);
      }
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: "DEFLATE", compressionOptions: { level: 6 } });
      await fs.promises.writeFile(zipSavePath, zipBuffer);
      return { success: true, path: zipSavePath };
    } catch (error) {
      console.error('Error creating or saving ZIP file:', error);
      return { success: false, error: error.message || 'Failed to create or save ZIP file.' };
    }
  });

  ipcMain.handle('remove-file', async (event, { deviceId, remotePath }) => {
    if (!deviceId || !remotePath) {
      return { success: false, error: 'Device ID and remote path are required.' };
    }
    if (remotePath.endsWith('/')) {
      // This check is also in the renderer, but good to have a safeguard here.
      return { success: false, error: 'Path appears to be a directory. Only file deletion is supported by this action.' };
    }

    console.log(`Attempting to remove file: ${remotePath} from device: ${deviceId}`);

    try {
      // Ensure remotePath is properly quoted for the shell command.
      const command = `rm -f "${remotePath.replace(/"/g, '\\"')}"`; // Basic quoting for paths with spaces/quotes
      const stream = await client.shell(deviceId, command);

      return new Promise((resolve) => {
        let shellOutput = '';
        stream.on('data', (data) => shellOutput += data.toString());
        stream.on('end', async () => {
          // Verify deletion by trying to stat the file.
          // If stat fails with "No such file", deletion was successful.
          try {
            await client.stat(deviceId, remotePath);
            // If stat succeeds, the file still exists.
            console.error(`File ${remotePath} still exists after rm command. Shell output: ${shellOutput}`);
            resolve({ success: false, error: `File still exists. ADB shell output: ${shellOutput}`.trim() });
          } catch (statError) {
            if (statError.message && statError.message.toLowerCase().includes('no such file')) {
              console.log(`File ${remotePath} successfully removed from ${deviceId}.`);
              resolve({ success: true }); // Confirmed deletion
            } else {
              // Stat failed for a reason other than "no such file".
              // This means we couldn't confirm deletion, or stat itself failed. Treat as failure.
              console.error(`File ${remotePath} stat failed after rm attempt with non-"no such file" error: ${statError.message}. Shell output: ${shellOutput}`);
              resolve({ success: false, error: `Failed to verify deletion via stat: ${statError.message}. ADB shell output: ${shellOutput}`.trim() });
            }
          }
        });
        stream.on('error', (err) => {
          console.error(`ADB shell command 'rm' error for ${remotePath} on ${deviceId}:`, err);
          resolve({ success: false, error: `Shell command execution failed: ${err.message}` });
        });
      });
    } catch (err) {
      console.error(`Error setting up remove command for file ${remotePath} from ${deviceId}:`, err);
      return { success: false, error: err.message || 'An unknown error occurred during file removal setup.' };
    }
  });

  ipcMain.handle('cleanup-preview-file', async (_, localPath) => {
    if (localPath && typeof localPath === 'string') {
      try {
        if (fs.existsSync(localPath)) {
          await fs.promises.unlink(localPath);
          tempPreviewFiles.delete(localPath);
          console.log('Cleaned up temp preview file:', localPath);
          return { success: true };
        }
        // If file doesn't exist, consider it successfully "cleaned" or already gone
        tempPreviewFiles.delete(localPath); // Ensure it's removed from tracking
        return { success: true, message: 'File not found, considered cleaned.' };
      } catch (error) {
        console.error('Error cleaning up temp preview file:', localPath, error);
        // Still remove from tracking if an error occurs during unlink
        tempPreviewFiles.delete(localPath);
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: 'Invalid path provided for cleanup.' };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  // Cleanup any remaining temporary preview files when the app quits
  tempPreviewFiles.forEach(filePath => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) { /* Ignore errors during bulk cleanup on quit */ }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
