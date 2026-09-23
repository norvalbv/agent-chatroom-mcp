/** Stamp counterpart of scripts/adjudication-replay.ts, for the exact-answer arm-K pools (stamp-interpreter,
 * stamp-2 in bench/results/rq1-arm-k). Arm K picks the plurality answer, which loses exactly when the correct
 * answer is held by a minority (evidence/k-pool-disputes). Here the judge is shown only the task's public
 * spec.txt and program.stamp plus the group's DISTINCT answers (never how many attempts gave each), and names
 * the one the program really prints. The group submits an attempt with that answer; with no verdict it falls
 * back to plurality, so a missing or split verdict can only reproduce arm K, never do worse by construction.
 *
 * Verdicts are cached in bench/results/adjudication-replay/stamp-verdicts.json (committed), so a replay without
 * --judge makes no model calls. Oracle `passed` fields are read only to score.
 *
 *   node --import tsx scripts/adjudication-replay-stamp.ts --stats
 *   node --import tsx scripts/adjudication-replay-stamp.ts --judge sonnet --repeats 3
 *   node --import tsx scripts/adjudication-replay-stamp.ts
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "./bench-ak.js";

const POOL = "bench/results/rq1-arm-k";
const OUT = "bench/results/adjudication-replay";
const VERDICTS = join(OUT, "stamp-verdicts.json");
const TASKS = ["stamp-interpreter", "stamp-2"];

const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const judgeModel = opt("judge");
const repeats = Number(opt("repeats") ?? "1");
mkdirSync(OUT, { recursive: true });

type Attempt = { answer: string | null; passed: boolean };
type Group = { task: string; name: string; attempts: Attempt[]; plurality: number };
const groups: Group[] = TASKS.flatMap((task) =>
  readdirSync(POOL)
    .filter((n) => n.startsWith(`${task}-K-seed`))
    .sort()
    .map((name) => {
      const dir = join(POOL, name);
      const selection = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")).selection;
      const attempts = readdirSync(dir)
        .filter((n) => n.startsWith("attempt-"))
        .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
        .map((a) => {
          const f = join(dir, a, "workspace", "answer.txt");
          return { answer: existsSync(f) ? normalize(readFileSync(f, "utf8")) : null, passed: JSON.parse(readFileSync(join(dir, a, "result.json"), "utf8")).passed === true };
        });
      return { task, name, attempts, plurality: selection.winner_attempt - 1 };
    }),
);

const distinct = (g: Group) => [...new Set(g.attempts.map((a) => a.answer).filter((a): a is string => !!a))].sort();
const key = (g: Group) => JSON.stringify([g.task, distinct(g)]);
const verdicts: Record<string, { votes: (string | null)[] }> = existsSync(VERDICTS) ? JSON.parse(readFileSync(VERDICTS, "utf8")) : {};

function pickOf(votes: (string | null)[]): string | null {
  const tally = new Map<string | null, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.length > 1 && ranked[0][1] === ranked[1][1] ? null : ranked[0][0];
}

async function askJudge(task: string, answers: string[]): Promise<string | null> {
  const pub = join("tasks", task, "public");
  const options = answers.map((a, i) => `${String.fromCharCode(65 + i)}: ${a}`).join("\n");
  const prompt = `Several people ran the program below by hand under the STAMP specification and disagree on what it prints (printed values in order, space-separated).\n\n<spec>\n${readFileSync(join(pub, "spec.txt"), "utf8")}\n</spec>\n\n<program>\n${readFileSync(join(pub, "program.stamp"), "utf8")}\n</program>\n\nCandidate outputs:\n${options}\n\nFind where they differ, and work out from the spec exactly what the program prints there. Reply with your reasoning, then a final line "ANSWER: <letter>" naming the correct candidate, or "ANSWER: NONE" if none is correct.`;
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

const needed = new Map<string, [string, string[]]>();
for (const g of groups) if (distinct(g).length > 1) needed.set(key(g), [g.task, distinct(g)]);
console.log(`groups=${groups.length} disputed groups=${groups.filter((g) => distinct(g).length > 1).length} distinct disputes=${needed.size} cached=${[...needed.keys()].filter((k) => k in verdicts).length}`);
if (process.argv.includes("--stats")) process.exit(0);

if (judgeModel) {
  const todo = [...needed].filter(([k]) => (verdicts[k]?.votes.length ?? 0) < repeats);
  const run = async ([k, [task, answers]]: (typeof todo)[number]) => {
    const votes = verdicts[k]?.votes ?? [];
    const asks: Promise<string | null>[] = [];
    // Alternate the option order so a judge with a position bias cannot look consistent.
    for (let i = votes.length; i < repeats; i++) asks.push(askJudge(task, i % 2 ? [...answers].reverse() : answers));
    votes.push(...(await Promise.all(asks)));
    verdicts[k] = { votes };
    writeFileSync(VERDICTS, JSON.stringify(verdicts, null, 1));
    console.log(`  judged ${task} (${answers.length} answers): ${votes.map((v) => (v === null ? "NONE" : String.fromCharCode(65 + answers.indexOf(v)))).join(",")}`);
  };
  const width = Number(opt("parallel") ?? "6");
  for (let i = 0; i < todo.length; i += width) await Promise.all(todo.slice(i, i + width).map(run));
}

let judgedVotes = 0;
let rightVotes = 0;
let rightPicks = 0;
let picks = 0;
for (const task of TASKS) {
  let plural = 0;
  let adj = 0;
  let ceiling = 0;
  for (const g of groups.filter((x) => x.task === task)) {
    const v = verdicts[key(g)];
    const pick = v ? pickOf(v.votes) : null;
    const chosen = pick === null ? g.plurality : g.attempts.findIndex((a) => a.answer === pick);
    if (g.attempts[g.plurality].passed) plural++;
    if (g.attempts[chosen].passed) adj++;
    if (g.attempts.some((a) => a.passed)) ceiling++;
    const truth = g.attempts.find((a) => a.passed)?.answer;
    if (v && truth) {
      judgedVotes += v.votes.length;
      rightVotes += v.votes.filter((x) => x === truth).length;
      picks++;
      if (pick === truth) rightPicks++;
    }
  }
  console.log(`${task}: plurality ${plural}/40  adjudication ${adj}/40  oracle ceiling ${ceiling}/40`);
}
console.log(`judge (per disputed group): single votes correct ${rightVotes}/${judgedVotes}, verdicts correct ${rightPicks}/${picks}`);
