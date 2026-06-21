# nodeplayer-addon

这是一款专为 Electron 开发的原生播放器扩展，基于 N-API C++ 构建，支持 Electron 原生环境无法直接播放的 RTSP / RTMP / KMP / HTTP(S)-FLV 等网络视频协议。

## 特性

### 支持系统和架构
- Windows x64
- Linux x64 / arm64 / loong64 / riscv64
- MacOS x64 / arm64

### 支持协议
- RTSP
- RTMP
- KMP
- HTTP(S)-FLV

### 支持编码
- 视频：H.264 / H.265
- 音频：AAC / G.711 / G.726 / MP2

### 功能
- 低延迟播放
- 播放中截图、录像（MP4）
- 多画面、全屏播放
- 硬件解码加速

## 文档

详细的集成方法请参阅 `docs/` 目录：

| 文档 | 说明 |
|------|------|
| [introduction.md](./docs/introduction.md) | 项目简介与文档路由 |
| [quick-start.md](./docs/quick-start.md) | 最小可运行集成示例（main.js + preload.js + HTML） |
| [react-frontend.md](./docs/react-frontend.md) | React 前端集成指南 |
| [vue-frontend.md](./docs/vue-frontend.md) | Vue 前端集成指南 |

## 授权
无授权文件的情况下也可以直接开启试用测试

- QQ: 281269007
- Email: service@nodemedia.cn
