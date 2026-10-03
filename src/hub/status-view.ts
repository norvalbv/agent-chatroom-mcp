/**
 * room_status as a seat sees it (swarm-181144-uxtr, issue 2). The agent-facing Hub.summary repeated the whole room
 * topic on every call (6.8 KB of a 14-31 KB result in swarm-205033-6bp8, where 7 room_status calls were 19% of all hub
 * bytes), every seat's last shell command, and four fields per board key. A seat already holds the topic from its brief
 * and join_room; it polls room_status for who is doing what, the proposal and the board keys. So: the topic is cut to
 * its opening, a working detail to one line, and a board key to its author (plus reviewer). Proposals, votes,
 * challenges, liveness, claims and everything else pass through unchanged. join_room, list_rooms and the dashboard keep
 * the full summary.
 */
const TOPIC_HEAD = 240;
const DETAIL_HEAD = 80;

type Summary = Record<string, unknown> & {
  topic?: string;
  participants?: { working?: { detail?: string } | null }[];
  board?: Record<string, { by?: string; reviewer?: string; post_reveal?: boolean }>;
};

const head = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function statusView(summary: Summary): Summary {
  const topic = summary.topic ?? "";
  return {
    ...summary,
    topic: topic.length > TOPIC_HEAD ? `${topic.slice(0, TOPIC_HEAD)}… (${topic.length} chars; list_rooms carries it whole)` : topic,
    participants: summary.participants?.map((p) =>
      p.working?.detail ? { ...p, working: { ...p.working, detail: head(p.working.detail, DETAIL_HEAD) } } : p),
    board: summary.board && Object.fromEntries(Object.entries(summary.board).map(([k, e]) =>
      [k, { by: e.by, ...(e.reviewer ? { reviewer: e.reviewer } : {}), ...(e.post_reveal ? { post_reveal: true } : {}) }])),
  };
}
