import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WSCodec, OPCODES } from './ws_codec.js';

/**
 * Zero-Dependency Native RFC 6455 WebSocket Sync Client.
 * 
 * Features automatic exponential backoff reconnects and offline mutation queuing.
 */
export class WebSocketSyncClient extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} [options.host='127.0.0.1']
   * @param {number} [options.port=4040]
   * @param {string} [options.peerId]
   * @param {number} [options.maxReconnectDelayMs=5000]
   */
  constructor(options = {}) {
    super();
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 4040;
    this.peerId = options.peerId || `client_${Math.random().toString(36).substring(2, 8)}`;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs || 5000;

    this.socket = null;
    this.isConnected = false;
    this.isHandshaked = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.shouldReconnect = true;

    this.receiveBuffer = Buffer.alloc(0);
    this.offlineQueue = [];
  }

  /**
   * Connects to the remote sync server.
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      this.shouldReconnect = true;
      this.socket = net.createConnection({ host: this.host, port: this.port });

      const secWebSocketKey = crypto.randomBytes(16).toString('base64');
      this.expectedAccept = WSCodec.computeAcceptKey(secWebSocketKey);

      this.socket.on('connect', () => {
        const upgradeRequest = [
          'GET / HTTP/1.1',
          `Host: ${this.host}:${this.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${secWebSocketKey}`,
          'Sec-WebSocket-Version: 13',
          '\r\n',
        ].join('\r\n');

        this.socket.write(upgradeRequest);
      });

      this.socket.on('data', (chunk) => {
        if (!this.isHandshaked) {
          const responseStr = chunk.toString('utf8');
          if (responseStr.includes('101 Switching Protocols')) {
            this.isHandshaked = true;
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.emit('connected');

            // Find where HTTP header ends (\r\n\r\n)
            const headerEndIdx = chunk.indexOf('\r\n\r\n');
            if (headerEndIdx !== -1 && headerEndIdx + 4 < chunk.length) {
              this.receiveBuffer = chunk.subarray(headerEndIdx + 4);
            }

            this._flushOfflineQueue();
            resolve();
          } else {
            this.socket.destroy();
            reject(new Error(`WebSocket handshake failed: ${responseStr}`));
          }
          return;
        }

        this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
        const { frames, remaining } = WSCodec.decodeFrames(this.receiveBuffer);
        this.receiveBuffer = remaining;

        for (const frame of frames) {
          if (frame.opcode === OPCODES.TEXT) {
            try {
              const msg = JSON.parse(frame.payload);
              this.emit('message', msg);
            } catch {
              // Ignore invalid JSON
            }
          } else if (frame.opcode === OPCODES.PING) {
            const pong = WSCodec.encodeFrame(frame.payload, { isBinary: true, mask: true });
            pong[0] = 0x80 | OPCODES.PONG;
            this.socket.write(pong);
          } else if (frame.opcode === OPCODES.CLOSE) {
            this._handleDisconnect();
          }
        }
      });

      this.socket.on('error', (err) => {
        this.emit('error', err);
        this._handleDisconnect();
      });

      this.socket.on('close', () => {
        this._handleDisconnect();
      });
    });
  }

  /**
   * Sends a message to the server, or queues it if currently offline.
   * 
   * @param {Object} message
   * @returns {boolean} true if sent immediately, false if queued offline
   */
  send(message) {
    if (this.isConnected && this.socket && !this.socket.destroyed) {
      const frame = WSCodec.encodeFrame(JSON.stringify(message), { mask: true });
      this.socket.write(frame);
      return true;
    }

    this.offlineQueue.push(message);
    return false;
  }

  /**
   * Flushes queued messages upon reconnection.
   * @private
   */
  _flushOfflineQueue() {
    if (this.offlineQueue.length === 0) return;

    for (const msg of this.offlineQueue) {
      const frame = WSCodec.encodeFrame(JSON.stringify(msg), { mask: true });
      this.socket.write(frame);
    }

    this.offlineQueue = [];
  }

  /**
   * Handles disconnect and schedules exponential backoff reconnect.
   * @private
   */
  _handleDisconnect() {
    const wasConnected = this.isConnected;
    this.isConnected = false;
    this.isHandshaked = false;

    if (wasConnected) {
      this.emit('disconnected');
    }

    if (!this.shouldReconnect) return;

    if (!this.reconnectTimer) {
      this.reconnectAttempts++;
      // Exponential backoff with random jitter
      const baseDelay = Math.min(100 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelayMs);
      const jitter = Math.random() * 200;
      const delay = baseDelay + jitter;

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.shouldReconnect) {
          this.connect().catch(() => {});
        }
      }, delay);
    }
  }

  /**
   * Disconnects client and stops reconnect attempts.
   */
  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
    }
    this.isConnected = false;
    this.isHandshaked = false;
  }
}
