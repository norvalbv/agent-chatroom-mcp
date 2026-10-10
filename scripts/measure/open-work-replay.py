"""Replay past room logs against PR1's open-work rules (src/hub/open-work.ts @ d1cb706c): at each pure-idle wait, what
would the idle hint have named?

  python3 scripts/measure/open-work-replay.py <data dir> [--examples N]

"Pure idle" is the definition of idle-waits-by-phase.py: a wait_for_messages completing 50-60 s after the same seat's
previous wait_for_messages, with no other hub call between. A run is a maximal chain of those; long = 5+ minutes.
The room is rebuilt from the log in file order (board, who is active, chat, proposal, votes) and openWork() is applied
at the first wait of each run (its START) and at every later wait in it.

Approximations, all stated in the output too:
 A1 own_claim_empty is gated in the hub on idleAgain() (no local-tool heartbeat between two idle waits). Old logs hold
    no heartbeats, so every pure-idle wait is taken as idle=true: an upper bound for that kind.
 A2 "owes nothing" (the hub only names work when its hint would be IDLE_HINT) is approximated: the seat owes a vote when
    a proposal is open and it has no vote since the last amend (the hub keeps agrees whose quote survived an amend, so
    this over-excludes); it owes an answer when a peer chat message @-mentions it after its last successful
    send_message/pass. Human asks, openings held and the talk-share line are not replayed. Numbers are printed both
    with this gate ("gated") and without it ("ungated").
 A3 A departed owner's last-seen time is lastActiveAt in its leave event (the hub also uses the working heartbeat, which
    old logs lack). The successor rule follows replacedBy from leave events and replacementOf from join events.
 A4 Events with no timestamp of their own (join, leave) take the time of the previous timestamped line.
 A5 A wait's reply is taken to see the state at the log line of its call_completion.
 A6 reviewed() is replayed as written, on raw names (anonymous labels do not change who wrote what).

"Live" is NOT a PR1 rule; it is this script's check on PR1's precision. An item PR1 would name is counted as already
settled, and so not live, when the claim's own JSON status starts with verified/fixed/merged/done/complete/closed, or
when a seat other than the owner has already reviewed it by PR1's own reviewed() rule (review_owed asks the assigned
reviewer even after another seat wrote verify/<area>; own_claim_empty fires on a claim whose work sits in git and whose
verify/<area> was written by a peer).
"""
import collections
import glob
import json
import re
import sys
from datetime import datetime, timezone

STALE_S = 600
NOT_WORK = ("claim/", "help/", "join-request/", "inbox/", "hold/", "verify/")
NOT_REVIEW = ("claim/", "help/", "join-request/", "inbox/", "hold/", "handoff/", "draft/")
KINDS = ["review_owed", "unreviewed", "claim_orphaned", "own_claim_empty", "help_wanted"]


