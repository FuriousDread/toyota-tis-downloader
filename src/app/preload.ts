import { contextBridge, ipcRenderer } from "electron";
import type { DownloadPayload, ManualSpec, ProgressEvent, VehicleSelection } from "../core/types";

// This is the only API visible to renderer.js. Keeping the surface explicit
// prevents the local UI (or remote Toyota pages) from receiving Node access.
contextBridge.exposeInMainWorld("tis", {
  // Request/response calls are implemented by ipcMain handlers in main.ts.
  openLogin: () => ipcRenderer.invoke("tis:open-login"),
  checkLogin: () => ipcRenderer.invoke("tis:check-login"),

  onLoginDetected: (callback: () => void) => {
    ipcRenderer.on("tis:login-detected", () => callback());
  },

  logout: () => ipcRenderer.invoke("tis:logout"),
  toggleTheme: () => ipcRenderer.invoke("tis:theme:toggle"),
  getTheme: () => ipcRenderer.invoke("tis:theme:get"),
  getVehicleOptions: (selection: Partial<VehicleSelection>) =>
    ipcRenderer.invoke("tis:vehicle-options", selection),
  searchDocuments: (vehicle: VehicleSelection) =>
    ipcRenderer.invoke("tis:search-documents", vehicle),
  parseManual: (input: string) => ipcRenderer.invoke("tis:parse-manual", input) as Promise<ManualSpec>,
  chooseOutput: () => ipcRenderer.invoke("tis:choose-output"),
  download: (payload: DownloadPayload) => ipcRenderer.invoke("tis:download", payload),

  // Progress is an event stream. Returning an unsubscribe function prevents
  // duplicate listeners if the renderer is ever initialized more than once.
  onProgress: (callback: (event: ProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: ProgressEvent) => callback(data);
    ipcRenderer.on("tis:progress", listener);
    return () => ipcRenderer.removeListener("tis:progress", listener);
  },
});
