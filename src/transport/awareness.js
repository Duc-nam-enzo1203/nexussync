/**
 * Ephemeral Presence & Awareness Protocol.
 * 
 * Manages real-time collaborative state: collaborative mouse cursors,
 * active text selections, and user profiles. Ephemeral states are never
 * persisted to disk and expire automatically if heartbeats cease.
 */
export class AwarenessProtocol {
  /**
   * @param {string} localPeerId
   * @param {Object} [initialPresence]
   */
  constructor(localPeerId, initialPresence = {}) {
    this.localPeerId = localPeerId;
    this.states = new Map(); // peerId -> { presence, updatedAt }

    this.localPresence = {
      user: { name: `Anonymous_${localPeerId.substring(0, 4)}`, color: '#3b82f6' },
      cursor: null,
      selection: null,
      ...initialPresence,
    };

    this.states.set(this.localPeerId, {
      presence: this.localPresence,
      updatedAt: Date.now(),
    });
  }

  /**
   * Updates local cursor and selection presence, returning a broadcast message.
   * 
   * @param {Object} updates
   * @returns {import('../types/domain.js').AwarenessMessage}
   */
  updateLocalPresence(updates) {
    this.localPresence = {
      ...this.localPresence,
      ...updates,
      updatedAt: Date.now(),
    };

    this.states.set(this.localPeerId, {
      presence: this.localPresence,
      updatedAt: Date.now(),
    });

    return {
      type: 'awareness',
      peerId: this.localPeerId,
      presence: this.localPresence,
    };
  }

  /**
   * Ingests a remote peer's presence broadcast.
   * 
   * @param {string} peerId
   * @param {Object} presence
   */
  applyRemotePresence(peerId, presence) {
    if (!peerId || peerId === this.localPeerId) return;

    this.states.set(peerId, {
      presence: { ...presence },
      updatedAt: Date.now(),
    });
  }

  /**
   * Removes peers that haven't sent a heartbeat within the timeout window.
   * 
   * @param {number} [timeoutMs=30000]
   * @returns {string[]} List of pruned peer IDs
   */
  pruneStalePeers(timeoutMs = 30000) {
    const now = Date.now();
    const pruned = [];

    for (const [peerId, state] of this.states.entries()) {
      if (peerId !== this.localPeerId && now - state.updatedAt > timeoutMs) {
        this.states.delete(peerId);
        pruned.push(peerId);
      }
    }

    return pruned;
  }

  /**
   * Returns presence states of all active collaborators.
   * @returns {Record<string, any>}
   */
  getAllStates() {
    const result = {};
    for (const [peerId, state] of this.states.entries()) {
      result[peerId] = state.presence;
    }
    return result;
  }
}
