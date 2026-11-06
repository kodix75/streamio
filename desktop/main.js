/* ═══════════════════════════════════════════════════════════
   STREAMIO · desktop/main.js — electron shell (AppImage)
   ═══════════════════════════════════════════════════════════ */
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");

const HOME = process.env.HOME || require("os").homedir();
const STREAMIO_HOME = path.join(HOME, ".streamio");

function installedAppDir() {
  const d = path.join(STREAMIO_HOME, "app");
  return fs.existsSync(path.join(d, "index.html")) ? d : null;
}
function bundledAppDir() {
  const candidates = [
    path.join(process.resourcesPath || "", "..", "app"),
    path.join(__dirname, "..", "app"),
    path.join(__dirname, "app"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "index.html"))) return c;
  return path.join(__dirname, "app");
}
function appDir() { return installedAppDir() || bundledAppDir(); }

function installedServerDir() {
  const d = path.join(STREAMIO_HOME, "server");
  return fs.existsSync(path.join(d, "index.js")) ? d : null;
}
function bundledServerDir() {
  const candidates = [
    path.join(process.resourcesPath || "", "..", "server"),
    path.join(__dirname, "..", "server"),
    path.join(__dirname, "server"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "index.js"))) return c;
  return path.join(__dirname, "server");
}
function serverDir() { return installedServerDir() || bundledServerDir(); }

let backendProc = null;

function startBackend() {
  const sdir = serverDir();
  const indexJs = path.join(sdir, "index.js");
  if (!fs.existsSync(indexJs)) return Promise.resolve(false);
  if (!fs.existsSync(path.join(sdir, "node_modules"))) {
    try { require("child_process").execSync("npm install --silent --no-audit --no-fund", { cwd: sdir, stdio: "ignore", timeout: 120000 }); }
    catch (e) { console.warn("backend deps missing; torrents will use in-browser WebTorrent"); return Promise.resolve(false); }
  }
  return new Promise((resolve) => {
    backendProc = spawn("node", [indexJs], { cwd: sdir, stdio: "ignore", env: { ...process.env, PORT: "7000" } });
    backendProc.on("error", () => resolve(false));
    let tries = 0;
    const check = () => {
      http.get("http://127.0.0.1:7000/health", (r) => {
        if (r.statusCode === 200) resolve(true); else retry();
      }).on("error", retry);
    };
    const retry = () => { if (++tries > 25) { resolve(false); return; } setTimeout(check, 400); };
    setTimeout(check, 400);
  });
}

function createWindow() {
  const dir = appDir();
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 500, minHeight: 500,
    backgroundColor: "#040d08",
    title: "Streamio",
    icon: path.join(dir, "assets", "logo.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(dir, "index.html"));
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