import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CollaborativeDoc } from '../src/sync/sync_protocol.js';

describe('CollaborativeDoc Sync Protocol (Handshake & Delta Sync)', () => {
  it('synchronizes two offline peers via 2-step handshake exchange', () => {
    const peerA = new CollaborativeDoc('peer-A');
    const peerB = new CollaborativeDoc('peer-B');

    // Peer A performs offline actions:
    peerA.setMapValue('title', 'Distributed Systems Blueprint');
    peerA.addSetElement('chapter-1');
    peerA.insertText(0, 'Architecture: ');

    // Peer B performs offline actions:
    peerB.setMapValue('author', 'Staff Engineer');
    peerB.addSetElement('chapter-2');
    peerB.insertText(0, 'Introduction');

    // Step 1: Peer A sends handshake to Peer B
    const handshakeA = peerA.createHandshake();
    const replyFromB = peerB.handleMessage(handshakeA);

    // B responds with delta containing B's changes
    assert.equal(replyFromB.type, 'delta');
    assert.ok(replyFromB.deltas.length > 0);

    // Step 2: Peer A applies B's deltas
    const ackFromA = peerA.handleMessage(replyFromB);
    assert.equal(ackFromA.type, 'ack');

    // Step 3: Peer B sends handshake to Peer A
    const handshakeB = peerB.createHandshake();
    const replyFromA = peerA.handleMessage(handshakeB);

    // A responds with delta containing A's changes
    assert.equal(replyFromA.type, 'delta');
    assert.ok(replyFromA.deltas.length > 0);

    // Step 4: Peer B applies A's deltas
    const ackFromB = peerB.handleMessage(replyFromA);
    assert.equal(ackFromB.type, 'ack');

    // Both peers MUST have identical converged state!
    const stateA = peerA.getState();
    const stateB = peerB.getState();

    assert.deepEqual(stateA.map, stateB.map);
    assert.deepEqual(stateA.set.sort(), stateB.set.sort());
    assert.equal(stateA.text, stateB.text);

    assert.equal(stateA.map.title, 'Distributed Systems Blueprint');
    assert.equal(stateA.map.author, 'Staff Engineer');
    assert.deepEqual(stateA.set.sort(), ['chapter-1', 'chapter-2']);
  });

  it('guarantees idempotency when duplicate deltas arrive', () => {
    const peerA = new CollaborativeDoc('peer-A');
    const peerB = new CollaborativeDoc('peer-B');

    peerA.setMapValue('count', 42);
    const handshakeA = peerA.createHandshake();
    const handshakeB = peerB.createHandshake();

    const deltasFromA = peerA.handleMessage(handshakeB);

    // Apply the exact same deltas twice to peer B
    peerB.handleMessage(deltasFromA);
    const state1 = peerB.getState();

    peerB.handleMessage(deltasFromA); // duplicate packet
    const state2 = peerB.getState();

    assert.deepEqual(state1, state2);
    assert.equal(peerB.getState().map.count, 42);
  });
});
