# Stream and download security

## What this protects

AniKino intentionally offers anonymous playback and public iframe embeds. That means this is
not DRM: a determined viewer can always watch the video, record their screen, or run a browser
that behaves like a viewer. The goal is more practical:

- never disclose a provider's raw HLS or Cinemap download URL to the browser;
- make a copied local proxy URL useless outside the browser context that created it;
- make a competing site pay for a stateful, bandwidth-heavy relay if it tries to replace the
  AniKino player and UI; and
- stop bulk source harvesting before it becomes a provider, CPU, memory, or bandwidth problem.

Official iframe embeds remain supported. An embed visitor sees the AniKino player and its future
ads/UI. A site that removes that player must proxy the media from its own server instead of giving
the visitor a reusable source URL.

## Request flow

```text
Viewer browser
  -> HTTPS middleware (:3000)
  -> resolver (/api/* or /embed/*)
  -> opaque, encrypted local token URL
  -> /api/m3u8-proxy or /api/proxy-stream
  -> provider HLS/CDN
```

The backend on port 4000 accepts only calls bearing the middleware secret. Static files are
served from explicit allowlisted frontend directories, not the repository root.

The browser receives URLs such as `/api/m3u8-proxy?token=...`; it never receives the upstream
provider URL. Every HLS child playlist, segment, encryption-key URI, initialization-map URI, and
proxied subtitle URI is rewritten into another local token URL.

RU-MV download links use `/api/download-proxy?token=...`. The server follows only redirects that
remain within the Cinemap allowlist, streams the attachment bytes itself, and never forwards an
external `Location` header.

## Controls currently in place

### 1. Encrypted, expiring, session-bound proxy tokens

`Backend/server.js` encrypts proxy payloads with AES-256-GCM. A payload contains the target URL,
provider referrer/UA where needed, the anonymous HttpOnly session ID, a playback lease ID, and an
expiry. Tokens expire after two hours.

The proxy verifies the session cookie before it contacts an upstream host. Copying only a token
from DevTools, HTML, JSON, or a playlist is therefore not enough to replay it elsewhere.

### 2. Strict target allowlists

The stream, redirect-download, and server-proxied-download paths have separate domain allowlists.
A token cannot be repurposed as a generic SSRF proxy, and the RU-MV download proxy refuses any
redirect that leaves the Cinemap domain family.

### 3. Resolver nonce and anonymous budgets

Internal source-resolver routes require an `X-Resolve-Nonce` bound to the current anonymous
session. The nonce lasts three hours, which avoids breaking episode changes or normal retries.

Resolver work is additionally limited in memory:

| Resource | Session budget | Network-prefix budget | Window |
| --- | ---: | ---: | --- |
| Source resolves | 90 | 240 | 15 minutes |
| Nonce minting | 12 | 36 | 15 minutes |
| Public embed resolves | same source-resolve budget | same source-resolve budget | 15 minutes |

The network key is a one-way hash of an IP prefix; raw IP addresses are not placed in the budget
maps. These numbers intentionally permit normal preload behavior and more than 100 legitimate
embeds while preventing one relay host from cheaply minting unlimited sessions/tokens.

### 4. Playback leases

A resolver token creates a random playback lease. The first playback request binds that lease to:

- the already-bound anonymous session;
- a coarse IP prefix; and
- a hash of the browser User-Agent.

The lease has a ten-minute idle timeout and a two-hour maximum lifetime. Each session may have six
active leases, allowing normal title/server/quality exploration without punishing a viewer for
recently stopped players. The player calls the authenticated, idempotent `/api/playback-stop`
endpoint whenever it tears down an HLS instance, so the idle timeout is a fallback rather than the
normal release path. A lease allows at most six concurrent media requests, enough for normal HLS
video/audio fetches and modest browser prefetching.

Subtitles do not claim a playback slot. This matters because a caption track should never block a
quality switch or a second legitimate player.

Three lease-context failures from a network prefix cause a 15-minute cooldown for fresh protected
resolves. This targets repeated token replay, UA switching, and automation mistakes rather than a
single flaky media request.

### 5. Egress and memory guardrails

Each lease has an 8 GiB media budget. This is deliberately much larger than normal HD viewing but
finite: it prevents a single anonymous playback context from becoming an unlimited bulk relay.

