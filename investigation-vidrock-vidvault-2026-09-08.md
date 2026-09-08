# Investigation: vidrock.net (new VR server) + vidvault.ru (new VidV download source)

Full command-by-command trail. Every `curl`/`node` command run and its actual result, in order.
For the clean end-to-end summary (no debugging noise), see
`vidrock-vidvault-scheme.md`.

User asked whether vidrock.net is its own thing or just reselling Kino/T1M under the hood, and
pointed at `https://hoofoot.ru/watch?id=37854&type=tv` (One Piece, tmdbId 37854) as a real site
using it, plus `https://vidvault.ru/tv/37854/1/1` as a related download-focused site worth
checking too.

==================================================================================================

## Part 1: vidrock.net - is it separate from Kino/T1M?

**Command:**
```bash
curl -s "https://vidrock.net/" -A "<chrome UA>"
```
**Result:** a tiny (1488 byte) Vite/React SPA shell - real logic lives in
`/assets/index-Db8jW2IQ.js`, referenced via `<script type="module" src="...">`.

**Command:**
```bash
curl -s "https://vidrock.net/assets/index-Db8jW2IQ.js" -o vidrock_bundle.js
grep -oE 'https?://[a-z0-9][a-z0-9.-]*\.[a-z]{2,}[a-z0-9/_.-]*' vidrock_bundle.js | sort -u
```
**Result:** every external domain referenced in the bundle:
```
https://api.themoviedb.org/3
https://dpnwueuknjpjirujkcxg.supabase.co
https://s.vdrk.site/csub.html, csubtv.html
https://stats.vidrock.ru/movie/, /tv/
https://sub.vdrk.site
https://vidrock.net/api
https://vidvault.ru
```
**No references anywhere to vidsrcme.ru, tungtungtungtungsahur.app, shows.st, vidlove.cc,
megaplay.buzz, imgnex.top, or akirax.buzz** - none of our existing Kino/T1M/MegaPlay provider
domains appear at all. **Confirmed: vidrock is genuinely separate infrastructure** (own backend
at `vidrock.net/api`, Supabase-backed) - not a Kino/T1M reseller. Also confirms vidrock and
vidvault are related to each other (vidvault.ru is referenced directly in vidrock's own bundle).

**Command (finding the actual API call shape):**
```bash
grep -oE '\$\{SF\}/\$\{s\}' vidrock_bundle.js
# then wider context around that match
```
**Result:** `SF` is the API base (`https://vidrock.net/api`), and the real call is:
```js
const s = type==="tv" ? `tv/${tmdbId}/${season}/${episode}` : `movie/${tmdbId}`;
fetch(`${SF}/${s}`)
```

**Command (live test):**
```bash
curl -s "https://vidrock.net/api/tv/37854/1/1" -H "Referer: https://vidrock.net/"
```
**Result: `200`, real JSON**, one entry per server:
```json
{
  "Nova": {"url":"9hKc58V7...(long opaque token)...","language":"English","flag":"us","type":"hls"},
  "Atlas": {"url":null,"type":null},
  "Luna": {"url":null,"type":null},
  "Orion": {"url":"y4q-AntK...","language":"English","flag":"us","type":"hls"},
  "Astra": {"url":"DrFf29eP...","language":"English","flag":"us","type":"mp4"}
}
```
Server names match the screenshot exactly (Nova/Luna/Orion/Astra, plus Atlas here). Some servers
are `null` for a given title/episode (no source on that server) - not an error, same "not every
server has every title" pattern our own providers already have.

**Command (finding the decrypt logic for the opaque `url` field):**
```bash
grep -oE 'for\(const\[l,c\]of Object\.entries\(a\).{600}' vidrock_bundle.js
```
**Result:** each server's `url` gets passed through `await SQ(u.url)` - "Failed to decrypt url"
in the surrounding error message confirms this is a decrypt step, not just formatting.

**Command (finding SQ's definition):**
```bash
grep -oE '.{20}\bSQ\b.{100}' vidrock_bundle.js
```
**Result:**
```js
async function SQ(r){
  const e=wQ(r);                                    // base64url-decode
  if(e.length<28)throw new Error("Ciphertext too short");
  const t=e.slice(0,12), n=e.slice(12);              // first 12 bytes = IV, rest = GCM ciphertext+tag
  const s=await EQ();                                // imported AES key
  const o=await crypto.subtle.decrypt({name:"AES-GCM",iv:t.buffer...}, s, n.buffer...);
  return new TextDecoder().decode(o);
}
```
Classic AES-256-GCM shape: 12-byte IV, 16-byte auth tag appended to ciphertext, 28-byte minimum
matches exactly.

**Command (finding wQ/EQ/bQ and the actual key material):**
```bash
grep -oE 'function wQ\(.{400}' vidrock_bundle.js   # base64url decode, standard
grep -oE 'EQ=.{600}' vidrock_bundle.js             # imports key via bQ(xQ)
grep -oE 'function bQ\(.{400}' vidrock_bundle.js   # hex decode
grep -oE 'xQ=.{300}' vidrock_bundle.js             # the actual key constant
```
**Result - the key, in plaintext in their own bundle:**
```js
xQ = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f"
```
64 hex chars -> 32 raw bytes via `bQ` (hex decode) -> AES-256 key.

**Command (full decrypt test, Node, standalone):**
```js
const key = Buffer.from("7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f", "hex");
const raw = base64urlDecode(encoded);   // the Nova server's url field
const iv = raw.subarray(0, 12);
const authTag = raw.subarray(raw.length - 16);
const ciphertext = raw.subarray(12, raw.length - 16);
const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(authTag);
Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
```
**Result: worked first try.**
```
https://cdn.ngcorp.dad/tv/ktb4FwetBk-gugS4qgJ6yd6jqyazz0orPATSydV1_lI.7YjbpzaB/bigtits.m3u8
```
(Filename is a joke/troll string from whoever runs this CDN - real content is One Piece S1E1.)

**Command (confirming the decrypted URL is directly fetchable, no further auth):**
```bash
curl -s -D - -o /dev/null "https://cdn.ngcorp.dad/tv/.../bigtits.m3u8" -H "Referer: https://vidrock.net/"
```
**Result: `200`, `Content-Type: application/vnd.apple.mpegurl`, real 39KB manifest.** No signed
token, no trustWatch-style handshake, no session cookie - simpler than MegaPlay by a wide margin.
Cloudflare-fronted but not gated.

**Conclusion: vidrock is a real, separate, fully-crackable provider.** Pipeline: call their API
for a TMDB id (+season/episode for TV) -> get back a per-server-name object -> AES-256-GCM
decrypt (static key, in their own JS) each server's `url` field -> fetch directly, no further
auth. Multiple servers per title (Nova/Atlas/Luna/Orion/Astra seen so far - names may vary by
title), `type` is `"hls"` or `"mp4"` per server.

==================================================================================================

## Part 2: vidvault.ru - the download-only site

**Command:**
```bash
curl -s "https://vidvault.ru/tv/37854/1/1"
```
**Result:** another Vite/React SPA shell, bundle at `/assets/index-6CLxgSMC.js`.

**Command:**
```bash
curl -s "https://vidvault.ru/assets/index-6CLxgSMC.js" -o vidvault_bundle.js
grep -oE 'https?://[a-z0-9][a-z0-9.-]*\.[a-z]{2,}[a-z0-9/_.-]*' vidvault_bundle.js | sort -u
```
**Result:**
```
https://checker.vidvault.ru/movie/, /tv/
https://dl.gemlelispe.workers.dev
https://sub.k5s7sjozpn.workers.dev
https://vidvault.ru/api
https://vlaq11.site
```

**Command (finding the API call shape):**
```bash
grep -oE '\$\{bf\}[a-zA-Z0-9/${}._-]{0,100}' vidvault_bundle.js
```
**Result:** two endpoints - `${bf}/get-token` and `${bf}/download-proxy`, `bf =
"https://vidvault.ru/api"`.

**Command (full context around the call site):**
```bash
grep -oE '.{500}\$\{bf\}/get-token.{500}'
```
**Result - the real flow, straight from their own code:**
```js
const token = (await (await fetch(`${bf}/get-token`)).json())?.t || "";
const result = await (await fetch(`${bf}/download-proxy`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-request-token": token },
  body: JSON.stringify({ type, tmdbId, season, episode })
})).json();
// result.mp4Data, result.mkvData, result.mkvV2Data
```

**Command (live test, full flow):**
```bash
TOKEN=$(curl -s "https://vidvault.ru/api/get-token" -H "Referer: https://vidvault.ru/" | jq -r .t)
curl -s -X POST "https://vidvault.ru/api/download-proxy" \
  -H "Content-Type: application/json" -H "x-request-token: $TOKEN" \
  -d '{"type":"tv","tmdbId":37854,"season":1,"episode":1}'
```
**Result: `200`, real payload**, top-level keys `mp4Data`, `mkvData`, `mkvV2Data`, `cached`.

**Shape of each, confirmed live:**
- `mp4Data.downloadInfo.data.downloads[]` - `{format:"MP4", url, resolution:360|480, size,
  duration, codecName}` - direct presigned CDN URLs (`bcdnw.hakunaymatata.com`, `sign=`/`t=`
  query params), no further auth needed to actually download.
- `mp4Data.downloadInfo.data.captions[]` - `{lan, lanName, url, size}` per subtitle language -
  also presigned (`cacdn.hakunaymatata.com`, CloudFront-style `Policy`/`Signature`/`Key-Pair-Id`
  query params). Saw 11+ languages in one real response (ar, bn, en, es, fr, hi, id, ms, pa, pt,
  ru, ur - matches the screenshot's language list closely).
- `mkvData.files[]` - `{url, size}` - "MKV Downloads (Embedded Subtitles)" in the UI. URLs are
  Cloudflare Worker links (`mkv.<random>.workers.dev/d/<id>`), also directly fetchable.
- `mkvV2Data` - a single object, not an array - `{size, quality, language, country, url}` -
  "MKV v2 Downloads" in the UI, a different Worker (`mkv2.<random>.workers.dev/d/<id>`).

**Every download URL in every category is already a direct, presigned, publicly-fetchable
link once `download-proxy` returns it** - the `get-token`/`download-proxy` dance is only needed
to GENERATE these links server-side (presumably to rate-limit/attribute requests, matching how
their site avoids showing ads on the actual download click - the token step is probably also
what keeps this from being trivially scraped at scale). No decryption needed for vidvault at
all, unlike vidrock's HLS URLs.

**Conclusion: vidvault is a real, working, presigned-URL download aggregator**, closely related
to vidrock (same title screen styling, cross-referenced in vidrock's own bundle) but a distinct
service focused purely on direct-download links rather than streaming.

==================================================================================================

## Status (initial)

Both providers fully reverse-engineered and verified live, end-to-end, real content confirmed for
both. Implementation (backend resolver functions + frontend UI wiring) tracked separately - see
commit history from 2026-09-08 for what actually shipped.

==================================================================================================

## Follow-up: MP4 downloads genuinely blocked, MKV v2 was a caching bug - two separate problems

User reported after real-world testing: MKV v2 gave a `403`, everything else (MP4, other MKV)
gave `429` - "unless it's the sub file", which always worked. My first assumption (IP-level rate
limiting, per the MegaPlay precedent) was wrong: user loaded `https://vidvault.ru/tv/127532/1/1`
directly on their own connection with zero issues - ruling out IP reputation entirely, same
"wrong assumption" shape as MegaPlay's early theories, just caught faster this time.

**Command (re-reading vidvault's own bundle for how a real download click actually builds the
URL, instead of assuming the raw `download-proxy` response field IS the download URL):**
```bash
grep -oE '.{300}\.mp4Data.{400}' vidvault_bundle.js
```
**Result - the real client-side logic, verbatim:**
```js
if (k?.downloads) for (const N of k.downloads) N.size && N.url && s.push({
  ..., url: `${Bo}/${encodeURIComponent(N.url)}?n=${a}`   // Bo = "https://dl.gemlelispe.workers.dev"
});
if (k?.captions) { ... url: `${nC}/?url=${encodeURIComponent($.url)}&title=${...}` }  // nC = sub worker
// mkvData.files[0].url and mkvV2Data.url are used DIRECTLY, no wrapping
```
**MP4 downloads route through a Cloudflare Worker relay** (`dl.gemlelispe.workers.dev`), not the
raw `bcdnw.hakunaymatata.com` URL - the actual API response field was never meant to be fetched
directly. Subtitles route through a different worker too, though the raw URL already worked fine
standalone in earlier testing (worker likely optional/cosmetic there, or subtitles just aren't as
strictly gated). MKV and MKV v2 are used as-is by their own frontend, matching what this codebase
already does.

**Command (testing the real MP4 flow through the Worker):**
```js
const workerUrl = `https://dl.gemlelispe.workers.dev/${encodeURIComponent(rawUrl)}?n=${title}`;
```
**Result: `427 Forbidden`** (a non-standard code, clearly the Worker's own custom response) -
progress (past the plain 429 the raw URL gave), but still blocked.

**Command (systematically ruling out every HTTP-layer explanation):**
- Exact page Referer (`/tv/127532/1/1`, not just `/`) - still 427.
- Full `Sec-Fetch-Site`/`Sec-Fetch-Mode`/`Sec-Fetch-Dest`/`Sec-Fetch-User` navigation headers,
  manually set - still 427.
- A completely fresh URL, single attempt, zero prior testing on it - still 427 (rules out
  replay-detection on a reused token).
- **`got-scraping` (TLS/HTTP2 fingerprint impersonation - the exact tool that solved MegaPlay's
  CDN block) - still 427.** This is the key finding: unlike MegaPlay, no HTTP-layer trick gets
  past this Worker, including the one that worked for a near-identical-looking problem last
  session. Reads as an actual Cloudflare JS challenge (real JS execution required, not just
  request shape/TLS fingerprint) - a materially different, harder class of block than anything
  else encountered this week.

**Decision (with the user): do not chase MP4 further right now.** Explicitly declined rebuilding
a persistent-browser relay for this specific case given the cost/uncertain payoff (every
HTTP-layer trick already failed, including the one MegaPlay needed - no strong reason to expect
even a real browser session would fare differently without testing it, and that's real
engineering time). MP4 stays as a known, flagged limitation for now.

**Command (re-investigating MKV v2's `403`/`404` instead, on the user's correction that it's a
separate issue - their own site was also slow/inconsistent for that specific episode):**
```bash
curl "https://mkv2.<hash>.workers.dev/d/<id>" -H "Referer: https://vidvault.ru/"
```
**Result: `404`, body `"Invalid or expired download link"`.** A genuine, honest error - not a
bot-block shape at all. Confirmed the underlying `download-proxy` response is CACHED on
vidvault's own side (`cached: true`, identical `sign`/`t` values across repeated calls) - meaning
this specific link had already been sitting stale for a while by the time anything fetched it,
matching the exact same "signed URL goes stale before actual use" bug MegaPlay's own CDN token
needed fixing for.

**Fix applied:** `/api/anime-vidvault-download` now calls `fetchVidvaultDownloadInfo` directly
(bypassing `resolveVidvaultDownloadInfoCached`'s 30-minute cache) right before the actual file
fetch - `/api/anime-vidvault-info` (just for listing what's available) keeps the cached version,
since a stale LIST isn't harmful the way a stale FILE URL is. Minimizes the gap between minting a
link and actually using it, same fix class as MegaPlay's Follow-up 5.

**Status:** MKV/MKV v2/subtitles should now be meaningfully more reliable (real bug fixed, not
just a mitigation). MP4 remains a known limitation - needs either a real persistent-browser
relay (unverified whether that would even clear this specific Worker's check) or accepting it
as unavailable through this codebase for now.
