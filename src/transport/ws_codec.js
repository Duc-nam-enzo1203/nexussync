import crypto from 'node:crypto';

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODES = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
};

/**
 * Pure RFC 6455 WebSocket Framing & Codec (Zero External Dependencies).
 * Handles bitwise framing, masking/unmasking, and SHA-1 upgrade handshakes.
 */
export class WSCodec {
  /**
   * Computes the Sec-WebSocket-Accept handshake header response.
   * @param {string} secWebSocketKey
   * @returns {string}
   */
  static computeAcceptKey(secWebSocketKey) {
    return crypto
      .createHash('sha1')
      .update(secWebSocketKey + WS_GUID)
      .digest('base64');
  }

  /**
   * Encodes a string or JSON payload into an RFC 6455 WebSocket frame.
   * 
   * @param {string | object} payload
   * @param {Object} [options]
   * @param {boolean} [options.isBinary=false]
   * @param {boolean} [options.mask=false]
   * @returns {Buffer}
   */
  static encodeFrame(payload, options = {}) {
    const dataBuffer = typeof payload === 'string'
      ? Buffer.from(payload, 'utf8')
      : Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(JSON.stringify(payload), 'utf8');

    const length = dataBuffer.length;
    const opcode = options.isBinary ? OPCODES.BINARY : OPCODES.TEXT;
    const isMasked = options.mask || false;

    let headerLength = 2;
    if (length > 65535) {
      headerLength += 8;
    } else if (length > 125) {
      headerLength += 2;
    }
    if (isMasked) {
      headerLength += 4;
    }

    const frame = Buffer.alloc(headerLength + length);

    // Byte 0: FIN (1) + RSV (0) + Opcode
    frame[0] = 0x80 | (opcode & 0x0f);

    // Byte 1: Mask bit + Length indicator
    const maskBit = isMasked ? 0x80 : 0x00;
    let offset = 2;

    if (length > 65535) {
      frame[1] = maskBit | 127;
      frame.writeBigUInt64BE(BigInt(length), offset);
      offset += 8;
    } else if (length > 125) {
      frame[1] = maskBit | 126;
      frame.writeUInt16BE(length, offset);
      offset += 2;
    } else {
      frame[1] = maskBit | length;
    }

    if (isMasked) {
      const maskKey = crypto.randomBytes(4);
      maskKey.copy(frame, offset);
      offset += 4;

      for (let i = 0; i < length; i++) {
        frame[offset + i] = dataBuffer[i] ^ maskKey[i % 4];
      }
    } else {
      dataBuffer.copy(frame, offset);
    }

    return frame;
  }

  /**
   * Decodes a buffer containing RFC 6455 frame(s).
   * 
   * @param {Buffer} buffer
   * @returns {{ frames: Array<{ opcode: number, payload: string | Buffer }>, remaining: Buffer }}
   */
  static decodeFrames(buffer) {
    const frames = [];
    let offset = 0;

    while (offset + 2 <= buffer.length) {
      const byte0 = buffer[offset];
      const byte1 = buffer[offset + 1];

      const fin = (byte0 & 0x80) !== 0;
      const opcode = byte0 & 0x0f;
      const isMasked = (byte1 & 0x80) !== 0;
      let payloadLength = byte1 & 0x7f;
      let headerSize = 2;

      if (payloadLength === 126) {
        if (offset + 4 > buffer.length) break;
        payloadLength = buffer.readUInt16BE(offset + 2);
        headerSize += 2;
      } else if (payloadLength === 127) {
        if (offset + 10 > buffer.length) break;
        payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
        headerSize += 8;
      }

      const maskSize = isMasked ? 4 : 0;
      const totalFrameSize = headerSize + maskSize + payloadLength;

      if (offset + totalFrameSize > buffer.length) {
        // Incomplete frame, wait for more chunks
        break;
      }

      let payloadBuffer;
      if (isMasked) {
        const maskKey = buffer.subarray(offset + headerSize, offset + headerSize + 4);
        const rawPayload = buffer.subarray(offset + headerSize + 4, offset + totalFrameSize);
        payloadBuffer = Buffer.alloc(payloadLength);

        for (let i = 0; i < payloadLength; i++) {
          payloadBuffer[i] = rawPayload[i] ^ maskKey[i % 4];
        }
      } else {
        payloadBuffer = buffer.subarray(offset + headerSize, offset + totalFrameSize);
      }

      const parsedPayload = opcode === OPCODES.TEXT
        ? payloadBuffer.toString('utf8')
        : payloadBuffer;

      frames.push({ opcode, fin, payload: parsedPayload });
      offset += totalFrameSize;
    }

    return {
      frames,
      remaining: buffer.subarray(offset),
    };
  }
}
