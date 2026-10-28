import crypto from 'node:crypto';

/**
 * Observed-Remove Set (OR-Set / Add-Wins Set) CRDT.
 * 
 * Supports adding and removing elements concurrently without resurrecting
 * deleted elements. Concurrent additions win over deletions (Add-Wins).
 */
export class ORSet {
  /**
   * @param {string} localPeerId
   * @param {Map<any, Set<string>>} [initialState]
   */
  constructor(localPeerId, initialState = null) {
    if (!localPeerId || typeof localPeerId !== 'string') {
      throw new Error('ORSet requires a valid string localPeerId');
    }
    this.localPeerId = localPeerId;
    // Map: element -> Set<tagString>
    this.entries = new Map();
    this.seq = 0;

    if (initialState) {
      for (const [elem, tags] of initialState.entries()) {
        this.entries.set(elem, new Set(tags));
      }
    }
  }

  /**
   * Generates a globally unique addition tag.
   * @private
   */
  _generateTag() {
    this.seq++;
    const random = crypto.randomBytes(4).toString('hex');
    return `${this.localPeerId}:${this.seq}:${Date.now()}:${random}`;
  }

  /**
   * Adds an element to the set, generating a unique tag.
   * 
   * @param {any} element
   * @returns {{ op: import('../types/domain.js').DeltaOperation, tag: string }}
   */
  add(element) {
    const tag = this._generateTag();
    let tagSet = this.entries.get(element);
    if (!tagSet) {
      tagSet = new Set();
      this.entries.set(element, tagSet);
    }
    tagSet.add(tag);

    return {
      op: {
        type: 'orset_add',
        payload: { element, tag },
        originPeer: this.localPeerId,
        seq: this.seq,
        timestamp: Date.now(),
      },
      tag,
    };
  }

  /**
   * Removes an element by purging all currently observed tags for it.
   * 
   * @param {any} element
   * @returns {{ op: import('../types/domain.js').DeltaOperation, removedTags: string[] } | null}
   */
  remove(element) {
    const tagSet = this.entries.get(element);
    if (!tagSet || tagSet.size === 0) {
      return null;
    }

    const removedTags = Array.from(tagSet);
    this.entries.delete(element);
    this.seq++;

    return {
      op: {
        type: 'orset_remove',
        payload: { element, removedTags },
        originPeer: this.localPeerId,
        seq: this.seq,
        timestamp: Date.now(),
      },
      removedTags,
    };
  }

  /**
   * Checks if element is present in the set.
   * @param {any} element
   * @returns {boolean}
   */
  has(element) {
    const tagSet = this.entries.get(element);
    return Boolean(tagSet && tagSet.size > 0);
  }

  /**
   * Returns all active elements in the set.
   * @returns {any[]}
   */
  values() {
    const result = [];
    for (const [elem, tagSet] of this.entries.entries()) {
      if (tagSet.size > 0) {
        result.push(elem);
      }
    }
    return result;
  }

  /**
   * Size of active elements in the set.
   * @returns {number}
   */
  get size() {
    return this.values().length;
  }

  /**
   * Applies an incoming delta operation.
   * 
   * @param {import('../types/domain.js').DeltaOperation} op
   * @returns {boolean} true if state changed
   */
  applyDelta(op) {
    if (op.type === 'orset_add') {
      const { element, tag } = op.payload;
      let tagSet = this.entries.get(element);
      if (!tagSet) {
        tagSet = new Set();
        this.entries.set(element, tagSet);
      }
      if (!tagSet.has(tag)) {
        tagSet.add(tag);
        return true;
      }
      return false;
    }

    if (op.type === 'orset_remove') {
      const { element, removedTags } = op.payload;
      const tagSet = this.entries.get(element);
      if (!tagSet) return false;

      let changed = false;
      for (const tag of removedTags) {
        if (tagSet.delete(tag)) {
          changed = true;
        }
      }

      if (tagSet.size === 0) {
        this.entries.delete(element);
      }
      return changed;
    }

    return false;
  }

  /**
   * Merges another ORSet into this one.
   * 
   * @param {ORSet} other
   */
  merge(other) {
    for (const [elem, otherTagSet] of other.entries.entries()) {
      let localTagSet = this.entries.get(elem);
      if (!localTagSet) {
        localTagSet = new Set();
        this.entries.set(elem, localTagSet);
      }
      for (const tag of otherTagSet) {
        localTagSet.add(tag);
      }
    }
  }

  /**
   * Exports serializable state for snapshotting.
   * @returns {Record<string, string[]>}
   */
  exportState() {
    const state = {};
    for (const [elem, tagSet] of this.entries.entries()) {
      if (tagSet.size > 0) {
        state[String(elem)] = Array.from(tagSet);
      }
    }
    return state;
  }
}
