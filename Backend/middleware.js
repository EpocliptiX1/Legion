'use strict';

/**
 * middleware.js — Reverse-proxy / middleware layer
 *
 * Architecture:
 *   Browser  →  [middleware :3000]  →  [backend :4000]  (internal only)
 *
 * Responsibilities:
 *   - Terminate TLS (HTTPS) for browsers
 *   - Serve all static frontend files (HTML / CSS / JS / images)
 *   - Forward every /api/* request to the hidden backend
 *   - Inject a shared secret header so the backend can reject direct hits
 *
 * Environment variables (all optional, sensible defaults for local dev):
 *   MIDDLEWARE_PORT   — port this server listens on          (default: 3000)
 *   BACKEND_HOST      — hostname of the real backend         (default: localhost)
 *   BACKEND_PORT      — port of the real backend             (default: 4000)
 *   MIDDLEWARE_SECRET — shared secret sent to backend        (default: '')
 *   TRUST_PROXY_HOPS  — set ONLY if a real reverse proxy (nginx/Cloudflare/a load balancer)
 *                       sits in front of this file and overwrites client-supplied
 *                       X-Forwarded-For with its own - never on an install where this file is
 *                       the actual internet-facing edge   (default: off, no proxy trusted)
 */

const express = require('express');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const rateLimit = require('express-rate-limit');

const MIDDLEWARE_PORT  = parseInt(process.env.MIDDLEWARE_PORT  || '3000', 10);
const BACKEND_HOST     = process.env.BACKEND_HOST              || 'localhost';
const BACKEND_PORT     = parseInt(process.env.BACKEND_PORT     || '4000', 10);
// Was a hardcoded default shared with server.js's own copy - see server.js for why that's a
// problem on a public repo. Both processes now independently load/generate the same persisted
// secretStore.js file, so they still agree without hardcoding a public value.
const MIDDLEWARE_SECRET = process.env.MIDDLEWARE_SECRET || require('./secretStore').loadOrCreateSecret('middleware_secret.key');
// Comma-separated list of origins allowed to call /api/* - anything else (curl, a script,
// another site's fetch) gets rejected before it ever reaches the backend. Set this to your
// real domain(s) when deployed, e.g. "https://mysite.com,https://www.mysite.com".
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || `https://localhost:${MIDDLEWARE_PORT},http://localhost:${MIDDLEWARE_PORT}`)
    .split(',').map(o => o.trim()).filter(Boolean);

const app = express();

// trust proxy defaults OFF, not on - this file IS the internet-facing entrypoint (see the
// architecture comment at the top: Browser -> [middleware] -> [backend]), with no other reverse
// proxy in front unless one is deliberately deployed. `trust proxy: 1` unconditionally trusted a
// CLIENT-SUPPLIED X-Forwarded-For header as the real client IP with nothing else validating it -
// confirmed live that a plain request with header `X-Forwarded-For: 127.0.0.1` made req.ip
// resolve to exactly that. Since req.ip feeds skipLocalhost (which gates every rate limiter AND
// requireSameOrigin) and the x-forwarded-for value relayed to the backend below (which the
// backend's own rate limiting keys off), that one header let anyone on the internet impersonate
// localhost and both bypass same-origin enforcement AND dodge rate limiting by rotating a fake
// IP per request. Only set TRUST_PROXY_HOPS when this is genuinely deployed behind a real reverse
// proxy (nginx/Cloudflare/a load balancer) that overwrites client-supplied X-Forwarded-For with
// its own - never on an install where this file is the actual edge.
const TRUST_PROXY_HOPS = process.env.TRUST_PROXY_HOPS ? parseInt(process.env.TRUST_PROXY_HOPS, 10) : false;
app.set('trust proxy', TRUST_PROXY_HOPS);

// Edge rate limiting (this is the internet-facing entrypoint).
// Skip all rate limiting for local/loopback requests (dev convenience).
//
// Uses req.socket.remoteAddress ONLY, never req.ip - `trust proxy: 1` above makes req.ip trust a
// client-supplied X-Forwarded-For header as-is (confirmed live: a plain request with header
// `X-Forwarded-For: 127.0.0.1` made req.ip resolve to exactly that, with no real proxy involved
// at all). Since skipLocalhost gates every rate limiter here AND requireSameOrigin below, that
// meant anyone on the internet could bypass both entirely with one spoofed header - the actual
// TCP socket peer is what genuinely can't be spoofed, so that's the only thing this check trusts.
function skipLocalhost(req) {
    const ip = req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100000,
    skip: skipLocalhost,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many API requests. Please slow down and try again shortly.' }
});

const heavyApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    skip: skipLocalhost,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many high-cost requests. Please wait before retrying.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    skip: skipLocalhost,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again later.' }
});

// Public embed player (/embed/*). It must remain iframe-loadable from third-party sites, so it
// has its own tight edge limit while its actual media stays behind session-bound proxy tokens.
const embedLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    skip: skipLocalhost,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many embed requests. Please slow down.' }
});

