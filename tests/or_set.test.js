import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ORSet } from '../src/crdt/or_set.js';

describe('ORSet (Observed-Remove Set with Add-Wins)', () => {
  it('adds elements and tracks membership', () => {
    const set = new ORSet('peer-1');
    assert.equal(set.has('apple'), false);
    set.add('apple');
    set.add('banana');

    assert.equal(set.has('apple'), true);
    assert.equal(set.has('banana'), true);
    assert.equal(set.size, 2);
    assert.deepEqual(set.values().sort(), ['apple', 'banana']);
  });

  it('removes elements by deleting observed tags', () => {
    const set = new ORSet('peer-1');
    set.add('apple');
    assert.equal(set.has('apple'), true);

    set.remove('apple');
    assert.equal(set.has('apple'), false);
    assert.equal(set.size, 0);
  });

  it('enforces Add-Wins when an addition and deletion occur concurrently', () => {
    const setA = new ORSet('peer-A');
    const setB = new ORSet('peer-B');

    // Both start with "item-1" synchronized
    const { op: initialAdd } = setA.add('item-1');
    setB.applyDelta(initialAdd);
    assert.equal(setA.has('item-1'), true);
    assert.equal(setB.has('item-1'), true);

    // Concurrently:
    // Peer A removes "item-1" (purges initialAdd tag)
    const { op: removeOp } = setA.remove('item-1');

    // Peer B re-adds "item-1" (generates a NEW tag not seen by A)
    const { op: concurrentAdd } = setB.add('item-1');

    // Cross-sync deltas
    setA.applyDelta(concurrentAdd);
    setB.applyDelta(removeOp);

    // Both must agree that "item-1" is present because concurrent Add wins!
    assert.equal(setA.has('item-1'), true);
    assert.equal(setB.has('item-1'), true);
  });

  it('re-adds an element cleanly after a sequential deletion', () => {
    const set = new ORSet('peer-1');
    set.add('task-1');
    set.remove('task-1');
    assert.equal(set.has('task-1'), false);

    set.add('task-1');
    assert.equal(set.has('task-1'), true);
  });
});
