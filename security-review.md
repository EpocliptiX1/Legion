# Third-Party Stream-Reuse Security Review

**Status:** First-party remediation implemented; deployment restart and live verification pending
**Scope:** Authorized, defensive testing of this local AniKino project. The goal is to determine whether a third party can reuse the site's resolved stream/proxy URLs in another player or application. Tests are limited to this project and its localhost instance; no provider site will be scraped, bypassed, or attacked.

## Method

- Inspect the client stream URL emitters and the backend proxy, token, lease, and rate-limit checks.
- Run controlled localhost checks only where a server is already running.
- Do not record real stream URLs, signed tokens, cookies, credentials, or provider URLs in this file.
- Treat a successful browser-side playback URL as sensitive test material and redact it in findings.

## Activity log

> This document was created and updated with `apply_patch` after each review step. Those write-only log updates are not individually listed below, to avoid a recursive “log the log update” loop; every inspection and test command is listed.

| # | Action / command | Why | Outcome |
|---|---|---|---|
| 1 | Read `C:\Users\Damir\.codex\plugins\cache\openai-bundled\browser\26.820.71523\skills\control-in-app-browser\SKILL.md` | Confirm the approved browser-testing procedure before any live localhost interaction. | Complete. It requires using the in-app browser runtime for browser testing and prohibits inspecting browser storage directly. |
| 2 | Queried available tools for `node_repl`, browser, HTTP, and security capabilities. | Check for a purpose-built local security or HTTP connector before using browser automation. | No applicable security/HTTP connector was available; the browser runtime is available for local UI testing. |
| 3 | `rg -n -C 5 "(buildStreamProxyUrl|buildM3u8ProxyUrl|api/proxy-stream|api/m3u8-proxy|createPlaybackLease|verifyPlaybackLease|validatePlaybackLease|recordPlayback|PROXY_TOKEN|SESSION_SECRET|leaseId|playback lease)" Backend/server.js js --glob '!node_modules/**'` | Locate the stream URL emitters and every backend control that should prevent copied URLs from becoming an external player's source. | Found session-bound encrypted proxy tokens, signed HttpOnly session cookies, expiring playback leases, and proxy routes. Also identified the public embed routes as a separate surface needing review. No real stream URL was accessed or logged. |
| 4 | `Get-Content Backend/server.js | Select-Object -Skip 1690 -First 660; Get-Content Backend/server.js | Select-Object -Skip 7415 -First 270; Get-Content Backend/server.js | Select-Object -Skip 11245 -First 250; Get-Content Backend/server.js | Select-Object -Skip 20520 -First 700` | Read the implementation behind the session, nonce, token, lease, proxy, and embed controls. | The internal player is well protected against a **copied URL alone**: its token is AES-GCM encrypted, expiry-bound, and checked against a signed HttpOnly browser session. The same code deliberately keeps `/embed/*` public and mints a fresh valid session/token for every independent embed visitor. |
| 5 | `rg -n "^(function (encryptProxyTarget|decryptProxyToken|buildM3u8ProxyUrl|buildStreamProxyUrl|verifyProxySession|claimPlaybackLease|renderPublicEmbedVideoPlayerHtml|renderPublicEmbedIframeFallbackHtml)|app\\.(get|post)\\('/api/(proxy-stream|m3u8-proxy|playback-stop)|app\\.get\\('/embed)" Backend/server.js; rg -n -C 3 "(cors\\(|Access-Control-Allow-Origin|X-Frame-Options|frame-ancestors|Content-Security-Policy|requireSameOrigin|embedLimiter)" Backend/server.js Backend/middleware.js --glob '!node_modules/**'` | Map the exact proxy, session, CORS, framing, and public-embed boundaries. | `/api/*` is same-origin/CORS-restricted, while `/embed/*` is intentionally exempt from that restriction and may be framed by third-party sites. This is the main architectural trade-off. |
| 6 | `curl.exe -k --max-time 10 -sS -D - -o NUL -H "Origin: https://attacker.invalid" "https://localhost:3000/api/m3u8-proxy?token=not-a-valid-proxy-token"; curl.exe -k --max-time 10 -sS -D - -o NUL -H "Origin: https://attacker.invalid" "https://localhost:3000/api/m3u8-proxy?url=not-a-stream"` | Negative localhost test: an unauthenticated foreign-origin request must not obtain a proxy response, and the retired raw-URL parameter must remain disabled. No provider address was supplied. | Pass: invalid token returned `403`; legacy raw-URL parameters returned `400`; neither response included `Access-Control-Allow-Origin`. The server issued normal signed session cookies, but their values are intentionally redacted. |
| 7 | `Get-Content Backend/server.js | Select-Object -Skip 1990 -First 400; Get-Content Backend/server.js | Select-Object -Skip 2308 -First 105; Get-Content Backend/server.js | Select-Object -Skip 7418 -First 180; Get-Content Backend/server.js | Select-Object -Skip 11247 -First 190; Get-Content Backend/middleware.js | Select-Object -Skip 88 -First 215` | Verify the public-embed proof-of-work flow and confirm whether it changes the access model or merely raises bulk-scraping cost. | The proof-of-work and request budgets slow automated resolution, but do not require an account or approved origin. A capable third party can obtain its own legitimate anonymous session through the public embed flow; it cannot reuse another visitor's copied token alone. |
| 8 | `curl.exe -k --max-time 10 -sS -H "Origin: https://attacker.invalid" "https://localhost:3000/embed/anime/0/1" \| Select-String -SimpleMatch "Preparing player"` | Confirm that a foreign-origin navigation reaches the public embed gate, while deliberately stopping before proof-of-work completion or provider resolution. | The public route returned its proof-of-work challenge page. This confirms that it is externally reachable by design; no title was resolved and no provider media was requested. |
| 9 | `Get-Content proxy-security.txt | Select-Object -First 420` | Cross-check current code against the project's prior proxy-security review and avoid re-reporting vulnerabilities already fixed. | Prior findings confirm that raw stream URLs, plaintext proxy parameters, cross-session token replay, and broad static-file exposure were previously addressed. The remaining issue is architectural: public embeds still let a third party create its **own** anonymous authorized session. |
| 10 | `curl.exe -k --max-time 10 -sS -D - -o NUL "https://localhost:3000/Backend/proxy_token.key"; curl.exe -k --max-time 10 -sS -D - -o NUL "https://localhost:3000/Backend/middleware_secret.key"; curl.exe -k --max-time 10 -sS -D - -o NUL "https://localhost:3000/Backend/users.db"` | Re-test the historical static-file exposure because leaked proxy/session keys would defeat every later control. Response bodies were discarded. | Pass: all three paths returned `404`, with no file content exposed. Cookie values from the headers are redacted. |
| 11 | `rg -n -C 3 "(/embed/|renderPublicEmbedIframeFallbackHtml|providerSrc|megaplay\\.buzz/stream)" Backend/server.js js html --glob '!node_modules/**'; git diff --check -- security-review.md; git status --short` | Find every public embed and fallback path, then validate the review document without changing unrelated user files. | Confirmed that the public embed API is documented for arbitrary third-party iframe use. Also found an anime fallback that sends a direct provider iframe URL to an anonymous embed caller. Markdown validation passed; only the new review file is part of this audit. |
| 12 | In-memory Node HTTPS probe against `https://localhost:3000`: requested public `/embed/anime/1429/1`, accepted the anonymous session cookie, requested `/api/pow-challenge`, performed the advertised SHA-256 work, redeemed it at `/api/pow-verify`, then requested the embed again. No application secret, account, middleware header, upstream URL, token value, or media bytes were printed or retained. | Test the actual outsider model the review is concerned with: a brand-new unauthenticated client that is **not** using the normal AniKino frontend/API. | The anonymous client completed the public PoW at difficulty 5 and received a `200` native-player document containing a session-bound AniKino proxy route. The response did not contain a raw upstream `.m3u8`/`.mp4` URL and was not the MegaPlay iframe fallback. |
| 13 | Second in-memory anonymous-session probe repeated the public PoW flow, extracted the **first** session-bound proxy route from the returned player HTML, and fetched that route with the same anonymous cookie. It retained neither the route nor response body; it only emitted response classification booleans. | Determine whether the outsider can pull a protected resource using the session it created itself. | The first route matched in the HTML returned `200 text/vtt`, so it was a subtitle track rather than the video manifest. This confirms the outsider can use its own anonymous session to request protected embed resources, but it does **not** establish a raw-video-manifest pull. A later probe must specifically target the video source assignment rather than the first generic proxy URL. |
| 14 | `rg -n -C 5 -S "streamUrl|video\\.src|loadSource|hls\\.loadSource|source\\.src|const.*stream|var.*stream" Backend/server.js` | Locate the exact public-player video-source assignment so the follow-up cannot accidentally select a subtitle track again. | The public player emits its video source as `var src = …` and passes it to `hls.loadSource(src)`. All native public anime providers wrap the resolved source with `buildM3u8ProxyUrl`. |
| 15 | Third in-memory anonymous-session probe followed the same no-account/no-secret public flow, then extracted **only** the `var src = …` assignment, fetched that session-bound route, and emitted booleans/content classification only. No token, cookie, manifest text, provider URL, or segment was printed, saved, or retained. | Verify the attacker-relevant path: can an outsider session obtain the video manifest required for a replacement UI? | **Confirmed.** The source was a session-bound `/api/m3u8-proxy` route; the outsider session received `200 application/vnd.apple.mpegurl` with a valid HLS manifest. Its child references remained tokenized AniKino proxy routes, and no absolute upstream media URL appeared in the manifest. |
| 16 | Replaced `html/TESTENV.html` with a standalone "Relay Lab" player test, then ran `node --check` on its extracted inline script, `curl.exe -k https://localhost:3000/html/TESTENV.html` feature assertions, and `git diff --check -- html/TESTENV.html`. | Demonstrate the result without nesting or restyling the existing AniKino embed UI. | The test page is served by the local app, contains no iframe, completes the public gate, extracts the native public player’s session-bound video source, and gives that source to an independent `<video>` + hls.js UI. Static/syntax checks passed. Browser visual playback could not be automated because the local TLS certificate is untrusted in the controlled browser. |
| 17 | Read the middleware routing/security sections around the static allowlist, `/embed` exception, `embedLimiter`, `requireSameOrigin`, resolver limits, and backend proxy secret forwarding. | Compare the first-party MovieInfo playback architecture against public embeds and identify the smallest meaningful security boundary change. | MovieInfo’s resolver/API traffic goes through the first-party middleware path and its internal backend boundary. `/embed/*` is intentionally excluded from `requireSameOrigin`, has no partner/account capability, and uses an anonymous session after only a rate limit + PoW. Therefore it cannot provide MovieInfo-equivalent source isolation while arbitrary third-party embedding remains supported. |
| 18 | Patched `Backend/middleware.js` and `Backend/server.js`; ran `node --check` on both, `git diff --check`, and source assertions for disabled-by-default legacy embeds, removed cross-origin exemption, local-only test page, blocked API docs, frame headers, strict cookies, and removal of the provider fallback. | Apply the strongest first-party-only remediation that does not require a DRM vendor or a defined partner program. | Pass. Legacy `/embed/*` is denied by default at both edge and backend, and may only be enabled for local non-production diagnostics. All first-party HTML/player documents send anti-framing headers; the public API documentation is blocked; the attack demonstration page needs an explicit local opt-in; session and PoW cookies are Strict; and the direct provider-iframe fallback is removed. |