// Internal resolve routes (anime-kaa-servers, anime-megaplay-log, anime-neko-log,
// movie/tv-kino-log, movie/tv-ru-log, anime-download-links, movie/tv-ru-download) - these are
// NOT the public API (that's /embed/*, embedLimiter above, untouched by this). They only exist
// for movieInfo.html's own JS to call while a real person watches something. apiLimiter's
// 100k/15min is generous enough that scripted bulk-resolving an entire catalog barely notices
// it. A real viewer, even binge-watching 20+ episodes with a couple of server retries each,
// lands nowhere near 300 resolve calls in 15 minutes - a scraper trying to mirror a catalog
// hits this wall fast. Paired with the resolve-nonce gate on the same route list server-side
// (server.js) - the nonce raises the bar per-request, this caps how much even a working script
// can pull before getting throttled.
const RESOLVE_GATED_PATHS = [
    '/api/anime-kaa-servers', '/api/anime-megaplay-log', '/api/anime-neko-log',
    '/api/movie-kino-log', '/api/tv-kino-log', '/api/movie-ru-log', '/api/tv-ru-log',
    '/api/anime-download-links', '/api/movie-ru-download', '/api/tv-ru-download'
];
const resolveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    skip: skipLocalhost,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many resolve requests. Please slow down.' }
});

// ── Static files ──────────────────────────────────────────────────────────────
// Serve ONLY the actual frontend asset directories - never the project root itself.
// Pentest (2026-08-17) found the previous `express.static(path.join(__dirname, '..'))`
// mount served the ENTIRE repo root, including Backend/ (server.js, users.db,
// proxy_token.key, middleware_secret.key - the literal keys the whole token/session
// security scheme depends on) and cert/ (the HTTPS private key bundle) over plain
// GET requests. Every directory below is deliberately explicit and allowlisted -
// adding a new top-level asset folder means adding a line here, not widening the
// mount back out to the whole tree.
//
// no-cache (not no-store) forces the browser to revalidate via ETag/
// Last-Modified on every load instead of guessing its own freshness window
// (the default with no Cache-Control header at all) -- unmodified files still
// come back as a cheap 304, but a page reload after a CSS/JS edit can never
// silently serve a stale cached copy. Without this, a background tab getting
// reloaded by the browser (memory-saver tab discarding, etc.) could load
// against whatever the browser last decided was "still fresh enough".
const staticHeaders = {
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        // Keep same-origin Referer headers for the protected HLS/API requests, while never
        // disclosing player paths or query strings to third-party origins.
        res.setHeader('Referrer-Policy', 'same-origin');
    }
};
const PROJECT_ROOT = path.join(__dirname, '..');

// All first-party documents refuse cross-site framing. This does not try to hide HTML/JS (that
// is impossible for a public website); it prevents another site from making our real UI appear
// inside its own chrome while it is served from this origin.
function setFirstPartyDocumentHeaders(req, res, next) {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
}

app.use('/html', setFirstPartyDocumentHeaders);
['html', 'css', 'js', 'img', 'svg'].forEach(dir => {
    app.use(`/${dir}`, express.static(path.join(PROJECT_ROOT, dir), staticHeaders));
});
// A handful of top-level files (favicon, manifest, etc.) are requested from "/" directly -
// serve those individually rather than remounting the whole root.
['favicon.ico', 'manifest.json'].forEach(file => {
    const filePath = path.join(PROJECT_ROOT, file);
    app.get(`/${file}`, (req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(filePath, err => { if (err) res.status(404).end(); });
    });
});
app.use(
    "/node_modules",
    express.static(path.join(__dirname, "node_modules"))
);
// Reject /api/* calls that didn't come from a page load on our own site - blocks the
// straightforward case (curl/a script hitting the API directly, no browser involved,
// no Origin/Referer set) without touching real browser traffic. Trivially spoofable by
// anyone who bothers to set the header, but that's a much higher bar than what it took to
// scrape anikoto/KAA in the first place, and costs real users nothing.
//
// Origins are validated against the Host header of the incoming request itself, not a
// hardcoded list - the site gets hit at whatever address the client actually used
// (localhost for local dev, a LAN IP for the Electron app/other devices on the same WiFi,
// the real domain once deployed), and all of those need to keep working without editing
// this file every time. ALLOWED_ORIGINS is only for extra origins beyond that (e.g. a
// separately-hosted frontend), not required for the normal case.
function requireSameOrigin(req, res, next) {
    if (skipLocalhost(req)) return next();
    // Public embeds are intentionally frameable. Requests made *inside* the embedded player
    // remain same-origin with AniKino and continue to use the session-bound proxy routes.
    if (req.path.startsWith('/embed/')) return next();

    const host = req.headers['host'];
    const validOrigins = host ? [`https://${host}`, `http://${host}`, ...ALLOWED_ORIGINS] : ALLOWED_ORIGINS;

    // Modern browsers identify real same-origin player fetches. This is only a supplemental
    // signal (a server-side attacker can forge headers), but it rejects ordinary cross-site
    // iframe/navigation traffic before it consumes resolver capacity.
    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const origin = req.headers['origin'];
    if (origin) {
        if (validOrigins.includes(origin)) return next();
        return res.status(403).json({ error: 'Forbidden' });
    }

    const referer = req.headers['referer'] || req.headers['referrer'];
    if (referer && validOrigins.some(o => referer.startsWith(o + '/') || referer === o)) {
        return next();
    }

    return res.status(403).json({ error: 'Forbidden' });
}

