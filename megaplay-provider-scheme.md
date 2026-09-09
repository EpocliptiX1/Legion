# MegaPlay (MVP) provider — how it actually works

Clean reference doc. For the full messy reverse-engineering trail (dead ends included), see
`investigation-t1m-megaplay-2026-09-07.md`. This file is just the working scheme, start to finish.

## The pipeline, in order

1. **Get the embed page.**
   `GET https://megaplay.buzz/stream/mal/{malId}/{episode}/{sub|dub}`
   Requires a `Referer` header (any value works) or you get a fake "file not found" page.
   Response HTML contains `data-id="<numeric id>"`.

2. **Get the encrypted source blob.**
   `GET https://megaplay.buzz/stream/getSources?id=<data-id>`
   Headers: `Referer: <the embed URL from step 1>`, `X-Requested-With: XMLHttpRequest`.
   Response JSON includes `tracks`, `intro`, `outro`, and the field that matters: `enc` (a
   base64url AES-256-CBC ciphertext — this replaced a plain `sources.file` URL at some point,
   with no warning).

3. **Decrypt `enc` to get the real CDN URL.**
   AES-256-CBC. Key = UTF-8 bytes of `i?LMTAx0Q6,:}50U`, zero-padded to 32 bytes. IV = UTF-8
   bytes of `W0;27ToaUpl_P%'c` (16 bytes, used as-is). Decrypted plaintext is
   `{"file":"https://cdn.imgnex.top/anime/<id1>/<id2>/master.m3u8"}` — no query string.

4. **Sign the CDN URL — it needs a `?token=`.**
   `token = base64url(payload) + "." + base64url(HMAC-SHA256(secret, payload))`
   where `payload = "<unix timestamp>|<id1>/<id2>"` (the CDN path with the trailing filename
   stripped) and `secret = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s"`.
   **Every URL under that CDN needs its own fresh token** — the master manifest's token does
   NOT cover the media-playlist/segment URLs discovered inside it. Each one must be re-signed
   individually (same recipe, same dirPath, fresh timestamp).

