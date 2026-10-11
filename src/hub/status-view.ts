/**
 * room_status as a seat sees it (swarm-181144-uxtr, issue 2). The agent-facing Hub.summary repeated the whole room
 * topic on every call (6.8 KB of a 14-31 KB result in swarm-205033-6bp8, where 7 room_status calls were 19% of all hub
 * bytes), every seat's last shell command, and four fields per board key. A seat already holds the topic from its brief
 * and join_room; it polls room_status for who is doing what, the proposal and the board keys. So: the topic is cut to
 * its opening, a working detail to one line, and a board key to its author (plus reviewer). Proposals, votes,
 * challenges, liveness, claims and everything else pass through unchanged. room_status(full_topic=true), join_room,
 * list_rooms and the dashboard keep the whole topic.
 */
const TOPIC_HEAD = 240;
const DETAIL_HEAD = 80;

type Summary = Record<string, unknown> & {
  topic?: string;
  participants?: { name?: string; working?: { detail?: string } | null; output?: object; holds?: string[] }[];
  board?: Record<string, { by?: string; reviewer?: string; post_reveal?: boolean; late?: boolean }>;
};

const head = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function statusView(summary: Summary, fullTopic = false): Summary {
  const topic = summary.topic ?? "";
  return {
    ...summary,
    topic: !fullTopic && topic.length > TOPIC_HEAD ? `${topic.slice(0, TOPIC_HEAD)}… (${topic.length} chars; room_status full_topic=true carries it whole)` : topic,
    // a seat's output record ships what it delivered, non-zero counts only: no age (last_seen_at is beside it), no claims (the
    // board keys name their authors), and nothing delivered ships as no field at all
    participants: summary.participants?.map(({ output, holds: held, ...p }) => {
      const counts = Object.entries(output ?? {}).filter(([k, v]) => v && k !== "age_seconds" && k !== "claims");
      // a claim the seat wrote is already in the board manifest under its name: holds carries what the manifest cannot
      // (takes, whose holder may not be their author); the dashboard keeps both
      const holds = held?.filter((k) => !(k.startsWith("claim/") && summary.board?.[k]?.by === p.name));
      return {
        ...p,
        ...(holds?.length ? { holds } : {}),
        ...(p.working?.detail ? { working: { ...p.working, detail: head(p.working.detail, DETAIL_HEAD) } } : {}),
        ...(counts.length ? { output: Object.fromEntries(counts) } : {}),
      };
    }),
    no_output: (summary.no_output as unknown[] | undefined)?.length ? summary.no_output : undefined,
    // said once, in join_room: a seat polls room_status for who is doing what, not for constants
    limits: undefined,
    board: summary.board && Object.fromEntries(Object.entries(summary.board).map(([k, e]) =>
      [k, { by: e.by, ...(e.reviewer ? { reviewer: e.reviewer } : {}), ...(e.post_reveal ? { post_reveal: true } : {}), ...(e.late ? { late: true } : {}) }])),
  };
}
