(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.VideoPlayer = factory());
})(this, (function () { 'use strict';

  /**
   * VideoPlayer — MediaSource Extension based video player for Electron renderer.
   *
   * Works with the IPC bridge set up by NodePlayer.registerIpc() in the main process
   * and the preload script that exposes window.electronAPI.
   *
   * Usage (ESM in React/Vue):
   *   import VideoPlayer from 'nodeplayer-addon/video-player'
   *   const player = new VideoPlayer(videoEl, 'my-id', { onStatus, onRecord })
   *   await player.start('rtsp://...')
   *
   * Usage (UMD in HTML):
   *   <script src="video-player.umd.js"></script>
   *   <script>
   *     const player = new VideoPlayer(videoEl, 'my-id', {
   *       onStatus(id, text) { ... },
   *       onRecord(id, recording, msg) { ... },
   *     })
   *     player.start('rtsp://...')
   *   </script>
   */
  class VideoPlayer {
    /**
     * @param {HTMLVideoElement} video - The <video> element to render into
     * @param {string} id - Unique player identifier (used for IPC channels)
     * @param {object} [options]
     * @param {function} [options.onStatus] - (id: string, text: string) => void
     * @param {function} [options.onRecord] - (id: string, recording: boolean, msg: string) => void
     * @param {object} [options.api] - IPC bridge (default: window.electronAPI)
     */
    constructor(video, id, options = {}) {
      this.id = id;
      this.video = video;
      this.onStatus = options.onStatus || null;
      this.onRecord = options.onRecord || null;
      this._api = options.api || (typeof window !== 'undefined' && window.electronAPI) || null;

      this.mediaSource = null;
      this.sourceBuffer = null;
      this.queue = [];
      this.isStarted = false;
      this.isReady = false;
      this.isRecording = false;
      this.videoCodecString = null;
      this.audioCodecString = null;

      this._videoWidth = 0;
      this._videoHeight = 0;
      this._canvas = null;
      this._canvasCtx = null;

      this._unsubEvent = null;
      this._unsubInfo = null;
      this._unsubData = null;
    }

    _setStatus(text) {
      if (this.onStatus) this.onStatus(this.id, text);
    }

    _setRecording(recording, msg) {
      this.isRecording = recording;
      if (this.onRecord) this.onRecord(this.id, recording, msg);
    }

    /**
     * 启动播放
     * @param {string} url - RTSP/RTMP/KMP 地址
     */
    async start(url) {
      if (this.isStarted) return
      this._setStatus('Connecting...');

      const createResult = await this._api.createPlayer(this.id);
      if (!createResult.success) {
        this._setStatus('Error: ' + createResult.error);
        return
      }

      this._unsubEvent = this._api.onEvent(this.id, (data) => {
        this._handleEvent(data.code, data.msg);
      });

      this._unsubInfo = this._api.onInfo(this.id, (info) => {
        this.videoCodecString = info.video ? info.video.codecString : null;
        this.audioCodecString = info.audio ? info.audio.codecString : null;
        if (info.video && info.video.width && info.video.height) {
          this._videoWidth = info.video.width;
          this._videoHeight = info.video.height;
          this._initCanvas();
        }
        this._setStatus('Stream info received...');
        this._initMediaSource();
      });

      this._unsubData = this._api.onData(this.id, (data) => {
        this._handleData(data);
      });

      const startResult = await this._api.startPlayer(this.id, url);
      if (!startResult.success) {
        this._setStatus('Error: ' + startResult.error);
        this._cleanupSubscriptions();
        return
      }

      this.isStarted = true;
      this._setStatus('Waiting for stream info...');
    }

    /**
     * 停止播放并释放资源
     */
    async stop() {
      if (!this.isStarted) return
      this.isStarted = false;
      this.isReady = false;

      this._cleanupSubscriptions();

      try {
        await this._api.stopPlayer(this.id);
        await this._api.destroyPlayer(this.id);
      } catch (e) { /* ignore */ }

      this._destroyMediaSource();
      this._canvas = null;
      this._canvasCtx = null;
      this._videoWidth = 0;
      this._videoHeight = 0;
      this.queue = [];
      this._setStatus('');
      this.isRecording = false;
    }

    /**
     * 开始录像
     * @param {string} [outputPath] - 输出文件路径（可选，由主进程自动生成）
     * @returns {Promise<{success: boolean, path?: string, error?: string}>}
     */
    async startRecord(outputPath) {
      if (!this.isStarted) return { success: false, error: 'Player not started' }
      try {
        const result = await this._api.startRecord(this.id, outputPath);
        if (result.success) this.isRecording = true;
        return result
      } catch (e) {
        return { success: false, error: e.message }
      }
    }

    /**
     * 停止录像
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async stopRecord() {
      if (!this.isStarted) return { success: false, error: 'Player not started' }
      try {
        const result = await this._api.stopRecord(this.id);
        if (result.success) this.isRecording = false;
        return result
      } catch (e) {
        return { success: false, error: e.message }
      }
    }

    /**
     * 截取当前视频帧，返回 JPG 格式的 data URL
     * @param {number} [quality=0.9] - JPG 质量 (0-1)
     * @returns {string|null} data URL (image/jpeg)，未就绪时返回 null
     */
    captureScreenshot(quality = 0.9) {
      if (!this.isReady || !this._canvas || !this.video) return null
      this._canvasCtx.drawImage(this.video, 0, 0, this._videoWidth, this._videoHeight);
      return this._canvas.toDataURL('image/jpeg', quality)
    }

    /**
     * 截取当前视频帧并通过 IPC 保存到指定路径（JPG 格式）
     * @param {string} [outputPath] - 保存路径（可选，默认自动生成）
     * @param {number} [quality=0.9] - JPG 质量 (0-1)
     * @returns {Promise<{success: boolean, path?: string, error?: string}>}
     */
    async saveScreenshot(outputPath, quality = 0.9) {
      if (!this.isReady || !this._canvas || !this.video) {
        return { success: false, error: 'Stream not ready' }
      }
      if (!this._api || !this._api.saveScreenshot) {
        return { success: false, error: 'IPC saveScreenshot not available' }
      }
      try {
        this._canvasCtx.drawImage(this.video, 0, 0, this._videoWidth, this._videoHeight);
        const dataUrl = this._canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
        return await this._api.saveScreenshot(this.id, outputPath, base64)
      } catch (e) {
        return { success: false, error: e.message }
      }
    }

    // ============ Internal ============

    _initCanvas() {
      this._canvas = document.createElement('canvas');
      this._canvas.width = this._videoWidth;
      this._canvas.height = this._videoHeight;
      this._canvasCtx = this._canvas.getContext('2d');
    }

    _initMediaSource() {
      if (!this.videoCodecString || !this.video) return

      this.mediaSource = new MediaSource();
      this.video.src = URL.createObjectURL(this.mediaSource);

      this.mediaSource.addEventListener('sourceopen', () => {
        if (this.mediaSource.readyState !== 'open') return
        try {
          const codecs = this.audioCodecString
            ? this.videoCodecString + ',' + this.audioCodecString
            : this.videoCodecString;
          const mimeType = 'video/mp4; codecs="' + codecs + '"';
          this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
          this.sourceBuffer.addEventListener('updateend', () => this._processQueue());
          this.isReady = true;
          this._setStatus('Playing');
          if (this.queue.length > 0) this._processQueue();
        } catch (e) {
          this._setStatus('Error: ' + e.message);
        }
      });

      this.mediaSource.addEventListener('sourceclose', () => {
        this.isReady = false;
        this.sourceBuffer = null;
      });
    }

    _processQueue() {
      if (!this.isReady || !this.sourceBuffer) return
      if (this.sourceBuffer.updating) return
      if (this.queue.length === 0) return
      try {
        if (this.mediaSource && this.mediaSource.readyState === 'open') {
          this.sourceBuffer.appendBuffer(this.queue.shift());
        }
      } catch (e) {
        console.error('[VideoPlayer] processQueue error:', e);
      }
    }

    _handleEvent(code, msg) {
      const stateMap = {
        1000: 'Connecting...',
        1001: 'Connected',
        1002: 'Connection failed: ' + msg,
        1003: 'Reconnecting...',
        1004: 'Disconnected',
        1005: 'Network error: ' + msg,
        1006: 'Connection timeout: ' + msg,
        3001: 'Recording started',
        3002: 'Recording stopped',
        3003: 'Recording error: ' + msg,
      };
      this._setStatus(stateMap[code] || 'Unknown (' + code + ')');

      if (code === 1004) {
        this._destroyMediaSource();
      } else if (code === 3001) {
        this._setRecording(true, msg);
      } else if (code === 3002 || code === 3003) {
        this._setRecording(false, msg);
      }
    }

    _handleData(data) {
      if (!this.isStarted) return
      try {
        this.queue.push(new Uint8Array(data).buffer);
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

    _cleanupSubscriptions() {
      if (this._unsubEvent) { this._unsubEvent(); this._unsubEvent = null; }
      if (this._unsubInfo) { this._unsubInfo(); this._unsubInfo = null; }
      if (this._unsubData) { this._unsubData(); this._unsubData = null; }
    }
  }

  return VideoPlayer;

}));
