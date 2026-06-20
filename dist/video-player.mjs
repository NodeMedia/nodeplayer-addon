/**
 * VideoPlayer — MediaSource Extension based video player for Electron renderer.
 *
 * Works with the IPC bridge set up by NodePlayer.registerIpc() in the main process
 * and the preload script that exposes window.electronAPI.
 *
 * Usage (ESM in React/Vue):
 *   import VideoPlayer from 'nodeplayer-addon/video-player'
 *   const player = new VideoPlayer(videoEl, 'my-id')
 *   player.on('event', (code, msg) => { ... })
 *   player.on('error', (err) => { ... })
 *   await player.start('rtsp://...')
 *
 * Usage (UMD in HTML):
 *   <script src="video-player.umd.js"></script>
 *   <script>
 *     const player = new VideoPlayer(videoEl, 'my-id')
 *     player.on('event', (code, msg) => { ... })
 *     player.on('error', (err) => { ... })
 *     player.start('rtsp://...')
 *   </script>
 */
class VideoPlayer {
  /**
   * @param {HTMLVideoElement} video - The <video> element to render into
   * @param {string} id - Unique player identifier (used for IPC channels)
   * @param {object} [options]
   * @param {object} [options.api] - IPC bridge (default: window.electronAPI)
   * @param {number} [options.maxBufferDuration=15] - 直播缓冲上限(秒),超过则触发清理
   * @param {number} [options.keepBehindDuration=5] - 清理时保留当前播放点之前的秒数
   * @param {number} [options.targetAhead=0.5] - 追赶后的目标 ahead 值(秒)
   * @param {number} [options.maxAhead=3] - ahead 超过此值时触发 seek 追赶
   */
  constructor(video, id, options = {}) {
    this.id = id;
    this.video = video;
    this._api = options.api || (typeof window !== 'undefined' && window.electronAPI) || null;
    this._listeners = {};

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
    this._bufferStatsTimer = null;

    // 直播场景的缓冲控制(主动清理已播放数据,避免无限增长)
    // 触发清理的总缓冲阈值
    this._maxBufferDuration = options.maxBufferDuration || 30;
    // 清理时保留当前播放点之前的秒数(抗抖动 + 允许短暂回看)
    this._keepBehindDuration = options.keepBehindDuration || 5;

    // 直播延迟追赶(任何原因导致 ahead 累积过大时,seek 到接近 buffer 末端)
    // 追赶后的目标 ahead 值
    this._targetAhead = options.targetAhead != null ? options.targetAhead : 0.3;
    // ahead 超过此阈值时触发追赶(截图/卡顿/IPC 慢等场景)
    this._maxAhead = options.maxAhead != null ? options.maxAhead : 3;
  }

