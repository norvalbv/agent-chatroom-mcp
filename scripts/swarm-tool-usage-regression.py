#!/usr/bin/env python3
"""Exercise measurement using independent mixed-provider log fixtures."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("usage", Path(__file__).with_name("swarm-tool-usage.py"))
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


class UsageTests(unittest.TestCase):
    def test_discovery_reads_initial_worker_or_verifier_prompt_only(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "project"
            project.mkdir()
            for name, prompt in (("worker", 'You are worker in MCP room `target-room`'),
                                 ("verifier", 'Protocol: `join_room` room="target-room", name="verifier"'),
                                 ("other", 'You are worker in MCP room `other-room`; prior target-room')):
                (project / (name + ".jsonl")).write_text(json.dumps({"type": "user", "message": {"content": prompt}}))
            self.assertEqual({p.stem for p in usage.discover_claude(Path(directory), "target-room")}, {"worker", "verifier"})

    def test_codex_pairs_events_once_and_keeps_missing_usage_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = {"id": "item_1", "type": "mcp_tool_call", "server": "chatroom", "tool": "wait_for_messages", "arguments": {"room": "r"}}
            done = {**item, "result": {"content": [{"type": "text", "text": "é"}]}}
            events = [{"type": "turn.started"}, {"type": "item.started", "item": item},
                      {"type": "item.completed", "item": done}, {"type": "item.completed", "item": done},
                      {"type": "turn.started"}, {"type": "item.started", "item": item}]
            (root / "a.events.jsonl").write_text("\n".join(map(json.dumps, events)) + '\n{"partial":')
            (root / "b.usage.json").write_text(json.dumps({"codex_usage": {"input_tokens": 100, "cached_input_tokens": 80, "output_tokens": 7}}))
            report = usage.analyze(root)
            self.assertEqual(report["tools"]["wait_for_messages"]["calls"], 2)
            self.assertEqual(report["tools"]["wait_for_messages"]["results"], 1)
            self.assertEqual(report["observed_totals"]["hub_text_bytes"], 2)
            self.assertIsNone(report["seats"]["a"]["usage"])
            self.assertIsNone(report["seats"]["b"]["tool_calls"])
            self.assertEqual(report["coverage"], {"seats": 2, "seats_with_trace": 1, "seats_with_usage": 1})

    def test_claude_deduplicates_blocks_and_sidecar_supersedes_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            join = {"type": "tool_use", "id": "join", "name": "mcp__chatroom__join_room", "input": {"room": "r", "name": "builder"}}
            assistant = {"type": "assistant", "message": {"id": "msg", "usage": {"input_tokens": 9, "output_tokens": 3}, "content": [join]}}
            result = {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "join", "content": [{"type": "text", "text": "ok"}]}]}}
            path = root / "transcript.jsonl"
            path.write_text("\n".join(map(json.dumps, [assistant, assistant, result, result])))
            report = usage.analyze(root, [path, path])
            self.assertEqual(report["seats"]["builder"]["tool_calls"], 1)
            self.assertEqual(report["seats"]["builder"]["usage"]["input_tokens"], 9)
            self.assertNotIn("cache_read_input_tokens", report["seats"]["builder"]["usage"])
            (root / "builder.usage.json").write_text(json.dumps({"input_tokens": 20, "output_tokens": 8}))
            report = usage.analyze(root, [path])
            self.assertEqual(report["seats"]["builder"]["usage"]["input_tokens"], 20)
            self.assertEqual(report["observed_totals"]["hub_text_bytes"], 2)

    def test_repeated_deliveries_respect_rooms_and_refused_send_retries(self):
        message = "#3 peer: hello"
        def call(tool, text, room="r", **args):
            return {"tool": tool, "hub": True, "text": text, "args": {"room": room, **args}}
        calls = [call("wait_for_messages", json.dumps({"messages": [message]})),
                 call("read_messages", json.dumps([message])),
                 call("send_message", '1 message(s) arrived while you were composing.\n' + json.dumps({"unread": [message]}), content="answer"),
                 call("send_message", '{"sent":"#4 builder: answer"}', content="answer", force=True),
                 call("read_messages", json.dumps([message]), room="different")]
        _, result = usage.summarize_calls(calls)
        self.assertEqual(result["read_messages_after_wait"], 1)
        self.assertEqual(result["repeated_message_deliveries"], 2)
        self.assertEqual(result["repeated_message_text_bytes"], 2 * len(message))
        self.assertEqual(result["unread_send_refusals"], 1)
        self.assertEqual(result["same_content_send_retries"], 1)


if __name__ == "__main__":
    unittest.main()
