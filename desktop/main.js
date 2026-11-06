/* ═══════════════════════════════════════════════════════════
   STREAMIO · desktop/main.js — electron shell (AppImage)
   wraps the same web app so the forest can live in a window
   ═══════════════════════════════════════════════════════════ */
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

function createWindow(){
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 500, minHeight: 500,
    backgroundColor: "#040d08",
    title: "Streamio",
    icon: path.join(__dirname, "app", "assets", "logo.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" } });
  win.once("ready-to-show", () => win.show());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => (BrowserWindow.getAllWindows().length === 0 ? createWindow() : null));
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() });
