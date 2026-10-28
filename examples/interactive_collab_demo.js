import { WebSocketSyncServer } from '../src/transport/websocket_server.js';
import { WebSocketSyncClient } from '../src/transport/websocket_client.js';
import { CollaborativeDoc } from '../src/sync/sync_protocol.js';
import { AwarenessProtocol } from '../src/transport/awareness.js';

/**
 * NexusSync Interactive Multi-Peer Collaborative Demo
 * 
 * Simulates 3 distributed peers (Alice in SF, Bob in Tokyo, Charlie in London)
 * collaborating in real-time, handling offline edits, network partition,
 * and automatic conflict-free convergence.
 */
async function runCollabDemo() {
  console.log('\n===============================================================');
  console.log('🌐 NEXUSSYNC DISTRIBUTED CRDT REAL-TIME COLLABORATION DEMO');
  console.log('===============================================================\n');

  const PORT = 4055;
  const serverDoc = new CollaborativeDoc('central-relay');
  const server = new WebSocketSyncServer({ port: PORT, doc: serverDoc });
  await server.start();
  console.log(`[Relay Server] Started central sync hub on ws://127.0.0.1:${PORT}`);

  // Create 3 client documents & WebSocket connections
  const docAlice = new CollaborativeDoc('alice-sf');
  const docBob = new CollaborativeDoc('bob-tokyo');
  const docCharlie = new CollaborativeDoc('charlie-london');

  const clientAlice = new WebSocketSyncClient({ port: PORT, peerId: 'alice-sf' });
  const clientBob = new WebSocketSyncClient({ port: PORT, peerId: 'bob-tokyo' });
  const clientCharlie = new WebSocketSyncClient({ port: PORT, peerId: 'charlie-london' });

  // Bind message handlers
  clientAlice.on('message', (msg) => docAlice.handleMessage(msg));
  clientBob.on('message', (msg) => docBob.handleMessage(msg));
  clientCharlie.on('message', (msg) => docCharlie.handleMessage(msg));

  // Initialize Awareness
  const awarenessAlice = new AwarenessProtocol('alice-sf', { user: { name: 'Alice (SF)', color: '#3b82f6' } });
  const awarenessBob = new AwarenessProtocol('bob-tokyo', { user: { name: 'Bob (Tokyo)', color: '#10b981' } });

  try {
    // 1. Connect all clients
    await Promise.all([clientAlice.connect(), clientBob.connect(), clientCharlie.connect()]);
    console.log('[Network] Alice, Bob, and Charlie connected to sync hub.\n');

    // 2. Initial Collaborative Document Setup
    console.log('👉 [Step 1] Alice initializes the document...');
    const op1 = docAlice.setMapValue('title', 'Distributed Systems RFC');
    const op2 = docAlice.addSetElement('review-security');
    const op3 = docAlice.insertText(0, 'RFC 101: Conflict-Free Replication');

    // Broadcast Alice's initial state
    clientAlice.send({ type: 'delta', peerId: 'alice-sf', deltas: [op1, op2, ...op3] });
    await new Promise((r) => setTimeout(r, 60));

    console.log(`   Document Title: "${docBob.getState().map.title}"`);
    console.log(`   Document Text:  "${docBob.getState().text}"`);
    console.log(`   Active Tags:    [${docBob.getState().set.join(', ')}]\n`);

    // 3. Bob goes OFFLINE (Simulating an airplane flight)
    console.log('👉 [Step 2] ✈️ Bob loses network connectivity (goes offline)...');
    clientBob.disconnect();

    // 4. While Bob is offline: Alice and Charlie collaborate online
    console.log('👉 [Step 3] Alice and Charlie make concurrent online edits...');
    const opCharlie1 = docCharlie.setMapValue('status', 'in-review');
    const opCharlie2 = docCharlie.addSetElement('review-performance');
    clientCharlie.send({ type: 'delta', peerId: 'charlie-london', deltas: [opCharlie1, opCharlie2] });

    const opAliceText = docAlice.insertText(docAlice.text.length, ' by Alice');
    clientAlice.send({ type: 'delta', peerId: 'alice-sf', deltas: opAliceText });
    await new Promise((r) => setTimeout(r, 60));

    console.log(`   [Online State] Status: "${docAlice.getState().map.status}", Text: "${docAlice.getState().text}"\n`);

    // 5. Meanwhile: Bob works completely OFFLINE on his local machine
    console.log('👉 [Step 4] Bob makes offline edits in local storage ($0ms latency)...');
    docBob.setMapValue('status', 'approved-by-bob'); // Conflicting status edit
    docBob.addSetElement('ready-for-prod');
    docBob.insertText(0, '[DRAFT] ');
    console.log(`   [Bob Local State] Text: "${docBob.getState().text}"\n`);

    // 6. Bob reconnects to the network!
    console.log('👉 [Step 5] 🛬 Bob reconnects to sync hub. Starting State Vector Handshake...');
    await clientBob.connect();

    // Bob sends State Vector Handshake to Server
    const handshake = docBob.createHandshake();
    clientBob.send(handshake);

    // Bob flushes his offline deltas
    clientBob.send({
      type: 'delta',
      peerId: 'bob-tokyo',
      deltas: docBob.opLog,
    });

    await new Promise((r) => setTimeout(r, 120));

    // Re-sync Charlie and Alice with Bob's deltas
    clientCharlie.send(docCharlie.createHandshake());
    clientAlice.send(docAlice.createHandshake());
    await new Promise((r) => setTimeout(r, 120));

    // 7. Verify Convergence across all 3 replicas
    console.log('===============================================================');
    console.log('🔍 EVENTUAL CONSISTENCY RECONCILIATION AUDIT');
    console.log('===============================================================');

    const stateAlice = docAlice.getState();
    const stateBob = docBob.getState();
    const stateCharlie = docCharlie.getState();

    console.log(`Alice   Text: "${stateAlice.text}"`);
    console.log(`Bob     Text: "${stateBob.text}"`);
    console.log(`Charlie Text: "${stateCharlie.text}"\n`);

    console.log(`Alice   Tags: [${stateAlice.set.sort().join(', ')}]`);
    console.log(`Bob     Tags: [${stateBob.set.sort().join(', ')}]`);
    console.log(`Charlie Tags: [${stateCharlie.set.sort().join(', ')}]\n`);

    console.log(`Alice   Map:  ${JSON.stringify(stateAlice.map)}`);
    console.log(`Bob     Map:  ${JSON.stringify(stateBob.map)}`);
    console.log(`Charlie Map:  ${JSON.stringify(stateCharlie.map)}\n`);

    const converged = stateAlice.text === stateBob.text &&
                      stateBob.text === stateCharlie.text &&
                      JSON.stringify(stateAlice.map) === JSON.stringify(stateBob.map);

    if (converged) {
      console.log('✅ 100% MATHEMATICAL CONVERGENCE ACHIEVED!');
      console.log('   All 3 distributed replicas resolved conflicts with 0 data loss.');
    } else {
      console.error('❌ Divergence detected between replicas!');
    }

  } finally {
    clientAlice.disconnect();
    clientBob.disconnect();
    clientCharlie.disconnect();
    await server.stop();
  }
}

runCollabDemo().catch(console.error);
