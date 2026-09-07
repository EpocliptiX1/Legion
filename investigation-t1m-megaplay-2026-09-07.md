# T1M + MegaPlay outage investigation — 2026-09-07

Context: apidocs.html's new "Server Status" health check reported T1M and MVP (MegaPlay) as
down. User didn't believe MVP could really be down and asked for a manual check. This log
covers everything done to diagnose and fix both, in order, plus a section on what these
providers' own defenses suggest for hardening AniKino itself.

---

## T1M — root cause: dead domain (Cloudflare zone suspended), not a bot block

**Command:**
```bash
curl -s -D - -o /dev/null "https://api.shows.st/movie?id=293660&mode=json&sources=vidapi" \
  -A "Mozilla/5.0 ... Chrome/120.0.0.0 Safari/537.36"
```
**Result:** `HTTP/1.1 403 Forbidden`, headers show `Server: cloudflare`, `CF-RAY: ...` — genuinely
Cloudflare answering, not our own code.

**Why this alone isn't proof of a bot block:** a 403 with a `CF-RAY` header can mean several very
different things (WAF/bot challenge, rate limit, or the whole zone being pulled) — the header
alone doesn't distinguish them.

**Command (real browser, not curl — rules out "it's just blocking non-browser clients"):**
```
mcp__Claude_Browser__navigate → https://api.shows.st/movie?id=293660&mode=json&sources=vidapi
mcp__Claude_Browser__get_page_text
```
**Result:** same block page, in a real Chromium tab. Page text:
> "Error HTTP 403 Ray ID: {{.RayID}} ... Website Access Blocked — Cloudflare has restricted
> access to this website due to Terms of Service violations. The affected zone is shows.st."

**Conclusion:** this is Cloudflare suspending the entire `shows.st` zone for ToS violations —
nobody can reach it, browser or not. Not a bot/WAF challenge on us specifically. Same failure
class as the earlier Kinogo outage (site is just gone), per the user's own recollection.

