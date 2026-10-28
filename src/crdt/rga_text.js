/**
 * Replicated Growable Array (RGA) CRDT for Concurrent Real-Time Rich Text Collaboration.
 * 
 * Provides an eventually consistent linear sequence of characters that guarantees
 * no character interleaving when multiple users type concurrently at the exact same index.
 */
export class RGAText {
  /**
   * @param {string} localPeerId
   * @param {Array<import('../types/domain.js').RGANode>} [initialNodes]
   */
  constructor(localPeerId, initialNodes = null) {
    if (!localPeerId || typeof localPeerId !== 'string') {
      throw new Error('RGAText requires a valid string localPeerId');
    }
    this.localPeerId = localPeerId;
    this.seq = 0;
    this.clock = 0;

    // Ordered array of nodes (including tombstones)
    this.nodes = [];
    // Fast lookup map: nodeId -> index in this.nodes
    this.nodeIndexMap = new Map();
    // Causal dependency buffer for out-of-order network packets
    this.pendingBuffer = [];

    if (initialNodes && Array.isArray(initialNodes)) {
      for (const node of initialNodes) {
        this.nodes.push({ ...node });
        this.nodeIndexMap.set(node.id, this.nodes.length - 1);
        this.clock = Math.max(this.clock, node.timestamp || 0);
        if (node.peerId === this.localPeerId) {
          this.seq = Math.max(this.seq, node.seq || 0);
        }
      }
    }
  }

  /**
   * Generates next logical timestamp and sequence counter.
   * @private
   */
  _nextSeq() {
    this.seq++;
    this.clock++;
    return {
      seq: this.seq,
      timestamp: this.clock,
      id: `${this.localPeerId}:${this.seq}`,
    };
  }

