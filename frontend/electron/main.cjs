const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

let mainWindow;
let backendProcess;
let quitting = false;

const isDev = !app.isPackaged;
const projectRoot = path.resolve(__dirname, "../..");
const HEALTH_URL = "http://127.0.0.1:8077/api/health";
const BACKEND = isDev
  ? {
      command: path.join(projectRoot, "venv_build", "Scripts", "python.exe"),
      args: ["run_server.py"],
      cwd: path.join(projectRoot, "backend"),
    }
  : {
      command: path.join(process.resourcesPath, "backend", "GSTClientApp.exe"),
      args: [],
      cwd: path.join(process.resourcesPath, "backend"),
    };

ipcMain.handle("desktop-notify", async (event, payload = {}) => {
  if (!Notification || !Notification.isSupported()) return false;
  try {
    const note = new Notification({
      title: payload.title || "GST Client Management System",
      body: payload.body || "",
      silent: Boolean(payload.silent),
    });
    note.on("click", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      if (payload.link) event.sender.send("notification-click", payload.link);
    });
    note.show();
    return true;
  } catch (error) {
    console.error("Desktop notification failed:", error);
    return false;
  }
});

function probeBackend() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let data = null;
        try {
          data = JSON.parse(body);
        } catch (error) {
          data = null;
        }
        const healthy = Boolean(
          res.statusCode === 200 && data && data.status === "healthy"
        );
        resolve({ alive: true, healthy, data });
      });
    });

    req.setTimeout(1500, () => {
      req.destroy();
      resolve({ alive: false, healthy: false, data: null });
    });
    req.on("error", () => resolve({ alive: false, healthy: false, data: null }));
  });
}

function backendMatches(data) {
  if (!data || !data.executable) return false;
  try {
    return (
      path.resolve(data.executable).toLowerCase() ===
      path.resolve(BACKEND.command).toLowerCase()
    );
  } catch (error) {
    return false;
  }
}

function startBackend() {
  const child = spawn(BACKEND.command, BACKEND.args, {
    cwd: BACKEND.cwd,
    stdio: isDev ? "inherit" : "ignore",
    windowsHide: true,
  });
  backendProcess = child;

  child.on("error", (error) => {
    console.error("Backend startup failed:", error);
  });

  child.on("exit", (code) => {
    if (backendProcess === child) backendProcess = undefined;
    if (!quitting) {
      console.error(`Backend exited unexpectedly with code ${code}`);
      setTimeout(async () => {
        const probe = await probeBackend();
        if (!quitting && !probe.alive) startBackend();
      }, 1500);
    }
  });
}

async function waitForBackend(timeout = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const probe = await probeBackend();
    if (probe.healthy && backendMatches(probe.data)) return;
    if (probe.alive && !backendMatches(probe.data)) {
      throw new Error(
        "Another program is using port 8077. Close it and restart GST Office."
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The backend did not become ready within 60 seconds.");
}

async function ensureBackend() {
  const existing = await probeBackend();
  if (existing.alive) {
    if (existing.healthy && backendMatches(existing.data)) return;
    throw new Error(
      "Port 8077 is already in use by another program. Close it and restart GST Office."
    );
  }
  startBackend();
  await waitForBackend();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: "GST Client Management System",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return { action: "deny" };
    }

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
        return { action: "allow" };
      }
      dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Open external link",
        message: "Open this link in your browser?",
        detail: url,
        buttons: ["Open", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) shell.openExternal(url);
      }).catch((error) => console.error("Could not open external link:", error));
    }

    return { action: "deny" };
  });

  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5173/");
  } else {
    await mainWindow.loadURL("http://127.0.0.1:8077/");
  }
}

async function showStartupError(error) {
  console.error(error);
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "error",
    title: "Backend startup failed",
    message: "GST Client Management System could not start.",
    detail: error.message || String(error),
    buttons: ["Retry", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}

app.whenReady().then(async () => {
  while (!quitting) {
    try {
      await ensureBackend();
      await createWindow();
      break;
    } catch (error) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
        mainWindow = undefined;
      }
      const retry = await showStartupError(error);
      if (!retry) {
        app.quit();
        break;
      }
    }
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0 && !quitting) {
      try {
        await ensureBackend();
        await createWindow();
      } catch (error) {
        await showStartupError(error);
      }
    }
  });
});

app.on("before-quit", () => {
  quitting = true;
  if (backendProcess && backendProcess.exitCode === null) {
    backendProcess.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
