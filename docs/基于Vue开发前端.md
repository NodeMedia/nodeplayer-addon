在快速集成中，我们使用官方推荐的Electron Forge创建程序。可以用来开发react但是需要很多配置，我们在这个例子中换一个更简单的脚手架： [create-electron](https://www.npmjs.com/package/%40quick-start/create-electron)

## 1.创建项目
```bash
npm create @quick-start/electron
```

```bash
> npx
> "create-electron"

✔ Project name: … electron-app-vue
✔ Select a framework: › vue
✔ Add TypeScript? … No / Yes
✔ Add Electron updater plugin? … No / Yes
✔ Enable Electron download mirror proxy? … No / Yes

Scaffolding project in /Users/aliang/electron-app-vue...

Done. Now run:

  cd electron-app-vue
  npm install
  npm run dev
```
编辑器打开项目，可以看到目录结构如下
![](https://www.nodemedia.cn/wp-content/uploads/2026/06/QQ20260601-170644.png)

## 2.安装扩展
执行命令
```bash
npm i nodeplayer-addon
```

## 3.编辑 src/main/index.js 文件
```js
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import NodePlayer from 'nodeplayer-addon'

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  NodePlayer.registerIpc(ipcMain, {
    getWindow: () => mainWindow,
    licensePath: app.isPackaged
      ? join(process.resourcesPath, 'license.dat')
      : join(__dirname, '../../license.dat')
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

```

## 4. 编辑src/preload/index.js
```js
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const playerAPI = {
  createPlayer: (id) => ipcRenderer.invoke('player:create', id),
  startPlayer: (id, url) => ipcRenderer.invoke('player:start', id, url),
  stopPlayer: (id) => ipcRenderer.invoke('player:stop', id),
  destroyPlayer: (id) => ipcRenderer.invoke('player:destroy', id),
  startRecord: (id, filePath) => ipcRenderer.invoke('player:startRecord', id, filePath),
  stopRecord: (id) => ipcRenderer.invoke('player:stopRecord', id),

  onEvent: (id, callback) => {
    const channel = `player:event:${id}`
    const handler = (_event, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onInfo: (id, callback) => {
    const channel = `player:info:${id}`
    const handler = (_event, info) => callback(info)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onData: (id, callback) => {
    const channel = `player:data:${id}`
    const handler = (_event, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', playerAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.electronAPI = playerAPI
}

```

## 5.创建播放组件src/renderer/src/components/VideoPlayerView.vue
```vue
<script setup>
import { ref, shallowRef } from 'vue'
import VideoPlayer from 'nodeplayer-addon/video-player'

const url = ref('rtsp://')
const status = ref('')
const playing = ref(false)

const videoRef = ref(null)
const playerRef = shallowRef(null)

async function handlePlay() {
  if (!url.value.trim()) return

  const video = videoRef.value
  if (!video) return

  const player = new VideoPlayer(video, 'player-1')

  const EVENT_STATUS = {
    1000: 'Connecting...', 1001: 'Connected', 1002: 'Connection failed',
    1003: 'Reconnecting...', 1004: 'Disconnected', 1005: 'Network error',
    1006: 'Connection timeout', 3001: 'Recording...',
  }

  player.on('event', (code, msg) => {
    if (code in EVENT_STATUS) status.value = msg ? `${EVENT_STATUS[code]}: ${msg}` : EVENT_STATUS[code]
  })
  player.on('error', (err) => { status.value = err.message })

  playerRef.value = player
  playing.value = true
  await player.start(url.value.trim())
}

async function handleStop() {
  const player = playerRef.value
  if (player) {
    await player.stop()
    playerRef.value = null
  }
  playing.value = false
  status.value = ''
}

function onKeydown(e) {
  if (e.key === 'Enter' && !playing.value) handlePlay()
}
</script>

<template>
  <div class="player-container">
    <div class="player-toolbar">
      <input
        type="text"
        class="url-input"
        :value="url"
        :disabled="playing"
        placeholder="rtsp:// or rtmp://"
        @input="url = $event.target.value"
        @keydown="onKeydown"
      />
      <button v-if="!playing" class="btn btn-play" :disabled="!url.trim()" @click="handlePlay">
        ▶ Play
      </button>
      <button v-else class="btn btn-stop" @click="handleStop">■ Stop</button>
    </div>

    <div class="player-video-wrapper">
      <video ref="videoRef" class="player-video" autoplay muted playsinline />
      <div v-if="status" class="player-status">{{ status }}</div>
    </div>
  </div>
</template>
```

## 6.加载组件 src/renderer/src/App.vue
```vue
<script setup>
import Versions from './components/Versions.vue'
import VideoPlayerView from './components/VideoPlayerView.vue'
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>NodePlayer</h1>
    </header>
    <main class="app-main">
      <VideoPlayerView />
    </main>
    <footer class="app-footer">
      <Versions />
    </footer>
  </div>
</template>
```

## 运行效果
![](https://www.nodemedia.cn/wp-content/uploads/2026/06/QQ20260601-171000.jpg)

## 联系客服索取demo源码
- QQ: 281269007
- Email: service@nodemedia.cn