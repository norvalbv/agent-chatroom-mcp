/** Offline replay of disagreement adjudication on the retained arm-K STAMP pools (bench/results/rq1-arm-k),
 * the exact-answer counterpart of scripts/adjudication-replay.ts (printf).
 *
 * Arm K picked each group's answer by plurality, so it loses exactly when the correct answer is a minority or
 * tied. Adjudication instead shows a judge the public spec, the program and the group's distinct answers with
 * the tokens they disagree on marked, never how many attempts gave each answer or which attempt gave it. The
 * judge's majority pick (over --repeats votes, option order rotated per vote) is selected; no majority, or a
 * pick outside the group, falls back to the recorded plurality selection. Oracle `passed` fields are read only
 * to score.
 *
 * Verdicts are cached in bench/results/stamp-adjudication-replay/verdicts.json, keyed by task and sorted answer
 * set, so a replay with the cache committed is deterministic and costs nothing.
 *
 *   node --import tsx scripts/stamp-adjudication-replay.ts --stats                 # zero spend
 *   node --import tsx scripts/stamp-adjudication-replay.ts --judge sonnet --repeats 4
 *   node --import tsx scripts/stamp-adjudication-replay.ts                         # replay from the cache
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const POOL = "bench/results/rq1-arm-k";
const OUT = "bench/results/stamp-adjudication-replay";
const VERDICTS = join(OUT, "verdicts.json");
const TASKS = ["stamp-interpreter", "stamp-2"];

const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const judgeModel = opt("judge");
const repeats = Number(opt("repeats") ?? "4");

const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** Token-level LCS alignment of each answer against the first: the positions (in each answer) that are not
 * common to every answer. Answers can differ in length (a dropped or extra value), so plain index diff would
 * mark every later token. */
export function disputedTokens(answers: string[]): Set<number>[] {
  const toks = answers.map((a) => a.split(" "));
  const common = (a: string[], b: string[]) => {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const keepA = new Set<number>();
    const keepB = new Set<number>();
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
      if (a[i] === b[j]) keepA.add(i++), keepB.add(j++);
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return [keepA, keepB];
  };
  const marks = toks.map(() => new Set<number>());
  for (let x = 0; x < toks.length; x++)
    for (let y = x + 1; y < toks.length; y++) {
      const [kx, ky] = common(toks[x], toks[y]);
      toks[x].forEach((_, i) => kx.has(i) || marks[x].add(i));
      toks[y].forEach((_, j) => ky.has(j) || marks[y].add(j));
    }
  return marks;
}

const mark = (answer: string, disputed: Set<number>) =>
  answer.split(" ").map((t, i) => (disputed.has(i) ? `[[${t}]]` : t)).join(" ");

type Pool = { task: string; seed: string; answers: string[]; passedByAnswer: Map<string, boolean>; pluralityPassed: boolean; ceiling: boolean };

function loadPools(): Pool[] {
  const pools: Pool[] = [];
  for (const task of TASKS) {
    for (const g of readdirSync(POOL).filter((n) => n.startsWith(`${task}-K-seed`)).sort()) {
      const dir = join(POOL, g);
      const passedByAnswer = new Map<string, boolean>();
      for (const a of readdirSync(dir).filter((n) => n.startsWith("attempt-"))) {
        const f = join(dir, a, "workspace", "answer.txt");
        if (!existsSync(f)) continue;
        const passed = JSON.parse(readFileSync(join(dir, a, "result.json"), "utf8")).passed === true;
        passedByAnswer.set(norm(readFileSync(f, "utf8")), passed);
      }
      const r = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
      pools.push({ task, seed: g.split("seed")[1], answers: [...passedByAnswer.keys()].sort(), passedByAnswer, pluralityPassed: r.passed === true, ceiling: r.oracle_ceiling?.any_attempt_passed === true });
    }
  }
  return pools;
}

const verdictKey = (task: string, answers: string[]) => JSON.stringify([task, answers]);

