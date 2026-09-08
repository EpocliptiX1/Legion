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

## Status

Both providers fully reverse-engineered and verified live, end-to-end, real content confirmed for
both. Implementation (backend resolver functions + frontend UI wiring) tracked separately - see
commit history from 2026-09-08 for what actually shipped.
