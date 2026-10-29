"""Fixture check of run-room.py's outcome classification (decision/reveal-rivals-protocol CLASSIFICATION), no hub or seats.
Runs the exact statements from `infra=` up to `framing=` in run-room.py's try block, as 6-1-sol-3's oracle does
(attack/result/reveal-lever-pair), against one fixture per boundary: a crash must never read as a valid timeout, and a
real deadline must.
  python3 -I docs/measurements/reveal-pair/classify-check.py          # the working tree's run-room.py
  python3 -I docs/measurements/reveal-pair/classify-check.py <ref>    # git show <ref>:docs/measurements/reveal-pair/run-room.py"""
import ast, json, pathlib, re, subprocess, sys, tempfile

here = pathlib.Path(__file__).resolve().parent
ref = sys.argv[1] if len(sys.argv) > 1 else None
source = subprocess.check_output(['git', 'show', f'{ref}:docs/measurements/reveal-pair/run-room.py'], text=True) if ref else (here / 'run-room.py').read_text()
tree = ast.parse(source)
named = lambda node, name: isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets)
main = next(n for n in tree.body if isinstance(n, ast.Try) and any(named(c, 'infra') for c in n.body))
start = next(i for i, n in enumerate(main.body) if named(n, 'infra'))
end = next(i for i, n in enumerate(main.body) if i > start and named(n, 'framing'))
code_obj = compile(ast.Module(body=main.body[start:end], type_ignores=[]), f'<{ref or "worktree"} classification>', 'exec')
LIMIT = re.compile(r"usage limit|session limit|hit your [^\n]{0,30}limit|rate.limited|overloaded_error", re.I)

def final(kind, timed_out, conclusion=None, seats=(0, 0, 0)):
    return {'leadRoom': 'r-room', 'rooms': [{'name': 'r-room', 'payload': {'conclusion': {'text': conclusion} if conclusion else None}}],
            'collectionErrors': [], 'outcome': {'kind': kind, 'timedOut': timed_out, 'detail': ''},
            'scorecard': [{'name': n, 'exitCode': c} for n, c in zip(('w1', 'w2', 'verifier'), seats)]}

CASES = [  # name, result.json (None: absent), launcher exit, conclusion text, scorer reason, extra state, expected outcome
    ('crash after the incremental checkpoint (sol-3 oracle input)', {'leadRoom': 'r-room', 'rooms': [], 'collectionErrors': ['incremental checkpoint: 1/3 runs complete']}, 1, None, 'task_fail', {}, 'infra'),
    ('checkpoint with no collection error and no outcome', {'leadRoom': 'r-room', 'rooms': []}, 1, None, 'task_fail', {}, 'infra'),
    ('real deadline: final artifact, timedOut, exit 1, seats killed', final('proposal_open', True, seats=(None, None, None)), 1, None, 'task_fail', {}, 'timeout'),
    ('real deadline, workspace passes: still a timeout, not a pass', final('no_proposal', True, seats=(None, None, None)), 1, None, 'task_pass', {}, 'timeout'),
    ('concluded, exit 0, oracle passes', final('concluded', False, 'format.ts done'), 0, 'format.ts done', 'task_pass', {}, 'pass'),
    ('concluded, exit 0, oracle fails', final('concluded', False, 'format.ts done'), 0, 'format.ts done', 'task_fail', {}, 'fail'),
    ('seats left cleanly with nothing agreed before the deadline', final('no_proposal', False), 1, None, 'task_fail', {}, 'no_conclusion'),
    ('a seat crashed before the deadline, nothing agreed', final('no_proposal', False, seats=(0, 1, 0)), 1, None, 'task_fail', {}, 'infra'),
    ('launcher exit 2 (usage error) after a final artifact', final('no_proposal', False), 2, None, 'task_fail', {}, 'infra'),
    ('launcher exit 1 though the room concluded', final('concluded', False, 'done'), 1, 'done', 'task_pass', {}, 'infra'),
    ('lead-room payload error', {**final('proposal_open', True), 'collectionErrors': ['r-room payload: HTTP 500']}, 1, None, 'task_fail', {}, 'infra'),
    ('room missing', final('room_missing', False), 1, None, 'task_fail', {}, 'infra'),
    ('usage limit in a seat log', final('proposal_open', True), 1, None, 'task_fail', {'launcher_text': "w2 was stopped by the account's usage limit"}, 'infra'),
    ('two seats joined', final('proposal_open', True), 1, None, 'task_fail', {'joined': {'w1', 'verifier'}}, 'infra'),
    ('frozen hash changed', final('concluded', False, 'done'), 0, 'done', 'task_pass', {'unchanged': False}, 'infra'),
    ('scorer infrastructure_error', final('concluded', False, 'done'), 0, 'done', 'infrastructure_error', {}, 'infra'),
    ('runner guard stop', final('proposal_open', True), 1, None, 'task_fail', {'manifest': {'operator_stopped': 'runner_guard'}}, 'infra'),
    ('no result.json', None, 1, None, 'task_fail', {}, 'infra'),
]
bad = 0
for name, result, code, conclusion, reason, extra, want in CASES:
    with tempfile.TemporaryDirectory(prefix='classify-check-') as tmp:
        root = pathlib.Path(tmp)
        if result is not None: (root / 'result.json').write_text(json.dumps(result))
        state = dict(json=json, root=root, manifest={}, result=result or {}, room=(result or {}).get('leadRoom'), joined={'w1', 'w2', 'verifier'},
                     limit_re=LIMIT, launcher_text='', scored={'passed': reason == 'task_pass', 'reason': reason}, unchanged=True,
                     conclusion=conclusion, code=code, timed=bool(((result or {}).get('outcome') or {}).get('timedOut', False)))
        state.update(extra)
        exec(code_obj, state)
        ok = state['outcome'] == want
        bad += not ok
        print(('ok  ' if ok else 'FAIL'), f"{name}: outcome={state['outcome']} infra={state['infra']}" + ('' if ok else f' (want {want})'))
print(f'classify-check {ref or "worktree"}: {len(CASES) - bad}/{len(CASES)}')
sys.exit(1 if bad else 0)
