import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VectorClock } from '../src/crdt/vector_clock.js';

describe('VectorClock Causality & Partial Ordering', () => {
  it('initializes with local peer at 0 and increments on tick()', () => {
    const vc = new VectorClock('peer-A');
    assert.equal(vc.get('peer-A'), 0);
    assert.equal(vc.tick(), 1);
    assert.equal(vc.get('peer-A'), 1);
    assert.equal(vc.tick(), 2);
    assert.equal(vc.get('peer-A'), 2);
  });

  it('merges vector clocks using pointwise maximum', () => {
    const vcA = new VectorClock('peer-A', { 'peer-A': 3, 'peer-B': 1 });
    const vcB = new VectorClock('peer-B', { 'peer-A': 1, 'peer-B': 4, 'peer-C': 2 });

    vcA.merge(vcB);
    assert.equal(vcA.get('peer-A'), 3);
    assert.equal(vcA.get('peer-B'), 4);
    assert.equal(vcA.get('peer-C'), 2);
  });

  it('accurately classifies causality: before, after, same, and concurrent', () => {
    const base = new VectorClock('A', { A: 1, B: 1 });
    const same = new VectorClock('A', { A: 1, B: 1 });
    const advanced = new VectorClock('A', { A: 2, B: 1 });
    const advancedB = new VectorClock('B', { A: 1, B: 2 });

    // Same
    assert.equal(base.compare(same), 'same');

    // Before
    assert.equal(base.compare(advanced), 'before');

    // After
    assert.equal(advanced.compare(base), 'after');

    // Concurrent (split brain / parallel edits)
    // advanced has A=2, B=1. advancedB has A=1, B=2.
    assert.equal(advanced.compare(advancedB), 'concurrent');
    assert.equal(advancedB.compare(advanced), 'concurrent');
  });

  it('determines if a clock has witnessed another clock state', () => {
    const v1 = new VectorClock('A', { A: 5, B: 3 });
    const v2 = new VectorClock('B', { A: 2, B: 3 });
    const v3 = new VectorClock('C', { A: 2, B: 4 });

    assert.equal(v1.hasWitnessed(v2), true);
    assert.equal(v2.hasWitnessed(v1), false);
    // v1 and v3 are concurrent (v1 has higher A, v3 has higher B)
    assert.equal(v1.hasWitnessed(v3), false);
  });
});
