'use strict';
// Shared by server.js and middleware.js - both need to agree on the SAME secret value without
// either one owning it exclusively, and without introducing a dotenv dependency this project
// doesn't otherwise have. Whichever process starts first generates the file; the other just
// reads it. Mirrors the same pattern proxy_token.key already uses for the AES proxy-token key.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadOrCreateSecret(filename) {
    const file = path.join(__dirname, filename);
    try {
        const existing = fs.readFileSync(file, 'utf8').trim();
        if (existing) return existing;
    } catch (err) { /* doesn't exist yet - generate below */ }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, 'utf8');
    return secret;
}

module.exports = { loadOrCreateSecret };
