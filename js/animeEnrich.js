// animeEnrich.js
// Detects if the current movieInfo page is an anime, fetches MAL data via Jikan,
// and overwrites the relevant detail fields with proper anime metadata.

(async function () {
    const urlParams = new URLSearchParams(window.location.search);
    const tmdbId = urlParams.get('id');
    const typeParam = (urlParams.get('type') || '').toLowerCase();
    // Only run for TV/anime types
    if (!tmdbId || (typeParam !== 'tv' && typeParam !== 'anime' && typeParam !== 'series')) return;

    // Wait for movieLoading.js to populate genre so we can check if it's anime
    await new Promise(r => setTimeout(r, 800));
    console.log('finished waiting for 10000ms');
    const genreEl = document.getElementById('genre');
    const genreText = (genreEl?.innerText || '').toLowerCase();
    const titleEl = document.getElementById('title');

    // Check anime signals: Animation genre + Japanese (via lang hidden in page or genre text)
    // movieLoading.js stores isAnime logic — we replicate the same check via TMDB genre text
    // const looksLikeAnime = genreText.includes('animation') || genreText.includes('anime');
    console.log("Skipping anime check for debugging");
    // if (!looksLikeAnime) return;

    // --- Step 1: Get AniList ID from our backend ---
    let malId = null;
    let anilistId = null;
    try {
        const seasonEl = document.getElementById('seasonSelect');
        const season = seasonEl?.value || 1;

        const r = await fetch(`/api/anime-anilist-id?tmdbId=${tmdbId}&season=${season}`);
        if (!r.ok) {
            console.warn('[animeEnrich] AniList ID lookup failed: bad response');
            return;
        }

        const data = await r.json();
        anilistId = data.anilist_id;
    } catch (e) {
        console.warn('[animeEnrich] AniList ID lookup failed:', e.message);
        return;
    }

    if (!anilistId) {
        console.warn('[animeEnrich] No AniList ID found for TMDB:', tmdbId);
        return;
    }

    // This used to skip straight to a live AniList fetch + re-cache on every
    // single page load, no matter what -- so "caching" was really just
    // logging every visit, not actually caching anything. Worse for titles
    // AniList has no MAL mapping for (idMal: null, e.g. Western shows like
    // Rick and Morty): the live table's real PK turned out to be
    // `mal_id INTEGER PRIMARY KEY` (not `anilist_id`, despite what the
    // current CREATE TABLE says -- schema drift from before that line
    // existed), so every NULL malId insert got SQLite's auto-assigned rowid
    // instead of overwriting anything, piling up a fresh duplicate row every
    // reload forever. Check the existing cache first and only do the live
    // fetch on an actual miss.
    try {
        const cacheCheck = await fetch(`/api/anime-recommendations?tmdbId=${tmdbId}`).then(r => r.json()).catch(() => null);
        if (cacheCheck?.status === 'ready') {
            console.log('[animeEnrich] Recommendations already cached for tmdbId', tmdbId, '-- skipping live AniList fetch');
            return;
        }
    } catch (e) {
        console.warn('[animeEnrich] Cache check failed, proceeding to live fetch:', e.message);
    }

    try {
        console.log('Before AniList recommendations fetch for ID', anilistId);

        const query = `
        query ($id: Int) {
            Media(id: $id, type: ANIME) {
                id
                idMal
                recommendations(sort: RATING_DESC) {
                    edges {
                        node {
                            rating
                            mediaRecommendation {
                                id
                                idMal
                                title {
                                    romaji
                                    english
                                    native
                                }
                                coverImage {
                                    extraLarge
                                }
                                episodes
                                averageScore
                                format
                                seasonYear
                                startDate {
                                    year
                                }
                            }
                        }
                    }
                }
            }
        }
        `;

        const r = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                query,
                variables: { id: anilistId }
            })
        });

        const result = await r.json();
        console.log('[animeEnrich] AniList GraphQL response:', result);

        if (!r.ok) {
            console.warn('[animeEnrich] AniList GraphQL request failed:', result);
            return;
        }

        const edges = result?.data?.Media?.recommendations?.edges || [];
        console.log("========== ABOUT TO CACHE RECOMMENDATIONS ==========");
        console.log({
            tmdbId,
            anilistId,
            malId: result.data.Media.idMal
        });

        const cacheResponse = await fetch("/api/anime/recommendations/cache", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                anilistId,

                malId: result.data.Media.idMal,

                tmdbId,

                title: titleEl?.innerText || null,

                recommendations: result

            })

        });

        console.log("Recommendation cache response:", cacheResponse.status);
        console.log(await cacheResponse.text());

        console.log('[animeEnrich] AniList recommendations count:', edges.length);
        if (edges.length > 0) {
            const firstTitle = edges[0]?.node?.mediaRecommendation?.title?.romaji ||
                edges[0]?.node?.mediaRecommendation?.title?.english ||
                '<unknown>';
            console.log('[animeEnrich] First recommendation:', firstTitle);
        }

        // For now, we are only testing AniList GraphQL. Do not cache or Jikan fetch yet.
    } catch (e) {
        console.warn('[animeEnrich] AniList recommendation fetch failed:', e.message);
        return;
    }

    // --- Step 2: Skip Jikan/MAL enrichment for now ---
    console.log('[animeEnrich] AniList recommendation lookup complete, skipping Jikan enrichment');
    return;
    // --- Step 2: Fetch Jikan (MAL) data ---
    let mal = null;
    try {
        const r = await fetch(`https://api.jikan.moe/v4/anime/${malId}`);
        if (!r.ok) return;
        const data = await r.json();
        mal = data.data;
    } catch (e) {
        console.warn('[animeEnrich] Jikan fetch failed:', e.message);
        return;
    }
    if (!mal) return;

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

    // --- Step 3: Overwrite fields ---

    // Visionary Director → Main Studio
    const studio = mal.studios?.[0]?.name || null;
    if (studio) {
        setText('directors', studio);
        // Also update the studio row title if it exists
        const studioTitle = document.getElementById('studioTitle');
        if (studioTitle) studioTitle.innerText = `More from ${studio}`;
    }

    // Visual Style (genres) → MAL genres (real anime genres, not TMDB guesses)
    const malGenres = [
        ...(mal.genres || []),
        ...(mal.themes || []),
        ...(mal.demographics || [])
    ].map(g => g.name).join(', ');
    if (malGenres) setText('genre', malGenres);

    // Votes → MAL members (real engagement number) + MAL score
    const members = mal.members ? mal.members.toLocaleString() : null;
    const score = mal.score ? `${mal.score}/10` : null;
    if (members) setText('votes', members + (score ? ` (MAL Score: ${score})` : ''));

    // Production Value → Source material + episode count
    const source = mal.source || null;
    const episodes = mal.episodes ? `${mal.episodes} eps` : 'Ongoing';
    if (source) setText('budget', `${source} · ${episodes}`);
    else setText('budget', episodes);

    // Box Office Return → Airing season/year
    const aired = mal.aired?.string || null;
    const season_str = mal.season ? `${mal.season.charAt(0).toUpperCase() + mal.season.slice(1)} ${mal.year || ''}`.trim() : null;
    const airingInfo = season_str || aired || null;
    if (airingInfo) setText('revenue', airingInfo);

    // Success → MAL rank + popularity
    const rank = mal.rank ? `#${mal.rank}` : null;
    const popularity = mal.popularity ? `#${mal.popularity} popular` : null;
    const successStr = [rank && `Ranked ${rank}`, popularity].filter(Boolean).join(' · ');
    if (successStr) setText('financialStatus', successStr);

    // --- Step 4: Add MAL score badge next to IMDb badge ---
    const movieMeta = document.querySelector('.movie-meta');
    if (movieMeta && mal.score && !document.getElementById('malScoreBadge')) {
        const badge = document.createElement('span');
        badge.id = 'malScoreBadge';
        badge.className = 'tag';
        badge.style.cssText = 'background:#2e51a2;color:#fff;font-weight:700;margin-left:6px;padding:3px 8px;border-radius:4px;font-size:0.85rem;';
        badge.innerHTML = `MAL <span style="color:#f0c040;">${mal.score}</span>`;
        // Insert after the IMDb tag
        const imdbTag = movieMeta.querySelector('.imdb-tag');
        if (imdbTag?.nextSibling) {
            movieMeta.insertBefore(badge, imdbTag.nextSibling);
        } else {
            movieMeta.appendChild(badge);
        }
    }

    // --- Step 5: Rename labels to be anime-appropriate ---
    const labelMap = {
        'Visionary Director:': 'Studio:',
        'Visual Style:': 'Genres:',
        'Votes:': 'MAL Members:',
        'Production Value:': 'Source · Episodes:',
        'Box Office Return:': 'Season / Aired:',
        'Success:': 'MAL Rank:'
    };
    document.querySelectorAll('.detail-label').forEach(el => {
        const mapped = labelMap[el.innerText.trim()];
        if (mapped) el.innerText = mapped;
    });

    console.log(`[animeEnrich] Enriched with MAL ID ${malId}: ${mal.title}`);
})();