## Review rules

1. A normal `401` from a token-protected local proxy is a **pass**, not an error.
2. `429`, provider outage, and a backend restart are availability events, not proof of stream theft resistance.
3. Findings will distinguish between a user copying an already-authorized playback URL and an unauthenticated third party replaying it.
4. Any vulnerability finding will include a defensive remediation, not reusable bypass instructions.

## Findings

### F-1 — A copied proxy URL cannot be reused by itself

**Severity:** Pass / expected protection
**Confidence:** High (current code inspection, prior live pentest, and negative localhost tests)

The actual HLS proxy URLs carry an AES-GCM token that embeds the browser's signed anonymous session ID. The proxy checks that ID against the caller's HttpOnly `aniko_sid` cookie. A copied URL without that cookie is rejected, and legacy plaintext `?url=` proxy input is disabled. The negative live tests returned `403` for an invalid token and `400` for the retired raw-URL parameter; no CORS permission was present.

**What this stops:** somebody opening DevTools, copying only a player/manifest URL, and pasting it into a different user, browser profile, or simple third-party frontend.

### F-2 — Public embeds are an intentional third-party access path

**Severity:** High if the requirement is “no other site may show our streams”; otherwise accepted product behavior
**Confidence:** High (current code and controlled public-gate check)

`/embed/anime/*`, `/embed/movie/*`, and `/embed/tv/*` are deliberately exempt from same-origin enforcement and are documented for arbitrary iframe use. The public route creates a fresh anonymous session and, after proof-of-work, resolves a normal session-bound player for that caller.

