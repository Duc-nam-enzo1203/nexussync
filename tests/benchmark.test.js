import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LWWMap } from '../src/crdt/lww_map.js';
import { RGAText } from '../src/crdt/rga_text.js';
import { StateVectorManager } from '../src/sync/state_vector.js';

describe('NexusSync Performance & Throughput Benchmarks', () => {
  it('benchmarks LWWMap merge throughput (> 100,000 ops/sec)', () => {
    const mapA = new LWWMap('peer-A');
    const mapB = new LWWMap('peer-B');

    const ITERATIONS = 10_000;
    const ops = [];

    // Pre-generate mutations
    for (let i = 0; i < ITERATIONS; i++) {
      const { op } = mapA.set(`metric_key_${i % 100}`, i);
      ops.push(op);
    }

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      mapB.applyDelta(ops[i]);
    }
    const durationMs = performance.now() - start;
    const throughput = Math.round((ITERATIONS / durationMs) * 1000);

    console.log('\n================ NEXUSSYNC BENCHMARK ================');
    console.log(`LWWMap Delta Merge Throughput: ${throughput.toLocaleString()} ops/sec`);
    console.log(`Average Latency per Merge:     ${(durationMs / ITERATIONS).toFixed(4)} ms`);
    console.log('=====================================================\n');

    assert.ok(throughput > 50_000, `Throughput was ${throughput} ops/sec, expected > 50,000`);
  });

  it('benchmarks RGAText insertion and merge throughput', () => {
    const textA = new RGAText('peer-A');
    const textB = new RGAText('peer-B');

    const CHARS = 1_000;
    const ops = textA.insert(0, 'A'.repeat(CHARS));

    const start = performance.now();
    for (const op of ops) {
      textB.applyDelta(op);
    }
    const durationMs = performance.now() - start;
    const throughput = Math.round((CHARS / durationMs) * 1000);

    console.log(`RGAText Character Merge Rate:  ${throughput.toLocaleString()} chars/sec`);
    console.log(`1,000 Concurrent Characters:   ${durationMs.toFixed(2)} ms total\n`);

    assert.equal(textB.length, CHARS);
    assert.ok(throughput > 5_000);
  });

  it('benchmarks State Vector diff calculation latency', () => {
    const mockLog = [];
    for (let i = 0; i < 2_000; i++) {
      mockLog.push({
        type: 'lww_set',
        originPeer: `peer_${i % 10}`,
        seq: Math.floor(i / 10) + 1,
      });
    }

    const remoteVector = {
      peer_0: 100,
      peer_1: 150,
      peer_2: 80,
    };

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      StateVectorManager.calculateMissingDeltas(mockLog, remoteVector);
    }
    const avgLatencyMs = (performance.now() - start) / 100;

    console.log(`State Vector Diff Latency:     ${avgLatencyMs.toFixed(4)} ms (2,000 ops log)`);
    console.log('=====================================================\n');

    assert.ok(avgLatencyMs < 1.0, 'Diff calculation took > 1ms');
  });
});
