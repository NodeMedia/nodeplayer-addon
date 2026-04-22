# nodeplayer-addon
这是一款Electron原生播放器扩展, 支持RTSP,RTMP播放

## 特性

### 支持系统和架构
- windows x64
- linux x64 arm64 loong64 riscv64
- darwin x64 arm64

### 支持协议
- RTSP
- RTMP
- HTTP(S)-FLV

### 支持编码
- H.264/H.265
- AAC/G.711/G.726/MP2

## 集成
由于Electron特殊的权限控制, 集成本扩展需要在main.js和preload.js中进行注册

### 编辑main.js
```js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const NodePlayerAddon = require('nodeplayer-addon'); //导入播放器扩展


const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.maximize();
  mainWindow.show();

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    NodePlayerAddon.unregisterIpc(ipcMain)
    mainWindow = null
  })
  NodePlayerAddon.registerIpc(ipcMain, {
    getWindow: () => mainWindow,
    licensePath: app.isPackaged
      ? path.join(process.resourcesPath, 'license.dat')
      : path.join(__dirname, 'license.dat'),
  })
};

```

### 编辑preload.js
```js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  createPlayer: (id) => ipcRenderer.invoke('player:create', id),
  startPlayer: (id, url) => ipcRenderer.invoke('player:start', id, url),
  stopPlayer: (id) => ipcRenderer.invoke('player:stop', id),
  destroyPlayer: (id) => ipcRenderer.invoke('player:destroy', id),
  startRecord: (id, filePath) => ipcRenderer.invoke('player:startRecord', id, filePath),
  stopRecord: (id) => ipcRenderer.invoke('player:stopRecord', id),

  onEvent: (id, callback) => {
    const channel = `player:event:${id}`
    const handler = (event, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onInfo: (id, callback) => {
    const channel = `player:info:${id}`
    const handler = (event, info) => callback(info)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onData: (id, callback) => {
    const channel = `player:data:${id}`
    const handler = (event, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
})
```

### 播放前端

#### HTML单页集成方式
```js

```

#### React集成方式


#### Vue集成方式

## 授权
无授权文件的情况下也可以直接开启试用测试

- QQ: 281269007
- Email: service@nodemedia.cn
