import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WALAdapter } from '../src/storage/wal_adapter.js';

describe('WALAdapter Append-Only Persistence', () => {
  it('appends and reads back operations from disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexussync-wal-'));
    const walFile = path.join(tmpDir, 'test.wal');

    try {
      const wal = new WALAdapter(walFile);
      wal.append({
        type: 'lww_set',
        key: 'k1',
        payload: { value: 'val1' },
        originPeer: 'p1',
        seq: 1,
        timestamp: 100,
      });

      wal.append({
        type: 'orset_add',
        payload: { element: 'e1', tag: 'tag1' },
        originPeer: 'p1',
        seq: 2,
        timestamp: 101,
      });

      assert.equal(wal.size, 2);

      // Re-instantiate new adapter pointing to same file (simulating process restart)
      const restored = new WALAdapter(walFile);
      const ops = restored.readAll();
      assert.equal(ops.length, 2);
      assert.equal(ops[0].key, 'k1');
      assert.equal(ops[1].type, 'orset_add');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('truncates log cleanly after snapshotting', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexussync-wal-'));
    const walFile = path.join(tmpDir, 'trunc.wal');

    try {
      const wal = new WALAdapter(walFile);
      wal.appendBatch([
        { type: 'lww_set', originPeer: 'p', seq: 1, timestamp: 1 },
        { type: 'lww_set', originPeer: 'p', seq: 2, timestamp: 2 },
      ]);
      assert.equal(wal.size, 2);

      wal.truncate([]);
      assert.equal(wal.size, 0);

      const restored = new WALAdapter(walFile);
      assert.equal(restored.readAll().length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
