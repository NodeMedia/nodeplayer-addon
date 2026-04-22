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
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>NodePlayer Demo</title>
  <style>
    body { margin: 0; background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; }
    video { width: 100%; max-width: 960px; background: #000; }
    .controls { position: fixed; bottom: 20px; display: flex; gap: 10px; }
    .controls input { width: 400px; padding: 6px; }
    .controls button { padding: 6px 16px; cursor: pointer; }
    .status { position: fixed; top: 10px; left: 10px; color: #0f0; font-family: monospace; font-size: 14px; }
  </style>
</head>
<body>
  <div class="status" id="status"></div>
  <video id="video" autoplay muted playsinline></video>
  <div class="controls">
    <input id="url" type="text" placeholder="rtsp://..." value="rtsp://">
    <button id="btn-start">播放</button>
    <button id="btn-stop">停止</button>
    <button id="btn-record">录像</button>
  </div>

  <!-- 在 preload.js 中已通过 contextBridge 暴露 window.electronAPI -->
  <script src="https://cdn.jsdelivr.net/npm/nodeplayer-addon/dist/video-player.umd.js"></script>
  <script>
    const videoEl = document.getElementById('video')
    const statusEl = document.getElementById('status')
    const urlInput = document.getElementById('url')

    const player = new VideoPlayer(videoEl, 'demo', {
      onStatus(id, text) { statusEl.textContent = text },
      onRecord(id, recording) {
        document.getElementById('btn-record').textContent = recording ? '停止录像' : '录像'
      }
    })

    document.getElementById('btn-start').onclick = () => player.start(urlInput.value)
    document.getElementById('btn-stop').onclick = () => player.stop()
    document.getElementById('btn-record').onclick = () => {
      player.isRecording ? player.stopRecord() : player.startRecord()
    }
  </script>
</body>
</html>
```

#### React集成方式
```jsx
import { useRef, useEffect, useState, useCallback } from 'react'
import VideoPlayer from 'nodeplayer-addon/video-player'

export default function PlayerView({ url }) {
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const [status, setStatus] = useState('')
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    const player = new VideoPlayer(videoRef.current, `player-${Date.now()}`, {
      onStatus(id, text) { setStatus(text) },
      onRecord(id, rec) { setRecording(rec) },
    })
    playerRef.current = player

    return () => { player.stop() }
  }, [])

  const handleStart = useCallback(() => {
    playerRef.current?.start(url)
  }, [url])

  const handleStop = useCallback(() => {
    playerRef.current?.stop()
  }, [])

  const handleRecord = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    p.isRecording ? p.stopRecord() : p.startRecord()
  }, [])

  return (
    <div style={{ position: 'relative', background: '#000' }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: '100%', display: 'block' }}
      />
      <div style={{ position: 'absolute', top: 8, left: 8, color: '#0f0', fontFamily: 'monospace' }}>
        {status}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 8 }}>
        <button onClick={handleStart}>播放</button>
        <button onClick={handleStop}>停止</button>
        <button onClick={handleRecord}>{recording ? '停止录像' : '录像'}</button>
      </div>
    </div>
  )
}
```

#### Vue集成方式
```vue
<template>
  <div style="position: relative; background: #000">
    <video ref="videoEl" autoplay muted playsinline style="width: 100%; display: block" />
    <div style="position: absolute; top: 8px; left: 8px; color: #0f0; font-family: monospace">
      {{ status }}
    </div>
    <div style="display: flex; gap: 8px; padding: 8px">
      <button @click="start">播放</button>
      <button @click="stop">停止</button>
      <button @click="toggleRecord">{{ recording ? '停止录像' : '录像' }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import VideoPlayer from 'nodeplayer-addon/video-player'

const props = defineProps({ url: String })

const videoEl = ref(null)
const status = ref('')
const recording = ref(false)
let player = null

onMounted(() => {
  player = new VideoPlayer(videoEl.value, `player-${Date.now()}`, {
    onStatus(id, text) { status.value = text },
    onRecord(id, rec) { recording.value = rec },
  })
})

onUnmounted(() => { player?.stop() })

function start() { player?.start(props.url) }
function stop() { player?.stop() }
function toggleRecord() {
  if (!player) return
  player.isRecording ? player.stopRecord() : player.startRecord()
}
</script>
```

## 授权
无授权文件的情况下也可以直接开启试用测试

- QQ: 281269007
- Email: service@nodemedia.cn