**Impact:** another site can already build its own surrounding UI and place your fully working player inside an iframe. It does not need to steal an existing visitor's token to do this.

**Boundary:** this is not a cryptographic failure in the token implementation. It is the expected result of offering a public, keyless embed API.

### F-3 — A determined third party can act as its own anonymous session and relay the player

**Severity:** High
**Confidence:** High (current code inspection and controlled anonymous-session HLS-manifest probe)

The internal resolver controls (`requireSameOrigin`, resolve nonce, session cookie, budgets) make bulk automation costlier but do not authenticate the caller. Origin/Referer headers are useful browser signals, but a server-side client can supply them. A live controlled probe confirmed that a brand-new anonymous client can receive its own signed session cookie, redeem the public PoW, and receive a native player document containing a session-bound proxy route. The proxy token is bound to that attacker's own session, which is exactly what its relay owns.

**Impact:** a static third-party webpage cannot directly use your proxy because of CORS and HttpOnly cookies, but a third party with a backend can run an authenticated anonymous session and relay protected embed resources to its own player. Rate limits and proof-of-work reduce scale; they do not establish that the caller is your site. The live probe confirmed that such a session can retrieve the native video HLS manifest; its child playlists/segments remain session-bound AniKino proxy routes, so the attacker needs a backend relay or its own per-viewer proxy session—not the raw upstream CDN URL.

