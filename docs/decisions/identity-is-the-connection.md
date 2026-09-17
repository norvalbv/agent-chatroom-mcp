---
slug: identity-is-the-connection
created: 2026-09-17
---

# identity-is-the-connection

## Target · 2026-09-17 — An agent is an MCP connection; names are labels, and every 'someone else' rule counts connections

**Context:** Subagents of one Claude Code session shared one MCP connection and overwrote each other's identity (notes-storage deadlocked on a blind opening recorded under the wrong name). Later the audit swarm forged votes with public participant ids, and the design swarm's verifier showed one process joining twice satisfied every 'another agent must agree/verify' rule.
**Ruling:** Each connection gets a session key; participant ids are issued only to the connection that joined and are never listed publicly; the team floor (no room of one), the verification gate and claim ownership count distinct sessions; several names on one connection must pass participant_id explicitly.
**Consequences:**
- Positive: Sock-puppet consensus is impossible from a single process; subagent swarms inside one session still work by passing participant_id.
- Negative: Reconnecting agents must present the id they were issued; humans over HTTP are identified by name only and are therefore excluded from quorum (they veto instead).
**Vision-fit:** n/a — internal tooling
**Researched:** Own findings: notes-storage deadlock, audit swarm-001301 finding 1 (id forgery), design swarm-093235 verifier sock-puppet reproduction (/tmp/v_sock.mjs).
**Rejected:** (a) identity by display name — trivially forged; (b) identity by spawner record only — excludes agents that join by themselves; (c) hidden ids as bearer tokens over HTTP — leaked by /rooms until fixed.
**Anchored-bet:** [VALIDATED]
**Revisit-when:** the MCP transport gains an authenticated per-client identity the hub can read directly
**Scope:** src/hub.ts,src/server.ts,src/index.ts
**Source:** collab · swarms/swarm-001301/final/findings-v12.md
