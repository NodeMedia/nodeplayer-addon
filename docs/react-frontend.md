在快速集成中，我们使用官方推荐的Electron Forge创建程序。可以用来开发react但是需要很多配置，我们在这个例子中换一个更简单的脚手架： [create-electron](https://www.npmjs.com/package/%40quick-start/create-electron)

## 1.创建项目
```bash
npm create @quick-start/electron
```

```bash
> npx
> "create-electron"

✔ Project name: … electron-app-react
✔ Select a framework: › react
✔ Add TypeScript? … No / Yes
✔ Add Electron updater plugin? … No / Yes
✔ Enable Electron download mirror proxy? … No / Yes

Scaffolding project in electron-app-react...

Done. Now run:

cd electron-app-react
npm install
npm run dev
```
编辑器打开项目，可以看到目录结构如下
![](https://www.nodemedia.cn/wp-content/uploads/2026/05/QQ20260529-142414.png)

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

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

   mainWindow.on('closed', () => {
    NodePlayerAddon.unregisterIpc(ipcMain)
  })
  NodePlayerAddon.registerIpc(ipcMain, {
    getWindow: () => mainWindow,
    licensePath: app.isPackaged
      ? join(process.resourcesPath, 'license.dat')
      : join(__dirname, 'license.dat'),
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

```

## 4. 编辑src/preload/index.js
```js
import { contextBridge, ipcRenderer } from 'electron'

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
  }
})

```

## 5.编辑src/renderer/src/App.jsx
```js
import { useRef, useEffect, useState, useCallback } from 'react'
import VideoPlayer from 'nodeplayer-addon/video-player'

function App() {
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    const player = new VideoPlayer(videoRef.current, `player-${Date.now()}`)
    player.on('event', (code, msg) => {
      if (code === 3001) setRecording(true)
      if (code === 3002 || code === 3003) setRecording(false)
    })
    player.on('error', (err) => { setStatus(err.message) })
    playerRef.current = player

    return () => {
      player.stop()
    }
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
    <div style={{ maxWidth: 800, margin: '10px', fontFamily: 'sans-serif' }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000' }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
        />
        {status && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              color: '#0f0',
              fontFamily: 'monospace',
              fontSize: 12
            }}
          >
            {status}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '10px 0' }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="rtsp:// 或 http://"
          style={{ flex: 1, padding: '6px 10px', fontSize: 14 }}
        />
        <button onClick={handleStart}>播放</button>
        <button onClick={handleStop}>停止</button>
        <button onClick={handleRecord}>{recording ? '停止录像' : '录像'}</button>
      </div>
    </div>
  )
}

export default App

```

## 运行效果
![](https://www.nodemedia.cn/wp-content/uploads/2026/05/QQ20260529-161024.png)

## 加上样式后的运行效果
![](https://www.nodemedia.cn/wp-content/uploads/2026/05/QQ20260529-174150.png)

## 联系客服索取demo源码
- QQ: 281269007
- Email: service@nodemedia.cn