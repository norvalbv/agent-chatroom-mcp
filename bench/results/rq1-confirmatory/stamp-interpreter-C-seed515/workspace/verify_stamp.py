import sys

def parse(lines):
    return [l.split() for l in lines if l.strip() != ""]

with open("program.stamp") as f:
    lines = [l.rstrip("\n") for l in f]
toks = parse(lines)

# Build block structure: find matching END for each REPEAT/WHILE/IF/DEF at top-level parse
# We'll do a simple recursive-descent interpreter operating on a flat token stream with an index (program counter over statements).

procs = {}  # name -> (params, body_start, body_end) indices into toks
globals_ = {}
lists_ = {}

def find_end(i):
    depth = 1
    j = i+1
    while depth > 0:
        t = toks[j][0]
        if t in ("REPEAT","WHILE","IF","DEF"):
            depth += 1
        elif t == "END":
            depth -= 1
        j += 1
    return j-1  # index of matching END

class BreakExc(Exception): pass
class ContinueExc(Exception): pass
class RetExc(Exception):
    def __init__(self, val): self.val = val

def get_var(name, local, global_names):
    if name in global_names:
        return globals_.get(name, 0)
    if local is not None and name in local:
        return local[name]
    return globals_.get(name, 0)

def set_var(name, val, local, global_names):
    if name in global_names:
        globals_[name] = val
    elif local is not None:
        local[name] = val
    else:
        globals_[name] = val

def eval_expr(i, local, global_names):
    t = toks[i]
    tok = t[0] if len(t) else None
    # we operate token by token using a pointer approach instead; let's use a different structure
    raise Exception("unused")

# Since expressions are prefix and nested, better to tokenize whole program into a single token list with positions,
# and write a recursive parser for expressions given a position in a per-statement token list.

# Re-approach: represent program as list of statements (each a list of tokens), keep nesting via matching END using stack, similarly to above but operate per-statement-line since each line is one statement or a control header/END.

def is_int(s):
    if s.startswith('-') and len(s) > 1:
        return s[1:].isdigit()
    return s.isdigit()

