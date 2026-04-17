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
由于Electron特殊的权限控制, 本扩展集成需要在main.js和preload.js中进行注册

### 编辑main.js
```js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const NodePlayerAddon = require('nodeplayer-addon'); //导入播放器扩展
const players = new Map(); //索引多播放器实例
let mainWindow = null; // 将mainWindow的作用域放在全局

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
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
};

const registerNodePlayerAddon = () => {

  ipcMain.handle('player:create', (event, id) => {
    if (players.has(id)) {
      return { success: false, error: 'Player already exists' }
    }

    const opts = {}

    if (!opts.licensePath) {
      opts.licensePath = app.isPackaged
        ? path.join(process.resourcesPath, 'license.dat')
        : path.join(__dirname, 'license.dat')
    }

    const player = new NodePlayerAddon(opts)

    player.on('event', (code, msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`player:event:${id}`, { code, msg })
      }
    })

    player.on('info', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`player:info:${id}`, info)
      }
    })

    player.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`player:data:${id}`, data)
      }
    })

    players.set(id, player)
    return { success: true }
  })

  ipcMain.handle('player:start', (event, id, url) => {
    const player = players.get(id)
    if (!player) {
      return { success: false, error: 'Player not found' }
    }

    try {
      const result = player.start(url)
      return { success: result }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('player:stop', (event, id) => {
    const player = players.get(id)
    if (!player) {
      return { success: false, error: 'Player not found' }
    }

    try {
      player.stop()
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('player:destroy', (event, id) => {
    const player = players.get(id)
    if (!player) {
      return { success: false, error: 'Player not found' }
    }

    try {
      player.stop()
      players.delete(id)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('player:startRecord', (event, id, filePath) => {
    const player = players.get(id)
    if (!player) {
      return { success: false, error: 'Player not found' }
    }

    try {
      const result = player.startRecord(filePath)
      return { success: result }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('player:stopRecord', (event, id) => {
    const player = players.get(id)
    if (!player) {
      return { success: false, error: 'Player not found' }
    }

    try {
      player.stopRecord()
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
}

app.whenReady().then(() => {
  createWindow();
  registerNodePlayerAddon();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

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
/**
 * VideoPlayer — MediaSource-based video player using NodePlayerAddon IPC.
 *
 * Usage:
 *   const player = new VideoPlayer(videoElement, id, { onStatus(id, text) })
 *   await player.start(url)
 *   await player.stop()
 */
class VideoPlayer {
  /**
   * @param {HTMLVideoElement} video - The <video> element to render into
   * @param {string} id - Unique player identifier (used for IPC channels)
    * @param {{ onStatus: (id: string, text: string) => void, onRecord: (id: string, recording: boolean, msg: string) => void }} callbacks
   */
  constructor(video, id, callbacks) {
    this.id = id;
    this.video = video;
    this.callbacks = callbacks;
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.queue = [];
    this.isStarted = false;
    this.isReady = false;
    this.unsubscribeEvent = null;
    this.unsubscribeInfo = null;
    this.unsubscribeData = null;
    this.videoCodecString = null;
    this.audioCodecString = null;
    this.isRecording = false;
  }

  _setStatus(text) {
    if (this.callbacks && this.callbacks.onStatus) {
      this.callbacks.onStatus(this.id, text);
    }
  }

  async start(url) {
    if (this.isStarted) return;
    this._setStatus('连接中...');

    const result = await window.electronAPI.createPlayer(this.id);
    if (!result.success) {
      this._setStatus('错误: ' + result.error);
      return;
    }

    this.unsubscribeEvent = window.electronAPI.onEvent(this.id, (data) => {
      this._updateConnectionState(data.code, data.msg);
    });

    this.unsubscribeInfo = window.electronAPI.onInfo(this.id, (info) => {
      this.videoCodecString = info.video ? info.video.codecString : null;
      this.audioCodecString = info.audio ? info.audio.codecString : null;
      this._setStatus('接收流信息...');
      this._initMediaSource();
    });

    this.unsubscribeData = window.electronAPI.onData(this.id, (data) => {
      this._handleData(data);
    });

    const startResult = await window.electronAPI.startPlayer(this.id, url);
    if (!startResult.success) {
      this._setStatus('错误: ' + startResult.error);
      return;
    }

    this.isStarted = true;
    this._setStatus('等待流信息...');
  }

  _initMediaSource() {
    if (!this.videoCodecString || !this.video) return;

    this.mediaSource = new MediaSource();
    this.video.src = URL.createObjectURL(this.mediaSource);

    this.mediaSource.addEventListener('sourceopen', () => {
      if (this.mediaSource.readyState !== 'open') return;
      try {
        const mimeType = this.audioCodecString
          ? 'video/mp4; codecs="' + this.videoCodecString + ',' + this.audioCodecString + '"'
          : 'video/mp4; codecs="' + this.videoCodecString + '"';
        this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
        this.sourceBuffer.addEventListener('updateend', () => this._processQueue());
        this.isReady = true;
        this._setStatus('播放中');
        if (this.queue.length > 0) this._processQueue();
      } catch (e) {
        this._setStatus('错误: ' + e.message);
      }
    });

    this.mediaSource.addEventListener('sourceclose', () => {
      this.isReady = false;
      this.sourceBuffer = null;
    });
  }

  _processQueue() {
    if (!this.isReady || !this.sourceBuffer) return;
    if (this.sourceBuffer.updating) return;
    if (this.queue.length === 0) return;
    try {
      if (this.mediaSource && this.mediaSource.readyState === 'open') {
        const data = this.queue.shift();
        this.sourceBuffer.appendBuffer(data);
      }
    } catch (e) {
      console.error('[VideoPlayer] processQueue error:', e);
    }
  }

  _updateConnectionState(code, msg) {
    const stateMap = {
      1000: '连接中...',
      1001: '已连接',
      1002: '连接失败: ' + msg,
      1003: '重连中...',
      1004: '已断开',
      1005: '网络错误: ' + msg,
      1006: '连接超时: ' + msg,
      3001: '录像开始',
      3002: '录像停止',
      3003: '录像错误: ' + msg,
    };
    this._setStatus(stateMap[code] || '未知状态 (' + code + ')');
    if (code === 1004) this._destroyMediaSource();

    if (code === 3001) {
      this.isRecording = true;
      if (this.callbacks && this.callbacks.onRecord) {
        this.callbacks.onRecord(this.id, true, msg);
      }
    } else if (code === 3002) {
      this.isRecording = false;
      if (this.callbacks && this.callbacks.onRecord) {
        this.callbacks.onRecord(this.id, false, msg);
      }
    } else if (code === 3003) {
      this.isRecording = false;
      if (this.callbacks && this.callbacks.onRecord) {
        this.callbacks.onRecord(this.id, false, msg);
      }
    }
  }

  _handleData(data) {
    if (!this.isStarted) return;
    try {
      const buffer = new Uint8Array(data).buffer;
      this.queue.push(buffer);
      if (this.isReady && this.sourceBuffer && !this.sourceBuffer.updating) {
        this._processQueue();
      }
    } catch (e) {
      console.error('[VideoPlayer] handleData error:', e);
    }
  }

  _destroyMediaSource() {
    if (this.sourceBuffer && this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.sourceBuffer.abort();
        this.mediaSource.removeSourceBuffer(this.sourceBuffer);
      } catch (e) { /* ignore */ }
    }
    if (this.video && this.video.src && this.video.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.video.src);
    }
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.sourceBuffer = null;
    this.mediaSource = null;
  }

  async stop() {
    if (!this.isStarted) return;
    this.isStarted = false;
    this.isReady = false;

    if (this.unsubscribeEvent) { this.unsubscribeEvent(); this.unsubscribeEvent = null; }
    if (this.unsubscribeInfo) { this.unsubscribeInfo(); this.unsubscribeInfo = null; }
    if (this.unsubscribeData) { this.unsubscribeData(); this.unsubscribeData = null; }

    try {
      await window.electronAPI.stopPlayer(this.id);
      await window.electronAPI.destroyPlayer(this.id);
    } catch (e) { /* ignore */ }

    this._destroyMediaSource();
    this.queue = [];
    this._setStatus('');
    this.isRecording = false;
  }

  async startRecord(filePath) {
    if (!this.isStarted) return { success: false, error: 'Player not started' };
    try {
      const result = await window.electronAPI.startRecord(this.id, filePath);
      if (result.success) {
        this.isRecording = true;
      }
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async stopRecord() {
    if (!this.isStarted) return { success: false, error: 'Player not started' };
    try {
      const result = await window.electronAPI.stopRecord(this.id);
      if (result.success) {
        this.isRecording = false;
      }
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

```

#### React集成方式


#### Vue集成方式

## 授权
无授权文件的情况下也可以直接开启试用测试

- QQ: 281269007
- Email: service@nodemedia.cn
