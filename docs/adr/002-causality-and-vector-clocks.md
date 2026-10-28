# ADR 002: Causality Tracking via Vector Clocks and Hybrid Logical Timestamps

## Status
Accepted

## Context & Problem Statement
In distributed collaborative editing, physical wall clocks on different client devices (smartphones, laptops, servers) are subject to **clock skew** and non-monotonic adjustments (e.g. NTP synchronization jumps).

Relying strictly on `Date.now()` causes critical anomalies:
- A client whose clock is slow by 200ms will have its legitimate edits consistently overwritten by a client with a fast clock.
- When two events occur concurrently, physical timestamps cannot distinguish whether event $A$ caused event $B$ or whether both were generated independently in parallel.

## Decision Drivers
- **Deterministic Partial Ordering**: We must know with certainty if update $A$ causally preceded update $B$ ($A < B$), or if they are concurrent ($A \parallel B$).
- **Clock-Skew Immunity**: Merge decisions must not fail due to out-of-sync local physical clocks.
- **Compact Wire Representation**: Causality vectors must be small enough to exchange during initial WebSocket handshakes.

## Decision
We implemented a **Hybrid Causality Model**:

### 1. Vector Clocks for Causality & Synchronization Bounds
Each replica maintains a Vector Clock $V: \text{PeerId} \to \mathbb{N}$:
- When replica $P$ produces an edit, $V[P]$ increments by 1.
- Given two vectors $V_1$ and $V_2$:
  - $V_1 \le V_2 \iff \forall k, V_1[k] \le V_2[k]$.
  - $V_1 < V_2 \iff V_1 \le V_2 \land V_1 \ne V_2$ ($V_1$ happened-before $V_2$).
  - If neither $V_1 \le V_2$ nor $V_2 \le V_1$, the events are **concurrent** ($V_1 \parallel V_2$).

### 2. Lamport Timestamps with Peer-ID Tie Breaking for Register Ordering
For Last-Write-Wins (LWW) registers where a total order is required:
- Each update carries a logical timestamp $T = \max(T_{\text{local}}, T_{\text{remote}}) + 1$.
- If $T_A == T_B$, the conflict is deterministically resolved by lexicographical comparison of the origin $\text{PeerId}$:
  $$\text{winner} = (T_A > T_B) \lor (T_A == T_B \land \text{PeerId}_A > \text{PeerId}_B) \ ? \ A : B$$

## Consequences

### Positive
- Fully immune to physical clock skew and timezone variations.
- Guaranteed identical total ordering across all replicas without requiring atomic server time synchronization.
- Enables State Vector exchange: peers can summarize their entire history in a tiny payload (`{"peerA": 42, "peerB": 19}`).

### Negative / Trade-offs
- Vector clock size grows with the number of unique peers who have written to the document. To bound growth, inactive peers can be pruned during periodic snapshot compaction.