def eval_tokens(tokens, pos, local, global_names):
    tok = tokens[pos]
    if is_int(tok):
        return int(tok), pos+1
    if tok == '+':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return a+b,pos
    if tok == '-':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return a-b,pos
    if tok == '*':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return a*b,pos
    if tok == '/':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        if b==0: return 0,pos
        return a//b,pos  # python floor div matches floor toward -inf
    if tok == '%':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        if b==0: return 0,pos
        return a - (a//b)*b, pos
    if tok == '<':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return (1 if a<b else 0),pos
    if tok == '=':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return (1 if a==b else 0),pos
    if tok == 'AND':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return (1 if (a!=0 and b!=0) else 0),pos
    if tok == 'OR':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return (1 if (a!=0 or b!=0) else 0),pos
    if tok == 'MIN':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return min(a,b),pos
    if tok == 'MAX':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        return max(a,b),pos
    if tok == 'POW':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        b,pos = eval_tokens(tokens,pos,local,global_names)
        if b<0: return 0,pos
        return a**b,pos
    if tok == 'NOT':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        return (1 if a==0 else 0),pos
    if tok == 'ABS':
        a,pos = eval_tokens(tokens,pos+1,local,global_names)
        return abs(a),pos
    if tok == 'NEXT':
        name = tokens[pos+1]
        pos2 = pos+2
        cur = get_var(name, local, global_names)
        newv = cur+1
        set_var(name, newv, local, global_names)
        return newv, pos2
    if tok == 'LEN':
        name = tokens[pos+1]
        lst = lists_.get(name, [])
        return len(lst), pos+2
    if tok == 'AT':
        name = tokens[pos+1]
        idxv, pos2 = eval_tokens(tokens, pos+2, local, global_names)
        lst = lists_.get(name, [])
        n = len(lst)
        realidx = idxv if idxv>=0 else n+idxv
        if 0 <= realidx < n:
            return lst[realidx], pos2
        return 0, pos2
    if tok == 'CALL':
        fname = tokens[pos+1]
        pos2 = pos+2
        if fname not in procs:
            return 0, pos2
        params, body = procs[fname]
        args = []
        for p in params:
            v, pos2 = eval_tokens(tokens, pos2, local, global_names)
            args.append(v)
        newlocal = {}
        newglobal_names = set()
        for pname, aval in zip(params, args):
            newlocal[pname] = aval
        result = run_block(body, newlocal, newglobal_names)
        return result, pos2
    # variable name
    return get_var(tok, local, global_names), pos+1

output = []

def run_block(stmts, local, global_names):
    i = 0
    try:
        while i < len(stmts):
            stmt = stmts[i]
            head = stmt[0]
            if head == 'SET':
                name = stmt[1]
                val,_ = eval_tokens(stmt, 2, local, global_names)
                set_var(name, val, local, global_names)
            elif head == 'SETS':
                v = stmt[1]; w = stmt[2]
                e_val, pos = eval_tokens(stmt, 3, local, global_names)
                f_val, pos = eval_tokens(stmt, pos, local, global_names)
                set_var(v, e_val, local, global_names)
                set_var(w, f_val, local, global_names)
            elif head == 'PRINT':
                val,_ = eval_tokens(stmt, 1, local, global_names)
                output.append(val)
            elif head == 'PUSH':
                name = stmt[1]
                val,_ = eval_tokens(stmt, 2, local, global_names)
                lists_.setdefault(name, []).append(val)
            elif head == 'GLOBAL':
                global_names.add(stmt[1])
            elif head == 'RET':
                val,_ = eval_tokens(stmt, 1, local, global_names)
                raise RetExc(val)
            elif head == 'BREAK':
                raise BreakExc()
            elif head == 'CONTINUE':
                raise ContinueExc()
            elif head == 'DEF':
                # handled at top-level scanning already, skip nested defs body but register now
                pass
            elif head in ('REPEAT','WHILE','IF'):
                pass
            elif head == '_BLOCKEND':
                pass
            i += 1
    except RetExc as r:
        raise
    return 0

# The above run_block doesn't handle nested control blocks (REPEAT/WHILE/IF) structurally.
# Let's restructure: build nested statement tree instead.

def build_tree(start, end):
    tree = []
    i = start
    while i <= end:
        stmt = toks[i]
        head = stmt[0]
        if head in ('REPEAT','WHILE','IF'):
            close = find_end(i)
            if head == 'IF':
                # check for ELSE
                depth = 0
                else_idx = None
                j = i+1
                while j < close:
                    t = toks[j][0]
                    if t in ('REPEAT','WHILE','IF','DEF'):
                        depth += 1
                    elif t == 'END':
                        depth -= 1
                    elif t == 'ELSE' and depth == 0:
                        else_idx = j
                    j += 1
                if else_idx is not None:
                    then_body = build_tree(i+1, else_idx-1)
                    else_body = build_tree(else_idx+1, close-1)
                    tree.append(('IF', stmt[1:], then_body, else_body))
                else:
                    body = build_tree(i+1, close-1)
                    tree.append(('IF', stmt[1:], body, None))
            else:
                body = build_tree(i+1, close-1)
                tree.append((head, stmt[1:], body))
            i = close+1
        elif head == 'DEF':
            close = find_end(i)
            fname = stmt[1]
            params = stmt[2:]
            body = build_tree(i+1, close-1)
            tree.append(('DEF', fname, params, body))
            i = close+1
        elif head == 'ELSE':
            i += 1
        else:
            tree.append(('STMT', stmt))
            i += 1
    return tree

full_tree = build_tree(0, len(toks)-1)

def exec_tree(tree, local, global_names):
    i = 0
    while i < len(tree):
        node = tree[i]
        kind = node[0]
        if kind == 'STMT':
            stmt = node[1]
            head = stmt[0]
            if head == 'SET':
                name = stmt[1]
                val,_ = eval_tokens(stmt, 2, local, global_names)
                set_var(name, val, local, global_names)
            elif head == 'SETS':
                v = stmt[1]; w = stmt[2]
                e_val, pos = eval_tokens(stmt, 3, local, global_names)
                f_val, pos = eval_tokens(stmt, pos, local, global_names)
                set_var(v, e_val, local, global_names)
                set_var(w, f_val, local, global_names)
            elif head == 'PRINT':
                val,_ = eval_tokens(stmt, 1, local, global_names)
                output.append(val)
            elif head == 'PUSH':
                name = stmt[1]
                val,_ = eval_tokens(stmt, 2, local, global_names)
                lists_.setdefault(name, []).append(val)
            elif head == 'GLOBAL':
                global_names.add(stmt[1])
            elif head == 'RET':
                val,_ = eval_tokens(stmt, 1, local, global_names)
                raise RetExc(val)
            elif head == 'BREAK':
                raise BreakExc()
            elif head == 'CONTINUE':
                raise ContinueExc()
        elif kind == 'DEF':
            fname = node[1]; params = node[2]; body = node[3]
            procs[fname] = (params, body)
        elif kind == 'IF':
            cond_tokens = node[1]
            val,_ = eval_tokens(cond_tokens, 0, local, global_names)
            if val != 0:
                exec_tree(node[2], local, global_names)
            elif node[3] is not None:
                exec_tree(node[3], local, global_names)
        elif kind == 'REPEAT':
            cond_tokens = node[1]
            n,_ = eval_tokens(cond_tokens, 0, local, global_names)
            body = node[2]
            count = 0
            while count < n:
                count += 1
                try:
                    exec_tree(body, local, global_names)
                except BreakExc:
                    break
                except ContinueExc:
                    continue
        elif kind == 'WHILE':
            cond_tokens = node[1]
            body = node[2]
            while True:
                val,_ = eval_tokens(cond_tokens, 0, local, global_names)
                if val == 0:
                    break
                try:
                    exec_tree(body, local, global_names)
                except BreakExc:
                    break
                except ContinueExc:
                    continue
        i += 1

# fix run_block/CALL to use exec_tree
def run_block(body, local, global_names):
    try:
        exec_tree(body, local, global_names)
    except RetExc as r:
        return r.val
    return 0

exec_tree(full_tree, None, set())

print(" ".join(str(x) for x in output))
