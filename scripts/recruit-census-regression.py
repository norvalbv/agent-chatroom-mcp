#!/usr/bin/env python3
"""recruit-census.py --rows: one row per recruit (decision/recruit-timing B2, swarm-005940-77tu).

A synthetic run: the chair recruits r1 into its room, r1 writes findings/r1 and a worker cites it; the chair recruits
b1 and b2 into a breakout, b1 writes decision/child that nobody cites and b2 never joins; in a second room a
recruit_spawn event (no announcement line) names s1, recruited by a worker. Each row says what the recruit was for
(kind, requester role), whether it joined, delivered and was cited, and what it cost.
Run: python3 scripts/recruit-census-regression.py
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name("recruit-census.py")


def at(minute):
    return f"2026-10-26T01:{minute:02d}:00.000Z"


def join(room, pid, name, minute, role=None, seat=None):
    p = {"id": pid, "name": name, "agent": "claude", "joinedAt": at(minute), "seatKeyHash": seat or pid}
    if role:
        p["role"] = role
    return {"type": "join", "room": room, "p": p}


def say(room, pid, name, minute, content, kind="chat"):
    frm = {"id": "system", "name": "system"} if kind == "system" else {"id": pid, "name": name}
    return {"type": "message", "msg": {"room": room, "kind": kind, "from": frm, "content": content, "ts": at(minute)}}


def board(room, name, minute, key, text):
    return {"type": "board", "room": room, "key": key, "entry": {"text": text, "by": name, "updatedAt": at(minute)}}


def usage(room, seat, minute, cost):
    return {"type": "usage", "room": room, "seat": seat, "usage": {"requests": 3, "cost_usd": cost, "at": at(minute)}, "ts": at(minute)}


def write(root, room, events):
    (root / f"{room}.jsonl").write_text("\n".join(json.dumps(e) for e in [{"type": "room", "room": room, "opts": {}}] + events) + "\n")


class RecruitRows(unittest.TestCase):
    def run_rows(self, root):
        out = subprocess.run([sys.executable, "-I", str(SCRIPT), str(root), "--rows"], capture_output=True, text=True, check=True).stdout
        rows = {}
        for line in out.splitlines():
            if line.startswith("{"):
                r = json.loads(line)
                rows[r["name"]] = r
        return rows, out

    def test_rows(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            parent, child, other = "swarm-010000-abcd-room", "swarm-010000-abcd-child", "swarm-020000-wxyz-room"
            write(root, parent, [
                join(parent, "p_c", "chair-claude", 0, role="chair"),
                join(parent, "p_w", "worker-1", 0),
                say(parent, "", "", 1, "chair-claude recruited r1 (claude/claude-opus-5-5, area census): read the logs", kind="system"),
                join(parent, "p_r1", "r1", 1, role="recruit", seat="s_r1"),
                board(parent, "r1", 2, "claim/census", "{}"),
                board(parent, "r1", 6, "findings/r1", "87% delivered"),
                usage(parent, "s_r1", 9, 3.5),
                say(parent, "p_w", "worker-1", 8, "per findings/r1 the census holds"),
                say(parent, "", "", 9, "worker-1 recruited r2 (claude/claude-opus-5-5): build it", kind="system"),
                join(parent, "p_r2", "r2", 9, role="recruit"),
                say(parent, "p_r2", "r2", 12, "committed 9534bff5 on my branch"),
                say(parent, "", "", 10, "chair-claude recruited b1, b2 (claude/claude-opus-5-5, into swarm-010000-abcd-child): argue it out", kind="system"),
            ])
            write(root, child, [
                join(child, "p_b1", "b1", 10, role="recruit", seat="s_b1"),
                board(child, "b1", 30, "decision/child", "the answer"),
                usage(child, "s_b1", 31, 12.0),
            ])
            write(root, other, [
                join(other, "p_x", "worker-9", 0),
                {"type": "recruit_spawn", "room": other, "name": "s1", "requested_by": "worker-9", "by_role": "worker", "kind": "in-room", "depth": 1,
                 "agent": "claude", "model": "claude-opus-5-5", "compact_window": 300000, "ts": at(5)},
                join(other, "p_s1", "s1", 5, role="recruit", seat="s_s1"),
                board(other, "s1", 9, "review/abc1234", "holds"),
            ])
            rows, out = self.run_rows(root)

        self.assertEqual(set(rows), {"r1", "r2", "b1", "b2", "s1"}, out)
        r1, b1, b2, s1 = rows["r1"], rows["b1"], rows["b2"], rows["s1"]
        self.assertEqual((r1["kind"], r1["by"], r1["by_role"], r1["area"]), ("in-room", "chair-claude", "chair", "census"))
        self.assertTrue(r1["joined"] and r1["delivered"] and r1["cited"], r1)
        self.assertEqual(r1["first_deliv_min"], 5.0, "claim/* is not a deliverable; findings/r1 at +5 min is")
        self.assertEqual(r1["cost_usd"], 3.5)
        self.assertEqual((b1["kind"], b1["room"]), ("breakout", "swarm-010000-abcd-child"))
        self.assertTrue(b1["delivered"] and not b1["cited"], b1)
        self.assertFalse(b2["joined"], "b2 never joined its breakout")
        self.assertEqual((s1["kind"], s1["by"], s1["by_role"], s1["compact_window"]), ("in-room", "worker-9", "worker", 300000), "read from recruit_spawn")
        self.assertTrue(s1["delivered"], s1)
        self.assertTrue(rows["r2"]["delivered"] and rows["r2"]["commit"], "a commit named in chat is a deliverable")
        self.assertEqual(rows["r2"]["first_deliv_min"], 3.0)
        self.assertIn("recruits by kind", out)
        self.assertRegex(out, r"in-room\s+3 .*delivered 3", "summary counts r1, r2 and s1 as in-room deliveries")


if __name__ == "__main__":
    unittest.main()
