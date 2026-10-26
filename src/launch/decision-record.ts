/**
 * The run's DECISION RECORD, found where the verifier actually wrote it and filed one proposed decision per Target.
 * The launcher used to read only the CLI's json `result`, which is the verifier's LAST turn: a background command or
 * Monitor that ends after the final turn makes Claude take one more turn (code.claude.com/docs/en/headless, "Background
 * tasks at exit"), and RSI-4 (swarm-073112-zcd7) lost its record that way. It also filed only the first `Slug:`, so
 * RSI-3's eleven "**Target N: slug.**" headings (swarm-092526-89rn) filed nothing. Board evidence/decision-record-loss.
 * Candidates are the final text, the verifier's assistant texts and send_message contents from its session transcripts,
 * and its chat messages in the lead room; the newest that names at least one slug wins.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type DecisionRecordSource = "final_text" | "session_transcript" | "room_message";
export interface DecisionCandidate { source: DecisionRecordSource; /** ISO time; the final text has none and is the newest */ at?: string; text: string }
export interface DecisionTarget { slug: string; slugFrom: "slug_line" | "target_heading"; text: string }
export interface ParsedDecisionRecord { /** from the first "DECISION RECORD" to the end of the text */ record: string; targets: DecisionTarget[] }
export interface FoundDecisionRecord extends ParsedDecisionRecord { source: DecisionRecordSource; at?: string; /** the whole text that carried it: the verdict usually precedes the record */ turn: string }
export interface DecisionRecordSearch {
  found: FoundDecisionRecord | null;
  /** a record that names no slug, kept so its text is not lost */
  unnamed?: FoundDecisionRecord;
  missing?: string;
  searched: { final_text: boolean; session_texts: number; room_messages: number };
}
/** result.json `decisionRecord`: what was filed, from where, or why nothing was. */
export interface DecisionRecordSummary {
  source: DecisionRecordSource | null;
  at?: string;
  slugs: string[];
  files: string[];
  wholeRecord?: string;
  missing?: string;
  /** the turn that carried the record when it was not the CLI's final result, so the report still shows the verdict */
  verdict?: string;
  searched: DecisionRecordSearch["searched"];
}

