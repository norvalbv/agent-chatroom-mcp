# Research for the planted-defect build suite (swarm-191133-4hqx)

Only sources not already in docs/research-index.md. Read on 2026-09-19 at abstract level: arXiv:2406.09843, 2607.02606, 2603.23448, 2601.12307 and 2604.02460 from their abstract pages; arXiv:2308.16557, 2506.02954, 2607.22880, 2511.00872, 2604.16321 and 2603.20432 from search-result summaries only (title and one-line abstract). Nothing here was read in full text.

## 1. How defect-seeded and mutation-based evaluations are built and validated

- arXiv:2406.09843 (LLMs for mutation testing, 851 real Java bugs from Defects4J 2.0 and ConDefects). LLM-written mutants are more diverse and behave closer to real bugs than rule-based operators, and detect more real bugs, but have higher rates of non-compiling, duplicate and equivalent mutants (the percentages differ between versions of the abstract; only the direction is used). Design consequence: validate each planted defect three ways before admission (it compiles, the public suite still passes, a hidden test fails on the defect and passes on the fix). The last check removes equivalent defects.
- arXiv:2308.16557 (test generation with LLMs plus mutation testing) and arXiv:2506.02954 (mutation-guided unit test generation): mutation score is the target signal for test quality, so one hidden test per defect that kills that defect is the accepted unit of measurement.
- arXiv:2607.22880 (replicability study: do coverage and mutation scores of LLM-generated suites correlate with effectiveness?): proxy metrics can decouple from real fault detection. Design consequence: score on each defect's own hidden test, not on coverage or overall pass rate.
- arXiv:2607.02606 (ChainSWE, 304 bug-fix chains over 54 Python projects): performance falls by up to 70% as chain length grows in one evolving codebase. Many defects in one codebase are harder than the sum of single ones, which supports 6 to 12 defects as a route off ceiling.
- arXiv:2603.23448 (c-CRAB code review benchmark built from human reviews with generated tests): existing review agents solve about 40% of tasks, and agent reviews often flag different things from human reviews. Review is scored by tests, not a judge, as here.

## 2. Multi-agent versus single-agent on software tasks and review

- arXiv:2604.02460 (single agents match or beat multi-agent systems on multi-hop reasoning at equal thinking-token budgets): reported multi-agent gains are largely unaccounted compute and context effects; multi-agent becomes competitive when a single agent's context use is degraded or extra compute is spent. Prediction: if the room wins at equal dollars it should be on defects that sit far apart.
- arXiv:2601.12307 (a single agent replicates homogeneous multi-agent workflows on seven benchmarks including coding): compare arms at an equal dollar cap and record thinking tokens, or the comparison measures spend.
- arXiv:2511.00872 (agent frameworks on code-centric tasks) and arXiv:2604.16321 (literature review of multi-agent code generation): multi-agent frameworks are reported to help on long-horizon work; cost-matched evidence is thin, and this suite supplies the matched arm.
- arXiv:2603.20432 (coding agents as long-context processors): an agent that navigates files with native tools can handle far more text than fits in context, so file count alone does not make a task exceed one agent. The task has to need information from many places at once.

## 3. What makes a task exceed one context usefully

Not size for its own sake. Useful excess means: (a) each defect is only recognisable by comparing two or more modules, or a module against the written specification; (b) the number of such comparisons (defects times modules) is large enough that a single agent's read budget runs out before every pair is checked; (c) nothing local (comment, name, type) states the correct rule. Artificial excess is padding, dead files, or defects a grep finds. The retired complementary-fix task (rule stated in a doc comment above each defect) is the counter-example.

## Falsifiers, stated before building

1. F-ceiling: a single agent at the pinned effort catches at least 70% of planted defects (mean over at least five pilot seeds). The task is at ceiling; reject or enlarge it, report no arm comparison for it.
2. F-floor: a defect that no arm in any pilot seed catches is replaced (unfindable or ambiguous); a task whose single-agent mean is under 30% is rejected.
3. F-breadth: at equal dollar cap on the 20-seed run, the room's caught share exceeds the pair's by no more than seed noise (paired bootstrap 95% interval contains zero). Then a breadth and division-of-labour advantage is not supported for these tasks.
4. F-shipped: an arm that catches more also ships more regressions, so the gain is not net. Caught and shipped are always reported together.
5. F-cost: at equal cap the single agent at higher effort matches or beats both other arms. Then the paper's cost finding extends to build tasks.

Admission and defect replacement use pilot seeds only; confirmatory seeds are disjoint and listed in the prereg before running.
