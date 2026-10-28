#!/usr/bin/env node
import { WebSocketSyncServer } from './transport/websocket_server.js';
import { WALAdapter } from './storage/wal_adapter.js';

function startServer(args) {
  let port = 4040;
  let host = '0.0.0.0';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[i + 1];
      i++;
    }
  }

  const server = new WebSocketSyncServer({ port, host });
  server.start().then(() => {
    console.log('\n===============================================================');
    console.log(`🚀 NexusSync Central Relay Hub Active`);
    console.log(` - WebSocket URL:  ws://${host}:${port}`);
    console.log(` - Health Probe:   http://${host}:${port}/health`);
    console.log('===============================================================\n');
  });

  process.on('SIGINT', async () => {
    console.log('\nStopping NexusSync server...');
    await server.stop();
    process.exit(0);
  });
}

function inspectWAL(walPath) {
  if (!walPath) {
    console.error('Usage: nexussync inspect <path-to-wal.wal>');
    process.exit(1);
  }

  console.log(`\n[NexusSync] Inspecting WAL storage file: ${walPath}...`);
  const wal = new WALAdapter(walPath);
  const ops = wal.readAll();

  console.log(`Total Stored Operations: ${ops.length}`);
  const peerOps = {};
  const typeCounts = {};

  for (const op of ops) {
    peerOps[op.originPeer] = (peerOps[op.originPeer] || 0) + 1;
    typeCounts[op.type] = (typeCounts[op.type] || 0) + 1;
  }

  console.log('\nOperations by Origin Peer:');
  console.table(peerOps);

  console.log('\nOperations by CRDT Type:');
  console.table(typeCounts);
}

const [,, command, ...rest] = process.argv;

if (!command || command === 'serve') {
  startServer(rest);
} else if (command === 'inspect') {
  inspectWAL(rest[0]);
} else if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
NexusSync CLI 🌐

Usage:
  nexussync [command] [options]

Commands:
  serve [--port N] [--host H] (default)  Start the central WebSocket synchronization hub
  inspect <path-to-wal>                  Analyze and inspect a CRDT Write-Ahead Log on disk
  help                                   Show this help message
`);
} else {
  console.error(`Unknown command: '${command}'. Run 'nexussync --help' for usage.`);
  process.exit(1);
}
