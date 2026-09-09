# AllAnime (mkissa.to / api.mkissa.net) — full reproducible runbook

This is a step-by-step, copy-pasteable recipe, not just a summary — every command here was
actually run on 2026-09-09 and produced the exact output shown. For the narrative trail (why each
step was taken, what was tried and ruled out first) see `investigation-allanime-2026-09-09.md`.
This file is the "how to just do it again" version.

**Reference implementation this is ported from (Python, real, actively maintained):**
`https://raw.githubusercontent.com/sdaqo/anipy-cli/master/api/src/anipy_api/provider/providers/allanime_provider.py`
— if any step here stops working, that file (and the keygen script below) is the first place to
recheck; it may have been updated to match a site change.

---

## Part 0 — background facts worth knowing before touching this

- **Site**: `https://mkissa.to` (frontend), `https://api.mkissa.net/api` (GraphQL-ish API,
  persisted queries — the client sends a SHA256 hash of the query text, not the query text
  itself, except for episode-source lookups which need a client-computed signed token too).
  `https://allanime.day` is a separate domain used only for the final source-URL resolution step.
- **No Cloudflare wall on mkissa.to or api.mkissa.net** — confirmed live, plain `axios`/`curl`
  reach both fine, real HTML/JSON back immediately. This is a much friendlier target than
  AnimePahe/kwik.cx, which are both genuinely Cloudflare-protected.
- **This breaks periodically** — the upstream `anipy-cli` project has a whole history of GitHub
  issues titled things like "AllAnime changed something again" (#352, #348, #343, #342, #339, and
  a fresh one, #358, opened the day before this was written). Expect to redo Part 3 below every
  so often. Their own auto-updating keygen feed (see Part 2) went stale on 2026-08-03 and never
  recovered — that's a live example of exactly this happening.
- **Three separate identifiers get confused easily — keep them straight:**
  - `identifier` / `showId` — AllAnime's own internal show id (e.g. `B6AMhLy6EQHDgYgBF` for Solo
    Leveling), returned by search. Nothing to do with MAL id.
  - `build_id` — a version number for the current site build (e.g. `166`), changes whenever they
    deploy. Read live off the frontend's own JS.
  - `query_hash` — SHA256 of the exact GraphQL query text used for episode-source lookups.
    Changes whenever they touch that query's shape in a deploy. Read live off the frontend's own
    JS (different chunk file than build_id, same overall technique).

---

## Part 1 — search and episode listing (no crypto needed, works as-is)