Known-size segments are charged before streaming. Unknown-size responses pass through a tiny
Node `Transform` that charges bytes as they pass. The `/api/m3u8-proxy` media path now streams
segments instead of first loading them into an ArrayBuffer, avoiding an avoidable memory spike if
an upstream segment is unexpectedly large. RU-MV download bytes use the same lease and byte
accounting.

## What this does and does not stop

It stops the cheap forms of theft:

- raw HLS URLs copied from API JSON, HTML, or rewritten playlists;
- downloading Cinemap files by following a public redirect;
- replaying a copied local token from another browser/session;
- letting a visitor's browser fetch AniKino media directly from a competing site's custom player;
- bulk resolver calls without maintaining a valid browser-like state; and
- unbounded HLS byte relaying from one playback context.

It cannot stop a determined operator from running their own browser/session at their own server
and relaying every byte to their users. In that case they must retain session state, preserve a
stable network/browser identity, stay inside resolver and lease limits, and pay their own ingress
and egress cost. If they cache/rehost the actual video, no web-player security mechanism can
technically prevent it; that becomes a takedown/hosting/legal problem, not a token problem.

Do not treat `Origin`, `Referer`, User-Agent, JavaScript obfuscation, or a CAPTCHA alone as a
security boundary. They are useful signals and friction, but all can be imitated by a determined
browser automation setup.

## Deployment checklist

1. Set strong, persistent secrets outside Git for the middleware/session/token key material.
2. Expose only the HTTPS middleware. Block public access to backend port 4000.
3. Set `ALLOWED_ORIGINS` to real production domains. Do not leave broad CORS rules in front of
   the middleware.
4. Leave `TRUST_PROXY_HOPS` unset unless traffic really arrives through a reverse proxy that
   overwrites `X-Forwarded-For`. Configure it accurately when using Cloudflare/nginx/load
   balancers.
5. Put the middleware behind CDN/WAF rate limiting for volumetric attacks. The in-memory limits
   here are intentionally application-level controls, not DDoS protection.
6. Run more than one backend process only after moving playback leases/budgets to Redis (or an
   equivalent shared TTL store). In-memory state is per process.
7. Log only aggregate counters and security events in production. Never log raw provider URLs,
   full tokens, cookies, or Authorization headers.

## Manual test checklist

Use the public HTTPS address, not port 4000. Local development has a self-signed certificate, so
`curl -k` is expected for these tests.

1. Load a movie/TV/anime title and select each supported provider. Playback should work normally.
2. In Network, inspect resolver JSON and HLS manifests. Confirm there are only local `/api/...`
   token URLs and no provider HLS hostname.
3. Copy a token URL into a new incognito profile. It must return `403` because the session cookie
   differs.
4. With the same cookie jar, change the User-Agent and fetch a child media URL. It must return
   `429` after the lease is claimed.
5. Start one stream, then switch server/quality. Both should work; a third simultaneous stream in
   the same session should be denied.
6. Request an RU-MV download and inspect the response. It should be a local `/api/download-proxy`
   URL. A Range request should return `206` and never expose an external `Location` header.
7. Load an `/embed/...` URL from another site in an iframe. The AniKino player should still work.
   Confirm the playlist remains local-token-only.
8. Exercise normal episode changes and subtitle loading. Captions must not count as a playback
   slot.

## Safe tuning guidance

The relevant constants are near the playback-lease section in `Backend/server.js`. Tune gradually
and observe real playback before tightening:

- `MAX_ACTIVE_LEASES_PER_SESSION`: keep enough room for normal title/server/quality switching;
  the current value of 6 also covers recently stopped players if an unload cleanup is missed.
- `MAX_CONCURRENT_MEDIA_REQUESTS_PER_LEASE`: do not lower below 6 without testing Safari,
  hls.js, and high-latency networks.
- `MAX_MEDIA_BYTES_PER_LEASE`: 8 GiB is intentionally forgiving. Lower only after measuring
  actual long-form playback plus bitrate/quality behavior.
- resolver budgets: lower them only if request metrics show a clear abuse pattern; anime preloads
  legitimately make several resolves per episode.

## Future work (not implemented here)

- Pre-encoded HLS ad assets and server-side manifest splicing, which enforces ad breaks without
  per-viewer transcoding.
- Redis-backed leases/budgets for horizontal scaling.
- WAF/CDN challenges only when an abuse score is high, not as a blanket barrier for embeds.
- Aggregate metrics and alerts for lease mismatch rate, resolver denials, proxy bytes, and
  provider failures.
- Content-level watermarking if a provider relationship/licensing arrangement supports it.
