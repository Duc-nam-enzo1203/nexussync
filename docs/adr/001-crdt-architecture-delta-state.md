# ADR 001: Selection of Delta-State CRDTs over Classic CvRDT and CmRDT

## Status
Accepted

## Context & Problem Statement
In local-first collaborative software, multiple concurrent replicas can generate edits while offline. When these replicas reconnect, their states must converge without centralized locks or data loss.

There are two classical families of Conflict-Free Replicated Data Types (CRDTs):
1. **State-based CRDTs (CvRDT)**: Replicas periodically transmit their entire internal state and merge via a join-semilattice ($A \sqcup B$).
   - *Problem*: Bandwidth scales linearly with document size ($O(N)$), causing catastrophic overhead on large documents (e.g. sending a 5MB text document just because 1 character was typed).
2. **Operation-based CRDTs (CmRDT)**: Replicas transmit individual operations (e.g., `insert(char, pos)`).
   - *Problem*: Requires an underlying transport that guarantees exactly-once causal delivery without message loss or duplicates. Implementing reliable causal broadcast over lossy, intermittently disconnected WebSockets is fragile.

## Decision Drivers
- **Minimal Network Overhead**: Bandwidth consumption must scale with the size of the edit ($O(\Delta)$), not total document size.
- **Transport Fault Tolerance**: The merge function must remain **Associative**, **Commutative**, and **Idempotent** (ACID in semilattice terms), allowing safe retransmission over lossy connections.
- **Offline Partition Tolerance**: Edits performed during a multi-day network split must resolve deterministically without a central coordinator.

## Considered Options
1. **Classical State-Based CRDTs (CvRDT)**: Heavy bandwidth overhead.
2. **Pure Operation-Based CRDTs (CmRDT)**: High transport coupling, brittle on packet loss.
3. **Delta-State CRDTs ($\delta$-CRDT)**: Decomposes state mutations into minimal $\delta$-states that form a join-semilattice.

## Decision
We chose **Delta-State CRDTs ($\delta$-CRDT)** with **Vector Clock causality filtering**:
- When a local mutation occurs, a minimal delta $\delta$ is produced.
- A local monotonic sequence counter is incremented.
- When syncing with peers, replicas exchange **State Vectors** (compact mappings of `PeerId -> SequenceNumber`).
- The sender computes the difference between its local log and the peer's State Vector, transmitting only the unobserved deltas.
- The recipient applies the delta using semilattice join, ensuring that out-of-order, duplicated, or delayed deltas converge to the exact same state.

## Consequences

### Positive
- **Bandwidth Efficiency**: Only mutations made since the last common state vector are transmitted over the wire.
- **Idempotency**: Retrying dropped packets or receiving duplicates never corrupts the document state.
- **True Peer-to-Peer & Client-Server Symmetry**: The same sync protocol operates between Client $\leftrightarrow$ Server, or Peer $\leftrightarrow$ Peer (WebRTC).

### Negative / Trade-offs
- Requires maintaining an operation log or tombstone metadata until garbage collected via snapshot compaction.
