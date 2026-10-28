export type PeerId = string;

export interface LamportClock {
  readonly time: number;
  readonly peerId: PeerId;
}

export type VectorClockState = Record<PeerId, number>;

export type CausalityRelation = 'before' | 'after' | 'concurrent' | 'same';

export interface LWWRegister<T = unknown> {
  readonly value: T;
  readonly timestamp: number;
  readonly peerId: PeerId;
}

export interface ORSetAddTag {
  readonly tag: string;
  readonly peerId: PeerId;
  readonly timestamp: number;
}

export interface RGANode {
  readonly id: string;         // e.g. "peerA:1"
  readonly peerId: PeerId;
  readonly seq: number;
  readonly value: string;
  readonly leftId: string | null;
  readonly deleted: boolean;
  readonly timestamp: number;
}

export type DeltaType = 'lww_set' | 'lww_delete' | 'orset_add' | 'orset_remove' | 'rga_insert' | 'rga_delete';

export interface DeltaOperation {
  readonly type: DeltaType;
  readonly key?: string;
  readonly payload: unknown;
  readonly originPeer: PeerId;
  readonly seq: number;
  readonly timestamp: number;
}

export interface SyncHandshakeMessage {
  readonly type: 'handshake';
  readonly peerId: PeerId;
  readonly stateVector: VectorClockState;
}

export interface SyncDeltaMessage {
  readonly type: 'delta';
  readonly peerId: PeerId;
  readonly deltas: readonly DeltaOperation[];
}

export interface SyncAckMessage {
  readonly type: 'ack';
  readonly peerId: PeerId;
  readonly stateVector: VectorClockState;
}

export interface AwarenessMessage {
  readonly type: 'awareness';
  readonly peerId: PeerId;
  readonly presence: {
    readonly cursor?: { readonly x: number; readonly y: number; readonly line?: number; readonly col?: number };
    readonly selection?: unknown;
    readonly user?: { readonly name: string; readonly color: string };
    readonly updatedAt: number;
  };
}

export type SyncMessage = SyncHandshakeMessage | SyncDeltaMessage | SyncAckMessage | AwarenessMessage;