These two calls use fixed, apparently-stable persisted-query hashes. If they ever start failing
with `PersistedQueryNotFound`, the fix is to re-derive these two hashes the same way Part 3 below
derives the harder one (find the query template in the site's JS, resolve it, SHA256 it) — but as
of 2026-09-09 these have not needed touching.

**Search:**
```js
const axios = require('axios');

async function search(query) {
  const variables = {
    search: { query }, limit: 26, page: 1,
    translationType: 'sub', countryOrigin: 'ALL'
  };
  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash: 'a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c'
    }
  };
  const res = await axios.post('https://api.mkissa.net/api',
    { variables, extensions },
    {
      params: { variables: JSON.stringify(variables), extensions: JSON.stringify(extensions) },
      headers: { Referer: 'https://allmanga.to/', 'Content-Type': 'application/json' },
      timeout: 10000
    }
  );
  return res.data.data.shows.edges; // [{ _id, name, availableEpisodes: {sub, dub, raw}, ... }]
}
```
**Verified live result** (query "Solo Leveling"):
```json
[
  { "_id": "9NdrgcZjsp7HEJ5oK", "name": "Ore dake Level Up na Ken Season 2: Arise from the Shadow" },
  { "_id": "B6AMhLy6EQHDgYgBF", "name": "Ore dake Level Up na Ken" }
]
```
Note: results are NOT sorted by relevance — the real Python provider sorts client-side by
Levenshtein ratio against the query. Worth doing the same, or at minimum preferring an exact
`englishName` match if the full `get_info` response is fetched (see below).

**Get episode count / info** (same API, different fixed hash, POST-shaped like search but simpler
variables):
```js
async function getInfo(showId) {
  const variables = { _id: showId };
  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash: '043448386c7a686bc2aabfbb6b80f6074e795d350df48015023b079527b0848a'
    }
  };
  const res = await axios.post('https://api.mkissa.net/api',
    { variables: JSON.stringify(variables), extensions: JSON.stringify(extensions) },
    {
      params: { variables: JSON.stringify(variables), extensions: JSON.stringify(extensions) },
      headers: { Referer: 'https://allmanga.to/' }, timeout: 10000
    }
  );
  return res.data.data.show; // includes availableEpisodesDetail.{sub,dub}: [episode number strings]
}
```

---

## Part 2 — the OLD way to get fresh crypto values (currently broken, documented anyway)

The upstream project auto-generates a `keygen.json` feed here:
```
https://raw.githubusercontent.com/sdaqo/anipy-cli/refs/heads/key-gen/scripts/keygen/keygen.json
```
Shape: `{"build_id","epoch","lane","key","query_hash","static_key"}`. **As of 2026-09-09 this has
not updated since 2026-08-03 — do not trust it, always re-derive fresh per Part 3.** Check
freshness first if ever tempted to use it directly:
```
GET https://api.github.com/repos/sdaqo/anipy-cli/commits?sha=key-gen&path=scripts/keygen/keygen.json&per_page=1
```
If the top commit is recent (daily "ci: update generated keygen.json" messages, not a gap of
weeks), the feed can be trusted directly and Part 3 can be skipped. Also worth checking open
issues first (`https://github.com/sdaqo/anipy-cli/issues?q=is%3Aissue+keygen+OR+PersistedQuery`)
— if the maintainer's own CI is currently broken, re-deriving values live (Part 3) is the only
option regardless of what the feed says.

The real generation algorithm, if the feed is ever trustworthy and just needs replicating instead
of live-capturing: `https://raw.githubusercontent.com/sdaqo/anipy-cli/key-gen/scripts/keygen/keygen.py`
— genuinely complex (site HTML → app.js → chunk → a THIRD-PARTY tool
`github.com/mbpowers/ani-extract` to deobfuscate an embedded "crypto mask" → HMAC chain → a live
`/client-crypto/v1/bootstrap` API call → XOR-combine the mask with the server's response). **Part
3 below sidesteps needing to understand or replicate any of this** by capturing the final result
directly from a real browser's own WebCrypto calls instead.

---

## Part 3 — deriving fresh crypto values live (THE step to redo when things break)

### 3a. Get the current `build_id` and `lane`

```js
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CDN_IMMUTABLE = 'https://cdn.mkissa.net/all/mk/_app/immutable';

async function findTargetChunk() {
  const html = await axios.get('https://mkissa.to/', { headers: { 'User-Agent': UA } }).then(r => r.data);
  const appUrl = CDN_IMMUTABLE + html.match(/\/entry\/app\.[A-Za-z0-9_.-]+\.js/)[0];
  const appJs = await axios.get(appUrl, { headers: { 'User-Agent': UA } }).then(r => r.data);
  const chunkPaths = [...appJs.matchAll(/"\.\.\/(chunks\/[A-Za-z0-9_.-]+\.js)"/g)].map(m => m[1]).slice(0, 5);
  for (const chunk of chunkPaths) {
    const chunkJs = await axios.get(`${CDN_IMMUTABLE}/${chunk}`, { headers: { 'User-Agent': UA } }).then(r => r.data);
    if (chunkJs.includes('VaildTranslationTypeEnumType') || chunkJs.includes('x-aa-boot')) {
      return chunkJs; // this is "the target chunk" referenced throughout the rest of this doc
    }
  }
  throw new Error('target chunk not found - site structure likely changed, re-check chunk selection heuristic');
}
```
**Verified live:** app.js was `https://cdn.mkissa.net/all/mk/_app/immutable/entry/app.DwQcusLY.js`
(this hash changes every deploy, always re-fetch, never hardcode). The target chunk was
`chunks/BVxTyUEI.js` (~1.1MB minified) — also expect this filename to change on every deploy.

**Extracting `lane`** (small, stable-shaped regex, worked as-is):
```js
const laneMatch = chunkJs.match(/const \w\w?="(k[0-9]+)"/);
// -> "k7" as of 2026-09-09. Valid set was {k7, k9, k2} per the chunk's own i4=new Set([...]).
```

**Extracting `build_id` — this is the one that breaks most easily, and DID break during this
session.** The OLD approach (from `keygen.py`) was a direct regex:
`/!=="string"\?"([0-9]+)"/` — **this no longer matches** as of 2026-09-09; the site's own
obfuscated variable naming shifted. If that regex fails, trace it manually:
1. Search the chunk for `buildId:Fr` (or whatever short variable name appears repeatedly next to
   `buildId:`) — this identifies which variable actually holds the value.
2. Find where that variable is assigned: search for `` const Fr=oy() ``  (or equivalent — the
   exact function name will differ per deploy, but the pattern "one-letter/two-letter
   `const X = someFunctionCall()`, immediately after a large IIFE block" is consistent).
3. Follow into that function: `` function oy(){ ... return t.someObfuscatedMethod(cd,"") } `` —
   this is a generic `n || fallback` pattern; the REAL value is in the OTHER referenced variable
   (`cd` in this example), not literally computed by the function.
4. Find where THAT variable is assigned: `` const cd=fr(296) ``, then `` function fr(e,t){return
   Vr(e- -271)} ``, then `` function Vr(e,t){return e=e-468,Xc()[e]} `` — a classic
   javascript-obfuscator.io string-table lookup chain (offset math into a shuffled array
   returned by a function like `Xc()`).
5. **At this point, stop manually tracing and use Part 3b instead** — resolving the actual
   shuffled string array by hand is realistically not worth it; a real browser already does this
   correctly as a side effect of just loading the page.

### 3b. Capture the REAL, final values from a live browser instead of manually deobfuscating

This is the actual technique that worked. Requires `puppeteer-extra` +
`puppeteer-extra-plugin-stealth` (both already dependencies in this repo's `Backend/`).

```js
const puppeteerExtra = require('puppeteer-extra');
puppeteerExtra.use(require('puppeteer-extra-plugin-stealth')());

const browser = await puppeteerExtra.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setUserAgent(UA);

// Hook BEFORE navigation so it's in place before any of the site's own scripts run.
await page.evaluateOnNewDocument(() => {
  window.__cryptoLog = [];
  const origImportKey = SubtleCrypto.prototype.importKey;
  SubtleCrypto.prototype.importKey = function (format, keyData, algorithm, extractable, usages) {
    try {
      const bytes = keyData instanceof ArrayBuffer ? new Uint8Array(keyData) : new Uint8Array(keyData.buffer || keyData);
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      window.__cryptoLog.push({ algorithm: algorithm.name, usages, byteLength: bytes.length, hex });
    } catch (e) {}
    return origImportKey.apply(this, arguments);
  };
});

// Also capture the bootstrap response directly - it hands back the real, current `epoch` and
// `partB` (the server half of the final AES key derivation) without needing to compute anything.
let bootstrapData = null;
page.on('response', async res => {
  if (/client-crypto\/v1\/bootstrap/i.test(res.url())) {
    try { bootstrapData = await res.json(); } catch (e) {}
  }
});

// Navigate to any real show page - the bootstrap + key derivation happens on ordinary page load,
// no need to actually start playback.
await page.goto('https://mkissa.to/anime/B6AMhLy6EQHDgYgBF', { waitUntil: 'networkidle2', timeout: 30000 });

const cryptoLog = await page.evaluate(() => window.__cryptoLog);
await browser.close();

// cryptoLog now contains every AES-GCM/HMAC key the page imported, in hex, with real byte
// lengths. bootstrapData contains the real, live {epoch, partB, k}.
```

**Verified live result (2026-09-09, DO NOT reuse these values — they rotate, this is only to show
the shape):**
```
bootstrapData = {"epoch":2957,"epochMs":604800000,"graceMs":86400000,
                 "switchAt":1789084800000,"partB":"0M3a/rOE8dmkIAc5mXwvsorKaTWGbLq1rTm9yMUoL1o=","k":"k7"}
cryptoLog contains 2 HMAC-SHA256 keys (32 bytes each) and 2 DISTINCT AES-GCM keys (32 bytes
  each) - one imported at page load (later confirmed STALE, see 3c), one that turned out correct.
```

**Real bug hit here, worth knowing about in advance:** hand-copying a hex key string out of a
terminal display silently truncated/miscounted it TWICE in a row (an impossible odd-length hex
string both times — terminal line-wrapping makes this an easy mistake). **Always write captured
values straight to a JSON file and read them back programmatically — never retype a captured key
by hand.**
```js
require('fs').writeFileSync('./captured.json', JSON.stringify({ bootstrapData, cryptoLog }));
```

### 3c. Get the current `query_hash` (separate from everything above, pure static extraction)

This is the one piece that genuinely can be derived by static analysis alone, no browser needed —
port of `keygen.py`'s own `source_query_hash()`:

```js
const crypto = require('crypto');

function findQueryHash(chunkJs) {
  const templates = [...chunkJs.matchAll(/(\nquery\([^`]*)`/g)].map(m => m[1]);
  const template = templates.find(t => t.includes('sourceUrls') && t.includes('episode('));
  if (!template) throw new Error('query template not found');

  function resolve(tmpl, depth = 0) {
    if (depth > 6) return tmpl;
    for (const name of [...tmpl.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1])) {
      let repl = '';
      if (name.endsWith('()')) {
        const fnName = name.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const fn = chunkJs.match(new RegExp(fnName + '\\s*=\\s*\\w+\\s*=>\\s*\\w+\\s*\\?\\s*`[^`]*`\\s*:\\s*`([^`]*)`'));
        repl = fn ? resolve(fn[1], depth + 1) : '';
      } else {
        const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const v = chunkJs.match(new RegExp(escName + '\\s*=\\s*`([^`]*)`'));
        repl = v ? resolve(v[1], depth + 1) : '';
      }
      tmpl = tmpl.split('${' + name + '}').join(repl);
    }
    return tmpl;
  }

  const query = resolve(template);
  if (query.includes('${')) throw new Error('unresolved interpolation remains: ' + query);
  return crypto.createHash('sha256').update(query).digest('hex');
}
```
**Verified live result:** `1c836a5028e04275c6bc618aa4d1f0ea2290a73bc056ba6a8b93fe72ef42fd04`
(the stale keygen feed had a completely different hash, `6b48b24c...` — confirms this really does
rotate and the feed really is out of date).

### 3d. Confirm which of the captured AES keys actually works (there'll often be more than one)

The page-load flow can import a key that's about to be superseded (rotates on a schedule, or the
bootstrap response updates it) — don't assume the first one captured is the right one. Test each
against a real request and trust whichever one doesn't error:

```js
function buildAareq(buildId, lane, epoch, queryHash, keyHex) {
  const ts = Math.floor(Date.now() / 300000) * 300000; // 5-minute buckets
  const payload = JSON.stringify({ v: 1, ts, epoch, buildId, qh: queryHash, k: lane });
  const iv = crypto.createHash('sha256').update(`${epoch}:${queryHash}:${ts}`).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, ciphertext, tag]).toString('base64');
}
```
**Verified live:** the FIRST captured key (imported right at page load) got
`{"errors":[{"message":"AA_CRYPTO_STALE", "extensions":{"code":"AA_CRYPTO_STALE"}}]}` — a
genuine, explicit "this key is old" error from the server, not a guess. The SECOND captured key
got a real `200` with an encrypted `data.tobeparsed` payload. **Lesson: if `AA_CRYPTO_STALE`
comes back, just try the next captured key — this is an expected, self-diagnosing failure mode,
not a sign the whole approach is wrong.**

---

## Part 4 — the actual `get_video` call and decrypting its response

```js
async function getVideo(showId, episodeString, translationType, { buildId, lane, epoch, queryHash, keyHex }) {
  const aaReq = buildAareq(buildId, lane, epoch, queryHash, keyHex);
  const variables = { showId, translationType, episodeString };
  const extensions = { persistedQuery: { version: 1, sha256Hash: queryHash }, aaReq, k: lane };
  const res = await axios.get('https://api.mkissa.net/api', {
    params: { variables: JSON.stringify(variables), extensions: JSON.stringify(extensions) },
    headers: { Referer: 'https://mkissa.to', Origin: 'https://mkissa.to', 'x-build-id': buildId, 'User-Agent': UA },
    timeout: 10000
  });
  let data = res.data.data;
  if (data.tobeparsed) {
    const raw = Buffer.from(data.tobeparsed, 'base64');
    const iv = raw.subarray(1, 13), ciphertext = raw.subarray(13, raw.length - 16), tag = raw.subarray(raw.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    decipher.setAuthTag(tag);
    data = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  }
  return data.episode; // { episodeString, sourceUrls: [{sourceName, sourceUrl}], ... }
}
```
**Verified live (Solo Leveling, showId `B6AMhLy6EQHDgYgBF`, episode `"1"`, sub):** real
`episode.sourceUrls` with providers `Ak, Ok, Sw, Fm-Hls, Mp4, Vg, Yt-mp4` — matches the Python
provider's own allowlist (`['Yt-mp4','S-Mp4','Uv-mp4','Luf-Mp4','Ak','Default','Mp4']`, though the
exact set of providers offered varies per episode).

---

## Part 5 — resolving one provider's `sourceUrl` into a real, playable video URL

Each `sourceUrl` is XOR-obfuscated (after stripping literal `--` from the string):
```js
function xorDecrypt(providerId) {
  let out = '';
  for (let i = 0; i < providerId.length; i += 2) {
    out += String.fromCharCode(parseInt(providerId.slice(i, i + 2), 16) ^ 56);
  }
  return out;
}
```

**Special cases that need NO further resolution (use the URL as-is):**
- `sourceUrl` containing `tools.fast4speed.rsvp` → already a real, direct, pre-signed URL.
  **Caveat: confirmed live that this specific kind of URL can 404 within minutes of capture —
  short-lived. Fetch it immediately after decrypting, don't cache it.**
- `sourceName === 'Mp4'` → the decrypted value is itself a URL to fetch; the real video URL is
  inside that page's HTML, extracted via `response.text.match(/src:\s*"([^"]+)"/)`.

