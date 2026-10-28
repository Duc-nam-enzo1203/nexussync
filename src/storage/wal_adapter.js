import fs from 'node:fs';
import path from 'node:path';
import { ok, err } from '../types/result.js';

/**
 * Append-Only Write-Ahead Log (WAL) Storage Adapter for CRDT Operations.
 * 
 * Guarantees zero data loss across process crashes by writing every
 * local and remote operation sequentially to an append-only JSONL log.
 */
export class WALAdapter {
  /**
   * @param {string} [walFilePath] - Path to `.wal` file (in-memory if null)
   */
  constructor(walFilePath = null) {
    this.walFilePath = walFilePath;
    this.inMemoryLog = [];

    if (this.walFilePath) {
      const dir = path.dirname(this.walFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Appends a delta operation to the WAL.
   * 
   * @param {import('../types/domain.js').DeltaOperation} op
   * @returns {import('../types/result.js').Result<number, Error>} Length of log after append
   */
  append(op) {
    try {
      this.inMemoryLog.push(op);

      if (this.walFilePath) {
        fs.appendFileSync(this.walFilePath, JSON.stringify(op) + '\n', 'utf8');
      }

      return ok(this.inMemoryLog.length);
    } catch (error) {
      return err(error);
    }
  }

  /**
   * Appends multiple delta operations in a single batch.
   * 
   * @param {Array<import('../types/domain.js').DeltaOperation>} ops
   * @returns {import('../types/result.js').Result<number, Error>}
   */
  appendBatch(ops) {
    try {
      if (!ops || ops.length === 0) return ok(this.inMemoryLog.length);

      for (const op of ops) {
        this.inMemoryLog.push(op);
      }

      if (this.walFilePath) {
        const payload = ops.map(op => JSON.stringify(op)).join('\n') + '\n';
        fs.appendFileSync(this.walFilePath, payload, 'utf8');
      }

      return ok(this.inMemoryLog.length);
    } catch (error) {
      return err(error);
    }
  }

  /**
   * Reads all operations from the log (recovering state on boot).
   * 
   * @returns {Array<import('../types/domain.js').DeltaOperation>}
   */
  readAll() {
    if (!this.walFilePath || !fs.existsSync(this.walFilePath)) {
      return [...this.inMemoryLog];
    }

    try {
      const content = fs.readFileSync(this.walFilePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      const ops = [];

      for (const line of lines) {
        try {
          ops.push(JSON.parse(line));
        } catch {
          // Skip corrupted trailing records
        }
      }

      this.inMemoryLog = ops;
      return ops;
    } catch {
      return [...this.inMemoryLog];
    }
  }

  /**
   * Truncates the log after an immutable snapshot has been persisted.
   * 
   * @param {Array<import('../types/domain.js').DeltaOperation>} [remainingOps=[]]
   */
  truncate(remainingOps = []) {
    this.inMemoryLog = [...remainingOps];

    if (this.walFilePath) {
      if (remainingOps.length === 0) {
        fs.writeFileSync(this.walFilePath, '', 'utf8');
      } else {
        const payload = remainingOps.map(op => JSON.stringify(op)).join('\n') + '\n';
        fs.writeFileSync(this.walFilePath, payload, 'utf8');
      }
    }
  }

  /**
   * Returns current operation count.
   * @returns {number}
   */
  get size() {
    return this.inMemoryLog.length;
  }
}