def T(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def hhmm(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def area(key):
    return key[key.find("/") + 1:]


SETTLED = ("verified", "fixed", "merged", "done", "complete", "closed")


def status_settled(e):
    try:
        return str(json.loads(e["text"]).get("status") or "").strip().lower().startswith(SETTLED)
    except Exception:
        return False


def released(e):
    if e["by"] != "system":
        return False
    try:
        return json.loads(e["text"]).get("status") == "released"
    except Exception:
        return False


class Room:
    def __init__(self):
        self.parts = {}      # id -> participant dict from the log (+ gone: last-seen seconds)
        self.board = {}      # key -> entry
        self.chat = []       # (ts, from name, from agent, from id, content, mentions)
        self.state = "open"
        self.proposal = None  # proposer id while one is open
        self.voted = set()
        self.spoke = {}      # id -> seq-order index of its last successful send_message / pass
        self.words = {}
        self.rev = 0         # bumped on every board write, with len(chat) the key of the reviewed() cache
        self.memo = {}

    def word(self, slug):
        w = self.words.get(slug)
        if w is None:
            w = self.words[slug] = re.compile("(^|[^a-z0-9])" + re.escape(slug) + "([^a-z0-9]|$)", re.I)
        return w

    def departed(self, e):
        """Hub.departedClaimOwner: the most recently seen participant under that name, when all of them are inactive."""
        if e["by"] == "system" or not e["text"].strip():
            return None
        named = [x for x in self.parts.values() if x["name"] == e["by"]]
        if not named or any(x["active"] for x in named):
            return None
        return max(named, key=lambda x: x["gone"])

    def takeover(self, e, p, now, stale_s):
        owner = self.departed(e)
        if not owner:
            return False
        nxt = owner.get("replacedBy")
        seen = set()
        while nxt and nxt not in seen:
            if nxt == p["id"]:
                return True
            seen.add(nxt)
            nxt = (self.parts.get(nxt) or {}).get("replacedBy")
        return now - owner["gone"] >= stale_s

    def owes(self, p):
        """A2: would the hub's hint be something other than IDLE_HINT?"""
        if self.proposal and p["id"] not in self.voted and p["id"] != self.proposal:
            return "vote"
        since = self.spoke.get(p["id"], -1)
        for i in range(len(self.chat) - 1, since, -1):
            m = self.chat[i]
            if p["id"] in m[5] and m[2] not in ("hub",) and m[3] != p["id"]:
                return "ask"
        return None

    def open_work(self, p, now, stale_s):
        """openWork() of src/hub/open-work.ts with idle=true (A1)."""
        if self.state != "open" or p.get("agent") == "human":
            return []
        entries = [(k, e) for k, e in self.board.items() if e["text"].strip()]

        def has_work(name):
            return any(e["by"] == name and not k.startswith(NOT_WORK) for k, e in entries)

        def reviewed(ck, claim, by=None):
            memo_key = (ck, by, self.rev, len(self.chat))
            if memo_key not in self.memo:
                if len(self.memo) > 5000:
                    self.memo.clear()
                self.memo[memo_key] = reviewed_now(ck, claim, by)
            return self.memo[memo_key]

        def reviewed_now(ck, claim, by):
            slug = area(ck)
            word = self.word(slug)
            branch = (claim.get("workspace") or {}).get("branch")

            def mine(name):
                return name != claim["by"] and (by is None or name == by)
            for k, e in entries:
                if mine(e["by"]) and not k.startswith(NOT_REVIEW) and not k.endswith(".partial") and \
                        (area(k) == slug or word.search(e["text"]) or (branch and branch in e["text"])):
                    return True
            since = T(claim["updatedAt"])
            return any(m[2] != "hub" and mine(m[1]) and m[0] >= since and word.search(m[4]) for m in self.chat)

        review, own, orphaned, help_ = [], [], [], []
        for k, e in entries:
            if k.startswith(("help/", "join-request/")):
                if e["by"] != p["name"]:
                    help_.append(("help_wanted", k, e["by"], False))
                continue
            if not k.startswith("claim/") or released(e):
                continue
            if e["by"] == p["name"]:
                if not has_work(p["name"]):
                    own.append(("own_claim_empty", k, p["name"], status_settled(e) or reviewed(k, e)))
                continue
            if self.takeover(e, p, now, stale_s):
                orphaned.append(("claim_orphaned", k, e["by"], status_settled(e)))
                continue
            if not has_work(e["by"]):
                continue
            is_mine = e.get("reviewerId") == p["id"]
            if is_mine and not reviewed(k, e, p["name"]):
                review.append(("review_owed", k, e["by"], status_settled(e) or reviewed(k, e)))
            elif not is_mine and not reviewed(k, e) and (
                    p.get("role") == "verifier" or
                    (e.get("reviewerId") and not (self.parts.get(e["reviewerId"]) or {}).get("active"))):
                review.append(("unreviewed", k, e["by"], status_settled(e)))
        return review + orphaned + own + help_


def load(path):
    out = []
    for line in open(path):
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def idle_marks(events):
    """Line index -> (run id, position) for every wait in a pure-idle chain; position 0 is the run's start."""
    calls = collections.defaultdict(list)
    for i, d in enumerate(events):
        if d.get("type") == "call_completion" and d.get("participant") and d.get("ts"):
            calls[d["participant"]].append((T(d["ts"]), d["tool"], i))
    marks, runs = {}, []
    for pid, cs in calls.items():
        cur = None
        for (a, ta, ia), (b, tb, ib) in zip(cs, cs[1:]):
            if ta == "wait_for_messages" and tb == "wait_for_messages" and 50 <= b - a <= 60:
                if cur is None:
                    cur = {"pid": pid, "start": a, "lines": [ia]}
                    runs.append(cur)
                cur["lines"].append(ib)
                cur["end"] = b
            else:
                cur = None
    for n, r in enumerate(runs):
        for pos, i in enumerate(r["lines"]):
            marks[i] = (n, pos)
    return marks, runs


def replay(path):
    events = load(path)
    marks, runs = idle_marks(events)
    room, now = Room(), 0.0
    for r in runs:
        r["at"] = []  # per wait: (owes, items at 10 min, items at 0)
    for i, d in enumerate(events):
        ty = d.get("type")
        if d.get("ts"):
            now = T(d["ts"])
        if ty == "join":
            p = dict(d["p"])
            p["active"], p["gone"] = True, now
            room.parts[p["id"]] = p
            if p.get("replacementOf") in room.parts:
                room.parts[p["replacementOf"]]["replacedBy"] = p["id"]
        elif ty == "leave":
            p = dict(d["p"])
            p["active"] = False
            p["gone"] = T(p["lastActiveAt"]) if p.get("lastActiveAt") else now
            old = room.parts.get(p["id"]) or {}
            if old.get("replacedBy") and not p.get("replacedBy"):
                p["replacedBy"] = old["replacedBy"]
            room.parts[p["id"]] = p
        elif ty == "board":
            e = d.get("entry")
            room.rev += 1
            if e and e.get("updatedAt"):
                now = T(e["updatedAt"])
            if e and e.get("text", "").strip():
                room.board[d["key"]] = e
            else:
                room.board.pop(d["key"], None)
        elif ty == "message":
            m = d["msg"]
            now = T(m["ts"])
            if m.get("kind") == "chat":
                f = m["from"]
                room.chat.append((now, f.get("name"), f.get("agent"), f.get("id"), m.get("content") or "", m.get("mentions") or []))
        elif ty == "proposal":
            room.proposal = (d["proposal"].get("by") or {}).get("id") or "?"
            room.voted = set()
        elif ty == "amend":
            room.voted = set()
        elif ty == "vote":
            room.voted.add(d.get("pid"))
        elif ty == "state":
            room.state = d.get("state", room.state)
            if room.state != "open":
                room.proposal = None
        elif ty == "call_completion":
            if d.get("outcome") == "success" and d.get("tool") in ("send_message", "pass"):
                room.spoke[d["participant"]] = len(room.chat) - 1
            if i in marks:
                n, _ = marks[i]
                p = room.parts.get(d["participant"])
                if p:
                    runs[n]["at"].append((room.owes(p), room.open_work(p, now, STALE_S), room.open_work(p, now, 0)))
                    runs[n].setdefault("seat", p["name"])
                    runs[n].setdefault("role", p.get("role") or "worker")
                    if len(runs[n]["at"]) == 1:
                        runs[n]["chat_before"] = [(t, nm, c) for t, nm, ag, _, c, _ in room.chat if nm == p["name"]][-2:]
                        runs[n]["room_before"] = [(t, nm, c) for t, nm, ag, _, c, _ in room.chat if ag != "hub"][-3:]
                        runs[n]["state"] = room.state + ("+proposal" if room.proposal else "")
                        runs[n]["claims"] = sum(1 for k in room.board if k.startswith("claim/"))
    name = path.split("/")[-1].replace(".jsonl", "")
    for r in runs:
        r["room"] = name
        # what the seat did next: its first chat line after the run ended
        r["chat_after"] = [(t, nm, c) for t, nm, ag, pid, c, _ in room.chat if pid == r["pid"] and t > r["end"]][:1]
    return [r for r in runs if r["at"]]


def pct(a, b):
    return f"{100 * a / b:.0f}%" if b else "n/a"


def tally(samples, title):
    """samples: (minutes, owes, items10, items0). Prints share non-empty and the split by kind, gated and ungated."""
    tot_n, tot_m = len(samples), sum(s[0] for s in samples)
    print(f"\n{title}: n={tot_n}, {tot_m:.0f} idle min")
    for label, gate in (("ungated", False), ("gated (A2: seat owes no vote/answer)", True)):
        rows = [s for s in samples if not (gate and s[1])]
        n, m = len(rows), sum(s[0] for s in rows)
        if gate:
            print(f"  {label}: {tot_n - n} dropped as owing ({pct(tot_n - n, tot_n)}); shares below are of ALL {tot_n}")
        else:
            print(f"  {label}:")
        for stale, idx in (("stale=10min", 2), ("stale=0", 3)):
            def has(s, pred):
                return any(pred(it[0]) for it in s[idx])
            any_n = sum(1 for s in rows if s[idx])
            any_m = sum(s[0] for s in rows if s[idx])
            ext = lambda k: k != "own_claim_empty"
            ext_n = sum(1 for s in rows if has(s, ext))
            ext_m = sum(s[0] for s in rows if has(s, ext))
            print(f"    {stale:11s} list non-empty: {any_n}/{tot_n} ({pct(any_n, tot_n)}) of n, {any_m:.0f}/{tot_m:.0f} min ({pct(any_m, tot_m)});"
                  f" excluding own_claim_empty (A1): {ext_n} ({pct(ext_n, tot_n)}), {ext_m:.0f} min ({pct(ext_m, tot_m)})")
            parts, live = [], []
            for k in KINDS:
                kn = sum(1 for s in rows if has(s, lambda x: x == k))
                km = sum(s[0] for s in rows if has(s, lambda x: x == k))
                parts.append(f"{k} {kn} ({pct(kn, tot_n)}, {km:.0f} min)")
                ln = sum(1 for s in rows if any(it[0] == k and not it[3] for it in s[idx]))
                live.append(f"{k} {ln}")
            print("      by kind: " + "; ".join(parts))
            lv = [s for s in rows if any(not it[3] for it in s[idx])]
            lx = [s for s in rows if any(not it[3] and it[0] != "own_claim_empty" for it in s[idx])]
            print(f"      LIVE only (item not already settled): {len(lv)} ({pct(len(lv), tot_n)}), {sum(s[0] for s in lv):.0f} min ({pct(sum(s[0] for s in lv), tot_m)});"
                  f" excluding own_claim_empty: {len(lx)} ({pct(len(lx), tot_n)}), {sum(s[0] for s in lx):.0f} min; by kind: " + "; ".join(live))


def show(r, why=True):
    owes, i10, i0 = r["at"][0]
    mins = (r["end"] - r["start"]) / 60
    print(f"  {r['room']}  seat={r['seat']} ({r['role']})  start={hhmm(r['start'])}Z  polled {mins:.1f} min  room={r['state']}  claims on board={r['claims']}  owes={owes}")
    print(f"    named (10 min): {[f"{k}:{key} (by {by}){' [settled]' if st else ''}" for k, key, by, st in i10] or 'nothing'}")
    if i0 != i10:
        print(f"    named (stale=0): {[f"{k}:{key} (by {by}){' [settled]' if st else ''}" for k, key, by, st in i0]}")
    later = sorted({f"{k}:{key}" for _, a, _ in r["at"][1:] for k, key, _, _ in a} - {f"{k}:{key}" for k, key, _, _ in i10})
    if later:
        print(f"    appeared later in the run: {later}")
    if why:
        for t, nm, c in r.get("chat_before", []):
            print(f"    seat said before   {hhmm(t)[11:]} {nm}: {c[:260]!r}")
        for t, nm, c in r.get("room_before", [])[-2:]:
            print(f"    room said before   {hhmm(t)[11:]} {nm}: {c[:200]!r}")
        for t, nm, c in r.get("chat_after", []):
            print(f"    seat said after    {hhmm(t)[11:]} {nm}: {c[:260]!r}")


def main():
    data = sys.argv[1]
    n_ex = int(sys.argv[sys.argv.index("--examples") + 1]) if "--examples" in sys.argv else 5
    runs, files = [], sorted(glob.glob(data + "/swarm-*-room.jsonl"))
    for f in files:
        runs += replay(f)
    long_runs = [r for r in runs if r["end"] - r["start"] >= 300]
    print(f"rooms: {len(files)}; pure-idle runs: {len(runs)}; long (5+ min): {len(long_runs)}, {sum(r['end'] - r['start'] for r in long_runs) / 60:.0f} min")
    print("approximations A1-A6: see the docstring at the top of this file")

    tally([((r["end"] - r["start"]) / 60, *r["at"][0]) for r in long_runs],
          "(1) LONG RUNS, state at the START of the run (minutes = whole run length)")
    tally([((r["end"] - r["start"]) / 60 / (len(r["at"]) - 1), *a) for r in long_runs for a in r["at"][1:]],
          "(1b) LONG RUNS, state at EACH wait inside the run (one sample per ~55 s wait)")
    tally([((r["end"] - r["start"]) / 60 / (len(r["at"]) - 1), *a) for r in runs for a in r["at"][1:]],
          "(4) ALL pure-idle waits, long run or not (one sample per ~55 s wait)")

    # how often the full list would actually have been sent: once per change per seat (newlyNamed), within idle runs
    sent = collections.Counter()
    last = {}
    for r in sorted(runs, key=lambda r: (r["room"], r["start"])):
        for owes, i10, _ in r["at"][1:]:
            if owes:
                continue
            sig = "\n".join(f"{k}:{key}" for k, key, _, _ in i10)
            if last.get((r["room"], r["pid"])) != sig:
                last[(r["room"], r["pid"])] = sig
                if sig:
                    sent["full lists sent"] += 1
                    sent["...in long runs"] += r["end"] - r["start"] >= 300
    print(f"\nnewlyNamed (gated, stale=10min): the full list would have been sent {sent['full lists sent']} times over all idle waits,"
          f" {sent['...in long runs']} of them inside long runs; seats ever shown one: {sum(1 for v in last.values() if v)} of {len(last)} idle seats")
    by_role = collections.Counter()
    for r in long_runs:
        by_role[(r["role"], bool(r["at"][0][1]))] += 1
    print("long runs by role, (role, non-empty at start, ungated): " + ", ".join(f"{k}={v}" for k, v in sorted(by_role.items())))

    print(f"\n(5) EXAMPLES, list non-empty at start (longest run per kind first, then longest overall):")
    hit = sorted([r for r in long_runs if r["at"][0][1] and not r["at"][0][0]], key=lambda r: r["start"] - r["end"])
    picked = []
    for k in KINDS:  # the longest run whose first LIVE item is of this kind
        for r in hit:
            first = [it for it in r["at"][0][1] if not it[3]][:1]
            if r not in picked and first and first[0][0] == k:
                picked.append(r)
                break
    picked += [r for r in hit if r not in picked][:max(0, n_ex - len(picked))]
    for r in picked:
        show(r)
    print("\n(5c) EXAMPLES where everything named was already settled (PR1 would have been noise), longest first:")
    for r in [r for r in hit if all(it[3] for it in r["at"][0][1])][:2]:
        show(r)
    rooms = collections.Counter(r["room"] for r in long_runs)
    live_rooms = collections.Counter(r["room"] for r in long_runs if any(not it[3] for it in r["at"][0][1]))
    print(f"\nconcentration: long runs come from {len(rooms)} of {len(files)} rooms; a live item at start in {len(live_rooms)} rooms; top: "
          + ", ".join(f"{k} {v}/{rooms[k]}" for k, v in live_rooms.most_common(5)))
    print("\n(5) EXAMPLES, list empty for the whole run (both stale windows) and the seat polled 10+ min, longest first:")
    empty = sorted([r for r in long_runs if r["end"] - r["start"] >= 600 and not any(a[1] or a[2] for a in r["at"])],
                   key=lambda r: r["start"] - r["end"])
    print(f"  ({len(empty)} such runs, {sum(r['end'] - r['start'] for r in empty) / 60:.0f} min)")
    for r in empty[:max(2, n_ex - 3)]:
        show(r)


if __name__ == "__main__":
    main()
