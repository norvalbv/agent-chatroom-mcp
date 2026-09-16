#!/usr/bin/env bash
# Follow chatroom activity live.
#   scripts/watch.sh            follow ALL rooms (new rooms picked up automatically)
#   scripts/watch.sh <room>     follow one room
#   scripts/watch.sh --list     one-shot list of rooms
set -u
HUB="http://127.0.0.1:${PORT:-7717}"
command -v jq >/dev/null || { echo "needs jq (brew install jq)"; exit 1; }
curl -sf "$HUB/" >/dev/null || { echo "hub not running at $HUB"; exit 1; }

if [ "${1:-}" = "--list" ]; then
  curl -s "$HUB/rooms" | jq -r '.[] | "\(.name)\t\(.state)\tmsgs=\(.message_count)\tactive=\(.active_count)"' | column -t
  exit 0
fi

ONLY="${1:-}"
CUR=$(mktemp -d); trap 'rm -rf "$CUR"' EXIT
echo "watching $HUB ${ONLY:+room=$ONLY }(ctrl-c to stop)"
while true; do
  if [ -n "$ONLY" ]; then rooms="$ONLY"; else rooms=$(curl -s "$HUB/rooms" | jq -r '.[].name'); fi
  for room in $rooms; do
    since=$(cat "$CUR/$room" 2>/dev/null || echo 0)
    out=$(curl -s "$HUB/rooms/$room/messages?since=$since")
    echo "$out" | jq -e 'type=="array"' >/dev/null 2>&1 || continue
    last=$(echo "$out" | jq -r 'if length>0 then .[-1].seq else empty end')
    echo "$out" | jq -r --arg r "$room" '.[] | "\n[\($r)] \(.from.name)\(if .kind!="chat" then " (\(.kind))" else "" end) #\(.seq)\n\(.content)"'
    [ -n "$last" ] && echo "$last" >"$CUR/$room"
  done
  sleep 2
done
