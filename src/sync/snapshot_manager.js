import fs from 'node:fs';
import path from 'node:path';

/**
 * Snapshot & Tombstone Garbage Collection Manager for CRDT Stores.
 * 
 * Compacts operation logs into immutable state snapshots and prunes
 * acknowledged tombstones to prevent unbounded memory growth.
 */
export class SnapshotManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.snapshotFilePath]
   * @param {number} [options.snapshotIntervalOps=500]
   */
  constructor(options = {}) {
    this.snapshotFilePath = options.snapshotFilePath || null;
    this.snapshotIntervalOps = options.snapshotIntervalOps || 500;
    this.opsSinceLastSnapshot = 0;

    if (this.snapshotFilePath) {
      const dir = path.dirname(this.snapshotFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Creates a consolidated snapshot from active CRDT models.
   * 
   * @param {Object} params
   * @param {import('../crdt/vector_clock.js').VectorClock} params.vectorClock
   * @param {import('../crdt/lww_map.js').LWWMap} params.lwwMap
   * @param {import('../crdt/or_set.js').ORSet} params.orSet
   * @param {import('../crdt/rga_text.js').RGAText} params.rgaText
   * @returns {Object} Snapshot payload
   */
  createSnapshot({ vectorClock, lwwMap, orSet, rgaText }) {
    const snapshot = {
      version: 1,
      createdAt: new Date().toISOString(),
      stateVector: vectorClock.toJSON(),
      lwwMap: lwwMap.exportState(),
      orSet: orSet.exportState(),
      rgaNodes: rgaText.exportNodes(),
    };

    if (this.snapshotFilePath) {
      fs.writeFileSync(this.snapshotFilePath, JSON.stringify(snapshot, null, 2), 'utf8');
    }

    this.opsSinceLastSnapshot = 0;
    return snapshot;
  }

  /**
   * Loads the latest snapshot from disk if present.
   * @returns {Object | null}
   */
  loadSnapshot() {
    if (!this.snapshotFilePath || !fs.existsSync(this.snapshotFilePath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(this.snapshotFilePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Safely purges deleted tombstones from an RGAText instance when all peers
   * have acknowledged seeing the deletion.
   * 
   * @param {import('../crdt/rga_text.js').RGAText} rgaText
   * @param {Record<string, number>} minAcknowledgedVector
   * @returns {number} Count of permanently pruned tombstones
   */
  pruneAcknowledgedTombstones(rgaText, minAcknowledgedVector) {
    if (!minAcknowledgedVector || Object.keys(minAcknowledgedVector).length === 0) {
      return 0; // Not safe to prune if any peer's status is unknown
    }

    const initialCount = rgaText.nodes.length;
    const remainingNodes = [];

    for (const node of rgaText.nodes) {
      if (node.deleted) {
        // A tombstone is safe to delete if ALL known peers have witnessed the sequence
        const minSeen = minAcknowledgedVector[node.peerId] || 0;
        if (node.seq <= minSeen) {
          continue; // Prune!
        }
      }
      remainingNodes.push(node);
    }

    rgaText.nodes = remainingNodes;
    rgaText._rebuildIndexMap();

    return initialCount - remainingNodes.length;
  }
}
