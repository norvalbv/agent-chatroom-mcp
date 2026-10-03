#!/usr/bin/env python3
"""Adversarial ledger/provider fixtures for the supplementary delivery audit."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("audit", Path(__file__).with_name("delivery-audit.py"))
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def person(name, session=None, agent="claude"):
    return {"id": name, "name": name, "session": session, "agent": agent,
            "joinedAt": "2026-10-03T00:00:00Z", "lastActiveAt": "2026-10-03T00:00:00Z"}


def join(p, seconds=0, kind="join"):
    return {"type": kind, "p": {**p, "lastActiveAt": f"2026-10-03T00:00:{seconds:02}Z"}}


def message(seq, sender, **extra):
    return {"type": "message", "msg": {"seq": seq, "kind": "chat", "from": {"id": sender},
            "content": "body", **extra}}


def claim(key, owner):
    return {"type": "board", "key": "claim/" + key, "entry": {"text": json.dumps({"owner": owner})}}


def call(name, args, result, number):
    return [{"type": "assistant", "message": {"content": [{"type": "tool_use", "id": str(number),
            "name": "mcp__chatroom__" + name, "input": args}]}},
            {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": str(number),
            "content": result if isinstance(result, str) else json.dumps(result)}]}}]


class DeliveryAudit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.a, self.b, self.c = person("a", "s1"), person("b", "s2"), person("c", "s3")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, path, events):
        path.write_text("".join(json.dumps(e) + "\n" for e in events))
        return path

    def room(self, name, events, parent=None):
        return self.write(self.data / (name + ".jsonl"), [{"type": "room", "room": name,
            "createdAt": "2026-10-03T00:00:00Z", "opts": {"parent": parent}}] + events)

    def trace(self, events):
        return self.write(self.root / "trace.jsonl", call("join_room", {"room": "run-room", "name": "a"}, {}, 0) + events)

    def test_actual_delivery_and_message_time_unknown_claims(self):
        self.room("run-room", [join(self.a), join(self.b), join(self.c), join(person("h", "h", "human")),
            message(1, "b"), claim("a", "a"), claim("b", "b"), message(2, "b"),
            message(3, "b", quiet=True), message(4, "h"), message(5, "a"), message(6, "b"),
            message(7, "b", mentions=["a"]), message(8, "b"),
            {"type": "board", "key": "claim/b", "entry": None}, message(9, "b")])
        trace = self.trace(call("read_messages", {"room": "run-room"}, ["#1 b: body", "#2 b: body", "#3 b: quiet", "#4 h: human", "#5 a: self"], 1)
            + call("send_message", {"room": "run-room"}, 'Refused\n{"unread":["#2 b: body","#7 b: addressed","#8 b: [shown to you mid-turn; still owed]","#9 b: body"]}', 2)
            + [{"type": "user", "message": {"content": "[Chatroom run-room, from b, reply_to=m]\n#2 b: body"}}])
        result = AUDIT.audit(self.data, "run", [trace])
        a = next(s for s in result["seats"] if s["seat"] == "a")
        self.assertEqual(a["observed"]["public_peer_delivery_occurrences"], 6)
        self.assertEqual(a["observed"]["unique_public_peer_messages"], 4)
        self.assertEqual(a["observed"]["unique_public_background_messages"], 3)
        self.assertEqual(a["observed"]["cross_claim_lower_bound"], 2)
        self.assertEqual(a["observed"]["unknown_claim_attribution"], 2)
        self.assertIsNone(a["cross_claim_reads"])
        self.assertEqual(a["traces"][0]["stubs"], 1)
        self.assertEqual(result["coverage"]["seats_with_traces"], 1)
        self.assertIsNone(next(s for s in result["seats"] if s["seat"] == "b")["observed"])
        self.assertNotIn("s1", json.dumps(result))

    def test_arbitrary_room_and_concurrent_connection_formation(self):
        self.room("run-room", [join(self.a), join(self.b), join(person("h", "h", "human"))])
        self.room("unrelated-human-room", [join(person("h", "h", "human")), join(self.c)])
        self.room("arbitrary", [join(self.a, 1), join(person("alias", "s1"), 2),
            join(self.a, 3, "leave"), join(person("alias", "s1"), 4, "leave"),
            join(self.b, 5), join(self.a, 9)])
        result = AUDIT.audit(self.data, "run", [])
        self.assertTrue(result["breakout_formed"])
        self.assertEqual(result["seconds_to_two_session_split"], 9)
        self.assertEqual({r["name"] for r in result["rooms"]}, {"run-room", "arbitrary"})
        self.assertEqual(result["coverage"]["seats_with_traces"], 0)

    def test_ambiguous_owner_unmatched_sequence_and_missing_identity(self):
        self.room("run-room", [join(self.a), join(self.b), join({**self.c, "name": "b"}),
            claim("a", "a"), claim("b", "b"), message(1, "b")])
        self.room("unknown-identities", [join(person("x")), join(person("y"))], parent="run-room")
        trace = self.trace(call("wait_for_messages", {"room": "run-room"}, {"messages": ["#1 b: body", "#99 b: absent"]}, 1))
        result = AUDIT.audit(self.data, "run", [trace])
        self.assertIsNone(result["breakout_formed"])
        a = next(s for s in result["seats"] if s["seat"] == "a")
        self.assertEqual(a["observed"]["unknown_claim_attribution"], 1)
        self.assertEqual(a["observed"]["unmatched_sequence_occurrences"], 1)
        self.assertIsNone(a["cross_claim_reads"])


if __name__ == "__main__":
    unittest.main()
