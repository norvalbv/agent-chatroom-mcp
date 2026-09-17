/** Deterministic exact-answer scorer: normalized FULL-STRING equality; no substring. exit 0 iff score 1. */
import { readFileSync } from 'node:fs';
const [answerPath, oraclePath] = process.argv.slice(2);
if (!answerPath || !oraclePath) { console.error('usage: score-fact-check.ts ANSWER_FILE ORACLE_JSON'); process.exit(2); }
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const config = JSON.parse(readFileSync(oraclePath, 'utf8')) as { expected: string; distractors?: string[] };
const answer = readFileSync(answerPath, 'utf8');
const normalized = normalize(answer);
const expected = normalize(config.expected);
const distractor = (config.distractors ?? []).some(d => normalize(d) === normalized);
const score = normalized === expected && !distractor ? 1 : 0;
console.log(JSON.stringify({ score, normalized, expected }));
process.exit(score === 1 ? 0 : 1);
