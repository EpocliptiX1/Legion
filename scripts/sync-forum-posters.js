#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ROOT_DIR = path.resolve(__dirname, '..');
const FORUM_MOVIES_PATH = path.join(ROOT_DIR, 'Backend', 'backend', 'forum_movies.json');
const SERVER_PATH = path.join(ROOT_DIR, 'Backend', 'server.js');
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getFlagValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return null;
  return process.argv[idx + 1];
}

function toInt(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate())
  ].join('') + '-' + [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('');
}

function normalizeTitle(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\d{4}[^)]*\)/g, ' ')
    .replace(/\b(season|part|cour|vol\.|volume)\s*\d+\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - (levenshtein(a, b) / maxLen);
}

function isValidPosterUrl(url) {
  return /^https:\/\/image\.tmdb\.org\/t\/p\/w500\/.+/i.test(String(url || ''));
}

function extractTmdbApiKey() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY;

  if (!fs.existsSync(SERVER_PATH)) return '';
  const serverSource = fs.readFileSync(SERVER_PATH, 'utf8');
  const match = serverSource.match(/const\s+TMDB_API_KEY\s*=\s*['\"]([^'\"]+)['\"]/);
  if (!match) return '';
  if (match[1] === 'YOUR_TMDB_API_KEY') return '';
  return match[1];
}

function scoreCandidate(movieTitle, candidate) {
  const original = normalizeTitle(movieTitle);
  const candidateTitle = normalizeTitle(candidate.title || candidate.name || '');
  if (!candidateTitle) return 0;

  if (original === candidateTitle) return 1;

  let score = similarity(original, candidateTitle);

  if (original.includes(candidateTitle) || candidateTitle.includes(original)) {
    score = Math.max(score, 0.9);
  }

  if (!candidate.poster_path) {
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

async function tmdbSearchMulti(apiKey, query) {
  const response = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
    params: {
      api_key: apiKey,
      query,
      include_adult: false,
      language: 'en-US',
      page: 1
    },
    timeout: 20000
  });

  return (response.data?.results || [])
    .filter((item) => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path);
}

function chooseMatch(movieTitle, candidates) {
  if (!candidates.length) {
    return { status: 'unmatched' };
  }

  const ranked = candidates
    .map((item) => ({ item, score: scoreCandidate(movieTitle, item) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1] || null;

  if (!top || top.score < 0.86) {
    return { status: 'unmatched', topScore: top ? top.score : 0 };
  }

  const delta = second ? (top.score - second.score) : 1;
  const strictExact = top.score >= 0.999;

  if (!strictExact && second && delta < 0.06) {
    return {
      status: 'ambiguous',
      topScore: top.score,
      secondScore: second.score,
      topTitle: top.item.title || top.item.name || '',
      secondTitle: second.item.title || second.item.name || ''
    };
  }

  return {
    status: 'matched',
    score: top.score,
    result: top.item
  };
}

function createBackup(filePath) {
  const dir = path.dirname(filePath);
  const backupPath = path.join(dir, `forum_movies.backup.${timestamp()}.json`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function parseForumMovies() {
  const raw = fs.readFileSync(FORUM_MOVIES_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('forum_movies.json must be a JSON array');
  }
  return parsed;
}

function buildReportPath() {
  return path.join(__dirname, `forum-poster-sync-report.${timestamp()}.json`);
}

async function main() {
  const confirm = hasFlag('--confirm');
  const dryRun = !confirm || hasFlag('--dry-run');
  const includeAll = hasFlag('--all');
  const verbose = hasFlag('--verbose');
  const limit = toInt(getFlagValue('--limit'), null);

  const apiKey = extractTmdbApiKey();
  if (!apiKey) {
    throw new Error('TMDB API key not found. Set TMDB_API_KEY env var or define TMDB_API_KEY in Backend/server.js');
  }

  if (!fs.existsSync(FORUM_MOVIES_PATH)) {
    throw new Error(`Forum movies file not found at ${FORUM_MOVIES_PATH}`);
  }

  const movies = parseForumMovies();
  const workingSet = [];
  for (const movie of movies) {
    if (includeAll || !isValidPosterUrl(movie.poster)) {
      workingSet.push(movie);
    }
  }

  const boundedSet = Number.isFinite(limit) && limit > 0 ? workingSet.slice(0, limit) : workingSet;

  const updated = [];
  const ambiguous = [];
  const unmatched = [];
  const unchanged = [];

  for (let i = 0; i < boundedSet.length; i += 1) {
    const movie = boundedSet[i];
    const title = String(movie.movieTitle || '').trim();

    if (!title) {
      unmatched.push({
        movieId: movie.movieId,
        movieTitle: movie.movieTitle,
        reason: 'missing-title'
      });
      continue;
    }

    let candidates = [];
    try {
      candidates = await tmdbSearchMulti(apiKey, title);
    } catch (err) {
      unmatched.push({
        movieId: movie.movieId,
        movieTitle: title,
        reason: 'tmdb-request-failed',
        detail: err.message
      });
      continue;
    }

    const picked = chooseMatch(title, candidates);
    if (picked.status === 'matched') {
      const newPoster = `${TMDB_IMAGE_BASE}${picked.result.poster_path}`;
      if (newPoster === movie.poster) {
        unchanged.push({ movieId: movie.movieId, movieTitle: title });
      } else {
        updated.push({
          movieId: movie.movieId,
          movieTitle: title,
          oldPoster: movie.poster || '',
          newPoster,
          score: Number(picked.score.toFixed(3)),
          tmdbId: picked.result.id,
          mediaType: picked.result.media_type
        });
      }
    } else if (picked.status === 'ambiguous') {
      ambiguous.push({
        movieId: movie.movieId,
        movieTitle: title,
        topScore: Number((picked.topScore || 0).toFixed(3)),
        secondScore: Number((picked.secondScore || 0).toFixed(3)),
        topTitle: picked.topTitle || '',
        secondTitle: picked.secondTitle || ''
      });
    } else {
      unmatched.push({
        movieId: movie.movieId,
        movieTitle: title,
        reason: 'no-confident-match',
        topScore: Number((picked.topScore || 0).toFixed(3))
      });
    }

    if (verbose) {
      const progress = `[${i + 1}/${boundedSet.length}]`;
      const msg = picked.status === 'matched' ? 'match' : picked.status;
      console.log(`${progress} ${title} -> ${msg}`);
    }

    await sleep(180);
  }

  const report = {
    mode: dryRun ? 'dry-run' : 'confirm',
    includeAll,
    limit,
    sourceFile: FORUM_MOVIES_PATH,
    checked: boundedSet.length,
    updatedCount: updated.length,
    unchangedCount: unchanged.length,
    ambiguousCount: ambiguous.length,
    unmatchedCount: unmatched.length,
    updated,
    ambiguous,
    unmatched
  };

  const reportPath = buildReportPath();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  let backupPath = null;
  if (!dryRun && updated.length > 0) {
    backupPath = createBackup(FORUM_MOVIES_PATH);
    const updateMap = new Map(updated.map((u) => [String(u.movieId), u.newPoster]));
    const output = movies.map((movie) => {
      const key = String(movie.movieId);
      if (!updateMap.has(key)) return movie;
      return { ...movie, poster: updateMap.get(key) };
    });
    fs.writeFileSync(FORUM_MOVIES_PATH, JSON.stringify(output, null, 2), 'utf8');
  }

  console.log('');
  console.log('Forum poster sync summary');
  console.log(`- Mode: ${dryRun ? 'dry-run' : 'confirm'}`);
  console.log(`- Movies checked: ${boundedSet.length}`);
  console.log(`- Posters to update: ${updated.length}`);
  console.log(`- Unchanged: ${unchanged.length}`);
  console.log(`- Ambiguous skipped: ${ambiguous.length}`);
  console.log(`- Unmatched skipped: ${unmatched.length}`);
  if (backupPath) {
    console.log(`- Backup created: ${backupPath}`);
  }
  console.log(`- Report written: ${reportPath}`);

  if (dryRun) {
    console.log('');
    console.log('Dry-run only. Re-run with --confirm to write changes.');
  }
}

main().catch((err) => {
  console.error('Poster sync failed:', err.message || err);
  process.exit(1);
});
