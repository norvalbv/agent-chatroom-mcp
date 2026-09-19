import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
const root=resolve('.'),h=createHash('sha256');
function visit(p){const s=lstatSync(p);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory()){for(const n of readdirSync(p).sort())if(n!=='.git')visit(join(p,n));}else if(s.isFile()){h.update(relative(root,p));h.update('\0');h.update(readFileSync(p));h.update('\0');}}
visit(root);console.log(h.digest('hex'));
