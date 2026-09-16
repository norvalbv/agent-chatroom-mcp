#!/usr/bin/env bash
# Launch a Claude Code agent and a Codex agent into the same chatroom and have
# them reach a conclusion on a topic.
#
#   scripts/debate.sh "Should this repo use tabs or spaces?" [room-name]
#
# Env: PORT (default 7717), CLAUDE_MODEL, CODEX_MODEL, N_CLAUDE (default 1), N_CODEX (default 1)
set -euo pipefail
cd "$(dirname "$0")/.."

TOPIC="${1:?usage: scripts/debate.sh \"<topic>\" [room]}"
ROOM="${2:-debate-$(date +%H%M%S)}"
PORT="${PORT:-7717}"
URL="http://127.0.0.1:${PORT}/mcp"
N_CLAUDE="${N_CLAUDE:-1}"
N_CODEX="${N_CODEX:-1}"
N=$((N_CLAUDE + N_CODEX))
LOGS="logs/${ROOM}"; mkdir -p "$LOGS"

# 1. Make sure the hub is running (it is shared state, so exactly one process).
if ! curl -sf "http://127.0.0.1:${PORT}/" >/dev/null; then
  echo "[debate] starting hub on :${PORT}"
  CHATROOM_DATA_DIR="${CHATROOM_DATA_DIR:-data}" PORT="$PORT" npx tsx src/index.ts >"$LOGS/hub.log" 2>&1 &
  HUB_PID=$!
  trap 'kill $HUB_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:${PORT}/" >/dev/null && break; sleep 0.2; done
fi

LENSES=("cost and simplicity" "risk and failure modes" "the people who have to operate and maintain it" "the strongest case against the obvious answer" "what changes in a year" "evidence from real-world use")
IDX=0
render_prompt() { # name agent
  local lens="${LENSES[$((IDX % ${#LENSES[@]}))]}"; IDX=$((IDX + 1))
  sed -e "s|{{NAME}}|$1|g" -e "s|{{AGENT}}|$2|g" -e "s|{{ROOM}}|$ROOM|g" -e "s|{{N}}|$N|g" -e "s|{{TOPIC}}|$TOPIC|g" -e "s|{{LENS}}|$lens|g" prompts/participant.md
}

MCP_JSON="$LOGS/mcp.json"
printf '{"mcpServers":{"chatroom":{"type":"http","url":"%s"}}}\n' "$URL" >"$MCP_JSON"

PIDS=()
for ((i = 1; i <= N_CLAUDE; i++)); do
  NAME="claude-$i"
  echo "[debate] launching $NAME"
  MCP_TOOL_TIMEOUT=120000 claude -p "$(render_prompt "$NAME" claude)" \
    --mcp-config "$MCP_JSON" --strict-mcp-config \
    --allowedTools "mcp__chatroom__*" \
    ${CLAUDE_MODEL:+--model "$CLAUDE_MODEL"} \
    >"$LOGS/$NAME.out" 2>"$LOGS/$NAME.err" &
  PIDS+=($!)
done
for ((i = 1; i <= N_CODEX; i++)); do
  NAME="codex-$i"
  echo "[debate] launching $NAME"
  codex exec --skip-git-repo-check \
    -c "mcp_servers.chatroom.url=\"$URL\"" \
    -c "mcp_servers.chatroom.tool_timeout_sec=120" \
    ${CODEX_MODEL:+-m "$CODEX_MODEL"} \
    -o "$LOGS/$NAME.out" \
    "$(render_prompt "$NAME" codex)" >"$LOGS/$NAME.log" 2>&1 &
  PIDS+=($!)
done

echo "[debate] room=$ROOM  watch: curl -s http://127.0.0.1:${PORT}/rooms/${ROOM}/transcript"
echo "[debate] logs in $LOGS/"
for pid in "${PIDS[@]}"; do wait "$pid" || echo "[debate] a participant exited non-zero ($pid)"; done

echo
echo "===== TRANSCRIPT ====="
curl -s "http://127.0.0.1:${PORT}/rooms/${ROOM}/transcript"
echo "===== PARTICIPANT FINAL ANSWERS ====="
for f in "$LOGS"/*.out; do echo "--- $(basename "$f" .out)"; cat "$f"; echo; done
