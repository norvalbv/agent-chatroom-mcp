/* libc oracle helper for gen-cases.mjs. stdin lines: fmt \t types \t v1 \t v2 \t v3
 * types: i/l = integer (passed in an 8-byte slot, so %d reads its low 32 bits like C would after conversion),
 * s = string, d = double (only the patterns d, id, iid are supported). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
  static char line[4096], out[8192], strs[3][512];
  while (fgets(line, sizeof line, stdin)) {
    char *nl = strchr(line, '\n'); if (nl) *nl = 0;
    char *f[6] = {0}; int n = 0; char *p = line;
    while (n < 6) { f[n++] = p; char *t = strchr(p, '\t'); if (!t) break; *t = 0; p = t + 1; }
    const char *fmt = f[0], *types = f[1];
    long long slot[3] = {0, 0, 0}; double dv = 0;
    for (int k = 0; types[k] && k < 3; k++) {
      const char *v = f[2 + k];
      if (types[k] == 's') { strncpy(strs[k], v, 511); slot[k] = (long long)(size_t)strs[k]; }
      else if (types[k] == 'd') dv = strtod(v, NULL);
      else if (v[0] == '-') slot[k] = strtoll(v, NULL, 10);
      else slot[k] = (long long)strtoull(v, NULL, 10);
    }
    if (!strcmp(types, "d")) snprintf(out, sizeof out, fmt, dv);
    else if (!strcmp(types, "id")) snprintf(out, sizeof out, fmt, (int)slot[0], dv);
    else if (!strcmp(types, "iid")) snprintf(out, sizeof out, fmt, (int)slot[0], (int)slot[1], dv);
    else snprintf(out, sizeof out, fmt, slot[0], slot[1], slot[2]);
    puts(out);
  }
  return 0;
}
