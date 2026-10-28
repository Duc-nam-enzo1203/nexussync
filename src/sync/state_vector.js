/**
 * State Vector computation and minimal delta calculation for delta-based synchronization.
 */
export class StateVectorManager {
  /**
   * Computes the minimal set of delta operations that the remote peer is missing.
   * 
   * @param {Array<import('../types/domain.js').DeltaOperation>} localOpLog - Full or windowed local operation log
   * @param {Record<string, number>} remoteStateVector - The state vector sent by remote peer
   * @returns {Array<import('../types/domain.js').DeltaOperation>} Minimal delta operations needed by remote
   */
  static calculateMissingDeltas(localOpLog, remoteStateVector) {
    if (!Array.isArray(localOpLog)) return [];
    const vector = remoteStateVector || {};

    const missing = [];
    for (const op of localOpLog) {
      const peerKnownSeq = vector[op.originPeer] || 0;
      if (op.seq > peerKnownSeq) {
        missing.push(op);
      }
    }

    return missing;
  }

  /**
   * Compresses a State Vector into a compact wire string (e.g., "peerA:14,peerB:2").
   * @param {Record<string, number>} vector
   * @returns {string}
   */
  static encodeCompact(vector) {
    if (!vector || typeof vector !== 'object') return '';
    return Object.entries(vector)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([peer, seq]) => `${peer}:${seq}`)
      .join(',');
  }

  /**
   * Decodes a compact wire string back into a State Vector object.
   * @param {string} compactStr
   * @returns {Record<string, number>}
   */
  static decodeCompact(compactStr) {
    if (!compactStr || typeof compactStr !== 'string') return {};
    const result = {};
    const parts = compactStr.split(',');

    for (const part of parts) {
      const [peer, seqStr] = part.split(':');
      if (peer && seqStr) {
        const seq = parseInt(seqStr, 10);
        if (!isNaN(seq)) {
          result[peer] = seq;
        }
      }
    }

    return result;
  }

  /**
   * Checks if state vector A has observed everything in state vector B.
   * @param {Record<string, number>} vectorA
   * @param {Record<string, number>} vectorB
   * @returns {boolean}
   */
  static isDominating(vectorA, vectorB) {
    for (const [peer, bSeq] of Object.entries(vectorB || {})) {
      const aSeq = vectorA?.[peer] || 0;
      if (aSeq < bSeq) return false;
    }
    return true;
  }
}