const MARK = "DECISION RECORD";
// "**Target 1: slug.**", "- Target 3 — name", "### Target: slug"; never the guard-decisions field "- **target:** src/x.ts"
// (four records in swarms/ carry it under their slug line), "RE-TARGET <axis>" or prose such as "Target users"
const HEADING = /^(?:[\s>*_-]*(?:\d+[.)]\s+)?\**\s*Target\s*\d+\b|\s*#+\s*\**\s*Target\b)/i;
const HEADING_SLUG = /Target\b(?:\s*\d+)?\**\s*[:.)—–-]\s*\**\s*`?([a-z0-9]+(?:-[a-z0-9]+)+)/;
// markdown puts the colon either side of the emphasis: **Slug:** `x` and **Slug**: `x` both count
const SLUG_LINE = /(?:^|[\s*_>`(-])slug\**\s*:\s*\**\s*`?([a-z0-9][a-z0-9-]{2,79})/i;
const isSlugLine = (line: string) => SLUG_LINE.test(line);
const clean = (slug: string) => slug.toLowerCase().replace(/-+$/, "");

/**
 * Split a text's record into Targets three ways: at Target headings, at each Slug: paragraph, and not at all (one
 * record, one slug, as the launcher always read it). The split that names the most slugs wins, ties in that order, so a
 * line that only looks like a heading cannot hide a slug above it.
 */
export function parseDecisionRecord(text: string): ParsedDecisionRecord | null {
  const at = text.indexOf(MARK);
  if (at < 0) return null;
  const record = text.slice(at);
  const lines = record.split("\n");
  const headings = lines.map((l, i) => (i > 0 && HEADING.test(l) ? i : -1)).filter((i) => i >= 0);
  const slugLines = lines.map((l, i) => (i > 0 && isSlugLine(l) ? i : -1)).filter((i) => i >= 0);
  // the paragraph holding a Slug: line starts its target, so a title just above it goes with it
  const paragraphs = slugLines.length > 1 ? slugLines.map((s, k) => {
    let i = s;
    while (i - 1 > (k ? slugLines[k - 1] : 0) && lines[i - 1].trim() !== "") i--;
    return i;
  }) : [];
  const split = (starts: number[]) => (starts.length ? starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length).join("\n").trim()) : [record.trim()]);
  const ways = [headings, paragraphs, []].filter((starts, i) => i === 2 || starts.length).map((starts) => targetsOf(split(starts)));
  return { record, targets: ways.reduce((best, t) => (t.length > best.length ? t : best), [] as DecisionTarget[]) };
}

function targetsOf(blocks: string[]): DecisionTarget[] {
  const seen = new Map<string, number>();
  const targets: DecisionTarget[] = [];
  for (const block of blocks) {
    const line = SLUG_LINE.exec(block)?.[1];
    const heading = line ? undefined : HEADING_SLUG.exec(block.split("\n")[0])?.[1];
    const raw = line ?? heading;
    if (!raw) continue;
    let slug = clean(raw);
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    if (n > 1) slug = `${slug}-${n}`;
    targets.push({ slug, slugFrom: line ? "slug_line" : "target_heading", text: block });
  }
  return targets;
}

/** The verifier's own words from a Claude Code session transcript: assistant texts and what it sent with send_message. */
export function sessionCandidates(jsonl: string): DecisionCandidate[] {
  const out: DecisionCandidate[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.includes(MARK)) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (o?.type !== "assistant" || !Array.isArray(o.message?.content)) continue;
    for (const c of o.message.content) {
      if (c?.type === "text" && typeof c.text === "string") out.push({ source: "session_transcript", at: o.timestamp, text: c.text });
      else if (c?.type === "tool_use" && /send_message$/.test(String(c.name)) && typeof c.input?.content === "string") out.push({ source: "session_transcript", at: o.timestamp, text: c.input.content });
    }
  }
  return out;
}

/** The verifier's chat messages in a room transcript (GET /rooms/:room/transcript: "#<seq> [<iso>] <name> (<kind>): <text>"). */
export function roomMessageCandidates(transcript: string, isVerifier: (name: string) => boolean): DecisionCandidate[] {
  const out: DecisionCandidate[] = [];
  const head = /^#\d+ \[([^\]]+)\] (\S+) \((\w+)\): /gm;
  const marks = [...transcript.matchAll(head)];
  marks.forEach((m, i) => {
    if (m[3] !== "chat" || !isVerifier(m[2])) return;
    const end = marks[i + 1]?.index ?? transcript.length;
    out.push({ source: "room_message", at: m[1], text: transcript.slice(m.index! + m[0].length, end).trimEnd() });
  });
  return out;
}

/** The launcher's verifier seat, or a respawn of it (src/respawn.ts names them <name>-r<i>). */
export const isVerifierSeat = (name: string) => /^verifier(?:-r\d+)?$/.test(name);

/** Every place the launcher can see the verifier's words; a transcript file that is missing is skipped. */
export function verifierCandidates(o: { finalText: string | null | undefined; transcripts: string[]; roomTranscript: string | null | undefined; isVerifier?: (name: string) => boolean }): DecisionCandidate[] {
  const isVerifier = o.isVerifier ?? isVerifierSeat;
  const out: DecisionCandidate[] = o.finalText ? [{ source: "final_text", text: o.finalText }] : [];
  for (const path of o.transcripts) {
    try { if (existsSync(path)) out.push(...sessionCandidates(readFileSync(path, "utf8"))); } catch { /* unreadable: the others still count */ }
  }
  if (o.roomTranscript) out.push(...roomMessageCandidates(o.roomTranscript, isVerifier));
  return out;
}

const rank: Record<DecisionRecordSource, number> = { final_text: 2, session_transcript: 1, room_message: 0 };
// ISO times compare as strings; the final text has none and is the last thing the verifier said ("~" sorts after digits)
const when = (x: FoundDecisionRecord) => x.at ?? "~";
const newest = (a: FoundDecisionRecord, b: FoundDecisionRecord) =>
  when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : rank[b.source] - rank[a.source];

/** The newest candidate whose record names a slug; else the newest record with none, and why nothing can be filed. */
export function findDecisionRecord(candidates: DecisionCandidate[]): DecisionRecordSearch {
  const searched = {
    final_text: candidates.some((c) => c.source === "final_text"),
    session_texts: candidates.filter((c) => c.source === "session_transcript").length,
    room_messages: candidates.filter((c) => c.source === "room_message").length,
  };
  const parsed: FoundDecisionRecord[] = [];
  for (const c of candidates) {
    const p = parseDecisionRecord(c.text);
    if (p) parsed.push({ ...p, source: c.source, ...(c.at ? { at: c.at } : {}), turn: c.text });
  }
  const named = parsed.filter((p) => p.targets.length).sort(newest);
  if (named.length) return { found: named[0], searched };
  const unnamed = parsed.sort(newest)[0];
  const where = `the verifier's final text${searched.final_text ? "" : " (none)"}, ${searched.session_texts} session-transcript text(s) or ${searched.room_messages} room message(s)`;
  return unnamed
    ? { found: null, unnamed, missing: `a DECISION RECORD (${unnamed.source}${unnamed.at ? ` at ${unnamed.at}` : ""}) but no slug: no "Slug: <slug>" line and no "Target N: <slug>" heading`, searched }
    : { found: null, missing: `no DECISION RECORD in ${where}`, searched };
}

