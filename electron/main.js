// Thin desktop shell: just a native window pointed at the real site. The site's
// logic (frontend + Backend/) never lives inside this app -- when hosting moves
// off localhost, only APP_URL below needs to change, nothing else in the repo.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// No app menu at all -- otherwise Alt still reveals a default "View > Toggle
// Developer Tools" item regardless of the devTools:false webPreference below.
Menu.setApplicationMenu(null);

// TODO: swap to the real hosted domain once deployment is live.
// Using the host machine's LAN IP (not "localhost") so other devices on the
// same WiFi can reach it too -- "localhost" always means the DEVICE IT RUNS
// ON, never the machine that's actually serving the app.
const APP_URL = 'https://192.168.0.104:3000';

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'AniKino',
        icon: path.join(__dirname, '..', 'img', 'LOGO_Short.png'),
        autoHideMenuBar: true,
        backgroundColor: '#050505',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: false
        }
    });

    win.loadURL(APP_URL);

    // -------------------------------------------------------------
    // Add F11 Fullscreen Toggle Here:
    // -------------------------------------------------------------
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F11') {
            win.setFullScreen(!win.isFullScreen());
            event.preventDefault(); // Stop default web behavior
        }
    });

    // External links (target=_blank, window.open) open in browser
    win.webContents.setWindowOpenHandler(({ url }) => {
        require('electron').shell.openExternal(url);
        return { action: 'deny' };
    });
}

// middleware.js's dev cert (Backend/cert/localhost.pfx) is self-signed --
// Chromium normally hard-blocks that with no override. This scopes the bypass
// to localhost specifically (checked by hostname, not just "any TLS error")
// so a real deployment's certificate is never silently trusted the same way.
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch (_) { /* ignore */ }
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '192.168.0.104') {
        event.preventDefault();
        callback(true);
    } else {
        callback(false);
    }
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
