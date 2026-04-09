const { EventEmitter } = require('events')
const { existsSync } = require('fs')
const { join, dirname } = require('path')
const { createRequire } = require('module')
const { platform, arch } = process

/**
 * 获取原生 require，绕过 webpack/vite 的模块替换
 * - webpack 环境使用 __non_webpack_require__
 * - 其他环境使用 createRequire() 基于运行时目录创建
 */
let _nativeRequire = null
function getNativeRequire() {
  if (!_nativeRequire) {
    if (typeof __non_webpack_require__ !== 'undefined') {
      _nativeRequire = __non_webpack_require__
    } else {
      try {
        // 基于运行时工作目录创建 require，不受打包工具对 __dirname/__filename 的篡改
        _nativeRequire = createRequire(process.cwd() + '/package.json')
      } catch (e) {
        _nativeRequire = require
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
  const req = getNativeRequire()

  // Strategy 1: 通过 require.resolve 找到包的真实安装路径
  try {
    const pkgJsonPath = req.resolve('nodeplayer-addon/package.json')
    return dirname(pkgJsonPath)
  } catch (e) {
    // ignore
  }

  // Strategy 2: __dirname 上级存在 package.json（未打包环境）
  const fallback = join(__dirname, '..')
  if (existsSync(join(fallback, 'package.json'))) {
    return fallback
  }

  return fallback
}

// 延迟加载 native 模块，优先从预编译目录加载
let native = null
function getNative() {
  if (!native) {
    const req = getNativeRequire()
    const basePath = resolvePackageRoot()

    const prebuildPath = join(basePath, 'prebuilds', `${platform}-${arch}`, 'node_player.node')
    const localPath = join(basePath, 'build', 'Release', 'node_player.node')

    if (existsSync(prebuildPath)) {
      native = req(prebuildPath)
    } else if (existsSync(localPath)) {
      native = req(localPath)
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

/**
 * NodePlayer - RTSP/RTMP/KMP 流媒体播放器
 * 
 * 支持的事件:
 *   - 'event': (code, msg) => {} - 管线事件
 *   - 'info': (info) => {} - 流信息
 *   - 'data': (buffer) => {} - fMP4 分片数据
 * 
 * 使用示例:
 *   const player = new NodePlayer({ licensePath: '/path/to/license.dat' })
 *   player.on('info', (info) => console.log(info))
 *   player.on('data', (buffer) => console.log(buffer.length))
 *   player.start('rtsp://...')
 *   // ...
 *   player.stop()
 */
class NodePlayer extends EventEmitter {
  /**
   * @param {object} [options] - 配置选项
   * @param {string} options.licensePath - 许可证文件路径
   */
  constructor(options) {
    super()
    const opts = options || {}
    this._player = new (getNative().NodePlayer)(opts)
    this._started = false

    // 转发原生事件
    this._player.on('event', (code, msg) => {
      this.emit('event', code, msg)
    })

    this._player.on('info', (info) => {
      this.emit('info', info)
    })

    this._player.on('data', (buffer) => {
      this.emit('data', buffer)
    })
  }

  /**
   * 启动管线（内部会先验证许可证）
   * @param {string} url - 输入地址 (RTSP/RTMP/文件等)
   * @returns {boolean} 是否成功启动
   */
  start(url) {
    if (this._started) {
      throw new Error('Pipeline already started')
    }
    try {
      this._player.start(url)
      this._started = true
      return true
    } catch (err) {
      this.emit('error', err)
      return false
    }
  }

  /**
   * 停止管线
   */
  stop() {
    if (this._started) {
      this._player.stop()
      this._started = false
    }
  }
  
}

module.exports = NodePlayer
