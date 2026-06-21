# 流预探测（getMediaInfo）

在加入播放列表前，可先探测流地址是否可达、获取音视频参数并截取首帧预览图。整个过程在主进程后台执行（基于 `Napi::AsyncWorker` 跑在 libuv 线程池），不阻塞 Node 事件循环，也不依赖任何播放器实例。

> **前置条件**：已在主进程调用 `NodePlayerAddon.registerIpc(ipcMain, {...})`，并在 preload 暴露 `electronAPI.getMediaInfo`。完整接入步骤见 [quick-start.md](./quick-start.md)、[react-frontend.md](./react-frontend.md)、[vue-frontend.md](./vue-frontend.md)。

## 调用方式（两种等价）

```js
// 方式 A：通过 preload 暴露的 IPC
const result = await window.electronAPI.getMediaInfo('rtsp://...')

// 方式 B：通过 NodePlayerView 静态方法（内部转发到方式 A）
const result = await NodePlayerView.getMediaInfo('rtsp://...')
```

## 返回结构

```js
// 失败
{ success: false, error: '错误描述' }

// 成功
{
  success: true,
  info: {
    video: {
      codecId: 27,         // FFmpeg AV_CODEC_ID_* 原始值
      width: 1920,         // 视频宽（无视频时为 0）
      height: 1080         // 视频高（无视频时为 0）
    },
    audio: {
      codecId: 86018,      // FFmpeg AV_CODEC_ID_* 原始值
      sampleRate: 44100,   // 采样率 Hz
      channels: 2          // 声道数
      // 无音频时三个字段均为 0
    },
    screenshot: Uint8Array | { type:'Buffer', data:number[] } | null
                          // 首帧 JPEG 二进制；解码失败 / 无视频时为 null
  }
}
```

## 常用 codec ID 参考（FFmpeg AV_CODEC_ID_*）

| 类型 | codecId | 名称 |
|------|---------|------|
| 视频 | 1       | MPEG-1 |
|      | 2       | MPEG-2 |
|      | 27      | H.264 |
|      | 173     | H.265 (HEVC) |
| 音频 | 86016   | MP2 |
|      | 86017   | MP3 |
|      | 86018   | AAC |
|      | 86019   | AC3 |
|      | 86024   | Opus |
|      | 65542   | G.711 µ-law (PCMU) |
|      | 65543   | G.711 A-law (PCMA) |

> 完整 ID 列表见 FFmpeg `libavcodec/codec_id.h`。视频 ID 从 1 开始，音频 ID 从 `0x10000`（65536）开始。

> ⚠️ **IPC 序列化提示**：原生层返回的 `Buffer` 经 Electron 结构化克隆到达渲染进程后，形态可能是 `Uint8Array`，也可能是 `{ type:'Buffer', data:[...] }`（取决于 Electron 版本与 contextBridge 配置）。两种形态都要兼容，否则截图显示会失败。

## 完整示例

参考 `example/Simple/renderer.js` 的 Probe 实现：

```js
// 1. 兼容 Buffer 经 IPC 序列化后的两种形态
function toUint8Array(screenshot) {
  if (!screenshot) return null
  if (screenshot instanceof Uint8Array) return screenshot
  if (screenshot && typeof screenshot === 'object' && Array.isArray(screenshot.data)) {
    return new Uint8Array(screenshot.data)
  }
  return null
}

// 2. 调用
const result = await NodePlayerView.getMediaInfo(url)
if (!result.success) {
  console.warn('Probe failed:', result.error)
  return
}
const { video, audio, screenshot } = result.info

console.log(`视频：${video.width}×${video.height}（codecId=${video.codecId}）`)
console.log(`音频：采样率=${audio.sampleRate}，声道=${audio.channels}`)

// 3. 截图预览：用 Blob + objectURL，比先 base64 更高效
const bytes = toUint8Array(screenshot)
if (bytes && bytes.length > 0) {
  const previewSrc = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
  previewImg.src = previewSrc
  // 用完记得释放：URL.revokeObjectURL(previewSrc)
}
```
