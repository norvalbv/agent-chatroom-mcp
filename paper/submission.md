# Submission: arXiv rules and the disclosure statement that follows

Fetched 2026-09-18 from arXiv's own help pages (primary source, not a paraphrase site), and re-verified
2026-09-18 by re-fetching the same three pages in this room; wording is unchanged. Quotes below are
arXiv's own words where marked; everything else is our reading of them applied to this project.

## 1. Endorsement (first-time submitters)

Source: https://info.arxiv.org/help/endorsement.html

- A first-time submitter needs an endorsement before their first paper (or a first paper in a new
  category) is accepted.
- Two paths:
  - **Automatic**: an institutional email address plus a claimed co-authorship on an existing arXiv
    paper can grant endorsement without a personal request. arXiv: "First time submitters to arXiv
    are encouraged to associate an institutional email address if they have one...This will expedite
    the endorsement process."
  - **Personal**: without that, the submitter must ask an established arXiv author in the target
    category — start a submission, receive an endorsement-request link by email, find qualified
    endorsers by locating related papers and checking "Which authors of this paper are endorsers?",
    and contact one directly with the link.
  - At least one positive endorsement is required per category claimed: "At least one positive
    endorsement is required per endorsement category to be considered endorsed for that category."
- The endorser is not a peer reviewer: they check that "the paper is appropriate for the subject
  area," not whether "the author is unfamiliar with the basic facts of the field, or if the work is
  entirely disconnected with current work in the area" — a fit-and-basic-competence check, not a
  correctness check. Endorsers may decline without giving a reason and must keep the manuscript
  confidential.

**Applies here**: whichever human submits this paper needs cs.MA (or the chosen primary category, see
§3) endorsement if they have not posted to arXiv in that category before. This is the maintainer's
task, not something this room can satisfy — no seat in this room holds an arXiv identity.

## 2. Generative AI / authorship policy

Source: https://info.arxiv.org/help/moderation/index.html

arXiv's own language (as fetched, re-verified unchanged):
- "generative AI language tools should not be listed as an author" — a model or agent is a tool,
  never a byline.
- Authors must report significant use of such tools: "text-to-text generative AI [is] among those
  that should be reported consistent with subject standards for methodology" — disclose generative-AI
  use the way a paper discloses any other instrument, in the methodology, not as a footnote-only aside.
- Authors who sign the paper take full responsibility: "by signing their name as an author of a
  paper, they each individually take full responsibility for all its contents, irrespective of how
  the contents were generated." An AI producing a wrong citation, a fabricated result, or biased
  language is the human author's problem, not an excusable defect — the policy names "inappropriate
  language, plagiarized content, biased content, errors, mistakes, incorrect references, or
  misleading content" explicitly.
- Consequence for moderation: undisclosed generative-AI use, or generative-AI output that is
  plagiarized, fabricated, or misleading, is treated as a content-integrity violation like any other,
  and can be declined or removed on that basis.

**Applies here directly**, because this whole project is agents drafting for a human:
- No agent (sonnet-1 through sonnet-7, verifier, or any other seat name used in this repo's swarm
  rooms) may appear as a paper author. There is exactly one class of author: the human(s) responsible
  for the work.
- The paper must disclose, in its methodology or an explicit AI-use statement, that its
  system-under-test *and* parts of its own drafting/evaluation infrastructure were produced by LLM
  agents — see the disclosure text in §4.
- Every empirical claim in the paper (once results exist — this room writes none) must be
  independently checked before submission, because the fetched policy makes the human author liable
  for AI-introduced errors, not the tool.

## 3. Category

Source: https://arxiv.org/category_taxonomy (fetched 2026-09-18, re-verified unchanged).

Candidates and arXiv's own descriptions:
- **cs.MA — Multiagent Systems**: "Covers multiagent systems, distributed artificial intelligence,
  intelligent agents, coordinated interactions, and practical applications." (ACM class I.2.11.)
- **cs.AI — Artificial Intelligence**: "Covers all areas of AI except Vision, Robotics, Machine
  Learning, Multiagent Systems, and Computation and Language (Natural Language Processing), which
  have separate subject areas." (ACM classes I.2.0, I.2.1, I.2.3, I.2.4, I.2.8, I.2.11.)
- **cs.SE — Software Engineering**: "Covers design tools, software metrics, testing and debugging,
  programming environments, etc." (ACM class D.2.)

**Recommendation**: primary category **cs.MA** — the paper's subject is a multi-agent coordination
hub (consensus, delegated verification, cost/attention mechanics between agents), which is exactly
cs.MA's own description and explicitly *not* cs.AI's (cs.AI's text excludes multiagent systems).
Cross-list **cs.SE** (the agents are a software-engineering team; the task suite is
software-engineering-shaped: bug-fix, fact-check, long-brief) and optionally **cs.CL** only if a
later draft leans on prompting/language-model-specific findings rather than the coordination
mechanics.

## 4. Author and AI-disclosure statement (draft, to go in the paper)

> **Authors.** [Maintainer name/affiliation — to be filled by the maintainer before submission;
> arXiv's rule in §2 forbids listing any AI agent, model, or seat name as an author]. Corresponding
> author: [maintainer email].
>
> **AI-disclosure statement.** This paper describes and evaluates `agent-chatroom-mcp`, a
> coordination hub whose participants are large-language-model agents (Claude and, in earlier runs,
> OpenRouter-hosted models); the system under study is itself built from LLM agent output. In
> addition, large parts of the implementation, the evaluation harness, and drafts of this paper's
> text were produced by LLM agents operating under human direction and review, coordinated through
> the same hub described in the paper (see `paper/system.md` for the architecture; the agents
> drafting this paper's sections ran inside an instance of the system they describe). Per arXiv's
> generative-AI policy (https://info.arxiv.org/help/moderation/index.html), no AI agent is listed as
> an author; the human author(s) named above take full responsibility for all content, verified
> every empirical claim and citation before submission, and disclose this use as the paper's primary
> methodological instrument, not an incidental aid.

## 5. What this room could not settle

- The maintainer's real name/affiliation/email is not established anywhere in this repo and must be
  supplied before submission — left as a bracketed placeholder above rather than invented.
- Endorsement status (does the maintainer already hold cs.MA endorsement from a prior arXiv paper?)
  is unknown from the repository and cannot be checked by an agent with no arXiv account; this is a
  human action item, not a paper-drafting one.
- arXiv's pages are live documents; re-fetch all three URLs immediately before submission in case
  wording changed again after this run.

## Sources fetched in this run

- https://info.arxiv.org/help/endorsement.html — endorsement process for first-time submitters
  (re-fetched 2026-09-18, unchanged from the prior draft).
- https://info.arxiv.org/help/moderation/index.html — generative-AI/authorship policy (re-fetched
  2026-09-18, unchanged).
- https://arxiv.org/category_taxonomy — category descriptions for cs.MA, cs.AI, cs.SE (re-fetched
  2026-09-18, unchanged).
