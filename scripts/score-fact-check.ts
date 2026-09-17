/** Deterministic exact-answer scorer: normalized FULL-STRING equality; no substring. exit 0 iff score 1.
 * exit 0: task_pass; exit 1: task_fail (well-formed but wrong); exit 3: parse_failure
 * (missing/unreadable/empty answer or prohibited format); exit 2: invocation error.
 */
import { readFileSync } from 'node:fs';
const [answerPath, oraclePath] = process.argv.slice(2);
if (!answerPath || !oraclePath) { console.error('usage: score-fact-check.ts ANSWER_FILE ORACLE_JSON'); process.exit(2); }
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const config = JSON.parse(readFileSync(oraclePath, 'utf8')) as { expected: string; distractors?: string[] };
let raw: string;
try { raw = readFileSync(answerPath, 'utf8'); }
catch { console.log(JSON.stringify({ score: 0, reason: 'parse_failure', detail: 'answer file missing' })); process.exit(3); }
const trimmed = raw.trim();
// Prohibited format: JSON-wrapped object or fenced block. The value is right but the
// shape is not a plain answer string => parse_failure, never an honest equality verdict.
const jsonWrapped = trimmed.startsWith('{') && (() => { try { JSON.parse(trimmed); return true; } catch { return false; } })();
const fenced = trimmed.includes('```');
if (trimmed === '' || jsonWrapped || fenced) {
  console.log(JSON.stringify({ score: 0, reason: 'parse_failure', detail: trimmed === '' ? 'empty answer' : jsonWrapped ? 'JSON-wrapped answer' : 'fenced answer' }));
  process.exit(3);
}
const normalized = normalize(raw);
const expected = normalize(config.expected);
const distractor = (config.distractors ?? []).some(d => normalize(d) === normalized);
const score = normalized === expected && !distractor ? 1 : 0;
console.log(JSON.stringify({ score, normalized, expected }));
process.exit(score === 1 ? 0 : 1);
