# AllAnime (mkissa.to / api.mkissa.net) investigation — 2026-09-09

Context: after AnimePahe turned out to be a genuine dead end (see
`investigation-t1m-megaplay-2026-09-07.md`'s three 2026-09-09 follow-ups), the user separately
flagged two other leads they'd found while researching: AllAnime (github.com/topics/allanime-api)
and `anipy-cli` (github.com/sdaqo/anipy-cli). This is the trail for AllAnime, which turned out to
be real and (with real, non-trivial effort) working.

---

## Finding a real, currently-maintained reference implementation

**Command (checking anipy-cli's own provider list via the GitHub API, rather than guessing file
paths):**
```
GET https://api.github.com/repos/sdaqo/anipy-cli/git/trees/master?recursive=1
```
**Result:** `api/src/anipy_api/provider/providers/` contains `allanime_provider.py`,
`anidbapp_provider.py`, `animehub_provider.py`, `animekai_provider.py`, `native_provider.py` -
**no `animepahe_provider.py` at all**. Confirms AnimePahe support was dropped entirely from this
actively-maintained tool - consistent with everything found investigating it directly.

**Command (pulling the real, current AllAnime provider source):**
```
GET https://raw.githubusercontent.com/sdaqo/anipy-cli/master/api/src/anipy_api/provider/providers/allanime_provider.py
```
**Result:** a complete, real, working Python implementation (471 lines). Full mechanism:
- `NAME: allanime`, `BASE_URL: https://mkissa.to`, `API_URL: https://api.mkissa.net/api` - a
  GraphQL-ish API (persisted queries, not raw GraphQL query text over the wire).
- `get_search`/`get_episodes`/`get_info` use hardcoded, apparently-stable persisted-query SHA256
  hashes and work with a plain `Referer: https://allmanga.to/` header - no crypto involved.
- `get_video` (the actual source-resolving call) is the hard part - see below.

## Diagnosing why a direct port immediately failed: a stale, abandoned keygen feed

`get_video` depends on a **dynamic, time-boxed request-signing token** (`aaReq`), built from
values fetched from:
```
https://raw.githubusercontent.com/sdaqo/anipy-cli/refs/heads/key-gen/scripts/keygen/keygen.json
```
(`build_id`, `epoch`, `lane`, `key`, `query_hash`, `static_key`) - a JSON feed the anipy-cli
project auto-regenerates via its own CI, committed to a dedicated `key-gen` branch.

**Command (porting `build_source_request`/`decode_tobeparsed` to Node, testing live against a
real search result):**
```js
// AES-256-GCM encrypt {v,ts,epoch,buildId,qh,k} with keygen.key, IV = SHA256(epoch:qh:ts)[:12]
```
**Result:** search worked cleanly (real results, e.g. malId-equivalent show ids for Solo
Leveling), but `get_video` returned `{"errors":[{"message":"PersistedQueryNotFound", ...}]}`.

**Command (checking whether the keygen feed itself is stale, via its own commit history):**
```
GET https://api.github.com/repos/sdaqo/anipy-cli/commits?sha=key-gen&path=scripts/keygen/keygen.json
```
**Result:** daily "ci: update generated keygen.json" commits, then **nothing since 2026-08-03**
(a "fix: keygen" commit, then silence) - over five weeks stale as of this investigation
(2026-09-09). Cross-checked against the project's own GitHub issues
(`?q=is:issue keygen OR PersistedQuery OR allanime`): a fresh open issue from the day before
this investigation (#358, "no provider ?"), plus a recurring history of the exact same failure
(#352, #343, #342, #348, #339 - all "AllAnime changed something again", spanning back to July).
**Conclusion: the maintainer's own automation is currently broken too, not just us** - this is a
real, live, currently-unresolved problem for the upstream project itself, not something specific
to how this codebase would call it.

## Reading the real keygen GENERATION script (not just its stale output)

**Command:**
```
GET https://api.github.com/repos/sdaqo/anipy-cli/git/trees/key-gen?recursive=1
→ GET .../key-gen/scripts/keygen/keygen.py (raw)
```
**Result:** the actual algorithm the broken CI used to run. Genuinely sophisticated, multi-stage:
1. Fetch `mkissa.to`'s HTML, regex out the current `/entry/app.<hash>.js` bundle URL.
2. Fetch that bundle, regex out up to 5 chunk URLs, keep the one containing
   `VaildTranslationTypeEnumType` or `x-aa-boot` (the crypto/query logic lives there).
3. Regex out `build_id` and `lane` (`k7`/`k9`/`k2`) directly from that chunk.
4. `epoch` is pure math from the current timestamp (`now_ms // 259_200_000`, with a rollover
   adjustment) - no scraping needed for this one field.
5. **Depends on a SEPARATE third-party tool** (`git clone https://github.com/mbpowers/ani-extract`,
   `npm i`, `node ani-extract.js ./chunk.js`) to deobfuscate embedded base64 "crypto mask blocks"
   from the chunk - this is itself an external dependency the whole recipe leans on.
6. `mask = XOR-transform of the deobfuscated bytes, keyed by build_id`; `hmac_key =
   HMAC-SHA256(mask, "aa-boot:{build_id}")`; `aa_boot = HMAC-SHA256(hmac_key,
   "{build_id}:mkissa:mkissa.to:{epoch}:{lane}").hex()`.
7. `GET https://api.mkissa.net/client-crypto/v1/bootstrap?buildId=&k=` with `x-aa-boot`/
   `x-build-id` headers → real server response `{epoch, k, partB}`.
8. **Final key = `XOR(mask, base64decode(partB))`** - combines a client-computed value with a
   server-issued one, so the key can never be derived from static JS analysis alone even with
   the mask cracked.
9. `query_hash` separately: find a `\nquery(...` template literal in the same chunk containing
   `sourceUrls`/`episode(`, resolve its `${...}` interpolations by recursively looking up
   matching variable/helper-function definitions elsewhere in the chunk, then SHA256 the fully
   resolved query text.

**Why this matters:** this complexity is very plausibly *why* the upstream CI died - any single
link breaking (chunk structure change, `ani-extract` itself breaking, a new obfuscation pass)
kills the whole chain. Confirmed live that steps 1-3 still work today (mkissa.to has NO
Cloudflare wall at all, unlike animepahe.pw) except the `build_id` regex specifically, which had
gone stale (site's own variable name changed since the script was last updated).

## The actual fix: hook the browser's real crypto calls instead of statically deobfuscating

Rather than manually tracing the obfuscated string-array rotation to fix the `build_id` regex
(or reimplementing the third-party `ani-extract` dependency), reused the exact technique that
already worked for MegaPlay's own HMAC secret earlier this investigation (see
`investigation-t1m-megaplay-2026-09-07.md`'s "Follow-up 3"): hook `SubtleCrypto.prototype`
directly in a real (stealth) Puppeteer session and capture the actual live key material as the
site's own JS uses it.

**Command:**
```js
await page.evaluateOnNewDocument(() => {
  const orig = SubtleCrypto.prototype.importKey;
  SubtleCrypto.prototype.importKey = function (format, keyData, algorithm, extractable, usages) {
    // log algorithm.name, usages, and the raw key bytes as hex
    return orig.apply(this, arguments);
  };
});
await page.goto('https://mkissa.to/anime/B6AMhLy6EQHDgYgBF', { waitUntil: 'networkidle2' });
```
**Result - captured directly from real WebCrypto calls, zero static deobfuscation needed:**
- Real, current `build_id: "166"` (the stale feed had `"81"` - genuinely, badly outdated).
- Real, current `lane: "k7"` (matched the regex-extracted value - consistency check passed).
- Real bootstrap response: `{"epoch":2957, "partB":"0M3a/rOE8dmkIAc5mXwvsorKaTWGbLq1rTm9yMUoL1o=", "k":"k7", ...}`.
- Two AES-256-GCM keys imported. The first (used on initial page load) later failed with
  `AA_CRYPTO_STALE` when tested - clearly an old/rotating key already superseded by the time it
  was captured. The second worked correctly (see below).
- Also captured two HMAC-SHA256 key imports (the `hmac_key`/`aa_boot` chain from the Python
  script), not directly needed once the final AES key was captured directly.

**Command (finding the current `query_hash` via pure static extraction from the chunk already
downloaded, reusing `source_query_hash()`'s exact resolve-then-SHA256 logic, ported to JS):**
Fully resolved a 574-character query template (recursively resolving nested `${...}`
interpolations against other variables/helper functions in the same chunk file) and hashed it.
**Result:** `1c836a5028e04275c6bc618aa4d1f0ea2290a73bc056ba6a8b93fe72ef42fd04` - a fresh, current
hash, genuinely different from the stale feed's `6b48b24c...`.

**Command (assembling all captured/derived values - build_id 166, lane k7, epoch 2957 from the
live bootstrap response, the fresh query_hash, both captured AES keys - into a real, fresh
`get_video` request):**
```js
// aaReq = base64(0x01 + iv + AES-256-GCM-encrypt({v,ts,epoch,buildId,qh,k}, key) + tag)
// GET api.mkissa.net/api?variables=...&extensions={persistedQuery:{sha256Hash:qh}, aaReq, k}
```
**Result with key 0 (the one already flagged as possibly stale):** `AA_CRYPTO_STALE` - confirms
it really was outdated, consistent with it being captured at initial page load before something
rotated. **Result with key 1: a real 200 response with `data.tobeparsed`** - the query_hash and
request-signing were both correct.

**Note on a real debugging trap hit along the way:** hand-copying a captured hex key string out
of a terminal display led to a silently-truncated/miscounted string twice in a row (an
odd-length hex string that should be impossible) - purely a transcription error, not a real
data issue. Fixed by writing captured values straight to JSON files and reading them back
programmatically instead of ever retyping them by hand - a good general lesson for any future
key-capture work like this.

**Command (decrypting `tobeparsed` with the same working key):**
```js
// same AES-256-GCM scheme as the request itself: raw[0]=version, raw[1:13]=iv,
// raw[13:-16]=ciphertext, raw[-16:]=tag
```
**Result: clean decrypt, real JSON** - `episode.sourceUrls[]` with providers `Ak, Ok, Sw,
Fm-Hls, Mp4, Vg, Yt-mp4`, each `sourceUrl` XOR-obfuscated per the Python script's `_decrypt()`
(pairs of hex digits, `dec ^ 56`, after stripping literal `--` from the string).

**Command (XOR-decrypting the `Ak` provider's sourceUrl, fetching the resulting `clock.json`
URL, both immediately in the same run to avoid any staleness gap):**
```js
const decryptedPath = xorDecrypt(sourceUrl.replace(/--/g,'')).replace('clock','clock.json');
// -> https://allanime.day/apivtwo/clock.json?id=<xor-decrypted opaque id>
```
**Result: real JSON with `links[].rawUrls.vids[]`** - genuine, high-quality (up to 3840x2160/4K
seen live) direct video segment URLs on `upos-bstar1-mirrorakam.akamaized.net` (a legitimate,
Akamai-fronted Bilibili mirror - real infrastructure, not a sketchy proxy). Also got a directly
usable `Yt-mp4` provider URL (`tools.fast4speed.rsvp/media9/videos/...`) without needing the
XOR-decrypt/clock.json hop at all.

**Command (verifying the final Akamai URL is actually fetchable server-side, not itself behind
another wall - the same immediate-fresh-run discipline, since a `HEAD` on a stale copy of this
exact URL 404'd earlier in testing, and the `tools.fast4speed.rsvp` URL also 404'd once tested a
few minutes after being captured, consistent with short-lived signed tokens):**
```js
axios.get(rawVideoUrl, { headers: { Range: 'bytes=0-100' } })
```
**Result: `206 Partial Content`, `content-type: video/mp4`. Real, genuine video bytes.**
(A plain `HEAD` request got `403` on the same URL - some CDNs reject HEAD specifically; GET with
Range is the correct way to probe these, not a sign of failure.)

## Status: fully proven working, end-to-end, live. Not yet built into the real site.

Every step verified independently and then verified together in one fresh, immediate run:
search → episode lookup → signed request → decrypt → provider URL decrypt → real fetchable
video bytes. This is a genuinely different outcome than AnimePahe - not "sometimes exists
depending on unrelated user activity", a real, currently-working extraction with only external
dependency being the site's own occasionally-changing internals (which the upstream project's
own multi-month issue history shows happens every few weeks, requiring re-capture - a real
ongoing maintenance cost, flagged to the user and accepted before starting this).

**Not yet done (next session's work):**
- A periodic (Puppeteer-based) background refresh job to keep `build_id`/`lane`/`epoch`/
  `query_hash`/the AES key fresh automatically, rather than the values captured today going
  stale the same way the upstream project's own abandoned feed did.
- A clean Node.js port of the full pipeline as real `Backend/server.js` code (today's work was
  all disposable one-off test scripts in `Backend/_*.js`, not committed).
- Player integration - a new anime server, and specifically handling that AllAnime's real
  response is DASH-shaped (`rawUrls.vids[]`, multiple quality URLs) rather than a single HLS
  playlist like most other providers here - needs a different consumption path than the usual
  `showVideoPlayer(m3u8Url, ...)` call.
