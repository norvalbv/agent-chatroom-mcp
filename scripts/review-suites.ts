/**
 * The offline suites a commit reaches, for a reviewer to run in addition to the author's own test: every script of the
 * offline suite (scripts/offline-runner.mjs) whose static imports reach a changed src/ file, or that names a changed
 * file directly (a prompt it reads, a script it imports, its own path). seat-env-regression never names env.ts and
 * still broke on it twice, so names alone are not enough (board friction/told-run-grep-suites).
 *   npx tsx scripts/review-suites.ts <sha> [--run]       the commit's files, from git diff <sha>~1 <sha>
 *   npx tsx scripts/review-suites.ts --files a,b [--run]
 * --run executes them in the current directory (a checkout of the commit) the way the offline runner does, vm flag
 * included, and exits 1 if any fails.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error untyped .mjs
import { offlineScripts, runCommands } from "./offline-runner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

/** a relative import to the repo file it loads: x.js is x.ts in this tree */
function resolveImport(from: string, spec: string): string | undefined {
  const p = relative(root, resolve(root, dirname(from), spec));
  for (const c of [p.replace(/\.js$/, ".ts"), p, `${p}.ts`, join(p, "index.ts")]) if (existsSync(join(root, c)) && statSync(join(root, c)).isFile()) return c;
  return undefined;
}

const graph = new Map<string, string[]>();
function imports(file: string): string[] {
  let out = graph.get(file);
  if (out) return out;
  graph.set(file, (out = []));
  const text = readFileSync(join(root, file), "utf8");
  for (const m of text.matchAll(IMPORT)) {
    const r = resolveImport(file, m[1]);
    if (r) out.push(r);
  }
  // a vm harness loads modules by path string ("src/x.ts" or "../src/x.js") rather than importing them, and
  // seat-env/claude-lean-flags by bare name: harness('swarm') reads src/swarm.ts
  const names = [...text.matchAll(/["'`](?:\.\.\/)?(src\/[\w./-]+?)\.(?:ts|js)["'`]/g)].map((m) => m[1]);
  if (file.startsWith("scripts/") && text.includes("SourceTextModule")) names.push(...[...text.matchAll(/["'`]([a-z][\w-]*(?:\/[\w-]+)?)["'`]/g)].map((m) => `src/${m[1]}`));
  for (const n of names) {
    const r = existsSync(join(root, `${n}.ts`)) ? `${n}.ts` : undefined;
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

function reach(file: string): Set<string> {
  const seen = new Set<string>();
  const todo = [file];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...imports(f));
  }
  return seen;
}

/** regression scripts the offline runner does not list, so `npm test` never runs them */
export const unlisted = (): string[] => readdirSync(join(root, "scripts")).filter((f) => f.endsWith("-regression.ts") && !(offlineScripts as string[]).includes(f)).sort();

/** script names under scripts/ (offline suite first, then unlisted regressions) that a change to these repo-relative files reaches */
export function suitesFor(changed: readonly string[]): string[] {
  const suites = [...(offlineScripts as string[]).filter((s) => existsSync(join(root, "scripts", s))), ...unlisted()];
  return suites.filter((s) => {
    const file = `scripts/${s}`;
    const reached = reach(file);
    const text = readFileSync(join(root, file), "utf8");
    return changed.some((c) => reached.has(c) || (!c.startsWith("src/") && (text.includes(c) || (c.startsWith("prompts/") && text.includes(basename(c))))));
  });
}

function changedFiles(argv: string[]): string[] {
  const i = argv.indexOf("--files");
  if (i >= 0) return argv[i + 1].split(",").filter(Boolean);
  const sha = argv.find((a) => !a.startsWith("--"));
  if (!sha) {
    console.error("usage: review-suites <sha> | --files a,b [--run]");
    process.exit(2);
  }
  return execFileSync("git", ["diff", "--name-only", `${sha}~1`, sha], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const changed = changedFiles(argv);
  const picked = suitesFor(changed);
  const off = new Set(unlisted());
  const total = (offlineScripts as string[]).length + off.size;
  console.log(`${picked.length} of ${total} suites reach ${changed.length} changed file(s):\n${picked.map((s) => `  scripts/${s}${off.has(s) ? "  (not in the offline suite: npm test never runs it)" : ""}`).join("\n")}`);
  if (argv.includes("--run")) {
    // as offline-runner.mjs runs them; a vm harness needs the flag, listed or not
    const vmFlag = (f: string) => (readFileSync(join(process.cwd(), "scripts", f), "utf8").includes("SourceTextModule") ? ["--experimental-vm-modules"] : []);
    const commands = picked.map((f) => ({ name: f, command: process.execPath, args: [...vmFlag(f), "--import", "tsx", `scripts/${f}`] }));
    process.exitCode = runCommands(commands, { cwd: process.cwd() });
  }
}
