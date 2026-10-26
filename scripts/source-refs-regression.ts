/** One outside source has one id however a seat wrote it: npx tsx scripts/source-refs-regression.ts
 * In swarm-164210-9f66 the owner handed the room two GitHub repos (resource/jmazzini-5m-poly-bot, 20 min in), a scout
 * reached the same repos through api.github.com and raw.githubusercontent.com, and nothing could say whether a source
 * was handed in or found, or found twice: settled.ts knew arXiv ids and DOIs only (inputs/owner-2, inputs/owner-4).
 * refsIn() is the one normaliser the prior-art and re-research measures share. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { refsIn } from "../src/telemetry/source-refs.ts";

test("an arXiv paper is one id in every spelling", () => {
  for (const t of ["arXiv:2409.07440", "arXiv: 2409.07440", "https://arxiv.org/abs/2409.07440v2", "arxiv.org/pdf/2409.07440", "see 2409.07440."]) {
    assert.deepEqual(refsIn(t), ["arXiv:2409.07440"], t);
  }
  assert.deepEqual(refsIn("https://export.arxiv.org/api/query?id_list=2409.07440,2508.18993"), ["arXiv:2409.07440", "arXiv:2508.18993"]);
  assert.deepEqual(refsIn("arXiv:cs/9810005"), ["arXiv:cs/9810005"]);
});

test("a number that cannot be an arXiv id is not one", () => {
  // the month part of a new-style id is 01-12, the year 07 or later
  assert.deepEqual(refsIn("filled at 1234.5678, epoch 1792886400.123, 2026.10261 shares, 0.94 to 0.99"), []);
});

test("a GitHub repo is one id from the site, the API, raw files, codeload and gh", () => {
  for (const t of [
    "https://github.com/jmazzini/5m-poly-bot",
    "git clone https://github.com/JMazzini/5m-poly-bot.git /tmp/x",
    "github.com/jmazzini/5m-poly-bot/blob/main/crypto_bot.py",
    "curl -s https://api.github.com/repos/jmazzini/5m-poly-bot",
    "raw.githubusercontent.com/jmazzini/5m-poly-bot/main/README.md",
    "https://codeload.github.com/jmazzini/5m-poly-bot/tar.gz/main",
    "gh repo clone jmazzini/5m-poly-bot -- --depth 1",
  ]) assert.deepEqual(refsIn(t), ["gh:jmazzini/5m-poly-bot"], t);
});

test("GitHub pages that are not a repo are not repos", () => {
  assert.deepEqual(refsIn("https://github.com/search?q=polymarket+bot https://github.com/topics/polymarket api.github.com/search/repositories?q=x api.github.com/rate_limit"), []);
});

test("DOIs, PyPI and npm packages", () => {
  assert.deepEqual(refsIn("doi 10.1145/2363.2433, then https://doi.org/10.1037/0033-295X.106.4.643."), ["doi:10.1145/2363.2433", "doi:10.1037/0033-295x.106.4.643"]);
  assert.deepEqual(refsIn("https://pypi.org/project/py-clob-client/ and https://www.npmjs.com/package/@polymarket/clob-client"), ["pypi:py-clob-client", "npm:@polymarket/clob-client"]);
});

test("other web pages only when asked, never a local one", () => {
  const t = "read https://docs.polymarket.com/programs/taker-rebates.md#tiers and http://127.0.0.1:7760/rooms/x and https://Help.Polymarket.com/en/articles/1/";
  assert.deepEqual(refsIn(t), []);
  assert.deepEqual(refsIn(t, { pages: true }), ["docs.polymarket.com/programs/taker-rebates.md", "help.polymarket.com/en/articles/1"]);
});

test("each id once, in the order first written", () => {
  assert.deepEqual(refsIn("arXiv:2409.07440 github.com/a/b arxiv.org/abs/2409.07440 api.github.com/repos/A/B"), ["arXiv:2409.07440", "gh:a/b"]);
});
