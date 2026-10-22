// חלון שולחני (Electron): מפעיל את השרת המקומי ומציג את הלוח במסך מלא
import { app, BrowserWindow, shell, Menu } from 'electron';
import path from 'node:path';
import { startServer } from './server.js';

app.whenReady().then(async () => {
  // ההגדרות נשמרות בתיקיית המשתמש, כדי שישרדו עדכון של האפליקציה
  const configFile = path.join(app.getPath('userData'), 'config.json');
  const { port } = await startServer({ port: 0, configFile });

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1080,
    height: 1920,
    backgroundColor: '#0b2a3f',
    title: 'Chartbeat Board',
    autoHideMenuBar: true,
    fullscreen: process.argv.includes('--fullscreen'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // קישורים לכתבות נפתחים בדפדפן הרגיל
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // F11 מסך מלא, F5 רענון
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F5') win.reload();
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
});

app.on('window-all-closed', () => app.quit());
