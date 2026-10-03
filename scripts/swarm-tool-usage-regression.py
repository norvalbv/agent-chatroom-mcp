#!/usr/bin/env python3
"""Exercise measurement using independent mixed-provider log fixtures."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys
import subprocess

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("usage", Path(__file__).with_name("swarm-tool-usage.py"))
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


class UsageTests(unittest.TestCase):
    def test_cold_start_uses_first_request_not_aggregate_or_final_block(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            events = [{"type": "system", "subtype": "init"}]
            for name, read in (("first", 0), ("later", 200), ("first", 0)):
                events.append({"type": "assistant", "message": {"id": name, "usage": {
                    "input_tokens": 10, "cache_read_input_tokens": read,
                    "cache_creation_input_tokens": 50, "output_tokens": 7}, "content": []}})
            (root / "seat.events.jsonl").write_text("\n".join(map(json.dumps, events)))
            report = usage.analyze(root)
            audit = report["seats"]["seat"]["request_cache"][0]
            self.assertEqual(audit["status"], "cold")
            self.assertEqual(audit["provider_requests"], 2)
            self.assertEqual(audit["first_request"]["cache_read_input_tokens"], 0)
            self.assertEqual(audit["later_requests"]["cache_read_input_tokens"], 200)
            self.assertEqual(report["cold_start"]["status"], "cold")
            result = subprocess.run([sys.executable, str(Path(usage.__file__)), "--run-dir", str(root),
                                     "--require-cold", "--expected-seats", "1"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertTrue(json.loads(result.stdout)["cold_start"]["coverage_complete"])
            self.assertEqual(usage.analyze(root, expected_seats=2)["cold_start"]["status"], "unknown")
            (root / "missing.usage.json").write_text(json.dumps({"input_tokens": 20, "cache_read_input_tokens": 0}))
            self.assertEqual(usage.analyze(root)["cold_start"]["status"], "unknown")

    def test_cold_start_rejects_warm_missing_and_incomplete_evidence(self):
        for read, initial, expected in ((1, True, "warm"), (None, True, "unknown"),
                                        (0, False, "unknown"), (True, True, "unknown")):
            with self.subTest(read=read, initial=initial), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                fields = {"input_tokens": 100}
                if read is not None:
                    fields["cache_read_input_tokens"] = read
                events = [{"type": "system", "subtype": "init"}] if initial else []
                events += [{"type": "assistant", "message": {"id": "first", "usage": fields}}]
                (root / "seat.events.jsonl").write_text("\n".join(map(json.dumps, events)))
                result = subprocess.run([sys.executable, str(Path(usage.__file__)), "--run-dir", str(root),
                                         "--require-cold-start"], capture_output=True, text=True)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(json.loads(result.stdout)["cold_start"]["status"], expected)

    def test_sidecar_alone_and_empty_run_cannot_prove_cold_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(usage.analyze(root)["cold_start"]["status"], "unknown")
            (root / "seat.usage.json").write_text(json.dumps({"input_tokens": 100, "cache_read_input_tokens": 0}))
            self.assertEqual(usage.analyze(root)["cold_start"]["status"], "unknown")

    def test_missing_first_usage_is_not_replaced_by_later_cold_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            events = [{"type": "user", "parentUuid": None, "message": {"content": "brief"}},
                      {"type": "assistant", "message": {"id": "first", "content": []}},
                      {"type": "assistant", "message": {"id": "later", "usage": {"cache_read_input_tokens": 0}}}]
            (root / "seat.events.jsonl").write_text("\n".join(map(json.dumps, events)))
            report = usage.analyze(root)
            self.assertEqual(report["cold_start"]["status"], "unknown")
            self.assertEqual(report["seats"]["seat"]["request_cache"][0]["first_request_id"], "first")
            del events[1]["message"]["id"]
            (root / "seat.events.jsonl").write_text("\n".join(map(json.dumps, events)))
            self.assertEqual(usage.analyze(root)["cold_start"]["status"], "unknown")

    def test_codex_non_mcp_tools_count_even_when_result_text_is_not_logged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "seat.events.jsonl"
            kinds = ["web_search", "file_change", "collab_tool_call", "todo_list", "webSearch", "fileChange", "collabAgentToolCall"]
            path.write_text("\n".join(json.dumps({"type": "item.completed", "item": {"id": str(i), "type": kind}})
                                       for i, kind in enumerate(kinds)))
            report = usage.analyze(Path(directory))
            self.assertEqual(report["seats"]["seat"]["tool_calls"], 7)
            self.assertEqual(report["seats"]["seat"]["hub_tool_calls"], 0)
            self.assertEqual(report["tools"]["other:web_search"]["results"], 0)

    def test_wait_timeouts_exclude_pending_asks_and_explicit_polls(self):
        quiet = json.dumps({"room_state": "open", "messages": [], "addressed_to_you": []})
        wait = {"tool": "wait_for_messages", "hub": True, "text": quiet, "args": {}, "duration_ms": 55001}
        focused = {**wait, "text": json.dumps({"room_state": "open", "messages": [], "addressed_to_you": [{"id": "ask"}]})}
        poll = {**wait, "args": {"timeout_ms": 0}, "duration_ms": 1}
        _, result = usage.summarize_calls([wait, focused, poll])
        self.assertEqual(result["no_message_wait_returns"], 2)
        self.assertEqual(result["no_message_wait_timeout_returns"], 1)
        self.assertEqual(result["no_message_wait_timeout_text_bytes"], len(quiet))

    def test_same_tool_name_outside_chatroom_is_not_a_hub_call(self):
        tools, _ = usage.summarize_calls([
            {"tool": "board_get", "hub": True, "text": "yes", "args": {}},
            {"tool": "board_get", "hub": False, "text": "unknown tool", "args": {}},
        ])
        self.assertEqual(tools["board_get"]["calls"], 1)
        self.assertEqual(tools["other:board_get"]["calls"], 1)

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
