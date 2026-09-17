---
slug: consensus-requires-scrutiny
created: 2026-09-17
---

# consensus-requires-scrutiny

## Target · 2026-09-17 — A conclusion must survive a challenge and a read-to-vote, not just agreement

**Context:** In the first live runs (notes-storage-2, live-3/4) three same-model agents reached unanimous agreement in 46s: the lone dissenter folded 8s after openings, all three votes landed within 0.3s on a several-hundred-word proposal nobody had read, and rooms concluded with zero objections. Agreement was measuring conformity, not correctness.
**Ruling:** The hub enforces scrutiny mechanically: blind openings revealed simultaneously; in rooms of 3+ a proposal cannot pass until a non-proposer files a challenge (whose own vote resets until answered); an agree vote must quote a verbatim clause of the current text; a disagree must state the change that would flip it; one open proposal at a time.
**Consequences:**
- Positive: Every recorded conclusion has at least one adversarial reading and one verified read behind it; live-4 rejected its first proposal over a false RLS claim and adopted a corrected one, which no earlier run did.
- Negative: About 2x wall-clock and extra ritual messages per room; challenges can be perfunctory when the proposal is genuinely fine (the rule then asks for the riskiest assumption instead).
**Vision-fit:** n/a — internal tooling; the hub's purpose is conclusions a human can trust
**Researched:** Multi-agent debate and its failure modes: Du et al. arXiv:2305.14325; MAD Liang et al. arXiv:2305.19118; ReConcile arXiv:2309.13007; Smit et al. 'Should we be going MAD?' arXiv:2311.17371; sycophancy/premature consensus Wynn et al. arXiv:2509.05396, Yao et al. arXiv:2509.23055; anonymised debate Choi et al. arXiv:2510.07517; adaptive stopping Hu et al. arXiv:2510.12697; self-assessment unreliability arXiv:2310.01798. Own transcripts: notes-storage-2, live-3, live-4.
**Rejected:** (a) trust free-text agreement — measured to collapse into conformity in 46s; (b) a designated judge model (MAD) — judge shows model-family bias and adds a role; (c) peer rating (DyLAN arXiv:2310.02170) — sycophancy-prone and never runs anything.
**Anchored-bet:** [VALIDATED]
**Revisit-when:** a same-model room reaches a wrong conclusion that passed the challenge gate, or mixed-model rooms make the gate redundant in >80% of runs
**Scope:** src/hub.ts
**Source:** arxiv · docs/swarm-protocol-spec.md