async function askJudge(task: string, answers: string[]): Promise<string | null> {
  const spec = readFileSync(`tasks/${task}/public/spec.txt`, "utf8");
  const program = readFileSync(`tasks/${task}/public/program.stamp`, "utf8");
  const marks = disputedTokens(answers);
  const options = answers.map((a, i) => `${String.fromCharCode(65 + i)}: ${mark(a, marks[i])}`).join("\n");
  const prompt = `Several people ran the program below by hand under the STAMP specification and got different outputs. Values in [[double brackets]] are where the candidates disagree; everything else is common to all of them.\n\n<spec>\n${spec}\n</spec>\n\n<program>\n${program}\n</program>\n\nCandidate outputs (printed values, space separated):\n${options}\n\nFind the statements that produce the disputed values and work out, strictly from the spec, what they print. Reply with your reasoning, then a final line "ANSWER: <letter>" naming the correct candidate, or "ANSWER: NONE" if none is correct.`;
  const stdout = await new Promise<string>((res) => {
    const c = spawn("claude", ["-p", "--model", judgeModel as string, "--tools", "", "--disable-slash-commands", "--setting-sources", "project"]);
    let buf = "";
    c.stdout.on("data", (d) => (buf += d));
    c.on("close", () => res(buf));
    c.stdin.end(prompt);
  });
  const m = /ANSWER:\s*([A-Z]+)\s*$/m.exec(stdout);
  if (!m || m[1] === "NONE") return null;
  const i = m[1].charCodeAt(0) - 65;
  return i >= 0 && i < answers.length ? answers[i] : null;
}

/** Strict majority of the votes, else null (no verdict): a split judge falls back rather than guessing. */
export function majority(votes: (string | null)[]): string | null {
  const tally = new Map<string | null, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return n * 2 > votes.length ? top : null;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const pools = loadPools();
  const verdicts: Record<string, { votes: (string | null)[] }> = existsSync(VERDICTS) ? JSON.parse(readFileSync(VERDICTS, "utf8")) : {};
  const needed = new Map<string, [string, string[]]>();
  for (const p of pools) if (p.answers.length > 1) needed.set(verdictKey(p.task, p.answers), [p.task, p.answers]);
  console.log(`pools=${pools.length} multi-answer pools=${pools.filter((p) => p.answers.length > 1).length} distinct answer sets=${needed.size} cached=${[...needed.keys()].filter((k) => k in verdicts).length}`);
  if (process.argv.includes("--stats")) {
    for (const [task, answers] of needed.values()) {
      const marks = disputedTokens(answers);
      console.log(`  ${task}: ${answers.map((a, i) => [...marks[i]].map((t) => `${t}:${a.split(" ")[t]}`).join(",") || "-").join(" | ")}`);
    }
    return;
  }
  if (judgeModel) {
    const todo = [...needed].filter(([k]) => (verdicts[k]?.votes.length ?? 0) < repeats);
    const run = async ([k, [task, answers]]: (typeof todo)[number]) => {
      const votes = verdicts[k]?.votes ?? [];
      const asks: Promise<string | null>[] = [];
      // Rotate the option order per vote so a position bias cannot look like a consistent verdict.
      for (let i = votes.length; i < repeats; i++) {
        const r = i % answers.length;
        asks.push(askJudge(task, [...answers.slice(r), ...answers.slice(0, r)]));
      }
      votes.push(...(await Promise.all(asks)));
      verdicts[k] = { votes };
      writeFileSync(VERDICTS, JSON.stringify(verdicts, null, 1));
      console.log(`  judged ${task} (${answers.length} answers): votes -> ${votes.map((v) => (v === null ? "NONE" : answers.indexOf(v))).join(",")}`);
    };
    const width = Number(opt("parallel") ?? "4");
    for (let i = 0; i < todo.length; i += width) await Promise.all(todo.slice(i, i + width).map(run));
  }
  const rows: string[] = [];
  for (const task of TASKS) {
    const ps = pools.filter((p) => p.task === task);
    let plur = 0, adj = 0, ceil = 0, missing = 0, fellBack = 0;
    for (const p of ps) {
      if (p.pluralityPassed) plur++;
      if (p.ceiling) ceil++;
      let passed = p.pluralityPassed;
      if (p.answers.length > 1) {
        const v = verdicts[verdictKey(p.task, p.answers)];
        const pick = v ? majority(v.votes) : null;
        if (!v) missing++;
        if (pick && p.passedByAnswer.has(pick)) passed = p.passedByAnswer.get(pick)!;
        else fellBack++;
        if (passed !== p.pluralityPassed) rows.push(`  ${task} seed${p.seed}: plurality ${p.pluralityPassed ? "pass" : "fail"} -> adjudication ${passed ? "pass" : "fail"}`);
      }
      if (passed) adj++;
    }
    console.log(`${task}: plurality ${plur}/${ps.length}  adjudication ${adj}/${ps.length}  oracle ceiling ${ceil}/${ps.length}  (fell back to plurality in ${fellBack}${missing ? `, ${missing} with no verdict yet` : ""})`);
  }
  for (const r of rows) console.log(r);
}

if (process.argv[1]?.endsWith("stamp-adjudication-replay.ts")) await main();
