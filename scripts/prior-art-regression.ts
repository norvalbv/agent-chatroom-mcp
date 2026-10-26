/** Prior art in the work ledger and in run-metrics: npx tsx scripts/prior-art-regression.ts (PORT= pins the throwaway hub)
 * In swarm-164210-9f66 no seat looked for existing code for 23 minutes on a task with 41 public clones, the owner handed
 * the room two repos at 20 min, a scout cloned 40 repos inside one shell loop, and nothing was ever run (inputs/owner-2,
 * evidence/research-depth). The hub could not show any of it: a web call to the target's own API and a search of GitHub
 * were both just "web", every `git clone` was web even of the room's own checkout, and a long command reached the log
 * only as 120 characters and a hash, so the loop's clones left no trace. Now the hub tags each local step as a prior-art
 * search, a fetch of outside code, or a run of it, from the whole detail the seat sent, and run-metrics gives minutes to
 * each and the outside references handed in against those the seats found. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { workClass } from "../src/hub/work.ts";
import { priorArt } from "../src/telemetry/prior-art.ts";
import { renderMetrics, runMetrics } from "../src/run-metrics.ts";
import { HEARTBEAT_HOOK, seatBeat } from "../src/env.ts";

const tag = (tool: string, detail: string, clones = new Set<string>()) => priorArt(workClass(tool, detail)!, tool, detail, clones);

test("a local clone is not a web call; a remote one is", () => {
  assert.equal(workClass("Bash", "rm -rf /tmp/c && git clone -q . /tmp/c && cd /tmp/c && npm test"), "run");
  assert.equal(workClass("Bash", 'git clone -q --no-checkout "$PWD" /tmp/s5-reh/build'), "run");
  assert.equal(workClass("Bash", "git clone --depth 1 https://github.com/a/b /tmp/x"), "web");
  assert.equal(workClass("Bash", "gh repo clone alibaba/open-code-review ocr -- --depth 1"), "web");
});

test("searching for code, packages or papers is prior art; the target's own data is not", () => {
  assert.equal(tag("WebSearch", "polymarket 5 minute bot github"), "search");
  assert.equal(tag("WebSearch", "Polymarket taker rebate program tiers"), undefined);
  assert.equal(tag("WebFetch", "https://docs.polymarket.com/programs/taker-rebates.md"), undefined);
  assert.equal(tag("Bash", "curl -s https://gamma-api.polymarket.com/markets?slug=btc"), undefined);
  assert.equal(tag("Bash", 'curl -s "https://api.github.com/search/repositories?q=polymarket+bot"'), "search");
  assert.equal(tag("WebFetch", "https://export.arxiv.org/api/query?search_query=all:agents"), "search");
  assert.equal(tag("WebFetch", "https://github.com/jmazzini/5m-poly-bot"), "search");
  assert.equal(tag("Bash", "curl -sL https://raw.githubusercontent.com/a/b/main/bot.py -o /tmp/s/bot.py"), "fetch");
});

test("the gh CLI's own search and the paper mirrors are prior-art searches", () => {
  // review/d9dfa21f: 7 work events across the records start with `gh search`, and alphaxiv, hyper.ai and Hugging Face
  // papers carry arXiv papers (review/024099de)
  assert.equal(tag("Bash", "gh search repos polymarket bot --limit 30 --json fullName,stargazersCount"), "search");
  assert.equal(tag("Bash", "gh search code 'py_clob_client' --language python"), "search");
  assert.equal(tag("Bash", "gh api 'search/repositories?q=polymarket+5m+bot&sort=stars'"), "search");
  assert.equal(tag("Bash", "gh api repos/a/b/pulls"), undefined);
  assert.equal(tag("WebFetch", "https://www.alphaxiv.org/abs/2409.07440"), "search");
  assert.equal(tag("WebFetch", "https://hyper.ai/en/papers/2409.07440"), "search");
  assert.equal(tag("WebFetch", "https://hyper.ai/en/news/123"), undefined);
});

test("fetching outside code, then running it, are told apart from running your own code over it", () => {
  const clones = new Set<string>();
  assert.equal(tag("Bash", "git clone -q --depth 1 https://github.com/a/bot /tmp/s/bot", clones), "fetch");
  assert.equal(tag("Bash", "cd /tmp/s/bot && python3 main.py --paper", clones), "run");
  assert.equal(tag("Bash", "/tmp/venv/bin/python /tmp/s/bot/src/run.py --dry", clones), "run");
  assert.equal(tag("Bash", "cd /tmp/s/bot && cat README.md | head", clones), undefined);
  assert.equal(tag("Bash", "python3 -I /tmp/s/tools/scan.py /tmp/s/bot", clones), undefined, "own scanner over the clone");
  assert.equal(tag("Bash", "python3 analyse.py", clones), undefined);
  // a loop of clones under one root (9f66's code-scout): the root is remembered, so any repo under it counts
  const loop = new Set<string>();
  assert.equal(tag("Bash", 'UA="scout"; for r in a/b c/d e/f; do git clone -q --depth 1 "https://github.com/$r" "/tmp/code-scout/${r/\\//_}/src" || true; done; ls /tmp/code-scout', loop), "fetch");
  assert.equal(tag("Bash", "cd /tmp/code-scout/c_d/src && npm test", loop), "run");
  assert.equal(tag("Bash", "python3 -I /tmp/code-scout-tools/scan.py /tmp/code-scout", loop), undefined);
  // a relative destination (kvkj-b: gh repo clone alibaba/open-code-review ocr)
  const rel = new Set<string>();
  assert.equal(tag("Bash", "mkdir -p /tmp/b2 && cd /tmp/b2 && gh repo clone alibaba/open-code-review ocr -- --depth 1", rel), "fetch");
  assert.equal(tag("Bash", "cd /tmp/b2/ocr && go run ./cmd/ocr --help", rel), "run");
  assert.equal(tag("Bash", "pip install git+https://github.com/a/b"), "fetch");
  // the room's own checkout cloned locally is never outside code
  const local = new Set<string>();
  assert.equal(tag("Bash", "git clone -q . /tmp/devclone && cd /tmp/devclone && npm test", local), undefined);
  assert.equal(tag("Bash", "cd /tmp/devclone && npm test", local), undefined);
});

const T0 = Date.parse("2026-10-25T16:42:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const seat = (id: string, name: string, role = "worker", agent = "claude") => ({ type: "join", room: "r", p: { id, name, role, agent, joinedAt: at(0) } });
const work = (pid: string, min: number, cls: string, tool: string, target: string, prior?: string) => ({ type: "work", room: "r", pid, cls, tool, target, ts: at(min), ...(prior ? { prior } : {}) });
const board = (key: string, by: string, min: number, text: string) => ({ type: "board", room: "r", key, entry: { text, by, updatedAt: at(min) } });

test("run-metrics: minutes to the first prior-art search, fetch and run, and handed against found", () => {
  const events = [
    { type: "room", room: "r", opts: { topic: "Reverse-engineer the bot; see arXiv:2409.07440" }, createdAt: at(0) },
    seat("p_a", "alice"), seat("p_b", "bob"), seat("p_c", "chair-claude", "chair"),
    work("p_a", 2, "web", "WebFetch", "docs.polymarket.com/programs/taker-rebates.md"),
    board("resource/jmazzini-5m-poly-bot", "chair-claude", 20, "Benji found https://github.com/jmazzini/5m-poly-bot"),
    work("p_b", 23.5, "web", "Bash", "api.github.com/search/repositories?q=$q&sort=update", "search"),
    work("p_b", 24, "web", "Bash", "github.com/nev3r1ess/polymarket5-15min-bot", "fetch"),
    board("evidence/code-sweep", "bob", 36, "1 github.com/nev3r1ess/polymarket5-15min-bot | 3; 2 github.com/jmazzini/5m-poly-bot | 0; also arXiv:2508.18993"),
    work("p_a", 40, "run", "Bash", "cd /tmp/s/polymarket5-15min-bot && cargo run -- --paper", "run"),
  ];
  const m = runMetrics(events);
  assert.equal(m.minutesTo.firstPriorArt, 23.5);
  assert.equal(m.minutesTo.firstCodeFetch, 24);
  assert.equal(m.minutesTo.firstThirdPartyRun, 40);
  assert.deepEqual(m.research?.handed, ["arXiv:2409.07440", "gh:jmazzini/5m-poly-bot"]);
  assert.deepEqual(m.research?.found, ["gh:nev3r1ess/polymarket5-15min-bot", "arXiv:2508.18993"]);
  assert.deepEqual(m.research?.foundBy, { bob: 2 });
  assert.equal(m.research?.steps.search, 1);
  const text = renderMetrics(m);
  assert.match(text, /prior art: first search 23\.5 min, first fetch from a code host 24 min, first outside code run 40 min; outside references 2 handed in, 2 found by seats/);
});

test("run-metrics: a log from before the tags is classified from its stored targets; none at all is said", () => {
  const events = [
    { type: "room", room: "r", opts: { topic: "x" }, createdAt: at(0) },
    seat("p_a", "alice"),
    work("p_a", 1.9, "web", "WebFetch", "polymtradebot.com"),
    work("p_a", 26.1, "web", "WebSearch", '"TRADE_SCALE" polymarket bot github'),
  ];
  const m = runMetrics(events);
  assert.equal(m.minutesTo.firstPriorArt, 26.1);
  // kvkj-b's clone was logged as run, before gh repo clone was web; its later run inside the clone still counts
  const old = runMetrics([
    { type: "room", room: "r", opts: {}, createdAt: at(0) }, seat("p_a", "alice"),
    work("p_a", 1.2, "run", "Bash", "mkdir -p /tmp/b2research && cd /tmp/b2research && (gh repo clone alibaba/open-code-review ocr -- --depth 1 2>&1 | tail -2)"),
    work("p_a", 5, "run", "Bash", "cd /tmp/b2research/ocr && go test ./..."),
  ]);
  assert.equal(old.minutesTo.firstCodeFetch, 1.2);
  assert.equal(old.minutesTo.firstThirdPartyRun, 5);
  assert.equal(m.minutesTo.firstThirdPartyRun, undefined);
  assert.match(renderMetrics(m), /first fetch from a code host never, first outside code run never/);
  const none = runMetrics([{ type: "room", room: "r", opts: {}, createdAt: at(0) }, seat("p_a", "alice"), work("p_a", 1, "web", "WebFetch", "polymtradebot.com")]);
  assert.match(renderMetrics(none), /prior art: no search for existing code, packages or papers/);
});

test("the swarm skill's prior-art bullet names the sentence run-metrics prints and where to read it", () => {
  // the session that launches a room reads the skill, not the code: a renamed measure must fail here, not leave it wrong
  const bullet = readFileSync(new URL("../skills/swarm/SKILL.md", import.meta.url), "utf8").split("\n").find((l) => l.startsWith("- **Prior art first.**"));
  assert.ok(bullet, "skills/swarm/SKILL.md has a Prior art first bullet");
  const printed = renderMetrics(runMetrics([
    { type: "room", room: "r", opts: {}, createdAt: at(0) }, seat("p_a", "alice"),
    work("p_a", 1, "web", "WebFetch", "arxiv.org/abs/2409.07440", "search"),
  ]));
  for (const phrase of ["prior art:", "first fetch from a code host", "first outside code run", "handed in", "found by seats"]) {
    assert.ok(printed.includes(phrase), `run-metrics prints "${phrase}"`);
    assert.ok(bullet.includes(phrase), `the skill names "${phrase}"`);
  }
  assert.ok(existsSync(new URL("../scripts/run-metrics.ts", import.meta.url)) && bullet.includes("scripts/run-metrics.ts"));
  assert.ok(bullet.includes("`--resources`") && bullet.includes("`blocked: <reason>`") && bullet.includes("`needs/<name>`"));
});

test("the hub tags the persisted work event from the whole command, not its 120-character display", async () => {
  const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
  assert.notEqual(PORT, 7717, "never the live hub");
  const DATA = mkdtempSync(join(tmpdir(), "prior-art-"));
  const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(DATA, "spawn"), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: DATA }, stdio: ["ignore", "ignore", "inherit"] });
  try {
    for (let i = 0; ; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); } }
    const beat = seatBeat(`http://127.0.0.1:${PORT}/mcp`, "seat-key-scout");
    const client = new Client({ name: "pa", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(beat.mcpUrl)));
    await client.callTool({ name: "join_room", arguments: { room: "pa", name: "scout", agent: "claude", expected_participants: 0 } });
    const local = (tool_name: string, tool_input: Record<string, string>) => new Promise<void>((done, fail) => {
      const run = spawn(process.execPath, [HEARTBEAT_HOOK], { env: { PATH: process.env.PATH ?? "", ...(beat.env as Record<string, string>) }, stdio: ["pipe", "ignore", "inherit"] });
      run.on("exit", (code) => (code === 0 ? done() : fail(new Error(`heartbeat hook exited ${code}`))));
      run.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name, tool_input }));
    });
    const loop = 'cd /tmp/code-scout/_meta && UA="code-scout/1.0 (read-only research)"; for r in nev3r1ess/polymarket5-15min-bot npcnpc09/polymarket-updown-bot; do git clone -q --depth 1 "https://github.com/$r" "/tmp/code-scout/${r/\\//_}/src"; done';
    assert.ok(loop.length > 120 && loop.length <= 300);
    await local("Bash", { command: loop });
    await local("Bash", { command: "cd /tmp/code-scout/npcnpc09_polymarket-updown-bot/src && python3 bot.py --paper" });
    await local("WebFetch", { url: "https://docs.polymarket.com/quickstart" });
    await client.close();
    const logged = readFileSync(join(DATA, "pa.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "work");
    assert.equal(logged.length, 3);
    assert.equal(logged[0].prior, "fetch", "the loop's clones are a fetch, though the display is cut at 120 characters");
    assert.ok(logged[0].target.length <= 120);
    assert.equal(logged[1].prior, "run");
    assert.equal(logged[2].prior, undefined);
  } finally {
    server.kill();
  }
});
