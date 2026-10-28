/**
 * Vector Clock implementation for tracking distributed causality and happened-before relations.
 */
export class VectorClock {
  /**
   * @param {string} localPeerId - The unique identifier of the local replica
   * @param {Record<string, number>} [initialState={}] - Initial clock vector
   */
  constructor(localPeerId, initialState = {}) {
    if (!localPeerId || typeof localPeerId !== 'string') {
      throw new Error('VectorClock requires a valid string localPeerId');
    }
    this.localPeerId = localPeerId;
    this.clock = { ...initialState };
    if (this.clock[this.localPeerId] === undefined) {
      this.clock[this.localPeerId] = 0;
    }
  }

  /**
   * Monotonically increments the local peer's sequence number.
   * @returns {number} The new sequence number
   */
  tick() {
    this.clock[this.localPeerId] = (this.clock[this.localPeerId] || 0) + 1;
    return this.clock[this.localPeerId];
  }

  /**
   * Gets the sequence counter for a specific peer.
   * @param {string} peerId
   * @returns {number}
   */
  get(peerId) {
    return this.clock[peerId] || 0;
  }

  /**
   * Updates a peer's sequence number to the maximum of its current or new value.
   * @param {string} peerId
   * @param {number} seq
   */
  update(peerId, seq) {
    const current = this.clock[peerId] || 0;
    this.clock[peerId] = Math.max(current, seq);
  }

  /**
   * Merges another vector clock into this one using point-wise maximum.
   * @param {VectorClock | Record<string, number>} other
   * @returns {VectorClock} this (for chaining)
   */
  merge(other) {
    const otherClock = other instanceof VectorClock ? other.clock : other;
    for (const [peerId, seq] of Object.entries(otherClock)) {
      this.clock[peerId] = Math.max(this.clock[peerId] || 0, seq);
    }
    return this;
  }

  /**
   * Compares causality relation between this vector clock and another.
   * 
   * @param {VectorClock | Record<string, number>} other
   * @returns {'same' | 'before' | 'after' | 'concurrent'}
   */
  compare(other) {
    const otherClock = other instanceof VectorClock ? other.clock : other;
    const allPeers = new Set([...Object.keys(this.clock), ...Object.keys(otherClock)]);

    let hasGreater = false;
    let hasLesser = false;

    for (const peer of allPeers) {
      const v1 = this.get(peer);
      const v2 = otherClock[peer] || 0;

      if (v1 > v2) hasGreater = true;
      if (v1 < v2) hasLesser = true;
    }

    if (hasGreater && hasLesser) return 'concurrent';
    if (hasGreater && !hasLesser) return 'after';
    if (!hasGreater && hasLesser) return 'before';
    return 'same';
  }

  /**
   * Returns true if this vector causally dominates or is identical to the other vector.
   * (i.e. this clock has witnessed everything the other clock has witnessed).
   * @param {VectorClock | Record<string, number>} other
   * @returns {boolean}
   */
  hasWitnessed(other) {
    const rel = this.compare(other);
    return rel === 'after' || rel === 'same';
  }

  /**
   * Returns a deep clone of this VectorClock.
   * @returns {VectorClock}
   */
  clone() {
    return new VectorClock(this.localPeerId, { ...this.clock });
  }

  /**
   * Returns JSON-serializable plain object representation.
   * @returns {Record<string, number>}
   */
  toJSON() {
    return { ...this.clock };
  }

  /**
   * Instantiates a VectorClock from JSON state.
   * @param {string} localPeerId
   * @param {Record<string, number>} json
   * @returns {VectorClock}
   */
  static fromJSON(localPeerId, json) {
    return new VectorClock(localPeerId, json || {});
  }
}
