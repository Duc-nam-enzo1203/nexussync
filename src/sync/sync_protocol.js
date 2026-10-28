import { VectorClock } from '../crdt/vector_clock.js';
import { LWWMap } from '../crdt/lww_map.js';
import { ORSet } from '../crdt/or_set.js';
import { RGAText } from '../crdt/rga_text.js';
import { StateVectorManager } from './state_vector.js';
import { WALAdapter } from '../storage/wal_adapter.js';

/**
 * NexusSync Collaborative Document & Protocol Session Coordinator.
 * 
 * Manages the unified CRDT document state (Metadata Map, Collections Set, Rich Text),
 * mutation logging, and the 2-step State Vector handshake synchronization protocol.
 */
export class CollaborativeDoc {
  /**
   * @param {string} localPeerId
   * @param {Object} [options]
   * @param {WALAdapter} [options.wal]
   */
  constructor(localPeerId, options = {}) {
    if (!localPeerId || typeof localPeerId !== 'string') {
      throw new Error('CollaborativeDoc requires a valid string localPeerId');
    }
    this.localPeerId = localPeerId;
    this.clock = new VectorClock(localPeerId);
    this.map = new LWWMap(localPeerId);
    this.set = new ORSet(localPeerId);
    this.text = new RGAText(localPeerId);
    this.wal = options.wal || new WALAdapter();

    this.opLog = [];
    this.peerVectors = new Map(); // peerId -> VectorClockState
  }

  /**
   * Generates initial handshake message to initiate synchronization with a peer or hub.
   * @returns {import('../types/domain.js').SyncHandshakeMessage}
   */
  createHandshake() {
    return {
      type: 'handshake',
      peerId: this.localPeerId,
      stateVector: this.clock.toJSON(),
    };
  }

  /**
   * Dispatches a local mutation to the appropriate CRDT and writes to WAL.
   * @private
   */
  _recordLocalMutation(op) {
    this.clock.tick();
    const finalizedOp = {
      ...op,
      originPeer: this.localPeerId,
      seq: this.clock.get(this.localPeerId),
      timestamp: Date.now(),
    };

    this.opLog.push(finalizedOp);
    this.wal.append(finalizedOp);
    return finalizedOp;
  }

  // --- High-Level Local Mutation APIs ---

  setMapValue(key, value) {
    const { op } = this.map.set(key, value);
    return this._recordLocalMutation(op);
  }

  deleteMapValue(key) {
    const result = this.map.delete(key);
    if (!result) return null;
    return this._recordLocalMutation(result.op);
  }

  addSetElement(element) {
    const { op } = this.set.add(element);
    return this._recordLocalMutation(op);
  }

  removeSetElement(element) {
    const result = this.set.remove(element);
    if (!result) return null;
    return this._recordLocalMutation(result.op);
  }

  insertText(visibleIndex, content) {
    const ops = this.text.insert(visibleIndex, content);
    const recorded = [];
    for (const op of ops) {
      recorded.push(this._recordLocalMutation(op));
    }
    return recorded;
  }

  deleteText(visibleIndex, length = 1) {
    const ops = this.text.delete(visibleIndex, length);
    const recorded = [];
    for (const op of ops) {
      recorded.push(this._recordLocalMutation(op));
    }
    return recorded;
  }

  // --- Synchronization Message Handler ---

  /**
   * Handles an incoming protocol message from a remote peer or server.
   * 
   * @param {import('../types/domain.js').SyncMessage} message
   * @returns {import('../types/domain.js').SyncMessage | null} Outgoing reply message (if any)
   */
  handleMessage(message) {
    if (!message || typeof message !== 'object') return null;

    // 1. Handshake received: calculate what the remote peer is missing and send deltas
    if (message.type === 'handshake') {
      const remoteVector = message.stateVector || {};
      this.peerVectors.set(message.peerId, remoteVector);

      const missingDeltas = StateVectorManager.calculateMissingDeltas(this.opLog, remoteVector);

      return {
        type: 'delta',
        peerId: this.localPeerId,
        deltas: missingDeltas,
      };
    }

    // 2. Deltas received: apply to local CRDT stores and advance vector clock
    if (message.type === 'delta') {
      const deltas = message.deltas || [];
      const appliedOps = [];

      for (const op of deltas) {
        let changed = false;

        if (op.type.startsWith('lww_')) {
          changed = this.map.applyDelta(op);
        } else if (op.type.startsWith('orset_')) {
          changed = this.set.applyDelta(op);
        } else if (op.type.startsWith('rga_')) {
          changed = this.text.applyDelta(op);
        }

        if (changed) {
          this.clock.update(op.originPeer, op.seq);
          this.opLog.push(op);
          this.wal.append(op);
          appliedOps.push(op);
        }
      }

      // Respond with ACK confirming new local state vector
      return {
        type: 'ack',
        peerId: this.localPeerId,
        stateVector: this.clock.toJSON(),
      };
    }

    // 3. ACK received: update peer's acknowledged state vector
    if (message.type === 'ack') {
      this.peerVectors.set(message.peerId, message.stateVector || {});
      return null;
    }

    return null;
  }

  /**
   * Returns a snapshot of the current state of all components.
   * @returns {Object}
   */
  getState() {
    return {
      map: this.map.toObject(),
      set: this.set.values(),
      text: this.text.toString(),
      stateVector: this.clock.toJSON(),
    };
  }
}
