// Aqua Guard Beta — ventana de escritorio (Electron).
// Carga la misma app que usan los celulares (carpeta ../www, copiada a ./www al compilar).
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function crearVentana() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 560,
    title: 'Aqua Guard Beta',
    backgroundColor: '#0a1f44',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  // Los enlaces externos se abren en el navegador, no dentro de la app
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  crearVentana();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) crearVentana(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
