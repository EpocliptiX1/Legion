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
const MIDDLEWARE_SECRET = process.env.MIDDLEWARE_SECRET        || 'ls_internal_4f8b2e9d';

const app = express();

// Respect forwarded client IP when deployed behind another proxy.
app.set('trust proxy', 1);

// Edge rate limiting (this is the internet-facing entrypoint).
// Skip all rate limiting for local/loopback requests (dev convenience).
function skipLocalhost(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
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

// ── Static files ──────────────────────────────────────────────────────────────
// Serve everything in the project root (html/, css/, js/, img/, etc.)
app.use(express.static(path.join(__dirname, '..')));
app.use(
    "/node_modules",
    express.static(path.join(__dirname, "node_modules"))
);
// Apply limits before proxying to backend.
app.use('/api', apiLimiter);
app.use(['/api/megacloud', '/api/anime-embed', '/api/anime-allanime', '/api/anime-animetsu', '/api/anime-kite-servers', '/api/yt-search', '/api/jikan', '/api/anime-mal-id'], heavyApiLimiter);
app.use(['/users/register', '/users/auth', '/users/change-password'], authLimiter);

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

// Use as catch-all fallback — anything not served as a static file goes to backend
app.use((req, res) => proxyToBackend(req, res));

// ── Start server ─────────────────────────────────────────────────────────────
const certPath = path.join(__dirname, '..', 'cert', 'localhost.pfx');

if (fs.existsSync(certPath)) {
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
