#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
  char line[512];
  while (fgets(line, sizeof line, stdin)) {
    char *nl = strchr(line, '\n'); if (nl) *nl = 0;
    char *tab = strchr(line, '\t'); if (!tab) continue; *tab = 0;
    double d = strtod(tab + 1, NULL);
    char out[4096];
    snprintf(out, sizeof out, line, d);
    printf("%s\n", out);
  }
  return 0;
}
