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

   MKV and MKV v2 URLs are **directly fetchable** as-is (matches their own frontend). **MP4 is
   not** — their own frontend routes it through a Cloudflare Worker relay instead:
   `https://dl.gemlelispe.workers.dev/{encodeURIComponent(rawUrl)}?n={title}`. That Worker
   blocks every non-browser client tested (plain requests, exact headers, TLS/HTTP2 fingerprint
   impersonation via `got-scraping`) with a `427` — genuinely different from MegaPlay's block,
   looks like a real Cloudflare JS challenge rather than anything spoofable at the HTTP layer.
   **MP4 downloads are a known, unresolved limitation** as of 2026-09-08 — not attempted further
   given the cost/uncertain payoff (see the investigation doc's own Follow-up section).
   Subtitles route through their own worker too but the raw URL already worked fine directly in
   testing.

## What got built (2026-09-08)

- **VR (vidrock)** — new server button, movie/TV/anime, same tier as Kino/T1M/RU-MV:
  - Backend: `decryptVidrockUrl` / `resolveVidrockServers` / `resolveVidrockBestSource` (picks
    the first `hls` server, falling back to the first `mp4`) in `Backend/server.js`, exposed via
    `GET /api/movie-vr-log`, `/api/tv-vr-log`, `/api/anime-vr-log` (the anime route also carries
    skip-intro/outro markers, same as every other anime server). All three wrap the real stream
    through `buildM3u8ProxyUrl` exactly like Kino/T1M - the browser never sees vidrock's own CDN
    URL. Verified live end-to-end through the real relay.
  - Frontend (`js/moviePlayer.js`): `srvVrM` (movie), `srvVrTv` (TV), `srvVr1` (anime) buttons,
    right next to Kino/T1M/MVP. `loadVrVideo()` (movie/TV) and `loadVrAnimeVideo()` (anime,
    borrows KaF's subtitles the same way MegaPlay/Neko do since vidrock carries none of its
    own). VidRock has no sub/dub toggle (one audio track per server) - the SUB/DUB row hides
    for `srvVr1` the same way it already does for RU-MV.
  - Multiple named servers per title (Nova/Atlas/Luna/Orion/Astra) are resolved server-side but
    NOT yet surfaced as a picker - `/api/*-vr-log` just picks one and plays it, same "one button,
    best pick" behavior every other server here already has. `resolveVidrockServers()` already
    returns the full list if a multi-server picker is ever worth building later.

- **VidV (vidvault)** — new download source in the anime download panel, next to NekoStream/KaF/
  MVP/RU-MV/Kiwi:
  - Backend: `fetchVidvaultDownloadInfo` / `resolveVidvaultDownloadInfoCached` /
    `flattenVidvaultOptions` + `GET /api/anime-vidvault-info` (returns a flat list of
    `{id, format, label, size}` - the real presigned URL is stripped server-side, never sent to
    the client) and `GET /api/anime-vidvault-download?id=...` (relays the real file with a
    proper `Content-Disposition: attachment` header). The download route always resolves FRESH
    (bypasses the info route's own cache) right before the actual file fetch - MKV/MKV v2 links
    can go stale within that cache's window, same class of bug MegaPlay's CDN token needed
    fixing for. Verified live: real subtitle file downloaded end-to-end with correct headers.
    **MP4 downloads are a known, unresolved limitation** - their real download URL requires
    going through a Cloudflare Worker (`dl.gemlelispe.workers.dev`) that blocks every
    non-browser client tested, TLS-fingerprint impersonation included - see the investigation
    doc for the full trail. MKV/MKV v2/subtitles work through the direct relay as built.
  - Frontend: a `VidV` button in `#dlSourceRow` alongside Kiwi. Unlike every other download
    source here (which pick a quality/language/burn config and hit ONE "Download" button),
    VidV's own list of already-complete files (MP4 at whatever resolutions this episode has,
    MKV, MKV v2, one button per subtitle language) renders dynamically in `#dlVidvaultWrap`
    (`dlRenderVidvaultOptions()`) - clicking any one of them **is** the download
    (`window.location.href` to `/api/anime-vidvault-download`, which triggers a native browser
    download via `Content-Disposition` and never navigates away - no new tab, no redirect, no
    ads). The quality/language/burn/compression rows and the normal "Download" button all hide
    while VidV is selected, since none of them apply - this is the direct-file external
    downloader path specifically requested to avoid client-side ffmpeg being the bottleneck on
    weaker devices.
