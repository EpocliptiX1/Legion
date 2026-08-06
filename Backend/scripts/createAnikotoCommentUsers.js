// One-off backfill: creates a real users.db account for every distinct Anikoto commenter
// already imported into animeCache.db's anime_comments table, so they can eventually have
// public profile pages. Mirrors the exact signup/guest-account fields real accounts get
// (see Backend/server.js: users table schema, generateLoginCode, generateWatch2getherCode,
// LOGIN_CODE_TTL_SECONDS, BCRYPT_SALT_ROUNDS) so these rows are indistinguishable in shape
// from a real account - just unreachable, since the password is random and never given out
// (only written to AnikotoCommentUserInfo.txt for our own reference).
//
// Run manually: node Backend/scripts/createAnikotoCommentUsers.js
// Idempotent - re-running skips any userUID that already exists in users.db.

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const BACKEND_DIR = path.resolve(__dirname, '..');
const ANIME_CACHE_DB_PATH = path.join(BACKEND_DIR, 'animeCache.db');
const USERS_DB_PATH = path.join(BACKEND_DIR, 'users.db');
const OUTPUT_TXT_PATH = path.join(BACKEND_DIR, 'AnikotoCommentUserInfo.txt');

// Matches Backend/server.js exactly.
const BCRYPT_SALT_ROUNDS = 10;
const LOGIN_CODE_TTL_SECONDS = 60 * 60 * 24 * 3650; // 10 years - "max amount allowed"

function generateLoginCode() {
    return String(Math.floor(1000000000 + Math.random() * 9000000000));
}

function generateWatch2getherCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function randomAlnum(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

function randomPassword(len = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

function randomIntInclusive(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

const animeCacheDb = new sqlite3.Database(ANIME_CACHE_DB_PATH);
const usersDb = new sqlite3.Database(USERS_DB_PATH);

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
}
function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
    });
}

async function main() {
    const commenters = await all(animeCacheDb, `
        SELECT
            user_uid,
            (SELECT username   FROM anime_comments a2 WHERE a2.user_uid = a1.user_uid AND a2.source = 'anikoto' ORDER BY created_at DESC LIMIT 1) AS username,
            (SELECT avatar_url FROM anime_comments a2 WHERE a2.user_uid = a1.user_uid AND a2.source = 'anikoto' ORDER BY created_at DESC LIMIT 1) AS avatar_url,
            MIN(created_at) AS firstAt,
            MAX(created_at) AS lastAt
        FROM anime_comments a1
        WHERE source = 'anikoto' AND user_uid IS NOT NULL AND user_uid != ''
        GROUP BY user_uid
    `);

    console.log(`[AnikotoUsers] Found ${commenters.length} distinct Anikoto commenters.`);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const logLines = [`# Generated ${new Date().toISOString()}`, `# username | userUID | userEmail | password`];
    let created = 0;
    let skipped = 0;

    for (const c of commenters) {
        const userUID = parseInt(c.user_uid, 10);
        if (!Number.isFinite(userUID)) { skipped++; continue; }

        const existing = await get(usersDb, `SELECT userUID FROM users WHERE userUID = ?`, [userUID]);
        if (existing) { skipped++; continue; }

        const username = (c.username || `AnikotoUser${userUID}`).slice(0, 64);
        const plainPassword = randomPassword(10);
        const hashedPassword = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
        const userEmail = `${randomAlnum(10)}${userUID}@gmail.com`;
        const accountUID = String(userUID);

        const createdAt = c.firstAt - randomIntInclusive(1, 20) * 86400;
        const lastSeen = Math.min(nowSeconds, c.lastAt + randomIntInclusive(1, 20) * 86400);

        const loginCode = generateLoginCode();
        const loginCodeExpiresAt = nowSeconds + LOGIN_CODE_TTL_SECONDS;
        const watch2getherCode = generateWatch2getherCode();

        await run(usersDb, `
            INSERT INTO users (
                userUID, accountUID, username, userEmail, userTier, userLanguage,
                searchCount, viewCount, allUIDs, userPassword, is_guest,
                login_code, login_code_expires_at, created_at, last_seen,
                profile_pic, watch2gether_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userUID, accountUID, username, userEmail, 'Free', 'en',
            0, 0, JSON.stringify([accountUID]), hashedPassword, 0,
            loginCode, loginCodeExpiresAt, createdAt, lastSeen,
            c.avatar_url || null, watch2getherCode
        ]);

        logLines.push(`${username} | ${userUID} | ${userEmail} | ${plainPassword}`);
        created++;
    }

    fs.appendFileSync(OUTPUT_TXT_PATH, logLines.join('\n') + '\n\n', 'utf8');

    console.log(`[AnikotoUsers] Created ${created} new accounts, skipped ${skipped} (already existed or invalid uid).`);
    console.log(`[AnikotoUsers] Credentials logged to ${OUTPUT_TXT_PATH}`);

    animeCacheDb.close();
    usersDb.close();
}

main().catch(err => {
    console.error('[AnikotoUsers] Failed:', err);
    process.exit(1);
});
