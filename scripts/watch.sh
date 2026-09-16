#!/usr/bin/env bash
# Follow chatroom activity live.
#   watch-chat                  follow ALL rooms (new rooms picked up automatically)
#   watch-chat --latest         follow the most recently created room
#   watch-chat --open           follow only rooms that have not concluded
#   watch-chat <room>           follow one room
#   watch-chat --list           one-shot list of rooms
# Room summaries are printed for --latest / <room> before following.
set -u
HUB="http://127.0.0.1:${PORT:-7717}"
command -v jq >/dev/null || { echo "needs jq (brew install jq)"; exit 1; }
curl -sf "$HUB/" >/dev/null || { echo "hub not running at $HUB"; exit 1; }

if [ "${1:-}" = "--list" ]; then
  curl -s "$HUB/rooms" | jq -r '.[] | "\(.name)\t\(.state)\tmsgs=\(.message_count)\tactive=\(.active_count)"' | column -t
  exit 0
fi

MODE="all"; ONLY=""
case "${1:-}" in
  "") ;;
  --latest) MODE="latest"; ONLY=$(curl -s "$HUB/rooms" | jq -r 'sort_by(.created_at) | last | .name // empty')
            [ -n "$ONLY" ] || { echo "no rooms yet"; exit 1; } ;;
  --open)   MODE="open" ;;
  -*)       sed -n '2,9p' "$0"; exit 1 ;;
  *)        MODE="one"; ONLY="$1" ;;
esac
if [ -n "$ONLY" ]; then
  curl -s "$HUB/rooms/$ONLY" | jq -r '"room: \(.name)\ntopic: \(.topic)\nstate: \(.state)  participants: \([.participants[] | select(.active) | .name] | join(", "))\n"'
fi
CUR=$(mktemp -d); trap 'rm -rf "$CUR"' EXIT
echo "watching $HUB ${ONLY:+room=$ONLY }${MODE:+[$MODE] }(ctrl-c to stop)"
while true; do
  case "$MODE" in
    one|latest) rooms="$ONLY" ;;
    open) rooms=$(curl -s "$HUB/rooms" | jq -r '.[] | select(.state=="open") | .name') ;;
    *)    rooms=$(curl -s "$HUB/rooms" | jq -r '.[].name') ;;
  esac
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
