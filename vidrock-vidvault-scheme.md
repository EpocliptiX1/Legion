# vidrock.net (VR server) + vidvault.ru (VidV downloads) — how they work

Clean reference doc. For the full reverse-engineering trail, see
`investigation-vidrock-vidvault-2026-09-08.md`. This file is just the working scheme.

## vidrock.net — streaming, new "VR" server option

Genuinely separate infrastructure from Kino/T1M/MegaPlay - own API, own CDN, own crypto. No
shared code with anything else in this codebase.

1. **Call their API.**
   `GET https://vidrock.net/api/movie/{tmdbId}` or
   `GET https://vidrock.net/api/tv/{tmdbId}/{season}/{episode}`
   Response is an object keyed by server name (`Nova`, `Atlas`, `Luna`, `Orion`, `Astra` seen so
   far — the actual set can vary by title): each value is `{url, language, flag, type}` where
   `type` is `"hls"` or `"mp4"`, or `{url: null, type: null}` when that server has nothing for
   this title.

2. **Decrypt each server's `url` — AES-256-GCM, static key.**
   Key (hex): `7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f` (32 raw bytes).
   The `url` field is base64url; decoded bytes are `IV(12) + ciphertext + authTag(16)`.
   Decrypt with that key/IV, verify the tag, UTF-8 decode the plaintext → real stream URL.

3. **Fetch directly — no further auth.**
   No signed token, no session/heartbeat handshake (unlike MegaPlay). A plain `Referer:
   https://vidrock.net/` is enough. Cloudflare-fronted but not gated.

## vidvault.ru — direct downloads, new "VidV" download button

Related to vidrock (cross-referenced in each other's bundles, same UI styling) but a separate
service, purely for direct-download links — no streaming, no ads/redirect wall on the actual
file if you skip their UI and call the API directly.

1. **Get a short-lived token.**
   `GET https://vidvault.ru/api/get-token` → `{ t: "<token>" }`

2. **Request the download links.**
   ```
   POST https://vidvault.ru/api/download-proxy
   Headers: Content-Type: application/json, x-request-token: <t from step 1>
   Body: { type: "movie"|"tv", tmdbId, season, episode }
   ```
   (`season`/`episode` only matter for `type: "tv"`.)

3. **Response shape** — three independent categories, use whichever exist:
   - `mp4Data.downloadInfo.data.downloads[]` → `{format:"MP4", url, resolution, size, duration,
     codecName}` — direct presigned CDN links, multiple resolutions (360p/480p seen).
   - `mp4Data.downloadInfo.data.captions[]` → `{lan, lanName, url, size}` — one entry per
     subtitle language, also presigned, no separate auth.
   - `mkvData.files[]` → `{url, size}` — "MKV Downloads (Embedded Subtitles)" in their UI.
   - `mkvV2Data` → a single object (not an array) `{size, quality, language, country, url}` —
     "MKV v2 Downloads (Embedded Subtitles)".

   Every `url` in every category above is **already directly fetchable** the moment
   `download-proxy` returns it — no decryption (unlike vidrock), no further signing. The
   token/proxy dance exists only to generate these links server-side, not to gate the files
   themselves.

## What to build

- **VR (vidrock)**: a new server option in the movie/TV player, same tier as Kino/T1M/RU-MV —
  resolves via steps 1–3 above, feeds the real decrypted `.m3u8`/`.mp4` URL through our own
  `/api/m3u8-proxy` exactly like every other provider (never expose the raw vidrock/CDN URL to
  the browser). Keep in mind vidrock has multiple named servers per title (Nova/Atlas/Luna/
  Orion/Astra) — worth surfacing more than one if useful, same idea as our own multi-server UI.
- **VidV (vidvault)**: a new button in the download panel, alongside NekoStream's — one click
  fetches step 1–2's real links server-side and hands the user a direct file, no iframe, no
  redirect, no ads. Surface whichever of MP4/MKV/MKV v2/captions came back for that title,
  matching the reference screenshot's own layout (separate sections per format/quality).
