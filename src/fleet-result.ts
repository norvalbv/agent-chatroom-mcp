/** Artifact-first transport. Markdown is only a labeled compatibility path. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readRunResult } from "./result.js";

export interface FleetHandoff {
  swarmId?: string;
  conclusion: string;
  verdict: string;
  reportPath?: string;
  resultPath?: string;
  source: "result.json v1" | "legacy report (best-effort fallback)" | "artifact-error" | "missing";
  error?: string;
}
export function consumeResult(resultPath: string, repoRoot: string, legacySwarmId?: string): FleetHandoff {
  if (existsSync(resultPath)) {
    try {
      const artifact = readRunResult(resultPath);
      const lead = artifact.rooms.find(r => r.name === artifact.leadRoom)?.payload;
      return { swarmId: artifact.run.id, conclusion: lead?.conclusion?.text ?? "", verdict: artifact.verifier.output ?? "", reportPath: artifact.reportPath, resultPath, source: "result.json v1" };
    } catch (error) {
      // Never hide an invalid authoritative artifact behind plausible Markdown.
      return { conclusion: "", verdict: "", resultPath, source: "artifact-error", error: String(error) };
    }
  }
  const reportPath = legacySwarmId ? resolve(repoRoot, "swarms", legacySwarmId, "report.md") : undefined;
  if (!reportPath || !existsSync(reportPath)) return { swarmId: legacySwarmId, conclusion: "", verdict: "", source: "missing" };
  const report = readFileSync(reportPath, "utf8");
  return { swarmId: legacySwarmId, conclusion: (/## Final answer[^\n]*\n\n([\s\S]*?)\n\n## /.exec(report)?.[1] ?? "").trim(), verdict: (/## Verifier[^\n]*\n\n([\s\S]*?)\n\n## /.exec(report)?.[1] ?? "").trim(), reportPath, source: "legacy report (best-effort fallback)" };
}

/** One framer per stream: don't join stdout and stderr fragments. Flush final unterminated line. */
export function lineFramer(onLine: (line: string) => void) {
  let pending = "";
  return {
    push(text: string) { pending += text; const lines = pending.split("\n"); pending = lines.pop()!; for (const line of lines) onLine(line); },
    flush() { if (pending) onLine(pending); pending = ""; },
  };
}
