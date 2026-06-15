---
name: nodeplayer-addon
description: 使用 nodeplayer-addon 的完整指南，包括使用流程、常见模式、最佳实践。当你需要查询 nodeplayer-addon、生成组件代码或解决使用问题时，请使用此技能。
---

# nodeplayer-addon — AI Skill Document

> Version: 0.2.3 | Package: `nodeplayer-addon`
> An Electron native player addon (N-API C++) supporting RTSP / RTMP streaming protocols.

---

## Table of Contents

1. [Installation & Imports](#installation--imports)
2. [Architecture Overview](#architecture-overview)
3. [NodePlayer (Main Process)](#nodeplayer-main-process)
4. [VideoPlayer (Renderer Process)](#videoplayer-renderer-process)
5. [IPC Bridge Protocol](#ipc-bridge-protocol)
6. [Preload API Interface](#preload-api-interface)
7. [Event Codes Reference](#event-codes-reference)
8. [Stream Info Object](#stream-info-object)
9. [Integration Patterns](#integration-patterns)
10. [License & Trial Mode](#license--trial-mode)
11. [Troubleshooting](#troubleshooting)

---

## Installation & Imports

```bash
npm install nodeplayer-addon
```

### Package Exports

| Subpath | Import (ESM) | Require (CJS) |
|---------|-------------|---------------|
| `nodeplayer-addon` | `dist/index.mjs` | `dist/index.cjs` |
| `nodeplayer-addon/video-player` | `dist/video-player.mjs` | `dist/video-player.umd.js` |

### Import Examples

```javascript
// Main process (CJS)
const NodePlayer = require('nodeplayer-addon')

// Main process (ESM)
import NodePlayer from 'nodeplayer-addon'

// Renderer process (ESM)
import VideoPlayer from 'nodeplayer-addon/video-player'

// Renderer process (UMD via <script>)
// <script src="node_modules/nodeplayer-addon/dist/video-player.umd.js"></script>
// → global window.VideoPlayer
```

### Prebuilds Directory Structure

```
nodeplayer-addon/
├── dist/
│   ├── index.cjs            — NodePlayer (CommonJS)
│   ├── index.mjs            — NodePlayer (ESM)
│   ├── video-player.mjs     — VideoPlayer (ESM)
│   └── video-player.umd.js  — VideoPlayer (UMD)
└── prebuilds/
    ├── darwin-arm64/node_player.node
    ├── darwin-x64/node_player.node
    ├── linux-arm64/node_player.node
    ├── linux-x64/node_player.node
    └── win32-x64/node_player.node
```

The native `.node` binary is lazy-loaded at runtime from `prebuilds/{platform}-{arch}/` or `build/Release/`.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Application                     │
│                                                              │
│  ┌──────────────────┐      IPC       ┌────────────────────┐ │
│  │   Main Process   │◄──────────────►│  Renderer Process  │ │
│  │                  │                │                    │ │
│  │   NodePlayer     │  ipcMain/      │   VideoPlayer      │ │
│  │   (C++ N-API)    │  ipcRenderer   │   (MSE + Canvas)   │ │
│  │                  │                │                    │ │
│  │  registerIpc()   │  preload.js    │  <video> element   │ │
│  └──────────────────┘  contextBridge └────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
  RTSP / RTMP streams
  (FFmpeg demux → decode → fMP4 segments)
```

**Data Flow:**

```
C++ native (FFmpeg demux)
  → NodePlayer 'data' event       [main process]
  → ipcMain → webContents.send()  [main → renderer]
  → preload contextBridge          [IPC bridge]
  → VideoPlayer._handleData()      [renderer]
  → FIFO queue → SourceBuffer.appendBuffer()
  → <video> playback
```

---

## NodePlayer (Main Process)

> **File**: `dist/index.cjs` / `dist/index.mjs`
> **Extends**: `EventEmitter`
> **Runtime**: Node.js / Electron main process only (requires native `.node` binary)

### Constructor

```javascript
const player = new NodePlayer(options?)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options` | `object` | `{}` | Configuration options |
| `options.licensePath` | `string` | `undefined` | License file path. If omitted or empty → trial mode (cumulative 10 min) |

### Instance Properties

| Property | Type | Description |
|----------|------|-------------|
| `isTrialMode` | `boolean` (readonly) | `true` if no `licensePath` was provided |

### Instance Methods

#### `start(url)` → `boolean`

Start the streaming pipeline. Internally validates the license before connecting.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Stream URL (RTSP / RTMP protocol) |
| **Returns** | `boolean` | `true` if started successfully, `false` on error |

**Throws**: `Error('Pipeline already started')` if called twice.

**Events emitted on error**: `'error'` event with the error object.

#### `stop()` → `void`

Stop the streaming pipeline. Safe to call multiple times (no-op if not started).

#### `startRecord(outputPath)` → `void`

Start recording to an MP4 file.

| Parameter | Type | Description |
|-----------|------|-------------|
| `outputPath` | `string` | Output MP4 file path |

**Throws**: `Error('Pipeline not started')` if pipeline is not running.

#### `stopRecord()` → `void`

Stop recording. Generates a complete MP4 file at the path specified in `startRecord()`.

### Events

All events are forwarded from the native C++ layer.

| Event | Callback Signature | Description |
|-------|-------------------|-------------|
| `'event'` | `(code: number, msg: string) => void` | Pipeline status events (connection, errors, recording) |
| `'info'` | `(info: StreamInfo) => void` | Stream information (codecs, resolution) — emitted once after connection |
| `'data'` | `(buffer: Buffer) => void` | fMP4 segment data for MSE playback |
| `'error'` | `(err: Error) => void` | Runtime errors |

### Static Methods

#### `NodePlayer.registerIpc(ipcMain, options)` → `void`

Register IPC handlers to bridge player operations to the renderer process.

| Parameter | Type | Description |
|-----------|------|-------------|
| `ipcMain` | `object` | Electron's `ipcMain` module |
| `options` | `object` | Configuration |
| `options.getWindow` | `() => BrowserWindow` | Function returning the current BrowserWindow |
| `options.licensePath` | `string?` | Default license path for all players (fallback) |

**Registered IPC Channels:**

| Channel | Direction | Params | Returns |
|---------|-----------|--------|---------|
| `player:create` | renderer → main | `(id, playerOptions?)` | `{ success: boolean, error?: string }` |
| `player:start` | renderer → main | `(id, url)` | `{ success: boolean, error?: string }` |
| `player:stop` | renderer → main | `(id)` | `{ success: boolean, error?: string }` |
| `player:destroy` | renderer → main | `(id)` | `{ success: boolean, error?: string }` |
| `player:startRecord` | renderer → main | `(id, outputPath?)` | `{ success: boolean, path?: string, error?: string }` |
| `player:stopRecord` | renderer → main | `(id)` | `{ success: boolean, error?: string }` |
| `player:screenshot` | renderer → main | `(id, outputPath?, base64Data)` | `{ success: boolean, path?: string, error?: string }` |

**Push Events (main → renderer):**

| Channel | Data Shape |
|---------|-----------|
| `player:event:${id}` | `{ code: number, msg: string }` |
| `player:info:${id}` | `StreamInfo` object |
| `player:data:${id}` | `Buffer` (fMP4 segment) |

#### `NodePlayer.unregisterIpc(ipcMain)` → `void`

Unregister all IPC handlers, stop all players, and clean up resources.

| Parameter | Type | Description |
|-----------|------|-------------|
| `ipcMain` | `object` | Electron's `ipcMain` module |

---

## VideoPlayer (Renderer Process)

> **File**: `dist/video-player.mjs` / `dist/video-player.umd.js`
> **Runtime**: Electron renderer process (uses MediaSource Extensions, Canvas API)
> **Dependency**: Requires `window.electronAPI` exposed via preload script

### Constructor

```javascript
const player = new VideoPlayer(video, id, options?)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `video` | `HTMLVideoElement` | The `<video>` element to render into |
| `id` | `string` | Unique player identifier (used for IPC channel names) |
| `options` | `object` | Optional configuration |
| `options.api` | `object` | Custom IPC bridge (default: `window.electronAPI`) |

### Instance Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `id` | `string` | — | Player identifier |
| `video` | `HTMLVideoElement` | — | Video element reference |
| `isStarted` | `boolean` | `false` | Whether playback has started |
| `isReady` | `boolean` | `false` | Whether MediaSource + SourceBuffer are ready |
| `isRecording` | `boolean` | `false` | Whether recording is active |
| `videoCodecString` | `string \| null` | `null` | Video codec MIME string (e.g., `"avc1.640029"`) |
| `audioCodecString` | `string \| null` | `null` | Audio codec MIME string (e.g., `"mp4a.40.2"`) |

### Instance Methods

#### `on(event, fn)` → `this`

Register an event listener. Supports chaining and multiple listeners per event.

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | `'event' \| 'error'` | Event name |
| `fn` | `function` | Listener function |
| **Returns** | `this` | Supports chaining |

**Events:**

| Event | Callback | Description |
|-------|----------|-------------|
| `'event'` | `(code: number, msg: string) => void` | Native event forwarded raw — connection status, recording lifecycle, etc. See [Event Codes Reference](#event-codes-reference) |
| `'error'` | `(err: Error) => void` | JS-layer errors (IPC failures, MediaSource init errors, data processing errors) |

#### `off(event, fn)` → `this`

Remove a previously registered event listener.

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | `'event' \| 'error'` | Event name |
| `fn` | `function` | The listener function to remove |
| **Returns** | `this` | Supports chaining |

#### `start(url)` → `Promise<void>`

Start playback. Creates the player via IPC, subscribes to events, and starts streaming.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | RTSP / RTMP stream URL |

**Lifecycle**: `createPlayer` → subscribe events → `startPlayer` → wait for `info` event → init MediaSource → play.

#### `stop()` → `Promise<void>`

Stop playback and release all resources. Unsubscribes from IPC events, destroys MediaSource, and clears the canvas.

#### `startRecord(outputPath?)` → `Promise<Result>`

Start recording the current stream.

| Parameter | Type | Description |
|-----------|------|-------------|
| `outputPath` | `string?` | Output file path (optional, auto-generated if omitted) |
| **Returns** | `Promise<{success, path?, error?}>` | Result with file path on success |

#### `stopRecord()` → `Promise<Result>`

Stop recording.

| **Returns** | `Promise<{success, error?}>` | Result |
|-------------|------------------------------|--------|

#### `captureScreenshot(quality?)` → `string | null`

Capture the current video frame as a JPG data URL. Uses an internal canvas.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `quality` | `number` | `0.9` | JPG quality (0–1) |
| **Returns** | `string \| null` | `data:image/jpeg;base64,...` or `null` if not ready |

#### `saveScreenshot(outputPath?, quality?)` → `Promise<Result>`

Capture the current frame and save it to a file via IPC.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `outputPath` | `string?` | auto-generated | Save path |
| `quality` | `number` | `0.9` | JPG quality (0–1) |
| **Returns** | `Promise<{success, path?, error?}>` | Result with saved file path |

---

## IPC Bridge Protocol

### Channel Naming Convention

```
player:{action}              — invoke channels (renderer → main)
player:{event}:{id}          — push channels (main → renderer)
```

### Request/Response Pattern

All invoke channels return a unified result object:

```typescript
interface IpcResult {
  success: boolean
  error?: string    // present when success === false
  path?: string     // present for startRecord and screenshot
}
```

### Multi-Player Support

Each player is identified by a unique `id` string. The main process maintains a `Map<string, NodePlayer>` internally. This allows multiple simultaneous streams in a single Electron window.

---

## Preload API Interface

The preload script must expose `window.electronAPI` via `contextBridge.exposeInMainWorld`. The interface VideoPlayer expects:

```typescript
interface ElectronAPI {
  // IPC invoke methods
  createPlayer(id: string, options?: object): Promise<{success: boolean, error?: string}>
  startPlayer(id: string, url: string): Promise<{success: boolean, error?: string}>
  stopPlayer(id: string): Promise<{success: boolean, error?: string}>
  destroyPlayer(id: string): Promise<{success: boolean, error?: string}>
  startRecord(id: string, outputPath?: string): Promise<{success: boolean, path?: string, error?: string}>
  stopRecord(id: string): Promise<{success: boolean, error?: string}>
  saveScreenshot(id: string, outputPath?: string, base64Data?: string): Promise<{success: boolean, path?: string, error?: string}>

  // Event subscription methods (return unsubscribe functions)
  onEvent(id: string, callback: (data: {code: number, msg: string}) => void): () => void
  onInfo(id: string, callback: (info: StreamInfo) => void): () => void
  onData(id: string, callback: (data: ArrayBuffer) => void): () => void
}
```

---

## Event Codes Reference

### Connection Events (1xxx)

| Code | Constant | Description |
|------|----------|-------------|
| `1000` | — | Connecting |
| `1001` | — | Connected |
| `1002` | — | Connection failed (`msg` contains details) |
| `1003` | — | Reconnecting |
| `1004` | — | Disconnected |
| `1005` | — | Network error (`msg` contains details) |
| `1006` | — | Connection timeout (`msg` contains details) |

### Recording Events (3xxx)

| Code | Constant | Description |
|------|----------|-------------|
| `3001` | — | Recording started |
| `3002` | — | Recording stopped |
| `3003` | — | Recording error (`msg` contains details) |

---

## Stream Info Object

Emitted via the `'info'` event / `player:info:${id}` IPC channel:

```typescript
interface StreamInfo {
  video?: {
    codecString: string   // e.g., "avc1.640029" (H.264), "hvc1.1.6.L93.B0" (H.265)
    width: number         // e.g., 1920
    height: number        // e.g., 1080
  }
  audio?: {
    codecString: string   // e.g., "mp4a.40.2" (AAC-LC)
    sampleRate: number    // e.g., 44100
    channels: number      // e.g., 2
  }
}
```

`codecString` values are used to construct the MediaSource MIME type:

```
video/mp4; codecs="<videoCodecString>,<audioCodecString>"
```

---

## Integration Patterns

### Pattern 1: Full Electron Integration (Recommended)

This is the standard 3-file pattern for Electron apps with `contextIsolation: true`.

#### main.js

```javascript
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const NodePlayer = require('nodeplayer-addon')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile('index.html')

  // Register IPC bridge — connects NodePlayer to renderer
  NodePlayer.registerIpc(ipcMain, {
    getWindow: () => mainWindow,
    licensePath: app.isPackaged
      ? path.join(process.resourcesPath, 'license.dat')
      : path.join(__dirname, 'license.dat'),
  })

  mainWindow.on('closed', () => {
    NodePlayer.unregisterIpc(ipcMain)
    mainWindow = null
  })
}

app.on('ready', createWindow)
app.on('window-all-closed', () => app.quit())
```

#### preload.js

```javascript
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Invoke methods
  createPlayer: (id, options) => ipcRenderer.invoke('player:create', id, options),
  startPlayer: (id, url) => ipcRenderer.invoke('player:start', id, url),
  stopPlayer: (id) => ipcRenderer.invoke('player:stop', id),
  destroyPlayer: (id) => ipcRenderer.invoke('player:destroy', id),
  startRecord: (id, outputPath) => ipcRenderer.invoke('player:startRecord', id, outputPath),
  stopRecord: (id) => ipcRenderer.invoke('player:stopRecord', id),
  saveScreenshot: (id, outputPath, base64Data) => ipcRenderer.invoke('player:screenshot', id, outputPath, base64Data),

  // Event subscriptions (return unsubscribe functions)
  onEvent: (id, callback) => {
    const channel = `player:event:${id}`
    const handler = (event, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onInfo: (id, callback) => {
    const channel = `player:info:${id}`
    const handler = (event, data) => callback(data)
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

#### renderer.js

```javascript
import VideoPlayer from 'nodeplayer-addon/video-player'

const videoEl = document.querySelector('video')

const player = new VideoPlayer(videoEl, 'stream-1')

player.on('event', (code, msg) => {
  console.log(`[stream-1] Event: ${code} ${msg}`)
})

player.on('error', (err) => {
  console.error(`[stream-1] Error: ${err.message}`)
})

// Start playback
await player.start('rtsp://192.168.1.100:554/stream')

// Record
const recResult = await player.startRecord('/path/to/recording.mp4')

// Screenshot
const dataUrl = player.captureScreenshot()

// Or save screenshot to file via IPC
const saveResult = await player.saveScreenshot('/path/to/snapshot.jpg')

// Cleanup
await player.stop()
```

### Pattern 2: Main-Process Only (No Renderer)

For Node.js scripts or Electron main-process-only usage:

```javascript
const NodePlayer = require('nodeplayer-addon')

const player = new NodePlayer({ licensePath: './license.dat' })

player.on('event', (code, msg) => {
  console.log('Event:', code, msg)
})

player.on('info', (info) => {
  console.log('Video:', info.video?.codecString, info.video?.width, 'x', info.video?.height)
  console.log('Audio:', info.audio?.codecString, info.audio?.sampleRate, 'Hz')
})

player.on('data', (buffer) => {
  console.log('fMP4 segment:', buffer.length, 'bytes')
})

player.start('rtsp://192.168.1.100:554/stream')

// Record
player.startRecord('./output.mp4')
// ... later
player.stopRecord()

player.stop()
```

### Pattern 3: Multi-Player Grid

```javascript
// renderer.js — create multiple players for a grid layout
const streams = [
  { id: 'cam-1', url: 'rtsp://192.168.1.100:554/stream' },
  { id: 'cam-2', url: 'rtsp://192.168.1.101:554/stream' },
  { id: 'cam-3', url: 'rtsp://192.168.1.102:554/stream' },
  { id: 'cam-4', url: 'rtsp://192.168.1.103:554/stream' },
]

const players = streams.map(({ id, url }) => {
  const videoEl = document.getElementById(id)
  const player = new VideoPlayer(videoEl, id)
  player.on('event', (code, msg) => {
    if (code <= 1999) updateStatusLabel(id, `${code}: ${msg}`)
  })
  player.on('error', (err) => { updateStatusLabel(id, 'Error: ' + err.message) })
  player.start(url)
  return player
})

// Stop all
await Promise.all(players.map(p => p.stop()))
```

---

## License & Trial Mode

| Mode | Trigger | Limitation |
|------|---------|------------|
| **Trial** | `new NodePlayer()` or `new NodePlayer({})` | Cumulative 10 minutes of playback |
| **Licensed** | `new NodePlayer({ licensePath: '/path/to/license.dat' })` | Full functionality, no time limit |

Check mode at runtime:

```javascript
if (player.isTrialMode) {
  console.log('Running in trial mode (10 min cumulative)')
}
```

---

## Troubleshooting

### `Cannot find native module`

**Cause**: The platform-specific `.node` binary is missing from `prebuilds/`.

**Fix**: Ensure the correct prebuild directory exists for your platform:
- `prebuilds/darwin-arm64/` — macOS Apple Silicon
- `prebuilds/darwin-x64/` — macOS Intel
- `prebuilds/linux-x64/` — Linux x64
- `prebuilds/win32-x64/` — Windows x64

### Webpack / Vite Build Errors

**Fix**: Exclude `nodeplayer-addon` from bundling:

```javascript
// webpack.config.js
module.exports = {
  externals: { 'nodeplayer-addon': 'commonjs nodeplayer-addon' },
}

// vite.config.js
export default {
  optimizeDeps: { exclude: ['nodeplayer-addon'] },
}
```

### MediaSource Codec Support

The renderer relies on Chromium's built-in codec support via MSE. Supported codecs vary by platform:

| Codec | `codecString` | Support |
|-------|--------------|---------|
| H.264 / AVC | `avc1.XXXXXX` | Universal |
| H.265 / HEVC | `hvc1.X.X.X.X` | macOS 10.13+, Windows 10+, some Linux |
| AAC | `mp4a.40.2` | Universal |

If `addSourceBuffer()` throws `QuotaExceededError` or `NotSupportedError`, the codec is not supported by the current Chromium build.

### IPC Data Not Reaching Renderer

**Check**:
1. `NodePlayer.registerIpc()` was called in main process
2. Preload script exposes `window.electronAPI` with `onData`, `onInfo`, `onEvent`
3. `contextIsolation: true` and `nodeIntegration: false` in BrowserWindow config
4. BrowserWindow is not destroyed when data arrives

### Recording Fails

**Ensure**: `startRecord()` is called only after `start()` succeeds. The pipeline must be running.

### Trial Mode Expired

**Symptom**: `start()` returns `false` or throws.

**Fix**: Provide a valid `licensePath` in the constructor options.
