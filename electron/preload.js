const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jastuk", {
  fetchJobs: () => ipcRenderer.invoke("tracker-fetch"),
  fetchLiveDrivers: () => ipcRenderer.invoke("tracker-live-drivers"),
  fetchOverlayData: () => ipcRenderer.invoke("overlay-data"),
  fetchDriverUsers: () => ipcRenderer.invoke("driver-users-fetch"),
  fetchProfileDrivers: () => ipcRenderer.invoke("profile-drivers-fetch"),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  openUrl: (url) => ipcRenderer.invoke("open-url", url),
  getApiUrl: () => ipcRenderer.invoke("get-api-url"),
  loadUsers: () => ipcRenderer.invoke("load-users"),
  loadJobs: () => ipcRenderer.invoke("load-jobs"),
  loadJobDeliveries: () => ipcRenderer.invoke("load-job-deliveries"),
  resendJobDelivery: (jobKey) => ipcRenderer.invoke("resend-job-delivery", jobKey),
  loadCities: () => ipcRenderer.invoke("load-cities"),
  loadConfig: () => ipcRenderer.invoke("load-env"),
  saveConfig: (config) => ipcRenderer.invoke("save-env", config),
  saveOverlaySettings: (settings) => ipcRenderer.invoke("save-overlay-settings", settings),
  discordLogin: () => ipcRenderer.invoke("discord-login"),
  loadPartial: (name) => ipcRenderer.invoke("partial-load", name),
  getUpdaterStatus: () => ipcRenderer.invoke("updater-status"),
  checkForUpdates: () => ipcRenderer.invoke("updater-check"),
  downloadUpdate: () => ipcRenderer.invoke("updater-download"),
  installUpdate: () => ipcRenderer.invoke("updater-install"),
  getDiscordPresenceStatus: () => ipcRenderer.invoke("discord-presence-status"),
  testDiscordPresence: () => ipcRenderer.invoke("discord-presence-test"),
  getDiscordPresenceLog: () => ipcRenderer.invoke("discord-presence-log"),
  onDiscordPresenceStatus: (callback) => {
    const listener = (_, status) => callback(status);
    ipcRenderer.on("discord-presence-status", listener);
    return () => ipcRenderer.removeListener("discord-presence-status", listener);
  },
  onUpdaterStatus: (callback) => {
    const listener = (_, status) => callback(status);
    ipcRenderer.on("updater-status", listener);
    return () => ipcRenderer.removeListener("updater-status", listener);
  },
  onOverlaySettings: (callback) => {
    const listener = (_, settings) => callback(settings);
    ipcRenderer.on("overlay-settings", listener);
    return () => ipcRenderer.removeListener("overlay-settings", listener);
  }
});
