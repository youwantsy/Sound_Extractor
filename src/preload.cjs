"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld(
  "sonora",
  Object.freeze({
    state: () => ipcRenderer.invoke("state"),
    tools: () => ipcRenderer.invoke("tools"),
    addURL: (value) => ipcRenderer.invoke("add-url", value),
    chooseFiles: () => ipcRenderer.invoke("choose-files"),
    dropFiles: (files) =>
      ipcRenderer.invoke(
        "drop-files",
        Array.from(files).map((file) => webUtils.getPathForFile(file)),
      ),
    chooseOutput: () => ipcRenderer.invoke("choose-output"),
    settings: (value) => ipcRenderer.invoke("settings", value),
    start: () => ipcRenderer.invoke("start"),
    cancel: (id) => ipcRenderer.invoke("cancel", id),
    cancelAll: () => ipcRenderer.invoke("cancel-all"),
    retry: (id) => ipcRenderer.invoke("retry", id),
    remove: (id) => ipcRenderer.invoke("remove", id),
    reorder: (id, direction) => ipcRenderer.invoke("reorder", id, direction),
    clearHistory: () => ipcRenderer.invoke("clear-history"),
    reveal: (id) => ipcRenderer.invoke("reveal", id),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("state-changed", listener);
      return () => ipcRenderer.removeListener("state-changed", listener);
    },
  }),
);