  /**
   * 注册事件监听器
   * @param {'event'|'error'} event - 事件名
   * @param {function} fn - 'event': (code: number, msg: string) => void; 'error': (err: Error) => void
   * @returns {this} 支持链式调用
   */
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = new Set();
    this._listeners[event].add(fn);
    return this
  }

  /**
   * 移除事件监听器
   * @param {'event'|'error'} event - 事件名
   * @param {function} fn - 要移除的监听函数
   * @returns {this}
   */
  off(event, fn) {
    if (this._listeners[event]) this._listeners[event].delete(fn);
    return this
  }

  _emit(event, ...args) {
    const set = this._listeners[event];
    if (set) for (const fn of set) fn(...args);
  }

  /**
   * 启动播放
   * @param {string} url - RTSP/RTMP/KMP 地址
   */
  async start(url) {
    if (this.isStarted) return

    const createResult = await this._api.createPlayer(this.id);
    if (!createResult.success) {
      this._emit('error', new Error(createResult.error));
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
      this._initMediaSource();
    });

    this._unsubData = this._api.onData(this.id, (data) => {
      this._handleData(data);
    });

    const startResult = await this._api.startPlayer(this.id, url);
    if (!startResult.success) {
      this._emit('error', new Error(startResult.error));
      this._cleanupSubscriptions();
      return
    }

    this.isStarted = true;
    // this._startBufferStats()
  }

  /**
   * 停止播放并释放资源
   */
  async stop() {
    if (!this.isStarted) return
    this.isStarted = false;
    this.isReady = false;

    // this._stopBufferStats()
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
        if (this.queue.length > 0) this._processQueue();
      } catch (e) {
        this._emit('error', e);
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
      this._emit('error', e);
    }
  }

  _handleEvent(code, msg) {
    this._emit('event', code, msg);

    if (code === 1004) {
      this._destroyMediaSource();
    } else if (code === 3001) {
      this.isRecording = true;
    } else if (code === 3002 || code === 3003) {
      this.isRecording = false;
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
      this._emit('error', e);
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

  /**
   * 启动每秒打印 video buffer 状态的循环
   * 输出: 总缓冲秒数、缓冲分段数、领先当前播放点的秒数
   */
  _startBufferStats() {
    this._stopBufferStats();
    this._bufferStatsTimer = setInterval(() => {
      const b = this.video && this.video.buffered;
      if (!b || b.length === 0) {
        console.log(`[VideoPlayer:${this.id}] buffer=0.00s, ranges=0`);
        return
      }
      let total = 0;
      for (let i = 0; i < b.length; i++) total += b.end(i) - b.start(i);
      const ahead = Math.max(0, b.end(b.length - 1) - this.video.currentTime);
      console.log(`[VideoPlayer:${this.id}] buffer=${total.toFixed(2)}s, ranges=${b.length}, ahead=${ahead.toFixed(2)}s`);
      this._trimBuffer(total);
      if (ahead > this._maxAhead) this._catchUp(ahead);
    }, 1000);
  }

  _stopBufferStats() {
    if (this._bufferStatsTimer) {
      clearInterval(this._bufferStatsTimer);
      this._bufferStatsTimer = null;
    }
  }

  /**
   * 清理已播放过的缓冲数据(直播场景)
   * 策略:总缓冲超过 _maxBufferDuration 时,remove 掉 [bufferedStart, currentTime - _keepBehindDuration)
   * @param {number} [totalDuration] - 预计算的总缓冲时长(秒),省略时内部重新计算
   */
  _trimBuffer(totalDuration) {
    if (!this.sourceBuffer || !this.mediaSource || this.mediaSource.readyState !== 'open') return
    // SourceBuffer 正在 append/remove 时不能再次操作
    if (this.sourceBuffer.updating) return

    const b = this.video.buffered;
    if (!b || b.length === 0) return

    const total = (typeof totalDuration === 'number')
      ? totalDuration
      : (() => { let s = 0; for (let i = 0; i < b.length; i++) s += b.end(i) - b.start(i); return s })();

    // 未超阈值,不清理(避免每秒 remove 造成碎片)
    if (total < this._maxBufferDuration) return

    const currentTime = this.video.currentTime;
    const removeEnd = currentTime - this._keepBehindDuration;
    // 当前播放点还太靠前,保留区还未形成
    if (removeEnd <= 0) return

    const trimStart = b.start(0);
    // removeEnd 必须严格大于 trimStart 才有意义
    if (removeEnd <= trimStart) return

    try {
      this.sourceBuffer.remove(trimStart, removeEnd);
      console.log(`[VideoPlayer:${this.id}] trim [${trimStart.toFixed(2)}, ${removeEnd.toFixed(2)}]`);
    } catch (e) {
      console.error(`[VideoPlayer:${this.id}] trimBuffer error:`, e);
    }
  }

  /**
   * 直播延迟追赶:seek 到 bufferedEnd - targetAhead
   * 触发场景:截图、主线程阻塞、IPC 慢、网络突发等导致 ahead 累积
   * @param {number} [currentAhead] - 预计算的 ahead 值,仅用于日志
   */
  _catchUp(currentAhead) {
    if (!this.video || !this.video.buffered) return
    const b = this.video.buffered;
    if (b.length === 0) return

    // 如果 video 被暂停(用户主动暂停),不追赶 —— 否则会强行拉回播放
    if (this.video.paused) return

    const bufferedEnd = b.end(b.length - 1);
    const targetTime = bufferedEnd - this._targetAhead;
    const currentTime = this.video.currentTime;

    // target 必须严格大于 current 才有意义
    if (targetTime <= currentTime) return
    // 确保目标点在已缓冲范围内(seek 安全)
    if (targetTime < b.start(0)) return

    const jump = targetTime - currentTime;
    const aheadLabel = (typeof currentAhead === 'number') ? ` (ahead was ${currentAhead.toFixed(2)}s)` : '';
    try {
      this.video.currentTime = targetTime;
      console.log(`[VideoPlayer:${this.id}] catchUp: seek +${jump.toFixed(2)}s${aheadLabel}`);
    } catch (e) {
      console.error(`[VideoPlayer:${this.id}] catchUp error:`, e);
    }
  }
}

export { VideoPlayer as default };
