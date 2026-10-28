import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketSyncServer } from '../src/transport/websocket_server.js';
import { WebSocketSyncClient } from '../src/transport/websocket_client.js';
import { CollaborativeDoc } from '../src/sync/sync_protocol.js';

describe('WebSocket Zero-Dependency Transport End-to-End', () => {
  it('synchronizes real-time delta between two clients via central sync server', async () => {
    const port = 49152 + Math.floor(Math.random() * 5000);
    const serverDoc = new CollaborativeDoc('server');
    const server = new WebSocketSyncServer({ port, host: '127.0.0.1', doc: serverDoc });

    await server.start();

    const docA = new CollaborativeDoc('client-A');
    const clientA = new WebSocketSyncClient({ host: '127.0.0.1', port, peerId: 'client-A' });

    const docB = new CollaborativeDoc('client-B');
    const clientB = new WebSocketSyncClient({ host: '127.0.0.1', port, peerId: 'client-B' });

    try {
      await clientA.connect();
      await clientB.connect();

      // Setup client message dispatchers
      clientA.on('message', (msg) => docA.handleMessage(msg));
      clientB.on('message', (msg) => docB.handleMessage(msg));

      // Client A performs a mutation and sends to server
      const mutationOp = docA.setMapValue('conference', 'Distributed Systems 2026');
      clientA.send({
        type: 'delta',
        peerId: 'client-A',
        deltas: [mutationOp],
      });

      // Wait 100ms for TCP frame delivery and broadcast
      await new Promise((r) => setTimeout(r, 100));

      // Both Server and Client B must have received and applied the delta!
      assert.equal(serverDoc.getState().map.conference, 'Distributed Systems 2026');
      assert.equal(docB.getState().map.conference, 'Distributed Systems 2026');
    } finally {
      clientA.disconnect();
      clientB.disconnect();
      await server.stop();
    }
  });
});
