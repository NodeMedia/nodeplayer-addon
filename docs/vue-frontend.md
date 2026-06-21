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
import NodePlayerAddon from 'nodeplayer-addon'

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

  NodePlayerAddon.registerIpc(ipcMain, {
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
  // 截图：将渲染进程生成的 JPG base64 数据保存到指定路径（默认由主进程自动生成）
  saveScreenshot: (id, outputPath, base64Data) => ipcRenderer.invoke('player:saveScreenshot', id, outputPath, base64Data),
  // 预探测：在创建播放器前分析 URL（连接性 / 编码 / 分辨率 / 首帧截图）
  getMediaInfo: (url) => ipcRenderer.invoke('player:getMediaInfo', url),

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
import NodePlayerView from 'nodeplayer-addon/NodePlayerView'

const url = ref('rtsp://')
const status = ref('')
const playing = ref(false)

const videoRef = ref(null)
const playerRef = shallowRef(null)

async function handlePlay() {
  if (!url.value.trim()) return

  const video = videoRef.value
  if (!video) return

  const player = new NodePlayerView(video, 'player-1')

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

async function handleScreenshot() {
  const player = playerRef.value
  if (!player) return
  const r = await player.saveScreenshot()
  status.value = r.success ? '截图已保存：' + r.path : (r.error || '截图失败')
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
      <button v-if="playing" class="btn btn-screenshot" @click="handleScreenshot">截图</button>
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

## 7. 更多功能

上面的示例只演示了「播放 / 停止 / 截图」。`registerIpc` 实际在主进程注册了更多能力，下面按需选用。

### 事件码参考

播放器通过 `player.on('event', (code, msg) => {})` 推送事件，常用码如下：

| 范围 | code | 含义 |
|------|------|------|
| 连接 | 1000 | 正在连接 |
|      | 1001 | 已连接 |
|      | 1002 | 连接失败 |
|      | 1003 | 重连中 |
|      | 1004 | 已断开 |
|      | 1005 | 网络错误 |
|      | 1006 | 连接超时 |
| 录像 | 3001 | 录像开始 |
|      | 3002 | 录像停止 |
|      | 3003 | 录像错误 |

> 流的编码、分辨率、采样率等参数通过 `player.on('info', (info) => {})` 单独推送，不走 `event`。

### 流预探测（getMediaInfo）

在加入播放列表前，可先探测地址是否可达、获取音视频参数并截取首帧预览图。

👉 完整 API、codec 参考表与示例：[get-media-info.md](./get-media-info.md)

### 截图

`NodePlayerView` 提供两种截图方式，均在**流就绪后**调用：

- `player.captureScreenshot(quality?)` → 返回 `data:image/jpeg;base64,...` 字符串（仅在内存中，不落盘）
- `player.saveScreenshot(outputPath?, quality?)` → 通过 IPC 将 JPG 写入磁盘，返回 `{ success, path }`，路径省略时由主进程自动生成

```js
// 直接预览（不落盘）
const dataUrl = player.captureScreenshot(0.9)
if (dataUrl) snapshotImg.src = dataUrl

// 保存到文件
const r = await player.saveScreenshot()
if (r.success) console.log('已保存：', r.path)
```

## 联系客服索取demo源码
- QQ: 281269007
- Email: service@nodemedia.cn