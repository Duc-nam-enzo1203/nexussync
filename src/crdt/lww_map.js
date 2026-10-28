/**
 * Last-Write-Wins Register Map (LWW-Map) CRDT.
 * 
 * Provides an eventually consistent Key-Value store where concurrent modifications
 * are deterministically resolved via logical timestamps and peer-ID tie-breaking.
 */
export class LWWMap {
  /**
   * @param {string} localPeerId
   * @param {Record<string, { value: any, timestamp: number, peerId: string, deleted?: boolean }>} [initialRegisters={}]
   */
  constructor(localPeerId, initialRegisters = {}) {
    if (!localPeerId || typeof localPeerId !== 'string') {
      throw new Error('LWWMap requires a valid string localPeerId');
    }
    this.localPeerId = localPeerId;
    this.registers = new Map();
    this.logicalClock = 0;

    for (const [key, reg] of Object.entries(initialRegisters)) {
      this.registers.set(key, { ...reg });
      this.logicalClock = Math.max(this.logicalClock, reg.timestamp || 0);
    }
  }

  /**
   * Generates next logical timestamp.
   * @private
   */
  _nextTimestamp() {
    this.logicalClock += 1;
    return this.logicalClock;
  }

  /**
   * Sets a key-value pair and produces a delta operation.
   * 
   * @param {string} key
   * @param {any} value
   * @returns {{ op: import('../types/domain.js').DeltaOperation, register: Object }}
   */
  set(key, value) {
    const timestamp = this._nextTimestamp();
    const register = {
      value,
      timestamp,
      peerId: this.localPeerId,
      deleted: false,
    };

    this.registers.set(key, register);

    return {
      op: {
        type: 'lww_set',
        key,
        payload: { value, timestamp, peerId: this.localPeerId },
        originPeer: this.localPeerId,
        seq: timestamp,
        timestamp,
      },
      register,
    };
  }

  /**
   * Marks a key as deleted using a tombstone.
   * 
   * @param {string} key
   * @returns {{ op: import('../types/domain.js').DeltaOperation, register: Object } | null}
   */
  delete(key) {
    const timestamp = this._nextTimestamp();
    const register = {
      value: undefined,
      timestamp,
      peerId: this.localPeerId,
      deleted: true,
    };

    this.registers.set(key, register);

    return {
      op: {
        type: 'lww_delete',
        key,
        payload: { timestamp, peerId: this.localPeerId },
        originPeer: this.localPeerId,
        seq: timestamp,
        timestamp,
      },
      register,
    };
  }

  /**
   * Retrieves the current value for a key (returns undefined if deleted or missing).
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    const reg = this.registers.get(key);
    if (!reg || reg.deleted) return undefined;
    return reg.value;
  }

  /**
   * Returns true if key exists and is not tombstoned.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const reg = this.registers.get(key);
    return Boolean(reg && !reg.deleted);
  }

  /**
   * Deterministically determines if incoming register beats local register.
   * @private
   */
  _shouldOverride(local, incoming) {
    if (!local) return true;
    if (incoming.timestamp > local.timestamp) return true;
    if (incoming.timestamp < local.timestamp) return false;
    // Tie-break on peer ID lexicographically
    return incoming.peerId > local.peerId;
  }

  /**
   * Applies an incoming delta operation.
   * 
   * @param {import('../types/domain.js').DeltaOperation} op
   * @returns {boolean} true if state changed, false if ignored
   */
  applyDelta(op) {
    if (op.type !== 'lww_set' && op.type !== 'lww_delete') {
      return false;
    }

    const key = op.key;
    const incoming = {
      value: op.type === 'lww_set' ? op.payload.value : undefined,
      timestamp: op.payload.timestamp,
      peerId: op.payload.peerId || op.originPeer,
      deleted: op.type === 'lww_delete',
    };

    // Update local logical clock to advance beyond observed remote timestamps
    this.logicalClock = Math.max(this.logicalClock, incoming.timestamp);

    const local = this.registers.get(key);
    if (this._shouldOverride(local, incoming)) {
      this.registers.set(key, incoming);
      return true;
    }

    return false;
  }

  /**
   * Merges another LWWMap into this one.
   * 
   * @param {LWWMap | Map<string, any>} other
   * @returns {number} Count of registers updated
   */
  merge(other) {
    let updated = 0;
    const otherRegisters = other instanceof LWWMap ? other.registers : other;

    for (const [key, incoming] of otherRegisters.entries()) {
      this.logicalClock = Math.max(this.logicalClock, incoming.timestamp);
      const local = this.registers.get(key);

      if (this._shouldOverride(local, incoming)) {
        this.registers.set(key, { ...incoming });
        updated++;
      }
    }

    return updated;
  }

  /**
   * Returns all active key-value pairs as a plain JavaScript object.
   * @returns {Record<string, any>}
   */
  toObject() {
    const result = {};
    for (const [key, reg] of this.registers.entries()) {
      if (!reg.deleted) {
        result[key] = reg.value;
      }
    }
    return result;
  }

  /**
   * Exports full state including tombstones for replication snapshotting.
   * @returns {Record<string, any>}
   */
  exportState() {
    const state = {};
    for (const [key, reg] of this.registers.entries()) {
      state[key] = { ...reg };
    }
    return state;
  }
}
