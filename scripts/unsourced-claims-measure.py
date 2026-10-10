"""How often a room's first proposal opened while a claim owner still in the room had findings on the board but no
outside source in anything they wrote: an http(s) URL to a non-local host, an arXiv id or a DOI (swarm-000525-jcz8,
idea/sourcer-seat revised). Past logs carry no work ledger, so "made no web call" cannot be replayed; this counts the
board side only. Also: of those owners, how many added an outside source later in the room.
Run: python3 scripts/unsourced-claims-measure.py [data dir] [--research-only]"""
import glob, json, re, sys
args = [a for a in sys.argv[1:] if not a.startswith("--")]
D = args[0] if args else "data"
RESEARCH = "--research-only" in sys.argv
SOURCE = re.compile(r"https?://(?!127\.0\.0\.1|localhost|\[::1\])[^\s\"')]+|arXiv:\s?\d{4}\.\d{4,5}|\b\d{4}\.\d{4,5}\b|10\.\d{4,}/\S+", re.I)
NOT_FINDINGS = re.compile(r"^(claim|draft|inbox|hold)/")
R = re.compile(r"research|investigat|brainstorm|survey|red-team", re.I)
B = re.compile(r"\bbuild|implement|fix\b", re.I)
rooms = hit = owners_n = unsourced_n = later = 0
for f in sorted(glob.glob(D + "/swarm-*.jsonl")):
    claims, wrote, sourced, active, proposed, flagged, topic = {}, set(), set(), set(), False, set(), ""
    for line in open(f):
        try: d = json.loads(line)
        except ValueError: continue
        t = d.get("type")
        if t == "room": topic = d["opts"].get("topic", "")
        elif t == "join": active.add(d["p"]["name"])
        elif t == "leave": active.discard(d["p"]["name"])
        elif t == "board" and d.get("entry"):
            by, text = d["entry"].get("by"), d["entry"].get("text") or ""
            if SOURCE.search(text) and not SOURCE.search(topic[:0] or ""): sourced.add(by)
            if d["key"].startswith("claim/"): claims[d["key"]] = by
            elif not NOT_FINDINGS.match(d["key"]): wrote.add(by)
        elif t == "board": claims.pop(d["key"], None)
        elif t == "message" and d["msg"]["kind"] == "chat" and SOURCE.search(d["msg"]["content"]): sourced.add(d["msg"]["from"]["name"])
        elif t == "proposal" and not proposed:
            if RESEARCH and not (R.search(topic) and not B.search(topic)): proposed = None; break
            proposed = True
            owners = {by for by in claims.values() if by in active and by in wrote}
            flagged = owners - sourced
            rooms += 1; owners_n += len(owners); unsourced_n += len(flagged); hit += bool(flagged)
    if proposed: later += len(flagged & sourced)
print(f"rooms with a proposal{' (pure research topics)' if RESEARCH else ''}: {rooms}")
print(f"first proposal with >=1 claim owner who had findings but no outside source: {hit} ({100*hit//max(rooms,1)}%)")
print(f"claim owners with findings at first proposal: {owners_n}; with no outside source anywhere (board or chat): {unsourced_n} ({100*unsourced_n//max(owners_n,1)}%)")
print(f"of those, added an outside source later in the room: {later}")