const label: Record<DecisionRecordSource, string> = { final_text: "final text", session_transcript: "session transcript", room_message: "room message" };

/**
 * Write one proposed decision per Target into `dir` (null when the project keeps no decision log) and the whole record
 * to <outDir>/decision-record.md whenever there is one, slugs or not. Returns result.json's `decisionRecord`.
 */
export function fileDecisionRecord(search: DecisionRecordSearch, o: { runId: string; state: string; outDir: string; dir: string | null }): DecisionRecordSummary {
  const rec = search.found ?? search.unnamed;
  const summary: DecisionRecordSummary = { source: search.found?.source ?? null, slugs: [], files: [], searched: search.searched, ...(search.missing ? { missing: search.missing } : {}) };
  if (!rec) return summary;
  if (rec.at) summary.at = rec.at;
  if (rec.source !== "final_text") summary.verdict = rec.turn;
  const from = `the verifier's ${label[rec.source]}${rec.at ? ` at ${rec.at}` : ""}`;
  const targets = search.found?.targets ?? [];
  summary.slugs = targets.map((t) => t.slug);
  try {
    mkdirSync(o.outDir, { recursive: true });
    const whole = join(o.outDir, "decision-record.md");
    writeFileSync(whole, `# Decision record of ${o.runId}\n\nFrom ${from}. ${targets.length ? `Targets filed: ${summary.slugs.join(", ")}.` : `Nothing filed: ${search.missing}.`}\n\n${rec.turn}\n`);
    summary.wholeRecord = whole;
    if (!o.dir || !targets.length) return summary;
    mkdirSync(o.dir, { recursive: true });
    targets.forEach((t, i) => {
      const path = join(o.dir!, `${t.slug}.md`);
      const of = targets.length > 1 ? `, target ${i + 1} of ${targets.length}; the whole record is swarms/${o.runId}/decision-record.md` : "";
      writeFileSync(path, `# Proposed decision: ${t.slug}\n\nFrom ${o.runId} (${o.state}); report: swarms/${o.runId}/report.md; taken from ${from}${of}. A human promotes this into docs/decisions/ with \`guard-decisions add\`; nothing is adopted automatically.\n\n${targets.length > 1 ? t.text : rec.record}\n`);
      summary.files.push(path);
    });
  } catch (e) {
    // a write that fails says so; the files written before it stay listed
    summary.missing = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return summary;
}

/**
 * The launcher's whole step, which never throws: it runs before result.json and report.md are written, so an error here
 * becomes `missing: "error: ..."` in the summary instead of losing the run's records (the verifier's review of 80da69ea).
 */
export function fileRunDecisionRecord(sources: Parameters<typeof verifierCandidates>[0], o: Parameters<typeof fileDecisionRecord>[1]): DecisionRecordSummary {
  try {
    return fileDecisionRecord(findDecisionRecord(verifierCandidates(sources)), o);
  } catch (e) {
    return { source: null, slugs: [], files: [], searched: { final_text: false, session_texts: 0, room_messages: 0 }, missing: `error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The launcher's log line: what it filed and from where, or why nothing. */
export function decisionRecordLine(d: DecisionRecordSummary): string {
  return d.slugs.length
    ? `decision record: ${d.slugs.length} target(s) from the verifier's ${d.source}${d.at ? ` at ${d.at}` : ""}${d.files.length ? `, proposed: ${d.files.join(", ")}` : ""}${d.missing ? `; ${d.missing}` : ""}`
    : `decision record: none filed (${d.missing})`;
}

/** The report's line for it: what was filed and from where, or why nothing was. */
export function renderDecisionRecord(s: DecisionRecordSummary | undefined): string {
  if (!s) return "";
  const where = s.source ? `the verifier's ${label[s.source]}${s.at ? ` at ${s.at}` : ""}` : "";
  let text = "## Decision record\n\n";
  if (s.slugs.length) text += `${s.slugs.length} target(s) from ${where}: ${s.slugs.join(", ")}.${s.files.length ? ` Proposed: ${s.files.join(", ")}.` : s.missing ? "" : " No decision log in this project, so none proposed."}${s.missing ? ` Filing failed: ${s.missing}.` : ""}`;
  else text += `None filed: ${s.missing ?? "no record"}.`;
  if (s.wholeRecord) text += ` Whole record: ${s.wholeRecord}.`;
  if (s.source && s.source !== "final_text") text += ` The verifier's last turn did not carry it, so the CLI result under Verifier is a later turn.`;
  return `${text}\n\n`;
}
