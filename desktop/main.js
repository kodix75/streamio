/* ═══════════════════════════════════════════════════════════
   STREAMIO · desktop/main.js — electron shell (AppImage)
   wraps the same web app so the forest can live in a window
   Also spawns the local backend (server/) so torrents play.
   ═══════════════════════════════════════════════════════════ */
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

let backendProc = null;

function startBackend(){
  const serverDir = path.join(__dirname, "server");
  const indexJs = path.join(serverDir, "index.js");
  const fs = require("fs");
  if (!fs.existsSync(indexJs)) return Promise.resolve(false);
  // ensure deps
  if (!fs.existsSync(path.join(serverDir, "node_modules"))) {
    try { require("child_process").execSync("npm install --silent --no-audit --no-fund", { cwd: serverDir, stdio: "ignore" }); }
    catch (e) { console.warn("backend deps missing; torrents will use in-browser WebTorrent"); return Promise.resolve(false); }
  }
  return new Promise((resolve) => {
    backendProc = spawn("node", [indexJs], { cwd: serverDir, stdio: "ignore", env: { ...process.env, PORT: "7000" } });
    backendProc.on("error", () => resolve(false));
    // wait for health
    let tries = 0;
    const check = () => {
      http.get("http://127.0.0.1:7000/health", (r) => {
        if (r.statusCode === 200) resolve(true);
        else retry();
      }).on("error", retry);
    };
    const retry = () => {
      if (++tries > 25) { resolve(false); return; }
      setTimeout(check, 400);
    };
    setTimeout(check, 400);
  });
}

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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await startBackend();
  createWindow();
  app.on("activate", () => (BrowserWindow.getAllWindows().length === 0 ? createWindow() : null));
});

app.on("window-all-closed", () => {
  if (backendProc) { try { backendProc.kill(); } catch (e) {} backendProc = null; }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backendProc) { try { backendProc.kill(); } catch (e) {} backendProc = null; }
});