5. **Register your IP with `trustWatch` — necessary, but (2026-09-08 update) not the whole
   gate.**
   `POST https://megaplay.buzz/stream/trustWatch`
   Body: `{"p": "<encrypted>"}`, same AES-256-CBC key/IV as step 3, encrypting a JSON object
   before base64url-encoding it.
   The response, once decrypted the same way, echoes back several fields - not just
   `server_ip` (your own outbound IP): `is_enable` (bool), `td`/`days3`/`days7` (minutes-watched
   counters), and a `rules` object shaped like a watch-time credit quota
   (`full_7d_min`/`full_3d_min`/`soft_today_min`/`soft_session_min`/`ep_credit_min`). When
   `is_enable` is `false`, the CDN 403s regardless of how correct everything else in this
   pipeline is - confirmed live, repeatedly, including with a genuine browser-fingerprinted
   client (`got-scraping`), which changed nothing. This is NOT a TLS-fingerprint/bot-detection
   gate; it reads and behaves like an actual watch-time credit system.
   The plaintext request also carries an **`enc_i` field** (found in `newclient.min.js`, their
   own client bundle) once a prior heartbeat has returned a `server_ip` to reuse: the client's
   own self-detected public IP (client-side, presumably WebRTC/STUN), XOR-encoded against the
   literal key `"MegaPlayTrustKey1"` then base64url-encoded (`ye()` in their bundle - decoded a
   real captured value back to a plain IPv4 to confirm). A real, unproxied browser's
   self-reported IP naturally matches the IP the connection physically arrives from; a bare
   heartbeat with no `enc_i` at all (what this codebase sent until 2026-09-08) is about as clean
   a "not a normal browser" signal as it gets. Now sent on every heartbeat after the first,
   using the IP `server_ip` last echoed back (the only value that can't create a mismatch).
   **Confirmed this does NOT flip `is_enable` instantly** - the credit fields read as something
   that accumulates over real elapsed time, not a switch a single correctly-shaped request
   flips. Left running; whether it earns real trust over days is still open.

6. **Fetch the signed CDN URL with a normal HTTP client.**
   No special client needed. Plain `axios`/`fetch`/`curl` all work identically, as long as step
   5 has run recently for this server's IP.

7. **Retry on `403` — it's genuinely flaky, even with trustWatch running, and the flakiness
   comes in bursts, not a flat rate.**
   Mapped empirically: same IP, same fresh trustWatch call, testing every 10s for a minute
   still got `200, 200, 200, 403, 200, 200, 403`. No clean expiry window — real, ongoing
   noise from the CDN itself. trustWatch is necessary but not sufficient; a `403` here is
   *not* a permanent rejection the way it is for every other provider (an actually-expired
   token elsewhere really won't succeed on retry — this one usually will).
   A separate controlled test (5 fresh requests, 1s apart) measured ~20% failure — but real
   `/embed` traffic twice burned all 3 retry attempts in a row, ~0.8% odds at a flat 20% rate.
   Reads as temporary escalated blocking during bursts of activity, not steady noise —
   MegaPlay's CDN gets 6 attempts now, not 3 (still just this host; capped backoff so total
   wait stays under hls.js's own 20s loader timeout). This is a mitigation for the CDN's own
   flakiness, not a fix for it — 100% success isn't guaranteed.

## What's actually running in this codebase

- `signMegaplayCdnUrl()` — step 4.
- `decryptMegaplaySource()` — step 3, calls `signMegaplayCdnUrl()` before returning.
- `fetchMegaplaySources()` — steps 1–2, calls `decryptMegaplaySource()` on the `enc` field.
- `megaplayTrustEncrypt()` / `megaplayTrustDecrypt()` / `callMegaplayTrustWatch()` — step 5, run
  as a recurring `setInterval` (every 20s) at server startup — ONE global heartbeat, not
  per-request, since the trust is IP-scoped, not session-scoped. `callMegaplayTrustWatch()` now
  also decrypts its own response (previously discarded) to learn `server_ip`, and
  `encodeMegaplayTrustIp()` builds the `enc_i` field from it for the next heartbeat.
- `resolveUri()` inside `/api/m3u8-proxy`'s manifest-rewrite logic — re-signs every
  media-playlist/segment URL discovered inside a manifest (step 4's "every URL needs its own
  token" requirement), recursing naturally since a media playlist is proxied through the same
  code path again when the client requests it.
- Both `/api/m3u8-proxy` retry loops (`fetchAndCacheSegment`, and the main uncached path) treat
  a `403` from `cdn.imgnex.top` as retryable (step 7) via `hostNeedsMegaplaySigning()` — scoped
  to this host only, every other provider still treats `403` as permanent.
- `resolveMegaplaySourcesCached()` re-signs the cached `stream` URL's token **on every
  retrieval**, cache hit or not — not just when freshly resolved. The cache (up to 1 hour, see
  `MEGAPLAY_CACHE_TTL_MS`) saves the real work (embed page + getSources + AES decrypt); only the
  cheap HMAC signing step happens fresh every time, since step 4's token carries a timestamp the
  CDN checks and a long-cached entry would otherwise hand out an increasingly stale one.
- `fetchUpstream()` — plain axios passthrough for every host, MegaPlay included. (An earlier,
  now-unnecessary version of this routed MegaPlay's CDN through `got-scraping` and then a
  persistent stealth-browser relay, chasing a TLS-fingerprint theory that turned out to be
  wrong. That code — `getMegaplayBrowserPage()` / `fetchViaMegaplayBrowser()` — is still in the
  file, unused, kept as a real working fallback in case `trustWatch` itself ever stops being
  enough.)

## Raw embed alternative (2026-09-09): `srvMegaEmbed1` / "MegaPlay"

Separate from everything above. Instead of resolving+proxying a real stream, this server just
embeds MegaPlay's own player iframe directly - the viewer's own browser talks to
`megaplay.buzz`, our backend is never involved in fetching video at all, so the `is_enable`
credit gate above is fully sidestepped (it's their infrastructure's own problem to grant real
browsers trust, not ours to fake). Trade-off: their own branding/controls, no skip markers, no
quality picker, no session-bound proxy protection on this path.

- `html/megaplay-embed.html` - static wrapper page, no backend route. Builds
  `megaplay.buzz/stream/mal/{malId}/{ep}/{sub|dub}` in an iframe with
  `referrerpolicy="unsafe-url"`. Its own URL carries `?ref=anixtv.me` - MegaPlay's own
  `app.main.js` does a plain substring check on whatever Referer it receives against a live
  allowlist (`GET megaplay.buzz/domains`, base64 JSON, confirmed real) to decide whether to
  inject an ad popunder; `unsafe-url` hands it this wrapper page's full URL (not just origin),
  so the `anixtv.me` substring is present and the ad gets skipped. See
  `investigation-t1m-megaplay-2026-09-07.md`'s two most recent follow-ups for the full trail.
- `js/moviePlayer.js` - `loadMegaplayEmbedVideo()`, wired as `srvMegaEmbed1` in the anime
  server dispatch, reusing `showIframePlayer()` (previously only used for movie/TV's own
  iframe-based servers). Kept as an addition alongside `srvMega1`/MVP, not a replacement or a
  silent fallback MVP drops into - the codebase had exactly this kind of raw iframe once before
  and deliberately removed it (see `loadMegaPlayFrame`'s own comment); this is a new, explicit,
  user-facing choice, not a revival of that.

## Constants (all currently correct, as of 2026-09-07)

| Name | Value | Used for |
|---|---|---|
| `MEGAPLAY_ORIGIN` | `https://megaplay.buzz` | embed page + getSources + trustWatch |
| `MEGAPLAY_ENC_KEY_STR` | `i?LMTAx0Q6,:}50U` | AES key material (steps 3 & 5, shared) |
| `MEGAPLAY_ENC_IV_STR` | `W0;27ToaUpl_P%'c` | AES IV (steps 3 & 5, shared) |
| `MEGAPLAY_TOKEN_HMAC_SECRET` | `MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s` | CDN token signing (step 4) |
| `MEGAPLAY_TRUST_WATCH_INTERVAL_MS` | 20,000 (20s) | heartbeat cadence (step 5) |

If MegaPlay silently breaks again, check in this order: (1) did the `enc`/getSources response
shape change again — (2) did the CDN token scheme change — (3) is the `trustWatch` heartbeat
actually still running and succeeding (check server logs for `[MegaPlay] trustWatch heartbeat
failed`) — (4) is `MEGAPLAY_TRUST_WATCH_INTERVAL_MS` still frequent enough (the real client's own
cadence was only ever observed at ~10s, not confirmed as the actual required minimum).
