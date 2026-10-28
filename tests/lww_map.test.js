import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LWWMap } from '../src/crdt/lww_map.js';

describe('LWWMap Conflict-Free Replicated Map', () => {
  it('sets, retrieves, and checks existence of keys', () => {
    const map = new LWWMap('peer-1');
    map.set('title', 'Distributed Systems');
    map.set('version', 1);

    assert.equal(map.get('title'), 'Distributed Systems');
    assert.equal(map.get('version'), 1);
    assert.equal(map.has('title'), true);
    assert.equal(map.has('missing'), false);
  });

  it('handles tombstones on delete()', () => {
    const map = new LWWMap('peer-1');
    map.set('status', 'draft');
    assert.equal(map.get('status'), 'draft');

    map.delete('status');
    assert.equal(map.get('status'), undefined);
    assert.equal(map.has('status'), false);
    assert.deepEqual(map.toObject(), {});
  });

  it('resolves concurrent conflicting edits using timestamps', () => {
    const mapA = new LWWMap('peer-A');
    const mapB = new LWWMap('peer-B');

    // Peer A sets key at timestamp 1
    const { op: opA } = mapA.set('theme', 'dark');

    // Peer B sets same key at higher timestamp 2
    mapB.set('dummy', 0); // bump clock
    const { op: opB } = mapB.set('theme', 'light');

    // Both peers apply each other's deltas
    mapA.applyDelta(opB);
    mapB.applyDelta(opA);

    // Both must converge to 'light' (higher timestamp)
    assert.equal(mapA.get('theme'), 'light');
    assert.equal(mapB.get('theme'), 'light');
  });

  it('breaks ties deterministically using peerId when timestamps match', () => {
    const mapAlpha = new LWWMap('client-A');
    const mapBeta = new LWWMap('client-B');

    // Craft conflicting ops with the exact same timestamp 100
    const opA = {
      type: 'lww_set',
      key: 'color',
      payload: { value: 'red', timestamp: 100, peerId: 'client-A' },
      originPeer: 'client-A',
      seq: 100,
      timestamp: 100,
    };

    const opB = {
      type: 'lww_set',
      key: 'color',
      payload: { value: 'blue', timestamp: 100, peerId: 'client-B' },
      originPeer: 'client-B',
      seq: 100,
      timestamp: 100,
    };

    // Both maps apply opA and opB in opposite orders
    mapAlpha.applyDelta(opA);
    mapAlpha.applyDelta(opB);

    mapBeta.applyDelta(opB);
    mapBeta.applyDelta(opA);

    // 'client-B' > 'client-A' alphabetically, so 'blue' must win on both!
    assert.equal(mapAlpha.get('color'), 'blue');
    assert.equal(mapBeta.get('color'), 'blue');
  });

  it('satisfies mathematical Commutativity & Idempotency', () => {
    const a = new LWWMap('A');
    const b = new LWWMap('B');

    a.set('x', 10);
    b.set('x', 20);
    a.set('y', 'hello');

    const replica1 = new LWWMap('R1');
    const replica2 = new LWWMap('R2');

    // Merge in opposite orders: A then B vs B then A
    replica1.merge(a);
    replica1.merge(b);

    replica2.merge(b);
    replica2.merge(a);

    assert.deepEqual(replica1.toObject(), replica2.toObject());

    // Idempotency: merging same map multiple times yields identical state
    replica1.merge(a);
    replica1.merge(a);
    assert.deepEqual(replica1.toObject(), replica2.toObject());
  });
});