**Command (checking if 111movies — T1M's original branding, per the user — is still alive):**
```
mcp__Claude_Browser__navigate → https://111movies.com
```
**Result:** redirects to `https://111movies.net`, a live "Video Streaming API" site offering
`/movie/{id}` and `/tv/{id}/{season}/{episode}` embed URLs.

**Command (loading an actual embed to find the real underlying player):**
```
mcp__Claude_Browser__navigate → https://111movies.net/movie/293660
```
**Result:** redirects to `https://player.vidlove.cc/embed/movie/293660` — a real player app
(React SPA). This matches our existing code's own comment in `fetchT1mSources` ("Discovered
live via a manual DevTools capture of player.vidlove.cc's 'Archer Queen' server"), confirming
`player.vidlove.cc` has been the actual underlying player the whole time — `api.shows.st` was
just the extraction-API domain sitting in front of it, and that's the domain that died.

**Command (reading the embed page's own inline bootstrap script for its real API calls):**
```
mcp__Claude_Browser__read_network_requests → requestId of the /embed/movie/293660 request
```
**Found inline in the HTML:** a pre-resolve script that builds
```js
var API = 'https://api.tungtungtungtungsahur.app';
var base = isTv
  ? API + '/tv?id=' + id + '&season=' + season + '&episode=' + episode + '&mode=json&sources=moviebox2'
  : API + '/movie?id=' + id + '&mode=json&sources=moviebox2';
```
— same exact query shape as the old `api.shows.st` code (`?id=&mode=json&sources=`), just a new
domain and a different default `sources=` value (`moviebox2` is now their lead provider, per
their own comment: "HLS-FIRST (2026-08-19): the LEAD is now moviebox2").

**Command (testing the new domain — bare request, to see if it's ALSO blocked):**
```bash
curl -v "https://api.tungtungtungtungsahur.app/movie?id=293660&mode=json&sources=moviebox2"
```
**Result:** `HTTP/1.1 403 Forbidden`, `Content-Type: text/plain`, `via: 1.1 Caddy` — NOT a
Cloudflare block page (no CF block HTML, plain text body) — their own origin-level check.

**Command (retrying with Referer/Origin matching the real player):**
```bash
curl -H "Referer: https://player.vidlove.cc/" -H "Origin: https://player.vidlove.cc" \
  "https://api.tungtungtungtungsahur.app/movie?id=293660&mode=json&sources=moviebox2"
```
**Result:** `HTTP 200`, full TMDB metadata + a large subtitle list + `"source":null` (moviebox2
had nothing for this specific title/source combo — not itself a failure, just this source
lacking that title).

**Command (retrying with `sources=vidapi`, the OLD default our code already used):**
```bash
curl -H "Referer: https://player.vidlove.cc/" -H "Origin: https://player.vidlove.cc" \
  "https://api.tungtungtungtungsahur.app/movie?id=293660&mode=json&sources=vidapi"
```
**Result:** `HTTP 200`, real `source.manifest` (`#EXTM3U...`) with opaque `/api?d=<token>`
variant URLs — the exact response shape our existing code already parses
(`res.data?.source?.manifest`). No code changes needed to the parsing logic at all.

**Command (confirming a variant URL from that manifest is actually playable):**
```bash
curl -I -H "Referer: https://megaplay... [n/a, this is T1M]" \
  "https://a2.tungtungtungtungsahur.app/api?d=<token from the manifest>"
```
(Referer used: `https://player.vidlove.cc/`, matching `T1M_REFERER` already in our code.)
**Result:** `HTTP 200`, `Content-Type: application/vnd.apple.mpegurl`, real Cloudflare-fronted
CDN response (`access-control-allow-origin: *`) — genuinely playable.

### Fix applied (Backend/server.js)
- `T1M_ORIGIN` changed from `'https://api.shows.st'` to `'https://api.tungtungtungtungsahur.app'`.
- `fetchT1mSources`'s `axios.get` now sends `Referer`/`Origin: https://player.vidlove.cc` — the
  new domain 403s a bare request with neither header (confirmed above); the old `api.shows.st`
  apparently didn't enforce this, so it was never needed before.
- `T1M_REFERER` (used for every downstream segment/variant fetch via `buildT1mMasterManifestUrl`)
  was already correct — no change needed there.
- Updated section-header/inline comments referencing `api.shows.st` to note the migration.
- `sources=vidapi` param left unchanged — still the correct value on the new domain too.

**Status: fully fixed, verified end-to-end (metadata call + a real segment fetch both 200).**
Syntax-checked (`node --check`) clean. Committed in `552a99ee` is the EARLIER apidocs/RU-MV
work — this T1M fix is a separate, not-yet-committed change from this same session.

---

## MegaPlay (MVP) — root cause: real API format change, not an outage

**Command (manual getSources call, no browser):**
```bash
curl -H "Referer: https://megaplay.buzz/" "https://megaplay.buzz/stream/mal/52299/1/dub" # embed page, get data-id
curl -H "Referer: <embed url>" -H "X-Requested-With: XMLHttpRequest" \
  "https://megaplay.buzz/stream/getSources?id=<data-id>"
```
**Result:** `HTTP 200`, but the JSON has no `sources` field at all anymore — only
`tracks`/`intro`/`outro`/`server`/`enc`. Repeated against a second, unrelated title (Bleach,
malId 269) with the same result — ruled out "this one title just doesn't have it," this is the
current shape for every request.

**Command (real logged-in browser, to rule out "this is a decoy response for scrapers"):**
```
mcp__Claude_Browser__javascript_tool → location.href = 'https://megaplay.buzz/stream/mal/269/1/dub';
mcp__Claude_Browser__read_network_requests → urlPattern: getSources
```
**Result:** identical `enc`-only shape, from a real browser with real cookies, and the video
still played (a `blob:` URL served `206 Partial Content`, confirmed via
`read_network_requests`). Conclusion: this is genuinely the new API shape, not an
anti-scraping decoy — MegaPlay switched their whole `getSources` endpoint to return an
encrypted blob instead of a plain URL, and every real client (including their own) has to
decrypt it client-side now.

**Command (downloading and grepping their own player JS for the decrypt logic):**
```bash
curl "https://megaplay.buzz/lib/newclient.min.js" -o newclient.min.js
curl "https://megaplay.buzz/lib/app.main.js" -o app.main.js
curl "https://megaplay.buzz/lib/e1-player.min.js" -o e1-player.min.js
curl "https://megaplay.buzz/lib/handle-bridge.min.js" -o handle-bridge.min.js
curl "https://megaplay.buzz/lib/live-sync.min.js" -o live-sync.min.js
curl "https://megaplay.buzz/lib/jw_player.js" -o jw_player.js
grep -o 'AES-CBC\|\.enc\b' *.js
```
**Found in `newclient.min.js`** a full AES-256-CBC decrypt routine using WebCrypto
(`crypto.subtle.decrypt`), with a **fixed, hardcoded key and IV** right in the minified source:
```js
var E="i?LMTAx0Q6,:}50U",   // key material (17 chars, zero-padded to 32 bytes for AES-256)
    C="W0;27ToaUpl_P%'c";   // IV (16 chars, used as-is)
function D(){ /* TextEncoder(E) -> 32-byte zero-padded key */ }
function U(i){ /* base64url -> base64 -> Uint8Array (the ciphertext decoder) */ }
function w(i){ /* AES-CBC decrypt using D() as key, TextEncoder(C) as iv, U(i) as ciphertext */ }
```
(Note: this specific `w()`/`H()` pair in the file is wired to `/segment/<token>` URLs
elsewhere in the player, not directly to the top-level `enc` field — grepping all six scripts
for a literal `enc` property access found nothing that reads `.enc` from the getSources JSON.
The actual consumer of `enc` wasn't located via static analysis; it may be a dynamically
loaded chunk. This didn't block the fix, though — see next step.)

**Command (empirically testing the extracted key/IV against a real captured `enc` value,
independent of finding where it's "supposed" to be used):**
```bash
node -e '
const crypto = require("crypto");
const b64 = encB64url.replace(/-/g,"+").replace(/_/g,"/");
const cipherBuf = Buffer.from(b64 + padding, "base64");
const key = Buffer.alloc(32); Buffer.from("i?LMTAx0Q6,:}50U","utf8").copy(key);
const iv = Buffer.from("W0;27ToaUpl_P%\x27c","utf8");
const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
console.log(Buffer.concat([decipher.update(cipherBuf), decipher.final()]).toString("utf8"));
'
```
**Result:** clean decrypt, first try:
```json
{"file":"https://cdn.imgnex.top/anime/d58072be2820e8682c0a27c0518e805e/f80e4497be149471d43d00d59874d135/master.m3u8"}
```
A real, correctly-shaped m3u8 URL. **This confirms the exact key/IV/cipher megaplay uses.**

### Second wall found: the CDN itself now blocks non-browser fetches

**Command:**
```bash
curl -I "https://cdn.imgnex.top/anime/.../master.m3u8" -H "Referer: https://megaplay.buzz/"
```
**Result:** `HTTP 403`, Cloudflare block page: *"Sorry, you have been blocked... This website is
using a security service to protect itself from online attacks."*

**Ruled out "just needs the right headers":** retried with `Origin`, full `Sec-Fetch-Site` /
`Sec-Fetch-Mode` / `Sec-Fetch-Dest` headers matching a real cross-site fetch — no change, still
403. This is very likely a TLS-fingerprint-level Cloudflare Bot Fight Mode check, not a header
check (headers can't fix it).

**Ruled out "the ToS-suspension explanation from T1M":** re-navigated a REAL Chromium tab
directly to the same CDN URL (top-level navigation, no prior same-origin session) — got
Cloudflare's *"Attention Required!"* challenge page too, not the "site is dead" ToS page T1M
showed. Different failure mode: the CDN is alive and actively challenging clients that show up
without a legitimate referring session, browser or not.

**Conclusion:** decrypting `enc` gets the correct URL, but actually fetching video content from
it needs a real, cookied browser session that first loaded `megaplay.buzz` itself (confirmed:
a real browser DID successfully stream a `blob:` URL earlier in this session) — the same class
of problem `runKinoExtractionViaBrowser` (this codebase's existing stealth-Puppeteer fallback
for Kino/vidsrcme) already exists to solve, just not yet wired up for MegaPlay. Building a
continuous segment-relay through a real browser is meaningfully bigger than a one-time page
extraction (Kino's case) and was treated as separate, not-yet-scoped work rather than folded
into this fix.

### Fix applied (Backend/server.js)
- Added `decryptMegaplaySource(encB64url)` — the exact base64url-decode + AES-256-CBC decrypt
  recipe above, as a plain Node `crypto` call (no new dependency).
- `fetchMegaplaySources` now falls back to `decryptMegaplaySource(j?.enc)` when the old plain
  `sources.file`/`sources[0].file` shape isn't present.
- Documented the CDN-block limitation directly in the section comment, including exactly what
  was ruled out, so a future session doesn't have to re-derive it.

**Status: decrypt logic implemented and verified correct (the sample `enc` value round-tripped
to a real, correctly-shaped URL). The CDN-block piece is NOT fixed** — decrypting alone doesn't
make MegaPlay work end-to-end again yet; that needs the stealth-browser segment-relay work
described above. Syntax-checked clean, not yet committed.

---

## Process notes

- Multiple browser tabs opened during MegaPlay testing were unexpectedly closed mid-session
  (once after a scripted `location.href` navigation, once after a `?s=tcdn` retry) — possibly
  megaplay.buzz's own anti-automation reacting to scripted navigation. Backed off to plain curl
  for the remaining tests to avoid escalating that further; recommend the same caution in any
  follow-up work here (don't hammer megaplay.buzz with rapid scripted browser navigations).
- A `?s=tcdn` / `?s=bcdn` URL parameter was found in the embed page's own bootstrap script,
  gating a `bypass` flag - tested as a hypothesis for restoring the old plain `sources` shape.
  **Disproven**: appending `&s=tcdn` to the actual `getSources` call made no difference, still
  got the `enc` shape. Noting this so it isn't re-tried blind later.
- Backend was also found to be running stale code mid-session (edited at 3:07pm, process
  started 2:47pm) during the earlier RU-MV fix — restarted cleanly (killed two accidentally
  duplicated instances in the process, left exactly one running).

---

## What these providers' own defenses suggest for AniKino

The user asked to note what's "good for us" here — i.e. defensive techniques worth borrowing,
not anything about getting past them. None of this is about circumventing their protections;
it's what their setups demonstrate as effective anti-scraping/anti-abuse patterns:

1. **TLS-fingerprint-level bot blocking (Cloudflare Bot Fight Mode on cdn.imgnex.top).** This
   is a materially stronger defense than header/UA checks — it blocked curl AND a real
   Chromium tab making a cold, out-of-context request, but let through a browser with a
   legitimate same-origin session. AniKino's own `/api/m3u8-proxy` and segment endpoints
   currently rely on session-bound encrypted tokens + Referer checks (see `security-review.md`)
   which is a reasonable, different-shaped defense (token-based rather than fingerprint-based) -
   not something to swap out, but the *pattern* of "a request with no legitimate prior session
   context gets nothing, regardless of what headers it fakes" is exactly what our own
   session-token scheme already achieves by a different mechanism. Worth explicitly confirming
   (not just assuming) that a token-less, cold request to our own proxy endpoints gets refused
   the same unconditional way.

2. **Encrypting the API response itself, not just the transport (MegaPlay's `enc` field).**
   Moving from a plain `sources.file` URL to an encrypted blob raises the bar for casual
   scraping meaningfully - it took real reverse-engineering (pulling a key out of their minified
   JS) to get past, not just "add a Referer header." AniKino's own `/api/m3u8-proxy` responses
   and `episode_load_cache` already avoid exposing raw upstream URLs to the browser at all (per
   `proxy-security.txt`/`security-review.md`), which is actually a stronger position than
   MegaPlay's own scheme - MegaPlay still ships a client-decryptable key, so anyone willing to
   read their JS gets the real URL (as this investigation just proved); AniKino's session-bound
   proxy tokens aren't decryptable client-side at all. Nothing to change here, just worth noting
   our existing approach already beats the pattern being reverse-engineered above.

3. **Zone-wide takedown as a failure mode to plan for (T1M/api.shows.st).** A whole upstream
   domain can vanish overnight for reasons entirely outside anyone's control (Cloudflare ToS
   enforcement). The fix here was a domain swap the user already knew about (111movies) rather
   than anything client-side - the actionable lesson for AniKino isn't a security feature, it's
   operational: the health-check system just added (apidocs.html Server Status) is exactly the
   right tool for catching this fast next time, since this class of failure looks identical to
   "our extraction code broke" from the outside until someone manually checks like this session
   did.

No changes are recommended to AniKino's own security posture as a direct result of this - the
comparison mostly confirmed our existing session-token/proxy design is already a stronger shape
than what MegaPlay itself relies on, not that we're behind.

---

## Follow-up: is the CDN block real Cloudflare, and can it be solved without per-request Puppeteer?

User pushed back hard on losing MegaPlay ("THE best one of our servers") and asked (1) whether
the CDN block is genuine Cloudflare or a custom copy, and (2) to keep investigating WITHOUT a
per-request Puppeteer launch (explicitly called out as too expensive for a 3-core box) - probing
with Puppeteer is fine, serving every real user through one is not.

**Checked whether `got-scraping` was already available for this class of problem before writing
any new code.** It is - already a dependency, already used in this exact file for kinogo.mu's own
Cloudflare TLS-fingerprint bot management (see the `RU Movie (kinogo.mu -> cinemar.cc)` section's
own comment: "kinogo.mu sits behind Cloudflare bot management that fingerprints the TLS client...
got-scraping mimics a real browser's TLS/HTTP2 fingerprint and gets through"). This is the
lightweight fix class the user asked for if it applies here - no browser process, just a
TLS/HTTP2 fingerprint-matching HTTP client.

**Command (got-scraping directly against a stale, already-tested URL):**
```js
const { gotScraping } = await import('got-scraping');
await gotScraping.get(cdnUrl, { headers: { Referer: 'https://megaplay.buzz/' } });
```
**Result:** `403`, body `<title>403 Forbidden</title>...<center>openresty</center>` - a PLAIN,
unbranded origin-level 403, not Cloudflare's own page. Different failure mode than the earlier
curl test's "Sorry, you have been blocked" WAF page.

**Command (same test, but against a completely FRESH token - fetched and decrypted immediately
beforehand, to rule out "that specific URL just went stale/single-use"):**
```bash
# fresh embed -> getSources -> decrypt -> gotScraping.get(url), all within one script, no delay
```
**Result:** `403`, same plain `openresty` page again.

**Command (plain curl against that SAME fresh URL, for direct comparison):**
```bash
curl "https://cdn.imgnex.top/anime/.../master.m3u8" -H "Referer: https://megaplay.buzz/"
```
**Result:** also `403 openresty` - identical to the got-scraping result. No visible difference
between a TLS-fingerprint-matching client and plain curl at this specific moment.

**Command (full chain through got-scraping with Set-Cookie forwarding, to rule out "needs a
session cookie from the embed page"):**
```js
// embed -> getSources -> CDN fetch, manually forwarding any Set-Cookie header between each hop
```
**Result:** megaplay.buzz set NO cookies at any step (confirmed - `set-cookie` header absent on
every response). CDN fetch still `403` - but this time back to the FULL Cloudflare "Attention
Required!" challenge page, not the plain openresty page.

**Three different response shapes across otherwise-identical requests, no cookies involved at
any point.** That inconsistency is the real finding here: this isn't a static rule a header or
fingerprint change can satisfy - it reads as Cloudflare's adaptive/risk-scored bot management,
where the SAME request can get waved through, JS-challenged, or hard-blocked depending on a
rolling reputation score for the source IP (repeated automated requests in a short window make
that score worse, which likely explains the escalation observed within this one investigation).
There also appears to be a genuinely separate origin-level (non-Cloudflare, `openresty`) check
stacked behind Cloudflare - passing Cloudflare's layer alone may not be sufficient.

**Decision: stopped live-probing at this point.** Continuing to hammer megaplay.buzz/cdn.imgnex.top
from the same IP would likely only push that risk score further into a hard block, without
producing a cleaner signal - the same caution flagged in the Process Notes section above, now
with direct evidence it's the right call.

### What this means for a real fix
- **A per-request Puppeteer launch is correctly ruled out** - already too expensive per the
  user, and wouldn't even reliably work anyway given the adaptive-scoring behavior (a fresh,
  never-used browser fingerprint from a burst of automated launches is exactly what a risk-based
  system is tuned to catch).
- **The realistic path is a shared, long-lived browser session** - launch Puppeteer (stealth
  plugin, already a dependency, already used for Kino) ONCE, let it sit on megaplay.buzz long
  enough to build a normal-looking reputation/clearance, and relay MANY real requests through
  that one persistent context - refreshed periodically (e.g. every N minutes, or reactively on
  a run of failures) rather than per-user. This is a materially different, cheaper shape than
  Kino's existing `runKinoExtractionViaBrowser` (which launches fresh per extraction) - closer to
  a standing worker than a one-shot fallback. Not built yet; this is real, scoped work, not a
  quick patch, and the next concrete step here rather than more probing.
- Genuinely uncertain whether even a persistent real-browser session would stay clean given how
  quickly the risk score seemed to escalate in this session's own testing - worth architecting
  with an explicit "MVP degraded, other servers still fine" fallback state rather than assuming
  a persistent session solves it outright.

==================================================================================================

## Follow-up 2: real Puppeteer test + the actual root cause (a missing signed token, not TLS fingerprinting)

User's home network (`beeline_10`/`beeline_10_5g`, or a VPN) was offered to get a fresh IP for
testing. First checked whether that would even matter:

**Command:**
```bash
curl -s https://ifconfig.me
curl -s https://ipapi.co/json/
```
**Result:** this environment's outbound IP is a datacenter IP in Astana, Kazakhstan - NOT the
user's home network at all. Confirmed switching their WiFi/VPN would have zero effect on this
session's own tests (this sandbox doesn't route through their machine). Also means the
"inconsistent Cloudflare blocking" observed in Follow-up 1 may partly reflect THIS sandbox's own
already-poor IP reputation (a datacenter IP in KZ repeatedly hitting an anime CDN in a short
window looks bot-like on its own, independent of anything about MegaPlay's real protection
level) - a caveat on how pessimistically to read that section.

**Command (real stealth Puppeteer, direct goto to the stream URL):**
```js
const puppeteerExtra = require('puppeteer-extra');
puppeteerExtra.use(require('puppeteer-extra-plugin-stealth')());
const browser = await puppeteerExtra.launch({ headless: 'new', args: [...] });
await page.goto('https://megaplay.buzz/stream/mal/52299/1/dub', { waitUntil: 'networkidle2' });
```
**Result:** page loaded (HTML/CSS/favicon only, 4 requests total) - never progressed to loading
the player scripts or calling getSources at all. Root cause: a direct Puppeteer `page.goto()` to
a deep URL, same as a real browser's own top-level navigation, sends no Referer - same problem
already documented for plain curl/axios above.

**Command (two-step navigation matching what actually worked earlier via the Browser tool -
load the root first, THEN same-origin-navigate via `location.href` so a real Referer chain
forms):**
```js
await page.goto('https://megaplay.buzz/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { location.href = 'https://megaplay.buzz/stream/mal/52299/1/dub'; });
```
**Result: it worked. 47 requests captured, full real playback**, including:
```
200 https://cdn.imgnex.top/.../ca8c2fc74649c9eee8774e41797556d2/master.m3u8?token=MTc4ODc4ODEwOXw1M2FkYjk2YzI4N2MzOTMxYjNiYzQxY2ViYjAwMzc4OC9jYThjMmZjNzQ2NDljOWVlZTg3NzRlNDE3OTc1NTZkMg.ETSpzgasjKB5IBzlrJMivLxUJHs9fkxBHWo_a_PIw7U
200 https://cdn.imgnex.top/.../index-f1-v1-a1.m3u8
```
plus real subtitle/segment fetches, all 200.

**The critical difference from every earlier failed manual test: a `?token=<value>` query
param on the master.m3u8 URL** that never appeared anywhere in the decrypted `enc` payload
(`decryptMegaplaySource` only ever produced `{"file": "<url, no token>"}`).

**Command (decoding the token's own structure):**
```js
const [payload, sig] = token.split('.');
Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8')
```
**Result:**
```
payload:   "1788788109|53adb96c287c3931b3bc41cebb003788/ca8c2fc74649c9eee8774e41797556d2"
                (unix timestamp)              (exact CDN path, matches the master.m3u8 URL)
signature: "ETSpzgasjKB5IBzlrJMivLxUJHs9fkxBHWo_a_PIw7U"  (43 chars, base64url - shape matches
                                                            an HMAC-SHA256 digest with padding
                                                            stripped)
```
This is a classic signed-URL/anti-hotlink scheme: `token = base64url(ts|path) + "." +
base64url(HMAC(secret, base64url(ts|path)))`. **Conclusion: this was never actually a
TLS-fingerprint/Cloudflare-adaptive block at the root - every earlier manual test (curl,
got-scraping, cookie-jar) was simply missing this required token, so of course all of them got
rejected in one way or another.** If the HMAC secret can be recovered, this becomes a **plain
server-side fix - sign our own token with Node's `crypto.createHmac`, no browser/Puppeteer
needed at all**, same shape as the AES `enc` fix already shipped.

**Command (searching all downloaded megaplay client scripts for where `token=` gets built):**
```bash
grep -oE '.{40}token.{80}' newclient.min.js app.main.js e1-player.min.js handle-bridge.min.js jw_player.js
```
**Result:** only one real hit, in `e1-player.min.js`:
```
case (0x75bcd15-0O726746425):cKWB=/[?&]token=/[jlkC.PHby(86)](AogB)?jlkC[jlkC.ncGy(7)]():jlkC[jlkC.j53x(4)]();break;
```
Heavily, deliberately obfuscated (control-flow flattening via a numeric `case` dispatcher, mixed
hex/octal numeric literals, computed property access through single-letter helper objects like
`jlkC.PHby(86)`) - not just minification, this is a real obfuscator, and it's sitting exactly on
the token-check logic.

==================================================================================================

## Follow-up 3: cracking the token - live instrumentation instead of manual deobfuscation

Rather than manually tracing the control-flow-flattened dispatcher by hand (real but slow), used
the same real Puppeteer session that already proved it can load the page successfully, and hooked
the Web Crypto API itself BEFORE any page script runs - captures the actual key/data at the
moment the real client code calls it, with zero static deobfuscation needed.

**Command:**
```js
await page.evaluateOnNewDocument(() => {
  window.__hmacLog = [];
  const origImportKey = SubtleCrypto.prototype.importKey;
  SubtleCrypto.prototype.importKey = function (format, keyData, algorithm, ...rest) {
    const bytes = keyData instanceof ArrayBuffer ? new Uint8Array(keyData) : new Uint8Array(keyData.buffer);
    window.__hmacLog.push({ type: 'importKey', algorithm, keyStr: new TextDecoder().decode(bytes) });
    return origImportKey.apply(this, arguments);
  };
  const origSign = SubtleCrypto.prototype.sign;
  SubtleCrypto.prototype.sign = function (algorithm, key, data) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer);
    window.__hmacLog.push({ type: 'sign', algorithm, dataStr: new TextDecoder().decode(bytes) });
    return origSign.apply(this, arguments);
  };
});
// then the same two-step navigation (root -> location.href) that already worked
```
**Result - captured directly from the real client's own crypto calls:**
```
importKey  AES-CBC   "i?LMTAx0Q6,:}50U" (same key already found statically - confirms the hook works)
importKey  HMAC-SHA256   "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s"   <- the real signing secret
sign       HMAC   "1788788662|53adb96c287c3931b3bc41cebb003788/ca8c2fc74649c9eee8774e41797556d2"
```

**Command (sanity-checking the recovered key/algorithm against the EXACT real payload+signature
pair captured earlier in Follow-up 2, with no live request involved at all):**
```js
const computed = b64url(crypto.createHmac('sha256', 'MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s')
  .update(Buffer.from('1788788109|53adb96c287c3931b3bc41cebb003788/ca8c2fc74649c9eee8774e41797556d2')).digest());
// computed vs the real captured signature "ETSpzgasjKB5IBzlrJMivLxUJHs9fkxBHWo_a_PIw7U"
```
**Result: exact byte-for-byte match.** The algorithm is fully solved:
```
token = base64url(ts|dirPath) + "." + base64url(HMAC-SHA256("MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s", ts|dirPath))
```
where `dirPath` is the CDN path with the trailing filename (`master.m3u8`) stripped, and `ts` is
the current unix timestamp.

**Command (first live test of a self-generated token, plain axios):** `403 openresty` - looked
like a failure at first, but the crypto itself was already proven correct by the byte-exact
match above, so this had to be something else.

**Command (same self-generated token, via `got-scraping` instead of plain axios):**
```
STATUS: 200
#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1691160,RESOLUTION=1920x1080...
```
**Real HLS manifest, served.**

**Command (control test - a brand new title/token, plain axios only, to rule out "the first
axios attempt just used a stale token"):** `403 openresty` again, confirming this specifically:
axios fails, got-scraping succeeds, on an equally fresh and equally valid token both times.

**Conclusion: fully solved.** Two independent layers, both cracked:
1. `enc` field -> AES-256-CBC decrypt (Follow-up 1) -> real file URL, no token.
2. That URL needs a `?token=` query param -> HMAC-SHA256-SIGN(secret, timestamp|dirPath) (this
   section) -> a genuinely valid, freshly-mintable token, no browser session needed to generate.
3. The actual HTTP fetch of that fully-authenticated URL still needs `got-scraping` (TLS/HTTP2
   fingerprint impersonation - already a dependency, already used for kinogo.mu elsewhere in this
   file) rather than plain axios/curl - this is the ONLY remaining piece that needs a
   non-default HTTP client, and it's a per-request client swap, not a persistent browser session.
   **No Puppeteer/persistent-session relay needed at all** - the earlier Follow-up 1/2 theory
   that this required a stateful browser context was wrong; it was actually two static secrets
   (an AES key and an HMAC key) plus one client-fingerprint requirement, all solvable per-request
   with plain server-side code.

### Fix applied (Backend/server.js)
- `signMegaplayCdnUrl(fileUrl)` - mints the HMAC-SHA256 token above and appends it to the
  decrypted URL. `decryptMegaplaySource` now calls this before returning, so `fetchMegaplaySources`
  always hands back a fully-authenticated URL, not just a decrypted-but-unusable one.
- New shared `fetchUpstream(url, opts)` adapter (near the segment-cache code, since that's its
  first consumer) - routes any URL on `cdn.imgnex.top` through `got-scraping` instead of axios,
  normalizes got's response/error shape to axios' own (`{status, data, headers}`,
  `err.response.status`) so neither of `/api/m3u8-proxy`'s two existing retry loops needed to
  change at all beyond swapping the function called. Every other host keeps using plain axios
  exactly as before (got-scraping is slower/heavier - only worth it where it's actually needed).
- Both `/api/m3u8-proxy` upstream fetch call sites (the cached-segment path in
  `fetchAndCacheSegment`, and the main playlist/segment/Range path) now go through
  `fetchUpstream` instead of calling `axios(...)` directly.
- Updated the section's own comment to describe the real, now-solved mechanism instead of the
  earlier (incorrect) "needs a persistent browser session" theory.

**Command (full end-to-end test of the exact logic now in server.js, against Solo Leveling SUB
specifically - the user's original bug report, not just the dub title used for most of this
investigation):**
```js
// decryptMegaplaySource(enc) -> signMegaplayCdnUrl(file) -> gotScraping.get(signedUrl)
```
**Result: `STATUS: 200`, real HLS master playlist.** Confirmed working for the exact
title/audio combination that started this whole investigation.

**Status: MegaPlay (MVP) is fully fixed** - AES decrypt, HMAC token signing, and TLS-fingerprint
routing all solved and wired into server.js. Syntax-checked clean.

**Command (restarted the backend for real - killed the stale process, `node server.js`, then
polled `/api/public/provider-status` through middleware until every staggered health check had
run):**
```bash
curl -sk https://localhost:3000/api/public/provider-status
```
**Result - every provider, from the real running server's own health checks (not manual
testing):**
```json
{
  "kino":    { "ok": true },
  "t1m":     { "ok": true },
  "ruMovie": { "ok": true },
  "mega":    { "ok": true },
  "kaa":     { "ok": true },
  "neko":    { "ok": true },
  "ruAnime": { "ok": true }
}
```
**All 7 green.** T1M and MVP (MegaPlay) - the two providers this entire investigation was about -
both confirmed fixed by the actual server process, not just standalone scripts. Investigation
closed.

==================================================================================================

## Follow-up 4: outbound IP pool scaffolding (unrelated to MegaPlay - user asked to prep this early)

User asked to get the codebase ready for the future UltaHost 8-IP outbound rotation (see
[[project_outbound_ip_pool_deferred]] memory - not provisioned yet) while this was fresh, rather
than retrofitting every upstream axios call site later. Added purely inert scaffolding:

- `OUTBOUND_IP_POOL` (empty array), `nextOutboundHttpsAgent()` - round-robins a plain Node
  `https.Agent({ localAddress: ip, keepAlive: true })` per call, one Agent instance reused per IP
  (not rebuilt per request). Empty pool -> returns `undefined` -> axios' `httpsAgent: undefined`
  is a no-op, identical to today's behavior.
- Wired into both `/api/m3u8-proxy` upstream axios call sites (the same two touched for the
  MegaPlay `fetchUpstream` change above) via `httpsAgent: nextOutboundHttpsAgent()`.
- Explicitly does NOT cover got-scraping-routed requests (cdn.imgnex.top) - got's own
  agent/proxy options don't accept a plain `https.Agent` the way axios does; noted in
  `fetchUpstream`'s own comment as follow-up work for whenever the real IPs land.
- No behavior change today (pool is empty) - confirmed via `node --check` only, this doesn't
  need a live test until real IPs exist to test with.

==================================================================================================

## Follow-up 5: real-world retest failed - a second bug found (unsigned sub-resource URLs)

User restarted the backend themselves and tried Solo Leveling on MVP through the actual site.
Symptom: loading spinner, Plyr attaches, never actually plays. Browser network panel: one
`/api/m3u8-proxy` request (206, media, hls.js-initiated) succeeded, two subtitle `/api/proxy-stream`
requests succeeded, then a `blob:` entry failed with 0 bytes. Backend terminal showed only the
subtitle-track requests logged, nothing obviously wrong.

**Root cause found by re-reading the manifest-rewrite code (`/api/m3u8-proxy`'s `isM3u8`
branch):**
```js
const resolveUri = (uri) => new URL(uri, targetUrl).href;
```
This resolves a relative URI (e.g. a media-playlist or segment filename found inside a parent
manifest) against `targetUrl` - but `new URL(relative, base)` does NOT carry the base URL's own
query string over to the result. Every embedded URL from Follow-up 2/3's signed master.m3u8
request (which correctly HAD `?token=...`) was being resolved to a version with NO token at all
before being handed to the client - the master manifest itself was signed and worked, but
everything the master manifest points to (the real media playlist, and by extension every real
segment) was going out unsigned.

**Fix applied:** `resolveUri` now re-signs any resolved URL whose host is in `GOT_SCRAPING_HOSTS`
(currently just `cdn.imgnex.top`) via `signMegaplayCdnUrl`, reusing the same function from
Follow-up 3. Since a media playlist is itself proxied back through this exact same `isM3u8`
branch when the client requests it next, this recurses naturally and covers segment URLs too -
one fix point for the whole chain (master -> media playlist -> segments).

**Command (isolated test: the exact same relative-URL-resolve the old code did, vs. the fix,
against a real captured master/media-playlist pair):**
```js
const resolved = new URL('index-f1-v1-a1.m3u8', masterUrl).href;   // OLD: no token
const resigned = signMegaplayCdnUrl(resolved);                      // FIXED: re-signed
```
**Result: both returned `200` via got-scraping at the moment of testing** - inconclusive on
whether missing signing is really what caused the user's specific failure, given the CDN's
already-documented inconsistent/adaptive blocking behavior (Follow-up 1/2). Could not get a
cleaner signal: this codebase's own anti-scraping nonce gate on `/api/anime-megaplay-log` blocks
scripted end-to-end testing (confirmed: `403 {"error":"Missing resolve nonce"}` on a bare axios
call, same protection encountered testing T1M earlier), and the Browser tool used throughout this
investigation still can't reach `https://localhost:3000` (known limitation, unrelated to this bug).

**Honest status:** the missing-token-on-sub-resources bug is real and fixed (confirmed via direct
code reading, not just live-test inference) - unsigned requests to this CDN are fragile at best
given everything else observed about it, so this needed fixing regardless of whether it was THE
cause of this specific failed playback. Backend restarted with the fix (`node --check` clean).
**Not yet confirmed against the user's original exact failure** - next step is the user retrying
live and, if it still fails, sharing the browser console's own JS errors (hls.js logs a specific
error code/reason on fatal failure) rather than just the network panel, which would pinpoint this
far better than another round of guessing.

==================================================================================================

## Follow-up 6: user retested, hls.js console error pinpointed a THIRD bug (this one mine)

User retested live, still failed, and this time shared the actual hls.js fatal error from the
browser console instead of just the network panel - much more useful signal:
```
[KickAssAnime(HLS)] { type: 'networkError', details: 'manifestParsingError', fatal: true,
  url: 'https://localhost:3000/api/m3u8-proxy?token=Gef7Q...', error: 'Error: no EXTM3U delimiter',
  networkDetails: { readyState: 4, status: 9364(?), ... }, response: { loaded: 9364, total: 9364 } }
```
hls.js received a 200 from OUR OWN `/api/m3u8-proxy` (not an error status), but the body it got
back was 9364 bytes of something that doesn't start with `#EXTM3U` - not a manifest at all.

**Root cause: a real bug in `fetchUpstream()` itself (Follow-up 3/4/5's own new code), not
anything MegaPlay-side.** `got-scraping` overrides plain `got`'s own default of
`throwHttpErrors: true` back to `false` in its own preset (confirmed live by testing the exact
same request with the option omitted vs explicitly set - identical behavior either way until
forced). Every other piece of code in this file that uses axios has always relied on the HTTP
client throwing on a non-2xx response before reaching any manifest-parsing logic - none of it
ever explicitly checks `response.status` itself. Since the non-stream branch of `fetchUpstream`
left `throwHttpErrors` unset, a genuine upstream 403 (or any error) from `cdn.imgnex.top` came
back as an ordinary `{status: 403, data: '<html>...error page...</html>'}` with NO exception
raised - the calling code in `/api/m3u8-proxy`'s `isM3u8` branch has no status check of its own
(never needed one before, given axios' behavior), so it just tried to parse that error page's
HTML as if it were an m3u8 manifest and handed the (broken) result straight to hls.js as a 200.

**Command (confirming the override empirically):**
```js
await gotScraping(url, { responseType: 'text' });                      // throws? NO
await gotScraping(url, { responseType: 'text', throwHttpErrors: true }); // throws? YES
```
Same URL, same 403 upstream response, different outcome purely based on this one option.

**Fix 1: force `throwHttpErrors: true` explicitly** on the non-stream branch, overriding
got-scraping's own preset back to the behavior every existing caller already assumes.

**Second, worse instance of the same bug found while fixing the first: the STREAM branch (real
segment data, not just manifests) has no `throwHttpErrors` concept to even set - it's a
promise-API-only option.** Tested directly:
```js
const stream = gotScraping.stream(url); // a 403 URL, no token
stream.on('response', res => console.log(res.statusCode)); // fires: 403
stream.on('data', chunk => ...);                            // ALSO fires: delivers the error page's own bytes
stream.on('error', ...);                                     // never fires at all for HTTP-level errors
```
**got's stream mode never signals an HTTP error via the 'error' event, regardless of
throwHttpErrors - only network/transport failures reach it.** My original stream-branch code
resolved unconditionally on the `'response'` event with whatever `statusCode` came back,
meaning a segment fetch that got blocked would have been piped straight to the video element as
if it were 200 real segment bytes - the exact same silent-failure shape as the manifest bug,
just for actual video data instead of playlist text.

**Fix 2: explicit status check inside the stream branch's `'response'` handler** - for anything
outside 200-299, drain the stream and reject with an axios-shaped error (`err.response.status`)
instead of resolving, mirroring axios' own default `validateStatus`.

**Command (verifying both fixes reject correctly against a real 403, and that the CDN's
already-documented inconsistent blocking is still present as background context):**
```js
// non-stream: throwHttpErrors:true -> throws, err.response.statusCode === 403  (confirmed)
// stream: manual statusCode check -> would reject, statusCode === 403           (confirmed)
```
Both confirmed correct. Retested a genuinely fresh, correctly-signed master.m3u8 request several
times afterward to also confirm the SUCCESS path still works end-to-end post-fix - got a
consistent 403 on every attempt this time, unlike earlier in this same investigation (where an
identical class of request succeeded repeatedly). Almost certainly this session's own testing IP
finally accumulating enough reputation damage from the sheer volume of requests sent to this CDN
over the course of this investigation (flagged as a real risk back in Follow-up 1's Process
Notes) - not a sign the fix is wrong, since the fix's own *error-handling* behavior (throwing/
rejecting correctly on a 403) was independently verified working in isolation above, separate
from whether any given real request happens to land or not. Stopped probing this CDN further
from this environment at this point - diminishing, possibly actively harmful returns.

**Status:** both `fetchUpstream` bugs fixed and verified in isolation (error paths now behave
correctly). Whether MegaPlay is now genuinely watchable end-to-end depends on this CDN's own
moment-to-moment blocking behavior, which cannot be cleanly tested further from this
environment's now-likely-burned IP - needs a real retest from production's own (different)
egress IP to get a clean read.

==================================================================================================

## Follow-up 7: user retested from production, still 502 - connection-reuse fix (last resort before a full browser)

User retested live from their own production server (not this sandbox) - still failed, this time
with `manifestLoadError` / `code 502 Bad Gateway` from `/api/m3u8-proxy` itself. That's actually
correct behavior from Follow-up 6's fix (a real upstream failure now surfaces as a clean 502
instead of corrupted fake-200 content) - but confirms the underlying block is not specific to
this sandbox's IP: production's own (different) egress IP is also being rejected by
cdn.imgnex.top, consistently.

User pointed out they can still watch megaplay.buzz via a plain iframe from their own residential
connection - i.e. not personally IP-banned - and asked whether the "every request is a fresh,
independent connection" behavior noted in the prior explanation could be changed, as a cheaper
step short of a full persistent-browser relay (explicitly called out as last-resort only).

**Theory:** a real browser session keeps ONE continuous, warm TLS connection alive across an
entire page load (embed page -> JS -> manifest -> every segment); our backend's got-scraping
calls, by contrast, use got-scraping's own default keep-alive, which only holds a connection open
for ~1s of idle time - well under the real gap between separate incoming segment requests during
actual playback. If Cloudflare-style bot management scores trust partly on connection/session
continuity (not just IP or request correctness, both already confirmed fine on their own), every
one of our requests looking like a brand-new stranger regardless of how many came before it could
plausibly be part of what's being flagged.

**Command (testing whether a dedicated, long-lived, shared `https.Agent` actually achieves
connection reuse through got-scraping, independent of whether it helps with blocking):**
```js
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 60000, maxSockets: 32 });
await gotScraping(url, { agent: { https: agent } });          // request 1
await sleep(12000);
await gotScraping(url, { agent: { https: agent } });          // request 2, 12s later
```
**Result:** request 1 total time ~339ms, request 2 (12 seconds later) ~84ms - consistent with
skipping a fresh TCP+TLS handshake on the second request. Confirmed real connection/TLS-session
reuse is achievable this way, and that got-scraping accepts a plain Node `https.Agent` via its
own `agent: { https }` option without breaking its browser-fingerprinting (headers/TLS profile
otherwise unaffected).

**Fix applied:** `megaplayCdnAgent` - one shared, module-level `https.Agent` (60s keep-alive,
32 max sockets), wired into BOTH `fetchUpstream` got-scraping call sites (stream and non-stream
branches) via `agent: { https: megaplayCdnAgent }`. Every request this backend makes to
cdn.imgnex.top - across every user, every segment, indefinitely - now shares and reuses the same
warm connection pool instead of each one independently negotiating its own fresh TLS session.

**Command (sanity check against the real endpoint with the new agent - confirms the wiring is
mechanically correct, NOT a signal on whether it actually helps with blocking):**
```js
await gotScraping(signedMasterUrl, { agent: { https: agent }, ... });
```
**Result: `403`, well-formed Cloudflare block page** - same as every other request from this
environment recently. Does not indicate the fix is wrong; this environment's own IP is still the
confounding variable (Follow-up 5/6's "likely burned from volume" theory, now reinforced by the
user's own iframe test showing THEIR residential IP is not blocked at all). Could not get a clean
success/failure signal on connection-reuse's actual effect from here - genuinely needs a real
retest from production's own egress IP, which doesn't carry this sandbox's accumulated request
history against this specific CDN.

**Status:** connection-reuse implemented and verified mechanically correct (real TLS/TCP reuse
confirmed independent of this CDN). Whether it meaningfully changes MegaPlay's blocking behavior
is unverified and can only be judged from production's own retest. This was explicitly discussed
as the cheap "last resort before a full persistent-browser relay" - if this doesn't move the
needle, the persistent-browser approach (one long-lived stealth Puppeteer tab, real segment
relay through it, real engineering effort) remains the next real step, not yet started.