  /**
   * Rebuilds nodeIndexMap after array mutations.
   * @private
   */
  _rebuildIndexMap() {
    this.nodeIndexMap.clear();
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodeIndexMap.set(this.nodes[i].id, i);
    }
  }

  /**
   * Finds the ID of the node corresponding to a visible text index (0-indexed).
   * Returns null if inserting at index 0 (start of document).
   * @private
   */
  _findLeftIdForVisibleIndex(visibleIndex) {
    if (visibleIndex <= 0) {
      return null;
    }

    let currentVisible = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node.deleted) {
        currentVisible++;
        if (currentVisible === visibleIndex) {
          return node.id;
        }
      }
    }

    // If visibleIndex is beyond visible length, anchor to the very last node
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      if (!this.nodes[i].deleted) {
        return this.nodes[i].id;
      }
    }

    return null;
  }

  /**
   * Inserts text at a visible character position.
   * 
   * @param {number} visibleIndex - 0-based character index
   * @param {string} text - string of characters to insert
   * @returns {import('../types/domain.js').DeltaOperation[]} Array of delta operations
   */
  insert(visibleIndex, text) {
    if (typeof text !== 'string' || text.length === 0) {
      return [];
    }

    const deltas = [];
    let currentLeftId = this._findLeftIdForVisibleIndex(visibleIndex);

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const { seq, timestamp, id } = this._nextSeq();

      const node = {
        id,
        peerId: this.localPeerId,
        seq,
        value: char,
        leftId: currentLeftId,
        deleted: false,
        timestamp,
      };

      this._insertNodeInternal(node);

      deltas.push({
        type: 'rga_insert',
        payload: { node },
        originPeer: this.localPeerId,
        seq,
        timestamp,
      });

      // The next character anchors to this newly inserted character
      currentLeftId = id;
    }

    return deltas;
  }

  /**
   * Deletes characters at a visible index.
   * 
   * @param {number} visibleIndex - 0-based index of first character to delete
   * @param {number} [length=1] - Number of characters to delete
   * @returns {import('../types/domain.js').DeltaOperation[]}
   */
  delete(visibleIndex, length = 1) {
    if (length <= 0) return [];

    const deltas = [];
    let visibleCount = 0;

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node.deleted) {
        if (visibleCount >= visibleIndex && visibleCount < visibleIndex + length) {
          node.deleted = true;
          this.clock++;

          deltas.push({
            type: 'rga_delete',
            payload: { id: node.id },
            originPeer: this.localPeerId,
            seq: ++this.seq,
            timestamp: this.clock,
          });
        }
        visibleCount++;
        if (visibleCount >= visibleIndex + length) {
          break;
        }
      }
    }

    return deltas;
  }

  /**
   * Internal deterministic insertion following RGA ordering.
   * @private
   */
  _insertNodeInternal(newNode) {
    if (this.nodeIndexMap.has(newNode.id)) {
      return false; // Idempotent: already inserted
    }

    const nodeToInsert = { ...newNode };

    // 1. Locate anchor index in array
    let insertIndex = 0;
    if (nodeToInsert.leftId !== null) {
      const anchorIdx = this.nodeIndexMap.get(nodeToInsert.leftId);
      if (anchorIdx !== undefined) {
        insertIndex = anchorIdx + 1;
      }
    }

    // 2. RGA Shift: Skip past concurrent nodes that have higher priority (timestamp, then peerId)
    // and all of their causal descendants
    const skippedAncestors = new Set();

    while (insertIndex < this.nodes.length) {
      const sibling = this.nodes[insertIndex];

      if (sibling.leftId === nodeToInsert.leftId) {
        const siblingPriority = sibling.timestamp;
        const newPriority = nodeToInsert.timestamp;

        if (siblingPriority > newPriority || (siblingPriority === newPriority && sibling.peerId > nodeToInsert.peerId)) {
          skippedAncestors.add(sibling.id);
          insertIndex++;
        } else {
          break;
        }
      } else if (sibling.leftId !== null && skippedAncestors.has(sibling.leftId)) {
        // This node is a descendant of a higher-priority sibling, skip it too
        skippedAncestors.add(sibling.id);
        insertIndex++;
      } else {
        break;
      }
    }

    // 3. Splice into nodes array and update map
    this.nodes.splice(insertIndex, 0, nodeToInsert);
    this._rebuildIndexMap();
    return true;
  }

  /**
   * Drains the pending buffer, applying any nodes whose leftId anchors have now arrived.
   * @private
   */
  _drainPendingBuffer() {
    let drainedAny = true;
    while (drainedAny && this.pendingBuffer.length > 0) {
      drainedAny = false;
      for (let i = 0; i < this.pendingBuffer.length; i++) {
        const pending = this.pendingBuffer[i];
        if (pending.leftId === null || this.nodeIndexMap.has(pending.leftId)) {
          this._insertNodeInternal(pending);
          this.pendingBuffer.splice(i, 1);
          drainedAny = true;
          break; // restart scan
        }
      }
    }
  }

  /**
   * Applies an incoming delta operation.
   * 
   * @param {import('../types/domain.js').DeltaOperation} op
   * @returns {boolean} true if state changed
   */
  applyDelta(op) {
    this.clock = Math.max(this.clock, op.timestamp || 0);

    if (op.type === 'rga_insert') {
      const node = { ...op.payload.node };

      // Causal dependency check: If left anchor has not arrived yet, buffer until anchor arrives!
      if (node.leftId !== null && !this.nodeIndexMap.has(node.leftId)) {
        this.pendingBuffer.push(node);
        return false;
      }

      const applied = this._insertNodeInternal(node);
      if (applied) {
        this._drainPendingBuffer();
      }
      return applied;
    }

    if (op.type === 'rga_delete') {
      const targetId = op.payload.id;
      const idx = this.nodeIndexMap.get(targetId);
      if (idx !== undefined && !this.nodes[idx].deleted) {
        this.nodes[idx].deleted = true;
        return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Merges an entire remote RGAText instance.
   * @param {RGAText} other
   */
  merge(other) {
    for (const node of other.nodes) {
      if (!this.nodeIndexMap.has(node.id)) {
        this._insertNodeInternal({ ...node });
      } else if (node.deleted) {
        const localIdx = this.nodeIndexMap.get(node.id);
        this.nodes[localIdx].deleted = true;
      }
    }
  }

  /**
   * Returns visible, non-deleted text as string.
   * @returns {string}
   */
  toString() {
    let result = '';
    for (let i = 0; i < this.nodes.length; i++) {
      if (!this.nodes[i].deleted) {
        result += this.nodes[i].value;
      }
    }
    return result;
  }

  /**
   * Number of visible characters.
   * @returns {number}
   */
  get length() {
    return this.toString().length;
  }

  /**
   * Exports full raw node array for snapshotting.
   * @returns {Array<import('../types/domain.js').RGANode>}
   */
  exportNodes() {
    return this.nodes.map(n => ({ ...n }));
  }
}
