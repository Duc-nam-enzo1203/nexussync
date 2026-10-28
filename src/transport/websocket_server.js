import http from 'node:http';
import { WSCodec, OPCODES } from './ws_codec.js';
import { CollaborativeDoc } from '../sync/sync_protocol.js';

/**
 * Zero-Dependency Native RFC 6455 WebSocket Central Synchronization Hub.
 * 
 * Handles client connections, bidirectional delta synchronization,
 * and collaborative presence awareness broadcasts.
 */
export class WebSocketSyncServer {
  /**
   * @param {Object} [options]
   * @param {number} [options.port=4040]
   * @param {string} [options.host='0.0.0.0']
   * @param {CollaborativeDoc} [options.doc]
   */
  constructor(options = {}) {
    this.port = options.port || 4040;
    this.host = options.host || '0.0.0.0';
    this.doc = options.doc || new CollaborativeDoc('server-hub');
    this.server = null;
    this.clients = new Map(); // socket -> { peerId, buffer }
  }

  /**
   * Starts the HTTP and WebSocket synchronization server.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', peers: this.clients.size }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      this.server.on('upgrade', (req, socket, head) => {
        this._handleUpgrade(req, socket, head);
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  /**
   * Performs the RFC 6455 WebSocket upgrade handshake.
   * @private
   */
  _handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = WSCodec.computeAcceptKey(key);
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n',
    ];

    socket.write(headers.join('\r\n'));

    const clientState = { peerId: null, buffer: Buffer.alloc(0) };
    this.clients.set(socket, clientState);

    socket.on('data', (chunk) => {
      clientState.buffer = Buffer.concat([clientState.buffer, chunk]);
      const { frames, remaining } = WSCodec.decodeFrames(clientState.buffer);
      clientState.buffer = remaining;

      for (const frame of frames) {
        if (frame.opcode === OPCODES.TEXT) {
          try {
            const message = JSON.parse(frame.payload);
            this._handleClientMessage(socket, clientState, message);
          } catch {
            // Ignore malformed payloads
          }
        } else if (frame.opcode === OPCODES.PING) {
          const pong = WSCodec.encodeFrame(frame.payload, { isBinary: true });
          pong[0] = 0x80 | OPCODES.PONG;
          socket.write(pong);
        } else if (frame.opcode === OPCODES.CLOSE) {
          socket.end();
          this.clients.delete(socket);
        }
      }
    });

    socket.on('close', () => {
      this.clients.delete(socket);
    });

    socket.on('error', () => {
      this.clients.delete(socket);
      socket.destroy();
    });
  }

  /**
   * Processes incoming sync or awareness message from a connected client.
   * @private
   */
  _handleClientMessage(senderSocket, clientState, message) {
    if (message.peerId) {
      clientState.peerId = message.peerId;
    }

    // 1. Process sync handshake / delta with server document
    const reply = this.doc.handleMessage(message);
    if (reply) {
      this._sendToSocket(senderSocket, reply);
    }

    // 2. Broadcast deltas or awareness events to all other connected peers
    if (message.type === 'delta' || message.type === 'awareness') {
      for (const [socket] of this.clients.entries()) {
        if (socket !== senderSocket && !socket.destroyed) {
          this._sendToSocket(socket, message);
        }
      }
    }
  }

  /**
   * Sends an encoded frame to a target socket.
   * @private
   */
  _sendToSocket(socket, message) {
    if (socket && !socket.destroyed) {
      const frame = WSCodec.encodeFrame(JSON.stringify(message));
      socket.write(frame);
    }
  }

  /**
   * Broadcasts a message to all connected clients.
   * @param {Object} message
   */
  broadcast(message) {
    for (const [socket] of this.clients.entries()) {
      this._sendToSocket(socket, message);
    }
  }

  /**
   * Stops the server.
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      for (const socket of this.clients.keys()) {
        socket.destroy();
      }
      this.clients.clear();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