// Apply limits before proxying to backend.
// megacloud/anime-allanime/anime-animetsu/anime-kite-servers routes themselves were removed
// (dead debug/scraper endpoints leaking raw source URLs, see server.js 48138b1f/dff6a451) -
// left off this list now that there's nothing left at those paths to rate-limit.
app.use(['/api/anime-embed', '/api/yt-search', '/api/jikan', '/api/anime-mal-id'], heavyApiLimiter);
app.use(RESOLVE_GATED_PATHS, resolveLimiter);
app.use(['/users/register', '/users/auth', '/users/change-password'], authLimiter);
app.use('/embed', embedLimiter);

// Friendly redirects
app.get('/', (req, res) => res.redirect('/html/indexMain.html'));

// ── API Proxy ─────────────────────────────────────────────────────────────────
// Forward all non-static requests to the backend.
// Routes that don't match a static file are assumed to be API calls.
// The real backend URL is never exposed to the browser.
function proxyToBackend(req, res) {
    const backendPath = req.url;

    // Forward all request headers except hop-by-hop ones
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
        const lower = key.toLowerCase();
        if (lower !== 'host' && lower !== 'connection' && lower !== 'keep-alive') {
            headers[key] = value;
        }
    }

    // Identify the real client IP for the backend
    headers['x-forwarded-for']   = req.ip || req.socket.remoteAddress || '';
    headers['x-forwarded-proto'] = 'https';

    // Shared secret so the backend knows the request came through the middleware
    headers['x-middleware-secret'] = MIDDLEWARE_SECRET;

    const options = {
        hostname: BACKEND_HOST,
        port:     BACKEND_PORT,
        path:     backendPath,
        method:   req.method,
        headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        console.error('[Middleware] Backend proxy error:', err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Backend unavailable', detail: err.message });
        }
    });

    // Stream request body through (handles POST / PUT with JSON bodies)
    req.pipe(proxyReq, { end: true });
}

// requireSameOrigin/apiLimiter used to be scoped to just '/api', silently leaving /users/*,
// /watch2gether/*, /movie-comments, /anime-comments (backend routes that don't happen to
// start with /api) completely uncovered by either check. Applied here instead, globally but
// positioned right before the catch-all proxy: every static asset request and the two page-
// navigation routes above (/, favicon/manifest) are already short-circuited by the time
// execution reaches this point, so nothing legitimate is affected - what's left IS a backend
// call, regardless of its path prefix.
app.use(requireSameOrigin);
app.use(apiLimiter);

// Use as catch-all fallback — anything not served as a static file goes to backend
app.use((req, res) => proxyToBackend(req, res));

// ── Start server ─────────────────────────────────────────────────────────────
const certPath = path.join(__dirname, '..', 'cert', 'localhost.pfx');

if (fs.existsSync(certPath)) {
    // Tried upgrading this to http2.createSecureServer({allowHTTP1:true}) to remove the
    // browser's ~6-connections-per-origin cap (HTTP/1.1) - reverted. On this Node version
    // (v24.12.0) Express's http2 compat layer crashed the whole process twice from unrelated
    // code paths: once via an unlistened 'error' event on an aborted request body stream, and
    // again inside finalhandler's error-response path (`res.removeHeader` hitting an internal
    // symbol http2's compat ServerResponse doesn't fully replicate on this Node build). Two
    // independent crash sites means the compat layer itself is unstable here, not a one-off
    // edge case worth patching around - not safe to run against real traffic.
    const tlsOptions = {
        pfx:        fs.readFileSync(certPath),
        passphrase: 'Damir_19032009',
    };
    https.createServer(tlsOptions, app).listen(MIDDLEWARE_PORT, () => {
        console.log(`\n🔀 Middleware  →  https://localhost:${MIDDLEWARE_PORT}`);
        console.log(`   Proxying /api/*  →  http://${BACKEND_HOST}:${BACKEND_PORT}`);
        if (MIDDLEWARE_SECRET) {
            console.log('   Secret header enforcement: enabled');
        } else {
            console.log('   Secret header enforcement: disabled (set MIDDLEWARE_SECRET to enable)');
        }
    });
} else {
    app.listen(MIDDLEWARE_PORT, () => {
        console.log(`\n🔀 Middleware  →  http://localhost:${MIDDLEWARE_PORT}`);
        console.log(`   Proxying /api/*  →  http://${BACKEND_HOST}:${BACKEND_PORT}`);
        console.warn('⚠️  No HTTPS cert found — running in HTTP mode');
    });
}
