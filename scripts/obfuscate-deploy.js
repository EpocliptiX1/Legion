/**
 * obfuscate-deploy.js
 *
 * Obfuscates all frontend JS files using javascript-obfuscator.
 * CSS and HTML are copied unchanged (class names left alone to avoid breaking JS DOM lookups).
 * Source originals are preserved in _source_backup/ — never modified.
 *
 * Usage:
 *   node scripts/obfuscate-deploy.js
 *   node scripts/obfuscate-deploy.js --dry-run   (list files, don't write)
 */

const fs         = require('fs');
const path       = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ─── Config ───────────────────────────────────────────────────────────────────

const ROOT   = path.join(__dirname, '..');
const BACKUP = path.join(ROOT, '_source_backup');

const JS_DIRS   = ['js'];
const COPY_DIRS = ['css', 'html'];   // copied as-is, no transformation

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// ─── Obfuscator options ───────────────────────────────────────────────────────
// compact            — removes whitespace/newlines
// stringArray        — pulls string literals into a lookup array
// rotateStringArray  — rotates that array so indices change each run
// selfDefending      — crashes if code is pretty-printed / reformatted
// identifierNamesGenerator — 'hexadecimal' gives _0x1a2b style names
const OBF_OPTIONS = {
    compact: true,
    controlFlowFlattening: false,       // keep false — true causes big slowdowns
    deadCodeInjection: false,           // keep false — inflates file size a lot
    debugProtection: false,             // can cause legit users issues, keep off
    selfDefending: true,
    stringArray: true,
    rotateStringArray: true,
    shuffleStringArray: true,
    stringArrayThreshold: 0.75,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,               // keep false — would break window.* assignments
    log: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readAllFilesFrom(base, dirs, ext) {
    const results = [];
    for (const dir of dirs) {
        const fullDir = path.join(base, dir);
        if (!fs.existsSync(fullDir)) continue;
        for (const file of fs.readdirSync(fullDir)) {
            if (file.endsWith(ext)) {
                results.push({ rel: path.join(dir, file), full: path.join(fullDir, file) });
            }
        }
    }
    return results;
}

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyDirRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src,  entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirRecursive(s, d);
        else fs.copyFileSync(s, d);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('=== obfuscate-deploy.js ===\n');

    // 1. Back up originals on first run
    if (!fs.existsSync(BACKUP)) {
        console.log('First run — backing up originals to _source_backup/ ...');
        ensureDir(BACKUP);
        for (const dir of [...JS_DIRS, ...COPY_DIRS]) {
            copyDirRecursive(path.join(ROOT, dir), path.join(BACKUP, dir));
        }
        console.log('Backup done.\n');
    } else {
        console.log('Using existing _source_backup/ as source.\n');
    }

    if (DRY_RUN) {
        const jsFiles = readAllFilesFrom(BACKUP, JS_DIRS, '.js');
        console.log('Would obfuscate:');
        jsFiles.forEach(f => console.log('  JS  ', f.rel));
        COPY_DIRS.forEach(d => console.log('  COPY', d + '/'));
        console.log('\nDry run — no files written.');
        return;
    }

    // 2. Obfuscate JS files (read from backup, write in-place)
    const jsFiles = readAllFilesFrom(BACKUP, JS_DIRS, '.js');
    let ok = 0, fail = 0;
    for (const f of jsFiles) {
        try {
            const src    = fs.readFileSync(f.full, 'utf8');
            const result = JavaScriptObfuscator.obfuscate(src, OBF_OPTIONS);
            const dest   = path.join(ROOT, f.rel);
            ensureDir(path.dirname(dest));
            fs.writeFileSync(dest, result.getObfuscatedCode(), 'utf8');
            console.log('  OK  ', f.rel);
            ok++;
        } catch (err) {
            console.warn('  FAIL', f.rel, '—', err.message);
            // On failure, copy original so the site still works
            fs.copyFileSync(f.full, path.join(ROOT, f.rel));
            fail++;
        }
    }

    // 3. Copy CSS and HTML unchanged
    for (const dir of COPY_DIRS) {
        copyDirRecursive(path.join(BACKUP, dir), path.join(ROOT, dir));
        console.log('  COPY', dir + '/');
    }

    console.log(`\nDone. ${ok} JS files obfuscated${fail ? `, ${fail} failed (originals used as fallback)` : ''}.`);
    console.log('Originals preserved in: _source_backup/');
    console.log('Run again for a fresh obfuscation with different identifiers.');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
