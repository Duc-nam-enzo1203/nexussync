import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotManager } from '../src/sync/snapshot_manager.js';
import { VectorClock } from '../src/crdt/vector_clock.js';
import { LWWMap } from '../src/crdt/lww_map.js';
import { ORSet } from '../src/crdt/or_set.js';
import { RGAText } from '../src/crdt/rga_text.js';

describe('SnapshotManager & Tombstone Garbage Collection', () => {
  it('creates in-memory snapshot with consolidated state', () => {
    const vc = new VectorClock('p1', { p1: 5, p2: 3 });
    const map = new LWWMap('p1');
    map.set('title', 'CRDT Guide');
    const set = new ORSet('p1');
    set.add('v1');
    const text = new RGAText('p1');
    text.insert(0, 'Hello');

    const sm = new SnapshotManager();
    const snap = sm.createSnapshot({ vectorClock: vc, lwwMap: map, orSet: set, rgaText: text });

    assert.equal(snap.version, 1);
    assert.deepEqual(snap.stateVector, { p1: 5, p2: 3 });
    assert.equal(snap.lwwMap.title.value, 'CRDT Guide');
    assert.equal(snap.rgaNodes.length, 5);
  });

  it('safely prunes tombstones acknowledged by all peers', () => {
    const text = new RGAText('p1');
    text.insert(0, 'ABCDE');
    assert.equal(text.nodes.length, 5);

    // Delete 'B' and 'C'
    text.delete(1, 2);
    assert.equal(text.toString(), 'ADE');
    assert.equal(text.nodes.length, 5); // tombstones still present

    const sm = new SnapshotManager();

    // Case 1: Peers have NOT seen all sequence numbers yet -> safe pruning does nothing
    const partialSeen = { p1: 1 };
    const prunedCount1 = sm.pruneAcknowledgedTombstones(text, partialSeen);
    assert.equal(prunedCount1, 0);
    assert.equal(text.nodes.length, 5);

    // Case 2: All peers have witnessed up to seq 10 (higher than all nodes)
    const allSeen = { p1: 10 };
    const prunedCount2 = sm.pruneAcknowledgedTombstones(text, allSeen);
    assert.equal(prunedCount2, 2); // 2 tombstones pruned!
    assert.equal(text.nodes.length, 3);
    assert.equal(text.toString(), 'ADE');
  });
});
