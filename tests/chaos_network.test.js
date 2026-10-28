import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CollaborativeDoc } from '../src/sync/sync_protocol.js';

describe('Chaos Engineering: Network Partition & Eventual Consistency', () => {
  it('converges 20 concurrent peers across simulated network partition, delays, and out-of-order delivery', async () => {
    const PEER_COUNT = 20;
    const peers = [];

    for (let i = 0; i < PEER_COUNT; i++) {
      peers.push(new CollaborativeDoc(`peer_${i}`));
    }

    // Phase 1: Partition into two isolated islands (Split-Brain)
    // Island 1: peers 0 to 9
    // Island 2: peers 10 to 19
    const island1 = peers.slice(0, 10);
    const island2 = peers.slice(10, 20);

    // Each peer in Island 1 performs independent concurrent mutations
    for (let i = 0; i < island1.length; i++) {
      const p = island1[i];
      p.setMapValue(`key_island1_${i}`, `val_${i}`);
      p.addSetElement(`tag_1_${i}`);
      p.insertText(p.text.length, `[I1-${i}]`);
    }

    // Each peer in Island 2 performs conflicting & overlapping mutations
    for (let i = 0; i < island2.length; i++) {
      const p = island2[i];
      // Deliberately write to common overlapping key to trigger conflict resolution
      p.setMapValue('shared_status', `island_2_peer_${i}`);
      p.addSetElement(`tag_2_${i}`);
      p.insertText(0, `[I2-${i}]`);
    }

    // Phase 2: Heal the network partition (Total Mesh Reconciliation)
    // All deltas from all peers are collected into a shuffled, out-of-order queue
    const chaosPacketQueue = [];

    for (const p of peers) {
      for (const op of p.opLog) {
        chaosPacketQueue.push({
          type: 'delta',
          peerId: p.localPeerId,
          deltas: [op],
        });
      }
    }

    // Randomize packet delivery order to simulate chaotic Internet routing
    chaosPacketQueue.sort(() => Math.random() - 0.5);

    // Deliver chaotic out-of-order packets to every peer
    for (const peer of peers) {
      for (const packet of chaosPacketQueue) {
        peer.handleMessage(packet);
      }
    }

    // Phase 3: Secondary State Vector Handshake Round (Ensures no missing transitive deltas)
    for (let i = 0; i < peers.length; i++) {
      const nextPeer = peers[(i + 1) % peers.length];
      const handshake = peers[i].createHandshake();
      const reply = nextPeer.handleMessage(handshake);
      if (reply && reply.deltas && reply.deltas.length > 0) {
        peers[i].handleMessage(reply);
      }
    }

    // Phase 4: Mathematical Eventual Consistency Assertion
    // All 20 peers MUST converge to the EXACT same state!
    const canonicalState = peers[0].getState();

    for (let i = 1; i < peers.length; i++) {
      const peerState = peers[i].getState();

      // Assert LWWMap converged identically
      assert.deepEqual(
        peerState.map,
        canonicalState.map,
        `Map divergence between peer_0 and peer_${i}!`
      );

      // Assert ORSet converged identically
      assert.deepEqual(
        peerState.set.sort(),
        canonicalState.set.sort(),
        `ORSet divergence between peer_0 and peer_${i}!`
      );

      // Assert RGAText converged identically
      assert.equal(
        peerState.text,
        canonicalState.text,
        `RGAText divergence between peer_0 and peer_${i}!`
      );
    }

    // Verify properties of the converged state
    assert.ok(canonicalState.map['shared_status']);
    assert.equal(canonicalState.set.length, 20); // 10 from island 1 + 10 from island 2
    assert.ok(canonicalState.text.length > 0);
  });
});
