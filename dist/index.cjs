'use strict';

var require$$0 = require('events');
var require$$1 = require('fs');
var require$$2 = require('path');
var require$$3 = require('module');

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

function commonjsRequire(path) {
	throw new Error('Could not dynamically require "' + path + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}

var js;
var hasRequiredJs;

function requireJs () {
	if (hasRequiredJs) return js;
	hasRequiredJs = 1;
	const { EventEmitter } = require$$0;
	const { existsSync, mkdirSync, writeFileSync } = require$$1;
	const { join, dirname } = require$$2;
	const { createRequire } = require$$3;
	const { platform, arch } = process;

	/**
	 * 获取原生 require，绕过 webpack/vite 的模块替换
	 * - webpack 环境使用 __non_webpack_require__
	 * - 其他环境使用 createRequire() 基于运行时目录创建
	 */
	let _nativeRequire = null;
	function getNativeRequire() {
	  if (!_nativeRequire) {
	    if (typeof __non_webpack_require__ !== 'undefined') {
	      _nativeRequire = __non_webpack_require__;
	    } else {
	      try {
	        // 基于运行时工作目录创建 require，不受打包工具对 __dirname/__filename 的篡改
	        _nativeRequire = createRequire(process.cwd() + '/package.json');
	      } catch (e) {
	        _nativeRequire = commonjsRequire;
	      }
	    }
	  }
	  return _nativeRequire
	}

	/**
	 * 解析包根目录（兼容打包后 __dirname 失效）
	 * - 优先通过 require.resolve 找到包在 node_modules 中的真实路径
	 * - __dirname 检查作为 fallback（未打包环境）
	 */
	function resolvePackageRoot() {
	  const req = getNativeRequire();

	  // Strategy 1: 通过 require.resolve 找到包的真实安装路径
	  try {
	    const pkgJsonPath = req.resolve('nodeplayer-addon/package.json');
	    return dirname(pkgJsonPath)
	  } catch (e) {
	    // ignore
	  }

	  // Strategy 2: __dirname 上级存在 package.json（未打包环境）
	  const fallback = join(__dirname, '..');
	  if (existsSync(join(fallback, 'package.json'))) {
	    return fallback
	  }

	  return fallback
	}

	// 延迟加载 native 模块，优先从预编译目录加载
	let native = null;
	function getNative() {
	  if (!native) {
	    const req = getNativeRequire();
	    const basePath = resolvePackageRoot();

	    const prebuildPath = join(basePath, 'prebuilds', `${platform}-${arch}`, 'node_player.node');
	    const localPath = join(basePath, 'build', 'Release', 'node_player.node');

	    if (existsSync(prebuildPath)) {
	      native = req(prebuildPath);
	    } else if (existsSync(localPath)) {
	      native = req(localPath);
	    } else {
	      throw new Error(
	        `[nodeplayer-addon] Cannot find native module.\n` +
	        `  Searched:\n` +
	        `    Prebuild: ${prebuildPath}\n` +
	        `    Local:    ${localPath}\n` +
	        `  Resolved root: ${basePath}\n` +
	        `  __dirname:     ${__dirname}\n` +
	        `  Platform:      ${platform}-${arch}\n\n` +
	        `If using webpack/vite, add to externals:\n` +
	        `  webpack: externals: { 'nodeplayer-addon': 'commonjs nodeplayer-addon' }\n` +
	        `  vite:    optimizeDeps: { exclude: ['nodeplayer-addon'] }`
	      )
	    }
	  }
	  return native
	}

	// ============ Electron IPC 管理 ============
	const _ipcPlayers = new Map();
	const _ipcChannels = [
	  'player:create',
	  'player:start',
	  'player:stop',
	  'player:destroy',
	  'player:startRecord',
	  'player:stopRecord',
	  'player:screenshot',
	  'player:getMediaInfo'
	];

	/**
	 * NodePlayer - RTSP/RTMP/KMP 流媒体播放器
	 * 
	 * 支持的事件:
	 *   - 'event': (code, msg) => {} - 管线事件
	 *   - 'info': (info) => {} - 流信息
	 *   - 'data': (buffer) => {} - fMP4 分片数据
	 * 
	 * 使用示例:
	 *   // 正式授权模式
	 *   const player = new NodePlayer({ licensePath: '/path/to/license.dat' })
	 *   player.on('info', (info) => console.log(info))
	 *   player.on('data', (buffer) => console.log(buffer.length))
	 *   player.start('rtsp://...')
	 *   player.startRecord('./record.mp4')
	 *   // ...
	 *   player.stopRecord()
	 *   player.stop()
	 * 
	 *   // 试用模式（无需许可证，累计 10 分钟）
	 *   const player = new NodePlayer()
	 *   player.start('rtsp://...')
	 */
	class NodePlayer extends EventEmitter {
	  /**
	   * @param {object} [options] - 配置选项
	   * @param {string} [options.licensePath] - 许可证文件路径。
	   *   传入有效路径 → 正式授权模式；
	   *   不传或空字符串 → 试用模式（累计 10 分钟）。
	   */
	  constructor(options) {
	    super();
	    const opts = options || {};
	    this._player = new (getNative().NodePlayer)(opts);
	    this._started = false;
	    this._trialMode = !opts.licensePath;

	    // 转发原生事件
	    this._player.on('event', (code, msg) => {
	      this.emit('event', code, msg);
	    });

	    this._player.on('info', (info) => {
	      this.emit('info', info);
	    });

	    this._player.on('data', (buffer) => {
	      this.emit('data', buffer);
	    });
	  }

	  /**
	   * 是否处于试用模式
	   * @returns {boolean}
	   */
	  get isTrialMode() {
	    return this._trialMode
	  }

	  /**
	   * 启动管线（内部会先验证许可证）
	   * @param {string} url - 输入地址 (RTSP/RTMP/KMP)
	   * @returns {boolean} 是否成功启动
	   */
	  start(url) {
	    if (this._started) {
	      throw new Error('Pipeline already started')
	    }
	    try {
	      this._player.start(url);
	      this._started = true;
	      return true
	    } catch (err) {
	      this.emit('error', err);
	      return false
	    }
	  }

	  /**
	   * 停止管线
	   */
	  stop() {
	    if (this._started) {
	      this._player.stop();
	      this._started = false;
	    }
	  }

	  /**
	   * 开始录像
	   * @param {string} outputPath - 输出 MP4 文件路径
	   */
	  startRecord(outputPath) {
	    if (!this._started) {
	      throw new Error('Pipeline not started')
	    }
	    this._player.startRecord(outputPath);
	  }

	  /**
	   * 停止录像（生成完整 MP4 文件）
	   */
	  stopRecord() {
	    this._player.stopRecord();
	  }

	  // ============ Electron IPC 静态方法 ============

	  /**
	   * 注册 Electron ipcMain 处理器，将播放器操作桥接到渲染进程。
	   *
	   * 注册后，渲染进程可通过 preload 调用：
	   *   - ipcRenderer.invoke('player:getMediaInfo', url)         // 预探测（无需 id）
	   *   - ipcRenderer.invoke('player:create', id, options)
	   *   - ipcRenderer.invoke('player:start', id, url)
	   *   - ipcRenderer.invoke('player:stop', id)
	   *   - ipcRenderer.invoke('player:destroy', id)
	   *   - ipcRenderer.invoke('player:startRecord', id, outputPath?)
	   *   - ipcRenderer.invoke('player:stopRecord', id)
	   *
	   * 事件通过 mainWindow.webContents.send 推送到渲染进程：
	   *   - player:event:${id}  → { code, msg }
	   *   - player:info:${id}   → info
	   *   - player:data:${id}   → Buffer
	   *
	   * @param {object} ipcMain - Electron ipcMain
	   * @param {object} options
	   * @param {function} options.getWindow - 返回当前 BrowserWindow 的函数（窗口可重建）
	   * @param {string} [options.licensePath] - 许可证路径（不传则为试用模式）
	   *
	   * @example
	   * // main.js
	   * const { ipcMain, app } = require('electron')
	   * const NodePlayer = require('nodeplayer-addon')
	   *
	   * NodePlayer.registerIpc(ipcMain, {
	   *   getWindow: () => mainWindow,
	   *   licensePath: app.isPackaged
	   *     ? path.join(process.resourcesPath, 'license.dat')
	   *     : path.join(__dirname, 'license.dat'),
	   * })
	   */
	  static registerIpc(ipcMain, options = {}) {
	    const { getWindow, licensePath } = options;

	    const send = (channel, data) => {
	      const win = getWindow && getWindow();
	      if (win && !win.isDestroyed()) {
	        win.webContents.send(channel, data);
	      }
	    };

	    // 预探测：分析 URL 是否可连接 + 视频/音频参数 + 截图（与 player 实例无关）
	    // 返回 { success, info?: { video, audio, screenshot } }
	    ipcMain.handle('player:getMediaInfo', async (event, url) => {
	      try {
	        const info = await NodePlayer.getMediaInfo(url);
	        return { success: true, info }
	      } catch (e) {
	        return { success: false, error: e.message }
	      }
	    });

	    ipcMain.handle('player:create', (event, id, playerOptions) => {
	      if (_ipcPlayers.has(id)) {
	        return { success: false, error: 'Player already exists' }
	      }

	      const opts = playerOptions || {};
	      if (!opts.licensePath && licensePath) {
	        opts.licensePath = licensePath;
	      }

	      const player = new NodePlayer(opts);

	      player.on('event', (code, msg) => {
	        send(`player:event:${id}`, { code, msg });
	      });

	      player.on('info', (info) => {
	        send(`player:info:${id}`, info);
	      });

	      player.on('data', (data) => {
	        send(`player:data:${id}`, data);
	      });

	      _ipcPlayers.set(id, player);
	      return { success: true }
	    });

	    ipcMain.handle('player:start', (event, id, url) => {
	      const player = _ipcPlayers.get(id);
	      if (!player) {
	        return { success: false, error: 'Player not found' }
	      }
	      try {
	        const result = player.start(url);
	        return { success: result }
	      } catch (e) {
	        return { success: false, error: e.message }
	      }
	    });

	    ipcMain.handle('player:stop', (event, id) => {
	      const player = _ipcPlayers.get(id);
	      if (!player) {
	        return { success: false, error: 'Player not found' }
	      }
	      try {
	        player.stop();
	        return { success: true }
	      } catch (e) {
	        return { success: false, error: e.message }
	      }
	    });

	    ipcMain.handle('player:destroy', (event, id) => {
	      const player = _ipcPlayers.get(id);
	      if (!player) {
	        return { success: false, error: 'Player not found' }
	      }
	      try {
	        player.stop();
	        _ipcPlayers.delete(id);
	        return { success: true }
	      } catch (e) {
	        return { success: false, error: e.message }
	      }
	    });

	    ipcMain.handle('player:startRecord', (event, id, outputPath) => {
	      const player = _ipcPlayers.get(id);
	      if (!player) {
	        return { success: false, error: 'Player not found' }
	      }
	      try {
	        const savePath = outputPath || join(
	          process.cwd(),
	          `record_${id}_${Date.now()}.mp4`
	        );
	        const dir = dirname(savePath);
	        if (!existsSync(dir)) {
	          mkdirSync(dir, { recursive: true });
	        }
	        player.startRecord(savePath);
	        return { success: true, path: savePath }
	      } catch (e) {
	        return { success: false, error: e.message }
	      }
	    });

	    ipcMain.handle('player:stopRecord', (event, id) => {
	      const player = _ipcPlayers.get(id);
	      if (!player) {
	        return { success: false, error: 'Player not found' }
	      }
	      try {
	        player.stopRecord();
	        return { success: true }
	      } catch (e) {
	        return { success: false, error: e.message }
	      }
	    });

	    ipcMain.handle('player:screenshot', (event, id, outputPath, base64Data) => {
	      try {
	        const savePath = outputPath || join(
	          process.cwd(),
	          `screenshot_${id}_${Date.now()}.jpg`
	        );
	        const dir = dirname(savePath);
	        if (!existsSync(dir)) {
	          mkdirSync(dir, { recursive: true });
	        }
	        writeFileSync(savePath, Buffer.from(base64Data, 'base64'));
	        return { success: true, path: savePath }
	      } catch (e) {
	        return { success: false, error: e.message }
	      }
	    });
	  }

	  /**
	   * 注销 Electron ipcMain 处理器，停止所有播放器并清理资源。
	   *
	   * @param {object} ipcMain - Electron ipcMain
	   *
	   * @example
	   * mainWindow.on('closed', () => {
	   *   NodePlayer.unregisterIpc(ipcMain)
	   * })
	   */
	  static unregisterIpc(ipcMain) {
	    _ipcPlayers.forEach(player => {
	      try { player.stop(); } catch (e) { /* ignore */ }
	    });
	    _ipcPlayers.clear();

	    _ipcChannels.forEach(ch => ipcMain.removeHandler(ch));
	  }

	  // ============ 流媒体探测（静态方法）============

	  /**
	   * 异步获取流媒体信息（不阻塞 Node 事件循环）。
	   *
	   * 用于在添加 URL 到播放器之前，先分析流：
	   *   - 是否可连接
	   *   - 视频/音频编码、分辨率、采样率
	   *   - 截取首帧作为预览图（MJPEG Buffer）
	   *
	   * @param {string} url - 流地址 (RTSP/RTMP/KMP/HTTP...)
	   * @returns {Promise<{video: object, audio: object, screenshot: Buffer|null}>}
	   *   - video: { codecId:number, width:number, height:number }
	   *       codecId 为 AV_CODEC_ID_* 原始值（27=H264, 173=HEVC...）
	   *   - audio: { codecId:number, sampleRate:number, channels:number }
	   *       无音频时三个字段均为 0
	   *   - screenshot: MJPEG 二进制 Buffer；解码失败/无视频时为 null
	   *
	   * @example
	   * const info = await NodePlayer.getMediaInfo('rtsp://...')
	   * console.log(info.video.width + 'x' + info.video.height)
	   * if (info.screenshot) {
	   *   const base64 = info.screenshot.toString('base64')
	   *   previewImg.src = 'data:image/jpeg;base64,' + base64
	   * }
	   */
	  static getMediaInfo(url) {
	    if (typeof url !== 'string' || !url) {
	      // 同步抛出 TypeError，遵循 Node.js fs.promises.* 的惯例
	      throw new TypeError('url must be a non-empty string')
	    }
	    // 原生层返回 Promise；用 Promise.resolve 统一异常路径，避免被调用方漏 catch
	    return Promise.resolve(getNative().getMediaInfo(url))
	  }

	}

	js = NodePlayer;
	return js;
}

var jsExports = requireJs();
var index = /*@__PURE__*/getDefaultExportFromCjs(jsExports);

module.exports = index;
