import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AwarenessProtocol } from '../src/transport/awareness.js';

describe('AwarenessProtocol Ephemeral Presence & Collaborative Cursors', () => {
  it('updates local presence and returns awareness broadcast message', () => {
    const awareness = new AwarenessProtocol('peer-1', {
      user: { name: 'Alice', color: '#ff0000' },
    });

    const msg = awareness.updateLocalPresence({
      cursor: { x: 120, y: 340, line: 12, col: 5 },
    });

    assert.equal(msg.type, 'awareness');
    assert.equal(msg.peerId, 'peer-1');
    assert.equal(msg.presence.cursor.x, 120);
    assert.equal(msg.presence.user.name, 'Alice');
  });

  it('tracks remote peers and aggregates collaborative state', () => {
    const awarenessA = new AwarenessProtocol('peer-A');
    awarenessA.applyRemotePresence('peer-B', {
      user: { name: 'Bob', color: '#00ff00' },
      cursor: { x: 200, y: 150 },
    });

    const all = awarenessA.getAllStates();
    assert.ok(all['peer-A']);
    assert.ok(all['peer-B']);
    assert.equal(all['peer-B'].user.name, 'Bob');
  });

  it('prunes stale peers that have not refreshed within the timeout', () => {
    const awareness = new AwarenessProtocol('peer-1');
    awareness.applyRemotePresence('stale-peer', { cursor: { x: 0, y: 0 } });

    // Artificially age the peer timestamp
    awareness.states.get('stale-peer').updatedAt = Date.now() - 35000;

    const pruned = awareness.pruneStalePeers(30000);
    assert.deepEqual(pruned, ['stale-peer']);
    assert.equal(awareness.getAllStates()['stale-peer'], undefined);
  });
});
