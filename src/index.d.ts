export * from './types/domain.js';
export * from './types/result.js';

export class VectorClock {
  constructor(localPeerId: string, initialState?: Record<string, number>);
  tick(): number;
  get(peerId: string): number;
  update(peerId: string, seq: number): void;
  merge(other: VectorClock | Record<string, number>): VectorClock;
  compare(other: VectorClock | Record<string, number>): 'same' | 'before' | 'after' | 'concurrent';
  hasWitnessed(other: VectorClock | Record<string, number>): boolean;
  clone(): VectorClock;
  toJSON(): Record<string, number>;
  static fromJSON(localPeerId: string, json: Record<string, number>): VectorClock;
}

export class LWWMap {
  constructor(localPeerId: string, initialRegisters?: Record<string, unknown>);
  set(key: string, value: unknown): { op: import('./types/domain.js').DeltaOperation; register: unknown };
  delete(key: string): { op: import('./types/domain.js').DeltaOperation; register: unknown } | null;
  get(key: string): unknown;
  has(key: string): boolean;
  applyDelta(op: import('./types/domain.js').DeltaOperation): boolean;
  merge(other: LWWMap | Map<string, unknown>): number;
  toObject(): Record<string, unknown>;
  exportState(): Record<string, unknown>;
}

export class ORSet {
  constructor(localPeerId: string, initialState?: Map<unknown, Set<string>> | null);
  add(element: unknown): { op: import('./types/domain.js').DeltaOperation; tag: string };
  remove(element: unknown): { op: import('./types/domain.js').DeltaOperation; removedTags: string[] } | null;
  has(element: unknown): boolean;
  values(): unknown[];
  readonly size: number;
  applyDelta(op: import('./types/domain.js').DeltaOperation): boolean;
  merge(other: ORSet): void;
  exportState(): Record<string, string[]>;
}

export class RGAText {
  constructor(localPeerId: string, initialNodes?: import('./types/domain.js').RGANode[] | null);
  insert(visibleIndex: number, text: string): import('./types/domain.js').DeltaOperation[];
  delete(visibleIndex: number, length?: number): import('./types/domain.js').DeltaOperation[];
  applyDelta(op: import('./types/domain.js').DeltaOperation): boolean;
  merge(other: RGAText): void;
  toString(): string;
  readonly length: number;
  exportNodes(): import('./types/domain.js').RGANode[];
}

export class CollaborativeDoc {
  constructor(localPeerId: string, options?: { wal?: unknown });
  readonly localPeerId: string;
  readonly clock: VectorClock;
  readonly map: LWWMap;
  readonly set: ORSet;
  readonly text: RGAText;
  createHandshake(): import('./types/domain.js').SyncHandshakeMessage;
  setMapValue(key: string, value: unknown): import('./types/domain.js').DeltaOperation;
  deleteMapValue(key: string): import('./types/domain.js').DeltaOperation | null;
  addSetElement(element: unknown): import('./types/domain.js').DeltaOperation;
  removeSetElement(element: unknown): import('./types/domain.js').DeltaOperation | null;
  insertText(visibleIndex: number, content: string): import('./types/domain.js').DeltaOperation[];
  deleteText(visibleIndex: number, length?: number): import('./types/domain.js').DeltaOperation[];
  handleMessage(message: import('./types/domain.js').SyncMessage): import('./types/domain.js').SyncMessage | null;
  getState(): {
    map: Record<string, unknown>;
    set: unknown[];
    text: string;
    stateVector: Record<string, number>;
  };
}

export class StateVectorManager {
  static calculateMissingDeltas(
    localOpLog: import('./types/domain.js').DeltaOperation[],
    remoteStateVector: Record<string, number>
  ): import('./types/domain.js').DeltaOperation[];
  static encodeCompact(vector: Record<string, number>): string;
  static decodeCompact(compactStr: string): Record<string, number>;
  static isDominating(vectorA: Record<string, number>, vectorB: Record<string, number>): boolean;
}

export class WALAdapter {
  constructor(walFilePath?: string | null);
  append(op: import('./types/domain.js').DeltaOperation): import('./types/result.js').Result<number, Error>;
  appendBatch(ops: import('./types/domain.js').DeltaOperation[]): import('./types/result.js').Result<number, Error>;
  readAll(): import('./types/domain.js').DeltaOperation[];
  truncate(remainingOps?: import('./types/domain.js').DeltaOperation[]): void;
  readonly size: number;
}

export class SnapshotManager {
  constructor(options?: { snapshotFilePath?: string | null; snapshotIntervalOps?: number });
  createSnapshot(params: {
    vectorClock: VectorClock;
    lwwMap: LWWMap;
    orSet: ORSet;
    rgaText: RGAText;
  }): unknown;
  loadSnapshot(): unknown | null;
  pruneAcknowledgedTombstones(rgaText: RGAText, minAcknowledgedVector: Record<string, number>): number;
}

export class AwarenessProtocol {
  constructor(localPeerId: string, initialPresence?: unknown);
  updateLocalPresence(updates: unknown): import('./types/domain.js').AwarenessMessage;
  applyRemotePresence(peerId: string, presence: unknown): void;
  pruneStalePeers(timeoutMs?: number): string[];
  getAllStates(): Record<string, unknown>;
}

export class WebSocketSyncServer {
  constructor(options?: { port?: number; host?: string; doc?: CollaborativeDoc });
  start(): Promise<void>;
  broadcast(message: unknown): void;
  stop(): Promise<void>;
}

export class WebSocketSyncClient {
  constructor(options?: { host?: string; port?: number; peerId?: string; maxReconnectDelayMs?: number });
  connect(): Promise<void>;
  send(message: unknown): boolean;
  disconnect(): void;
}