**The general case (`Ak` and most others):**
```js
const decryptedPath = xorDecrypt(sourceUrl.replace(/--/g, '')).replace('clock', 'clock.json');
const clockUrl = `https://allanime.day${decryptedPath}`;
const linksRes = await axios.get(clockUrl, { headers: { Referer: 'https://allanime.day/' }, timeout: 10000 });
// linksRes.data.links[] - each has either:
//   - {dash:true, rawUrls:{vids:[{url, height, width, bandwidth, mime_type}, ...]}} - pick by height
//   - {link} directly usable (non-dash) - some providers, check `dash` flag first
//   - .subtitles[] - {lang, label, src} - real subtitle URLs, same domain, no extra auth needed
```
**Verified live:** `clock.json` for the `Ak` provider returned `links[0].rawUrls.vids[]` with
multiple qualities, up to **3840×2160 (real 4K)**, hosted on
`upos-bstar1-mirrorakam.akamaized.net` — a genuine, Akamai-fronted Bilibili mirror, not a sketchy
proxy. Also returned a real English subtitle track URL on the same `allanime.day` domain.

**Confirming a resolved video URL is actually fetchable (the final verification step):**
```js
// A plain HEAD can 403 on this CDN even for a perfectly valid URL - not a failure signal.
// GET with a Range header is the correct probe:
const res = await axios.get(videoUrl, { headers: { Range: 'bytes=0-100', 'User-Agent': UA }, timeout: 10000 });
// Verified live: 206 Partial Content, content-type: video/mp4 — genuine, real video bytes.
```

**Timing discipline that matters:** every "verified live" result above that involved more than
one network hop (get_video → decrypt → clock.json → HEAD/GET) was run as ONE continuous script
with no manual pauses between steps. Signed URLs at multiple points in this chain are short-lived
(confirmed: the `tools.fast4speed.rsvp` URL and a stale `Ak` provider URL both 404'd when
retested even a few minutes apart from when they were minted) — always resolve fully fresh,
immediately, right before use; never cache intermediate values for later reuse in a real
implementation.

---

## Part 6 — what got built (same session, after this runbook was first written)

Everything in Parts 1–5 is now real, committed code, not disposable scripts:
- `Backend/server.js` — `allanimeCaptureCrypto()` (Part 3b, transient Puppeteer),
  `allanimeResolveQueryHash()` (Part 3c), `allanimeGetVideo()`/`allanimeGetVideoRaw()` (Part 4),
  `allanimeResolveSource()` (Part 5), `allanimeSearch()`/`allanimeGetInfo()`/
  `allanimeFindBestMatch()` (Part 1, plus englishName-aware re-scoring since this codebase's own
  titles are English and AllAnime's search only returns romaji names), and the real route,
  `GET /api/anime-allanime-log?title=&malId=&ep=&lang=`. Gated in `RESOLVE_GATED_PATHS` in both
  `server.js` and `middleware.js`, same as every other internal resolver on this site.
- `js/moviePlayer.js` — `srvAllAnime1`/"AllAnime" server button. `loadAllanimeVideo()` calls the
  route above; `showAllanimeMsePlayer()` does the actual MediaSource Extensions playback (two
  `SourceBuffer`s, one video one audio, each fed a single complete `fetch().arrayBuffer()` since
  the URLs are whole files not time-chunked segments — confirmed in Part 5 above). Wraps the
  same shared `<video>` element with Plyr, same as every other provider on the page.

**Known, deliberate gaps in what shipped:** no subtitle rendering (AllAnime's tracks are ASS
format — this codebase only has a real ASS/libass renderer in the offline ffmpeg.wasm download
path, not for live playback), no download support wired up for this source, and no
quality-switching UI (the resolver always picks the best available h264 quality automatically -
`qualities[]` is returned by the backend and available for a future picker, just not surfaced
yet).

**Genuinely not yet verified:** real playback in an actual browser. The backend is independently
proven correct (byte-verified real video via a direct curl test - see the investigation doc's
final follow-up), but the client-side MSE wiring itself (SourceBuffer setup, codec matching,
Plyr wrapping) has not been click-tested live - the Browser preview tool available this session
cannot reach `https://localhost:3000`, a pre-existing, unrelated limitation. Needs a real user
test before this can be called fully done.
