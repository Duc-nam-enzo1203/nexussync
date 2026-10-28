import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RGAText } from '../src/crdt/rga_text.js';

describe('RGAText Concurrent Sequence CRDT', () => {
  it('handles basic sequential typing and deletion', () => {
    const doc = new RGAText('peer-1');
    doc.insert(0, 'Hello World');
    assert.equal(doc.toString(), 'Hello World');
    assert.equal(doc.length, 11);

    // Delete " World" (from index 5, length 6)
    doc.delete(5, 6);
    assert.equal(doc.toString(), 'Hello');

    // Insert " Nexus"
    doc.insert(5, ' Nexus');
    assert.equal(doc.toString(), 'Hello Nexus');
  });

  it('guarantees NO character interleaving during concurrent insertions at the same index', () => {
    const docA = new RGAText('peer-A');
    const docB = new RGAText('peer-B');

    // Initial synchronized state: "START END"
    const initOps = docA.insert(0, 'START END');
    for (const op of initOps) docB.applyDelta(op);

    assert.equal(docA.toString(), 'START END');
    assert.equal(docB.toString(), 'START END');

    // Concurrently:
    // Peer A inserts " CAT" after "START" (at visible index 5)
    const opsA = docA.insert(5, ' CAT');

    // Peer B inserts " DOG" after "START" (also at visible index 5)
    const opsB = docB.insert(5, ' DOG');

    // Cross-apply deltas
    for (const op of opsB) docA.applyDelta(op);
    for (const op of opsA) docB.applyDelta(op);

    // Both peers MUST converge to the exact same text!
    assert.equal(docA.toString(), docB.toString());

    // Words must be contiguous (e.g. "START DOG CAT END" or "START CAT DOG END"), NEVER interleaved "C D O A G T"!
    const result = docA.toString();
    const hasCatFirst = result.includes('CAT DOG');
    const hasDogFirst = result.includes('DOG CAT');
    assert.ok(hasCatFirst || hasDogFirst, `Words were interleaved! Result was: "${result}"`);
  });

  it('preserves convergence when one peer deletes while another inserts nearby', () => {
    const docA = new RGAText('peer-A');
    const docB = new RGAText('peer-B');

    // Sync "ABCDEF"
    for (const op of docA.insert(0, 'ABCDEF')) docB.applyDelta(op);

    // Peer A deletes "CD"
    const delOps = docA.delete(2, 2);

    // Peer B concurrently inserts "123" between "C" and "D"
    const insOps = docB.insert(3, '123');

    // Cross apply
    for (const op of insOps) docA.applyDelta(op);
    for (const op of delOps) docB.applyDelta(op);

    assert.equal(docA.toString(), docB.toString());
    assert.equal(docA.toString(), 'AB123EF');
  });

  it('satisfies Commutativity: deltas arriving in different orders yield identical text', () => {
    const source = new RGAText('source');
    const ops1 = source.insert(0, 'Hello ');
    const ops2 = source.insert(6, 'NexusSync ');
    const ops3 = source.insert(16, 'Engine');

    const replicaForward = new RGAText('forward');
    const replicaReverse = new RGAText('reverse');

    const allOps = [...ops1, ...ops2, ...ops3];

    // Forward order
    for (const op of allOps) replicaForward.applyDelta(op);

    // Reverse order
    for (const op of [...allOps].reverse()) replicaReverse.applyDelta(op);

    assert.equal(replicaForward.toString(), replicaReverse.toString());
    assert.equal(replicaForward.toString(), 'Hello NexusSync Engine');
  });
});
