# Electron ADB File Transfer

A desktop application built with Electron for browsing and transferring files to/from Android devices using ADB (Android Debug Bridge).

## Features

*   List connected ADB devices.
*   Browse files and folders on the selected Android device.
*   Preview image and video files directly from the device.
*   Download files from the device to your computer.
*   Upload files from your computer to the device (via file selection dialog).
*   Download multiple selected files as a ZIP archive.
*   Delete files from the device (with confirmation).
*   Batch delete multiple selected files (with confirmation).

## Prerequisites

*   **Node.js**: Required for running from source and building. Download from [nodejs.org](https://nodejs.org/).
*   **Yarn (recommended) or npm**: Package managers for Node.js. Yarn is generally faster.
    *   Install Yarn: `npm install --global yarn`
*   **ADB (Android Debug Bridge)**:
    *   It's recommended to have ADB installed and configured in your system's PATH. You can get it as part of the Android SDK Platform Tools.
    *   While `adbkit` (used by this app) can sometimes manage its own ADB server, having a system-wide ADB installation is more reliable.

## Phone Setup (USB Debugging)

To allow the application to communicate with your Android device, you need to enable USB Debugging:

1.  **Enable Developer Options:**
    *   On your Android device, go to **Settings > About phone**.
    *   Tap on **Build number** repeatedly (usually 7 times) until you see a message saying "You are now a developer!"
2.  **Enable USB Debugging:**
    *   Go back to **Settings**, then find **System > Developer options** (the location might vary slightly depending on your Android version and manufacturer).
    *   Inside Developer options, find and enable **USB debugging**.
3.  **Connect your Device:**
    *   Connect your Android device to your computer using a USB cable.
4.  **Authorize the Device:**
    *   When you connect your device with USB debugging enabled for the first time to a new computer, a prompt should appear on your device asking "Allow USB debugging?".
    *   Check "Always allow from this computer" (optional, but recommended for convenience) and tap **Allow** (or **OK**).

## ADB Drivers (Windows)

If you are on Windows and your device is not recognized by ADB (e.g., it doesn't show up when you run `adb devices` in a command prompt), you may need to install ADB drivers.

*   **OEM Drivers**: The best source is usually your device manufacturer's website. Search for "[your device manufacturer] USB drivers".
*   **Google USB Driver**: For Google Pixel/Nexus devices, or as a generic option, you can use the Google USB Driver, available through Android Studio's SDK Manager or as a standalone download.

## Installation and Running

### Option 1: From Release (Recommended for most users)

1.  Go to [https://signportal.ro/downloads](https://signportal.ro/downloads/index.html).
2.  Download the appropriate file for your operating system from the project's section:
    *   `.exe` for Windows
    *   `.dmg` for macOS
3.  Install and run the application like any other desktop app.

### Option 2: From Source (For developers or if no release is available)

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/gabizz/adb-transfer-electron
    cd electron-adb
    ```
2.  **Install dependencies:**
    ```bash
    yarn install
    # or if you prefer npm:
    # npm install
    ```
3.  **Run in development mode:**
    This will typically start a Vite development server for the renderer and launch the Electron app.
    ```bash
    yarn dev
    # or if you prefer npm:
    # npm run dev
    ```
    *(Note: The exact script name `dev` depends on how it's defined in `package.json`.)*

## Building from Source

To create a distributable package of the application:

1.  **Ensure dependencies are installed:**
    ```bash
    yarn install
    # or npm install
    ```
2.  **Build the renderer code (if using Vite or similar bundler):**
    Your `package.json` likely has a script for this. It might be:
    ```bash
    yarn build:renderer
    # or npm run build:renderer
    # or simply `vite build` if configured directly
    ```
    This step bundles your React/renderer code into the `dist/renderer` directory (as per your `vite.config.js`).

3.  **Package the Electron application:**
    Your `package.json` should have a script for `electron-builder` or a similar packaging tool.
    ```bash
    yarn package
    # or npm run package
    # or specific commands like `yarn dist`, `electron-builder --win --mac`, etc.
    ```

    For your convenience, in package,json there are already 2 scripts already defined:
    ```bash
    yarn build:win
    yarn build:mac
```
    that should run all the necessary steps for obtaining an installation "kit".
    
    This will generate installable files (e.g., `.exe`, `.dmg`) in a `dist` or `release` folder.

## How to Use the Application

1.  **Launch the Application:** Start the app either from a pre-built release or by running it from source.
2.  **Connect Device:** Ensure your Android device is connected via USB with USB Debugging enabled and authorized (see "Phone Setup" above).
3.  **Select Device:** If multiple devices are connected, select your target device from the dropdown menu at the top of the application.
4.  **Refresh/Load Files:** The file browser should automatically load the contents of `/sdcard/` for the selected device. You can use the "Refresh" button to reload the current directory.
5.  **Navigate:**
    *   Click on folder names to enter them.
    *   Use the "Up" arrow icon (↑) to navigate to the parent directory.
6.  **File Actions:**
    *   **Click on a file:**
        *   Images and videos will attempt to show a preview in a modal.
        *   Other file types might not have a direct preview.
    *   **Download (from preview modal):** Click the "Download" button in the preview modal.
    *   **Download Selected (ZIP):** Select one or more files using the checkboxes in the table, then click the "Download X Selected" button. Files will be zipped and downloaded.
    *   **Delete File (row action):** Click the trash icon on a file's row to delete it (a confirmation will appear).
    *   **Remove Selected (batch delete):** Select one or more files using the checkboxes, then click the "Remove X Selected" button (a confirmation will appear).
7.  **Upload File:** (This feature is initiated by `ipcMain.handle('push-file', ...)` which uses `dialog.showOpenDialog`. The UI part for triggering this is not explicitly detailed in `renderer.jsx` but the backend capability exists. Typically, there would be an "Upload" button.)
    *   If an "Upload" button exists, click it.
    *   Select the file from your computer.
    *   The file will be pushed to the current `remotePath` on the device. If `remotePath` is a directory, the file will be placed inside it.

---

*This README assumes standard script names like `dev`, `build:renderer`, and `package` in your `package.json`. Adjust these commands if your project uses different script names.*
