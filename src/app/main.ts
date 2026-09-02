import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  session,
} from "electron";
import { join } from "path";
import { TIS_CATALOG_URL, TIS_PARTITION } from "../core/constants";
import {
  collectDocumentsElectron,
  getVehicleOptions,
  verifyTisLogin,
} from "../core/catalog/catalogElectron";
import { runDownload } from "../core/downloadManager";
import { parseManualSpec } from "../core/manual/parseSpec";
import { SessionExpiredError } from "../core/session/session";
import type { DownloadPayload, ProgressEvent, VehicleSelection } from "../core/types";

// Electron's main process owns privileged operations. The web UI receives only
// the deliberately small bridge exposed by preload.ts.
let mainWindow: BrowserWindow | undefined;
let loginWindow: BrowserWindow | undefined;
let downloadRunning = false;

// Watches the Toyota login session while the login window is open.
let loginCheckTimer: ReturnType<typeof setInterval> | undefined;
let loginCheckRunning = false;

const LOGIN_CHECK_INTERVAL_MS = 5000;

/** Forward background progress to the renderer without exposing Electron APIs. */
function sendProgress(event: ProgressEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tis:progress", event);
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    webPreferences: {
      // These settings keep remote/UI JavaScript isolated from Node and the OS.
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  void mainWindow.loadFile(join(app.getAppPath(), "src", "ui", "index.html"));
}

async function openLoginWindow(): Promise<void> {
  // Reuse an existing login window so opening it repeatedly cannot create
  // multiple competing Toyota sessions.
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "Toyota TIS Login",
    webPreferences: {
      // The persistent partition is also used by catalog and download helpers.
      partition: TIS_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  loginWindow.on("closed", () => {
    stopLoginAutoClose();
    loginWindow = undefined;
  });

  await loginWindow.loadURL(TIS_CATALOG_URL);

  // Start watching the shared Toyota session after the login page has loaded.
  startLoginAutoClose();
}

/** Close only the separate Toyota browser window, never the main app. */
function closeLoginWindow(): void {
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
}

/**
 * Stop checking Toyota's session when the login window is gone.
 */
function stopLoginAutoClose(): void {
  if (loginCheckTimer) {
    clearInterval(loginCheckTimer);
    loginCheckTimer = undefined;
  }
}

/**
 * Check whether the shared TIS browser session has become authenticated.
 *
 * The visible login window and verifyTisLogin() both use TIS_PARTITION,
 * so once login/MFA succeeds, the hidden verification window will see
 * the same authenticated session.
 */
async function checkLoginAndClose(): Promise<void> {
  if (loginCheckRunning) return;

  const targetWindow = loginWindow;

  if (!targetWindow || targetWindow.isDestroyed()) return;

  loginCheckRunning = true;

  try {
    const loggedIn = await verifyTisLogin(TIS_PARTITION);

    // Ignore a successful check if the user replaced or closed this window.
    if (
      loggedIn &&
      loginWindow === targetWindow &&
      !targetWindow.isDestroyed()
    ) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("tis:login-detected");
      }
      targetWindow.close();
    }
  } finally {
    loginCheckRunning = false;
  }
}

/**
 * While the Toyota login window is open, check every five seconds.
 */
function startLoginAutoClose(): void {
  stopLoginAutoClose();

  // Also check immediately in case a valid session already exists.
  void checkLoginAndClose();

  loginCheckTimer = setInterval(() => {
    void checkLoginAndClose();
  }, LOGIN_CHECK_INTERVAL_MS);
}

app.whenReady().then(() => {
  // Download helpers use this to find the bundled manual accessor HTML file.
  process.env.TIS_APP_ROOT = app.getAppPath();
  createMainWindow();

  // Theme actions ----------------------------------------------------------
  ipcMain.handle("tis:theme:get", () => {
    return nativeTheme.shouldUseDarkColors;
  });

  ipcMain.handle("tis:theme:toggle", () => {
    nativeTheme.themeSource =
      nativeTheme.shouldUseDarkColors ? "light" : "dark";

    return nativeTheme.shouldUseDarkColors;
  });

  // Login/session actions ---------------------------------------------------
  ipcMain.handle("tis:open-login", async () => {
    await openLoginWindow();
    return true;
  });

  ipcMain.handle("tis:check-login", async () => {
    const loggedIn = await verifyTisLogin(TIS_PARTITION);
    if (loggedIn) closeLoginWindow();
    return loggedIn;
  });

  ipcMain.handle("tis:logout", async () => {
    if (downloadRunning) {
      throw new Error("A download is currently running.");
    }

    // Prevent the automatic login checker from racing with session clearing.
    stopLoginAutoClose();

    // Destroy the visible Toyota window before clearing its session.
    closeLoginWindow();

    const tisSession = session.fromPartition(TIS_PARTITION);

    // Kill anything still using authenticated pooled connections.
    await tisSession.closeAllConnections();

    // Clear cookies, cache, local storage, IndexedDB, and service workers.
    await tisSession.clearData();

    await tisSession.clearAuthCache();

    return true;
  });

  // Catalog actions ---------------------------------------------------------
  ipcMain.handle("tis:vehicle-options", async (_event, selection: Partial<VehicleSelection>) => {
    if (!(await verifyTisLogin(TIS_PARTITION))) throw new SessionExpiredError();
    return getVehicleOptions(TIS_PARTITION, selection);
  });

  ipcMain.handle("tis:search-documents", async (_event, vehicle: VehicleSelection) => {
    if (!(await verifyTisLogin(TIS_PARTITION))) throw new SessionExpiredError();
    sendProgress({ phase: "catalog", message: "Searching Toyota TIS..." });
    const docs = await collectDocumentsElectron(TIS_PARTITION, vehicle);
    sendProgress({ phase: "catalog", message: `Found ${docs.length} TIS documents.` });
    return docs;
  });

  // Manual parsing and download actions ------------------------------------
  ipcMain.handle("tis:parse-manual", (_event, input: string) => parseManualSpec(input));

  ipcMain.handle("tis:choose-output", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose Toyota TIS download folder",
    });
    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle("tis:download", async (_event, payload: DownloadPayload) => {
    // Downloads are sequential by design; also reject a second UI invocation.
    if (downloadRunning) throw new Error("A download is already running.");
    if (!(await verifyTisLogin(TIS_PARTITION))) throw new SessionExpiredError();

    downloadRunning = true;
    try {
      const ses = session.fromPartition(TIS_PARTITION);
      return await runDownload(ses, TIS_PARTITION, payload, sendProgress);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        sendProgress({ phase: "error", message: error.message });
      }
      throw error;
    } finally {
      downloadRunning = false;
    }
  });
});

app.on("activate", () => {
  // Standard macOS behavior: recreate a window when the dock icon is clicked.
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
