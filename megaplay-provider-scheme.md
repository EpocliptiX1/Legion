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

5. **Register your IP with `trustWatch` — this is the actual gate.**
   `POST https://megaplay.buzz/stream/trustWatch`
   Body: `{"p": "<encrypted>"}`, same AES-256-CBC key/IV as step 3, encrypting the JSON
   `{"action":"status"}` before base64url-encoding it.
   The response, once decrypted the same way, echoes back `server_ip` — literally your own
   outbound IP. **This is a plain IP/session registration heartbeat.** Nothing before this in
   the pipeline actually requires anything about the client (browser, TLS fingerprint, User-
   Agent) — a completely plain HTTP client works fine, as long as this call has been made
   recently for the requesting IP.

6. **Fetch the signed CDN URL with a normal HTTP client.**
   No special client needed. Plain `axios`/`fetch`/`curl` all work identically, as long as step
   5 has run recently for this server's IP.

7. **Retry on `403` — it's genuinely flaky, even with trustWatch running.**
   Mapped empirically: same IP, same fresh trustWatch call, testing every 10s for a minute
   still got `200, 200, 200, 403, 200, 200, 403`. No clean expiry window — real, ongoing
   noise from the CDN itself. trustWatch is necessary but not sufficient; a `403` here is
   *not* a permanent rejection the way it is for every other provider (an actually-expired
   token elsewhere really won't succeed on retry — this one usually will).

## What's actually running in this codebase

- `signMegaplayCdnUrl()` — step 4.
- `decryptMegaplaySource()` — step 3, calls `signMegaplayCdnUrl()` before returning.
- `fetchMegaplaySources()` — steps 1–2, calls `decryptMegaplaySource()` on the `enc` field.
- `megaplayTrustEncrypt()` / `callMegaplayTrustWatch()` — step 5, run as a recurring
  `setInterval` (every 20s) at server startup — ONE global heartbeat, not per-request, since
  the trust is IP-scoped, not session-scoped.
- `resolveUri()` inside `/api/m3u8-proxy`'s manifest-rewrite logic — re-signs every
  media-playlist/segment URL discovered inside a manifest (step 4's "every URL needs its own
  token" requirement), recursing naturally since a media playlist is proxied through the same
  code path again when the client requests it.
- Both `/api/m3u8-proxy` retry loops (`fetchAndCacheSegment`, and the main uncached path) treat
  a `403` from `cdn.imgnex.top` as retryable (step 7) via `hostNeedsMegaplaySigning()` — scoped
  to this host only, every other provider still treats `403` as permanent.
- `fetchUpstream()` — plain axios passthrough for every host, MegaPlay included. (An earlier,
  now-unnecessary version of this routed MegaPlay's CDN through `got-scraping` and then a
  persistent stealth-browser relay, chasing a TLS-fingerprint theory that turned out to be
  wrong. That code — `getMegaplayBrowserPage()` / `fetchViaMegaplayBrowser()` — is still in the
  file, unused, kept as a real working fallback in case `trustWatch` itself ever stops being
  enough.)

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
