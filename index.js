const { EventEmitter } = require('events')
const { existsSync } = require('fs')
const { join } = require('path')
const { platform, arch } = process

// 延迟加载 native 模块，优先从预编译目录加载
let native = null
function getNative() {
  if (!native) {
    // 优先加载预编译二进制 prebuilds/{platform}-{arch}/node_player.node
    const prebuildPath = join(
      __dirname, '..', 'prebuilds',
      `${platform}-${arch}`,
      'node_player.node'
    )
    console.log(`Trying to load native module from: ${prebuildPath}`)
    if (existsSync(prebuildPath)) {
      native = require(prebuildPath)
    } else {
      // fallback 到本地构建目录
      console.warn(`Prebuilt module not found, falling back to local build`)
      native = require('../build/Release/node_player.node')
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