### F-4 — Public anime fallback exposes a direct provider iframe

**Severity:** Medium
**Confidence:** High (current code inspection)

If public native Mega resolution fails, the anonymous anime embed route returns a provider iframe fallback. That lets another site use the provider iframe directly instead of even framing your player. It is less capable than a raw media URL, but it bypasses the intended “only our proxy talks to the provider” boundary for this fallback case.

### F-5 — Historical secret/static-file exposure remains closed

**Severity:** Pass / expected protection
**Confidence:** High (controlled localhost test)

The proxy key, middleware secret, and user database are not served by the current static-file allowlist. All three requested paths returned `404` with discarded bodies.

## Remaining recommendations

1. **Make the product decision first.** If no external site should be able to use the player, disable `/embed/*`, its public exemption in `requireSameOrigin`, its API documentation, and any publicly served attack-test page. Route playback only through the existing first-party MovieInfo resolver path and set `Content-Security-Policy: frame-ancestors 'self'` (plus `X-Frame-Options: SAMEORIGIN` for older clients) on player responses. This is the only way to give embeds the same first-party boundary as MovieInfo.
2. **If embeds are required, make them partner-only.** Replace keyless public embeds with server-issued, short-lived partner capabilities; keep each partner key on that partner's server, enforce an allowlist plus egress/viewer quotas, and revoke keys when abused. Origin checks alone are not an authorization mechanism.
3. **Remove the direct provider-iframe fallback from public embeds.** Return an unavailable-player message or require a partner capability instead.
4. **Treat PoW, nonces, browser signals, and rate limits as anti-abuse cost controls only.** They are worthwhile, but cannot stop an attacker who operates a server and a browser/session of their own.
5. **For a stronger “cannot be reused elsewhere” guarantee, use content you are licensed to serve with an entitlement/DRM provider.** A freely playable anonymous HLS source can be made costly to copy, but cannot be made exclusive to one website by headers or encrypted URL wrappers alone.

## Implemented remediation

The first-party-only option is now active in source code. `ENABLE_LEGACY_FIRST_PARTY_EMBEDS=1` is the sole escape hatch for local diagnostics and is ignored when `NODE_ENV=production`; it does **not** restore public partner embeds. Leave it unset in normal operation. A restart of both middleware and backend is required before the changed route and header policy take effect.

Partner capabilities and DRM were not implemented because they need external product decisions: approved partner identities/key storage and quotas for the former, or a licensed DRM/entitlement provider for the latter.

## Test limitation

The review has resolved one valid public embed, completed its anonymous proof-of-work flow, and fetched the resulting HLS manifest through the attacker-created session. It has not recorded any proxy token, cookie, upstream media/provider URL, manifest body, or video segment. No segment was fetched because the manifest + implementation review already establishes the relevant trust boundary: an outside relay can request child resources through the same session, while the real upstream URL remains hidden from it.
