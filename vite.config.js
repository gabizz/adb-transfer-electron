// /Users/user/git/electron-adb/vite.config.js
import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    // plugins: [react()],
  optimizeDeps: {
    include: [
      '@mui/material',
      '@mui/icons-material',
      '@mui/x-date-pickers',
      '@emotion/react',
      '@emotion/styled',
      // Add other MUI or emotion packages if similar warnings appear for them
    ],
  },
  base: './', // Important for Electron to find assets correctly after build
  build: {
    outDir: 'dist/renderer', // Output directory for the renderer bundle
    rollupOptions: {
      output: {
        // Ensure that the entry file is named appropriately if needed,
        // Vite usually handles this well.
      }
    }
  },
  // Optional: If you want to serve from a specific port during development
  // server: {
  //   port: 3000 
  // },
});
