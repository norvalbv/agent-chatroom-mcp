# Supplemental delivery audit

This audit supplements the registered `oracle.py` and `reads.py` measures. It does
not replace their scores. The definition was posted to the room before scoring
the nine frozen v2 trials (`measurement/unprompted-delivery-definition`).

Run `python3 bench/breakouts-unprompted/delivery-audit.py --data-dir <hub/data>
--run <run-name> --trace <native-provider-trace>`, repeating `--trace` for every
seat. Run `python3 bench/breakouts-unprompted/delivery-audit.test.py` for the
adversarial fixtures. The helper imports the existing transcript decoder from
`scripts/swarm-tool-usage.py`; each output pins both files and input SHA256s.

The all-room inventory finds related rooms by parent, shared nonhuman connection,
or a successful recruit response naming a destination room. Formation requires
two distinct nonhuman connections present concurrently. Its timestamp is the
second connection's join, not room creation. Aliases on one connection are one
seat. Unrelated rooms sharing only a human are excluded; rooms lacking connection
identity cannot establish formation.

Public peer **chat** bodies actually returned by hub tools or explicit pushed
chat frames are matched to ledger sequence numbers. Quiet messages, self
messages, human messages, non-chat events and mid-turn stubs are excluded.
Occurrence counts include repeated exposure; unique counts deduplicate by room,
sequence and reader connection. Background messages do not mention the reader.
This is supplied context, not evidence of attention or understanding.

Cross-claim attribution uses explicit `claim/*` ownership **at message time**.
Both author and reader must own known, nonempty, disjoint sets of claim keys.
Missing or ambiguous owners stay unknown. `cross_claim_reads` is null if there
are unknown claims, unmatched sequence numbers or missing seat traces; a known
lower bound remains separate. This deliberately does not infer ownership from
different worker names or from the brief's question count.

The frozen nine-run supplement in
`docs/measurements/breakouts-unprompted-delivery-2026-10-03.json` records no related
room opened or formed in any run. All 27 seats have native traces, but all their
observed public peer chat has unknown claim attribution. Thus these trials do
not establish a change in cross-claim delivery. The registered `reads.py` values
are a different proxy: worker-authored lines including non-chat events and
stubs, with repeats, and with more limited envelope parsing.
