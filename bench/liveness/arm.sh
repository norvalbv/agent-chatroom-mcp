#!/bin/zsh
# usage: bench/liveness/arm.sh <repo dir> <port> <label>
# One arm of the restart A/B: worker 1 is SIGSTOPped right after it claims (alive but silent), the hub is killed by PID
# and restarted on the same data dir, the owner's uxtr line is posted, worker 1 is resumed 240 s later.
export CHATROOM_RECRUIT_AGENT=claude CHATROOM_RECRUIT_MODEL=claude-opus-5-5 DISABLE_PROMPT_CACHING=1
DIR="$1"; PORT="$2"; LABEL="$3"; OUT=${O2_AB:-/tmp/o2-ab}/$LABEL; mkdir -p $OUT
BRIEF="$(cat "$(dirname "$0")/brief.txt")"
cd "$DIR"
BEFORE=" $(ls data 2>/dev/null | sed -n 's/\.jsonl$//p' | tr '\n' ' ') "
CHATROOM_INSECURE_LOCAL=1 nohup node dist/swarm.js "$BRIEF" --flat --agents 3 --models claude-opus-5-5 --verifier-model claude-opus-5-5 --timeout 12 --port $PORT > $OUT/swarm.log 2>&1 &
SWPID=$!
echo "start $(date -u +%T) swarm=$SWPID" > $OUT/events
ROOM=""
for i in {1..120}; do
  ROOM=$(curl -s localhost:$PORT/rooms 2>/dev/null | BEFORE="$BEFORE" python3 -c "import json,sys,os
try:
  d=json.load(sys.stdin); rs=d if isinstance(d,list) else d.get('rooms',[]); print([r['name'] for r in rs if r['name'].endswith('-room') and (' '+r['name']+' ') not in os.environ['BEFORE']][-1])
except Exception: pass" 2>/dev/null)
  [[ -n "$ROOM" ]] && break; sleep 2
done
echo "room $ROOM" >> $OUT/events
RUN=${ROOM%-room}
# wait for any claim, then stop the claimant
CLAIMANT=""
for i in {1..180}; do
  CLAIMANT=$(curl -s localhost:$PORT/rooms/$ROOM | python3 -c "import json,sys
d=json.load(sys.stdin); b=d.get('board',{})
for k in ('claim/part-a','claim/part-b'):
  e=b.get(k)
  if e and e.get('by','').startswith('claude-opus'): print(e['by']); break" 2>/dev/null)
  [[ -n "$CLAIMANT" ]] && break; sleep 1
done
[[ -z "$CLAIMANT" ]] && { echo "no claimant" >> $OUT/events; }
SEATPID=$(ps -eo pid,command | grep -v grep | grep "claude -p" | grep -F "$RUN/$CLAIMANT.mcp.json" | awk '{print $1}' | head -1)
[[ -z "$SEATPID" ]] && { echo "no seat pid" >> $OUT/events; kill $SWPID; exit 1; }
kill -STOP $SEATPID
echo "stopped $(date -u +%T) $CLAIMANT pid=$SEATPID" >> $OUT/events
sleep 5
HUBPID=$(lsof -ti:$PORT -sTCP:LISTEN)
kill $HUBPID; sleep 2
CHATROOM_INSECURE_LOCAL=1 PORT=$PORT CHATROOM_DATA_DIR="$DIR/data" nohup node dist/index.js > $OUT/hub2.log 2>&1 &
for i in {1..50}; do curl -s localhost:$PORT/ >/dev/null && break; sleep 0.2; done
echo "restarted $(date -u +%T) oldhub=$HUBPID" >> $OUT/events
curl -s -X POST localhost:$PORT/rooms/$ROOM/messages -H 'content-type: application/json' -d '{"name":"benji","content":"@all sorry for the room restart - if you don'"'"'t see all the agents rejoin, please re-recruit."}' > /dev/null
sleep 240
kill -CONT $SEATPID
echo "resumed $(date -u +%T)" >> $OUT/events
for i in {1..300}; do
  ST=$(curl -s localhost:$PORT/rooms/$ROOM | python3 -c "import json,sys; print(json.load(sys.stdin).get('state'))" 2>/dev/null)
  [[ "$ST" == "concluded" || "$ST" == "closed" ]] && break
  kill -0 $SWPID 2>/dev/null || break
  sleep 3
done
echo "end $(date -u +%T) state=$ST" >> $OUT/events
curl -s localhost:$PORT/rooms/$ROOM > $OUT/room.json
curl -s localhost:$PORT/agents > $OUT/agents.json
cp "$DIR/data/$ROOM.jsonl" $OUT/ 2>/dev/null
# stop recruits this hub launched, then the hub, by PID
for p in $(python3 -c "import json; [print(a.get('pid','')) for a in json.load(open('$OUT/agents.json')) if a.get('running')]" 2>/dev/null); do kill $p 2>/dev/null; done
kill $(lsof -ti:$PORT -sTCP:LISTEN) 2>/dev/null
# the launcher and the resumed seat outlive the hub; stop them by their recorded PIDs
kill $SWPID $SEATPID 2>/dev/null
echo "done $(date -u +%T)" >> $OUT/events
