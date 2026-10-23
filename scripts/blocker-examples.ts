/**
 * Examples a chat message is compared with by meaning (decision/blocker-detection, inputs/owner-3: no hand-made word
 * list). Written at 08:08Z on 23 Oct before any held-out log existed (esc-before-2 unread, probe/heldout-brief not run);
 * none is copied from a log the cut is scored on. YES: something outside the room stops or invalidates the work and
 * only the owner can change it. NO: ordinary work talk, including the near misses the word list hit (server
 * timestamps, another room's post-mortem, a code review).
 */
export const BLOCKER_YES = [
  "Our cancels arrive after the takers have already hit us; from this machine we are simply too slow for this strategy.",
  "The network path goes through a VPN exit far from the exchange, so every round trip costs hundreds of milliseconds and the test is meaningless from here.",
  "This only works from a server next to the exchange; we cannot get that latency from a laptop.",
  "The exchange blocks our region, so we cannot place orders from this connection at all.",
  "The machine is overloaded and swapping, so our feed timings are the laptop's, not the market's.",
  "We need an API key, an account or a paid data feed we do not have before this can go any further.",
  "The budget is spent; nothing more can be tested without more money from the owner.",
  "Every latency-bound idea here dies on the same limit: we are behind the gateway and cannot get closer.",
];

export const BLOCKER_NO = [
  "I fixed the parser to use the server timestamp instead of our receive time; the numbers changed by a few milliseconds.",
  "Review of the commit: one bug in the retry loop, otherwise it passes.",
  "In the earlier room the laptop was the bottleneck and nobody paused; that is what this post-mortem is about.",
  "The markout at five seconds is negative for joins and flat for the guarded cell; standard errors are wide.",
  "I can't reproduce your table; which commit did you run it at?",
  "Claiming the settlement P&L work; I will dedupe fills by order id first.",
  "The recorder restarted at 14:04 and the feeds are fine since then.",
  "Agreed, I will draft the final proposal once the verifier reruns the numbers.",
];
