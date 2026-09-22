# Proposed decision: room-can-remove-a-seat-and-seats-prove-liveness

From swarm-140818-f1qy (concluded); report: swarms/swarm-140818-f1qy/report.md. A human promotes this into docs/decisions/ with `guard-decisions add`; nothing is adopted automatically.

DECISION RECORD
- **slug:** room-can-remove-a-seat-and-seats-prove-liveness
- **context:** A dead or blocking seat could stall a unanimous room, with no way to remove or replace it. Claude Code (`claude -p`) and codex seats never heartbeated, so seats busy with local work looked dead. Two earlier runs of this brief (swarm-140313-feeo, swarm-140520-p8au) ended open with no code.
- **ruling:**
  - One removal function, `Hub.removeParticipant`, handles both kick and replace. It marks the seat left with a kicked record that survives restarts and releases its claim/* entries. It refuses the connection's further calls to that room with KICKED, reads included, and blocks rejoining.
  - `kick_vote` counts one ballot per connection. The threshold is the room's quorum rule over the other connections, minimum 2. Only a dashboard human (`http:` session) counts as human.
  - `replace_participant` uses the same removal and then the existing replacement recruit path. An agent may only replace a seat that has left, was kicked, or is both 10+ minutes quiet and disconnected.
  - Each launched seat gets a random seat key. Claude seats heartbeat through a hook before every tool call; codex seats heartbeat from their process output. Every MCP call also counts as a step.
  - room_status reports each participant's liveness: active, idle, suspected_dead or left, with age in seconds.
- **consequences:** Rooms can't be stalled by a dead or blocking seat, and removal still needs either a vote or proof the seat is gone. This protects identity-is-the-connection, done-means-independently-verified and hub-carries-what-it-knows.
- **tradeoff:** The seat key and heartbeat endpoint accept any caller holding a random key. Every Claude tool call runs a small node hook. A seat that is truly dead but whose connection is still open can't be replaced by an agent until a kick vote passes or the connection times out.
- **researched:** no external sources were read this run. The evidence was the repo code, tests and commits listed above (NEW sources: none).
- **rejected:**
  - Replace on 10 minutes of silence alone: loses on false positives, because a seat inside one long command looks dead.
  - Trusting a self-declared `agent="human"`: loses because the hub can't check it.
  - Merging the size refactor 6ac3b44 first: outside the brief, and it would have forced kick to be re-verified.
  - Adjusting expected_participants on a kick: unnecessary, because the quorum count already ignores seats that have left.
- **revisit-when:** a seat that was verifiably alive is removed by replace, or a dead seat blocks a room for longer than the MCP session idle timeout.
