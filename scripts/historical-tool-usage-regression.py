#!/usr/bin/env python3
"""Verify census boundaries and privacy on a synthetic append-only ledger."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
script = Path(__file__).with_name("historical-tool-usage.py")
spec = importlib.util.spec_from_file_location("history", script)
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


class HistoricalUsageTests(unittest.TestCase):
    def write_room(self, root, name, telemetry=1, created="2026-01-01T00:00:00.000Z"):
        meta = {"type": "room", "room": name, "createdAt": created}
        if telemetry is not None:
            meta["telemetryVersion"] = telemetry
        participant = {"id": "private-id", "session": "private-session", "name": "builder", "agent": "codex"}
        events = [meta, {"type": "join", "p": participant},
                  {"type": "call_completion", "tool": "request_agent", "outcome": "hub_refusal", "participant": "private-id", "ts": created},
                  {"type": "call_completion", "tool": "request_agent", "outcome": "success", "participant": "private-id", "ts": created},
                  {"type": "call_completion", "tool": "kick_vote", "outcome": "success", "participant": None, "ts": created},
                  {"type": "message", "msg": {"kind": "chat", "content": "sensitive-body", "from": participant}}]
        (root / (name + ".jsonl")).write_text("\n".join(map(json.dumps, events)) + "\n")

    def test_scope_outcomes_and_private_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_room(root, "swarm-120000-good-room")
            self.write_room(root, "swarm-120001-old-room", telemetry=None)
            self.write_room(root, "swarm-120002-future-room", created="2027-01-01T00:00:00.000Z")
            self.write_room(root, "swarm-120000-good-child")
            self.write_room(root, "swarm-bench-room")
            result = history.census(root, "2026-10-03T20:28:03.762Z")
            self.assertEqual(result["coverage"], {"observed_main_rooms": 1, "excluded_without_telemetry": 1})
            self.assertEqual(result["aggregate"]["calls"], 3)
            self.assertEqual(result["aggregate"]["tools"]["request_agent"],
                             {"calls": 2, "success": 1, "hub_refusal": 1, "error": 0, "rooms_used": 1, "rooms_with_success": 1})
            self.assertEqual(result["rooms"][0]["unattributed_calls"], 1)
            self.assertEqual(result["rooms"][0]["seats"][0]["calls"], 2)
            self.assertNotIn("list_rooms", result["aggregate"]["tools"])
            self.assertTrue(result["method"]["list_rooms"].startswith("unknown:"))
            encoded = json.dumps(result)
            for secret in ("private-id", "private-session", "sensitive-body"):
                self.assertNotIn(secret, encoded)

    def test_rejects_nonexistent_corpus(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(script), "--data-dir", str(Path(directory) / "missing"),
                                     "--before", "2026-01-01T00:00:00.000Z"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn("existing directory", result.stderr)


if __name__ == "__main__":
    unittest.main()
