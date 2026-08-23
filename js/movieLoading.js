/* Handles Movie Details Page population, Recommendations, and Global Trailer Fetching
*/
console.log('[movieLoading.js] script loaded');

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

let currentPlaylist = [];
let activeTrailerIdx = -1;

const isAnimeModeEnabled = () => window.__animeMode === true || localStorage.getItem('animeMode') === 'true';

// Network Information API (Chromium only - no Safari/iOS support, so this is a progressive
// enhancement, not something the page depends on). Checked once at load rather than live,
// since re-checking mid-session would mean images already on screen change size under you.
function isSlowConnection() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    if (conn.saveData) return true;
    if (conn.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return true;
    if (typeof conn.downlink === 'number' && conn.downlink < 1.5) return true;
    return false;
}
window.__isSlowConnection = isSlowConnection();
console.log('[movieLoading.js] Slow connection detected:', window.__isSlowConnection);

// Picks a smaller TMDB image size when the connection looks slow. The main #posterImg stays
// fixed at its normal size everywhere it's set (not routed through this) - only secondary
// images (backdrop, cast thumbnails, recommendation row posters) get dialed down.
function tmdbImgUrl(imgPath, normalSize, slowSize) {
    if (!imgPath) return '/img/LOGO_Short.png';
    const size = window.__isSlowConnection ? slowSize : normalSize;
    return `https://image.tmdb.org/t/p/${size}${imgPath}`;
}

// AniList-sourced recommendation cards (genre row) carry an anilistId, and a TMDB id only
// when the backend already had that mapping cached (a free local lookup - it no longer does a
// live reverse-search per card, which used to mean up to ~26 sequential lookups before the row
// could even render). If we already have knownTmdbId, navigate instantly; only hit
// /api/anime-tmdb-id (one lookup, live search allowed there) for the specific card someone
// actually clicked when it wasn't pre-cached.
async function navigateToAnimeRecommendation(cardEl, anilistId, displayName, knownTmdbId) {
    if (knownTmdbId) {
        window.location.href = `movieInfo.html?id=${knownTmdbId}&type=tv`;
        return;
    }
    if (!anilistId) return;
    const original = cardEl?.style.opacity;
    if (cardEl) cardEl.style.opacity = '0.5';
    try {
        const res = await fetch(`/api/anime-tmdb-id?anilistId=${encodeURIComponent(anilistId)}&title=${encodeURIComponent(displayName || '')}`);
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        if (!data.tmdb_id) throw new Error('no tmdb_id in response');
        window.location.href = `movieInfo.html?id=${data.tmdb_id}&type=tv`;
    } catch (err) {
        console.error('[AnimeReco] Could not resolve TMDB id for AniList', anilistId, err);
        if (cardEl) cardEl.style.opacity = original || '';
        if (typeof showLimitToast === 'function') showLimitToast('Could not open that title right now.');
    }
}

// Used to hit graphql.anilist.co directly from the browser on every single page load, entirely
// uncached, then resolve every single result's own tmdbId via up to 20 SEQUENTIAL
// /api/anime-tmdb-id round trips before this row could even render a clickable card (confirmed
// live: 20 of those calls fired back to back loading movieInfo.html once). Now goes through
// /api/anime-timeline-row, which caches the whole result set server-side (same anime_row_cache/
// anime_cache tables the homepage rows and allMovies.html's filter panel already use) and
// resolves+embeds each item's tmdbId server-side too - a cache hit costs one request total.
async function fetchAniListTimelineRow(movieYear) {
    if (!Number.isFinite(Number(movieYear))) return [];
    try {
        const res = await fetch(`/api/anime-timeline-row?year=${encodeURIComponent(movieYear)}`);
        if (!res.ok) {
            console.warn('[AniListTimeline] HTTP error:', res.status);
            return [];
        }
        const items = await res.json();
        return Array.isArray(items) ? items : [];
    } catch (err) {
        console.warn('[AniListTimeline] fetch failed:', err);
        return [];
    }
}

// 2. GLOBAL TRAILER FETCHER — uses TMDB search + videos (no YouTube API key needed)
window.fetchYTId = async function(name) {

    console.log(`[fetchYTId] called with: "${name}"`);
    try {
        // Strip year from name if appended (e.g. "Inception 2010")
        const yearMatch = name.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : '';
        const cleanName = name.replace(/\s*\b(19|20)\d{2}\b\s*/g, '').trim();
        console.log(`[fetchYTId] cleanName="${cleanName}", year="${year}"`);

        // Search TMDB for the title
        const searchUrl = `/api/tmdb-proxy/search/multi?query=${encodeURIComponent(cleanName)}${year ? '&year=' + year : ''}&language=en-US&page=1`;
        console.log(`[fetchYTId] TMDB search URL: ${searchUrl}`);
        const searchRes = await fetch(searchUrl);
        console.log(`[fetchYTId] TMDB search status: ${searchRes.status}`);
        if (!searchRes.ok) { console.warn('[fetchYTId] Search request failed'); return ''; }
        const searchData = await searchRes.json();
        console.log(`[fetchYTId] TMDB search results count: ${searchData.results?.length ?? 0}`);
        console.log(`[fetchYTId] Top 3 results:`, searchData.results?.slice(0, 3).map(r => `${r.media_type}:${r.id} "${r.title || r.name}"`));
        const hit = searchData.results?.find(r => r.media_type === 'movie' || r.media_type === 'tv');
        if (!hit) {
            console.warn('[fetchYTId] No TMDB hit — going straight to YT scrape');
            const ytQuery = `${cleanName} ${year} official trailer`.trim();
            const ytUrl = `/api/yt-search?q=${encodeURIComponent(ytQuery)}`;
            console.log(`[fetchYTId] YT scrape URL: ${ytUrl}`);
            console.log(`[fetchYTId] YT search query: "${ytQuery}"`);
            const ytRes = await fetch(ytUrl);
            if (ytRes.ok) {
                const ytData = await ytRes.json();
                console.log(`[fetchYTId] YT scrape response:`, ytData);
                if (ytData.videoId) {
                    console.log(`[fetchYTId] YT scrape found: "${ytData.videoId}"`);
                    return ytData.videoId;
                }
            } else {
                console.warn(`[fetchYTId] YT scrape HTTP ${ytRes.status} — is the backend running on :4000?`);
            }
            console.log(`[fetchYTId] YT scrape returned nothing`);
            return '';
        }
        console.log(`[fetchYTId] Using hit: ${hit.media_type}:${hit.id} "${hit.title || hit.name}"`);

        // Fetch official trailers for the found title
        const mediaType = hit.media_type === 'tv' ? 'tv' : 'movie';
        const videosUrl = `/api/tmdb-proxy/${mediaType}/${hit.id}/videos?language=en-US`;
        console.log(`[fetchYTId] TMDB videos URL: ${videosUrl}`);
        const videosRes = await fetch(videosUrl);
        console.log(`[fetchYTId] TMDB videos status: ${videosRes.status}`);
        if (!videosRes.ok) { console.warn('[fetchYTId] Videos request failed'); return ''; }
        let videosData = await videosRes.json();
        console.log(`[fetchYTId] Videos returned: ${videosData.results?.length ?? 0} total`);

        // Fallback: retry without language filter (catches foreign/old films with non-EN trailers)
        if (!videosData.results?.length) {
            const fallbackRes = await fetch(`/api/tmdb-proxy/${mediaType}/${hit.id}/videos`);
            if (fallbackRes.ok) {
                videosData = await fallbackRes.json();
                console.log(`[fetchYTId] Fallback videos returned: ${videosData.results?.length ?? 0} total`);
            }
        }

        console.log(`[fetchYTId] All videos:`, videosData.results?.map(v => `${v.type}|${v.site}|${v.key}`));
        const trailer = videosData.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube')
                     || videosData.results?.find(v => v.site === 'YouTube');
        console.log(`[fetchYTId] Chosen trailer key: "${trailer?.key || '(none)'}"`);

        // Last resort: scrape YouTube search directly
        if (!trailer?.key) {
            const ytQuery = `${cleanName} ${year} official trailer`.trim();
            console.log(`[fetchYTId] Falling back to YT scrape: "${ytQuery}"`);
            const ytRes = await fetch(`/api/yt-search?q=${encodeURIComponent(ytQuery)}`);
            if (ytRes.ok) {
                const ytData = await ytRes.json();
                if (ytData.videoId) {
                    console.log(`[fetchYTId] YT scrape found: "${ytData.videoId}"`);
                    return ytData.videoId;
                }
            }
            console.log(`[fetchYTId] YT scrape returned nothing`);
        }

        return trailer?.key || '';
    } catch (e) {
        console.error('[fetchYTId] Error:', e);
        return '';
    }
}

window.fetchYTIds = async function(name) {
    try {
        const yearMatch = name.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : '';
        const cleanName = name.replace(/\s*\b(19|20)\d{2}\b\s*/g, '').trim();

        const searchUrl = `/api/tmdb-proxy/search/multi?query=${encodeURIComponent(cleanName)}${year ? '&year=' + year : ''}&language=en-US&page=1`;
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) return [];
        const searchData = await searchRes.json();
        const hit = (searchData.results || []).find(r => r.media_type === 'movie' || r.media_type === 'tv');
        if (!hit) {
            const ytQuery = `${cleanName} ${year} official trailer`.trim();
            const ytRes = await fetch(`/api/yt-search?q=${encodeURIComponent(ytQuery)}`);
            if (ytRes.ok) {
                const ytData = await ytRes.json();
                return ytData.videoId ? [ytData.videoId] : [];
            }
            return [];
        }

        const mediaType = hit.media_type === 'tv' ? 'tv' : 'movie';
        const videosUrl = `/api/tmdb-proxy/${mediaType}/${hit.id}/videos?language=en-US`;
        const videosRes = await fetch(videosUrl);
        if (!videosRes.ok) return [];
        let videosData = await videosRes.json();

        if (!Array.isArray(videosData.results) || videosData.results.length === 0) {
            const fallbackRes = await fetch(`/api/tmdb-proxy/${mediaType}/${hit.id}/videos`);
            if (fallbackRes.ok) {
                videosData = await fallbackRes.json();
            }
        }

        const youtubeVideos = (videosData.results || []).filter(v => v.site === 'YouTube').map(v => v.key).filter(Boolean);
        const unique = [...new Set(youtubeVideos)];
        if (unique.length > 0) return unique;

        const ytQuery = `${cleanName} ${year} official trailer`.trim();
        const ytRes = await fetch(`/api/yt-search?q=${encodeURIComponent(ytQuery)}`);
        if (ytRes.ok) {
            const ytData = await ytRes.json();
            return ytData.videoId ? [ytData.videoId] : [];
        }
        return [];
    } catch (e) {
        console.error('[fetchYTIds] Error:', e);
        return [];
    }
}

// Forum redirect modal controls (Movie Info page)
window.openForumRedirectModal = function() {
    const modal = document.getElementById('forumRedirectModal');
    if (modal) modal.classList.add('active');
};

window.closeForumRedirectModal = function() {
    const modal = document.getElementById('forumRedirectModal');
    if (modal) modal.classList.remove('active');
};

window.proceedToForum = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const tmdbId = urlParams.get('id');
    const titleEl = document.getElementById('title');
    const movieTitle = titleEl ? titleEl.innerText.trim() : '';
    
    // Pass both tmdbId and movie to forum
    let forumUrl = '/html/forum.html';
    if (tmdbId || movieTitle) {
        const params = new URLSearchParams();
        if (tmdbId) params.append('tmdbId', tmdbId);
        if (movieTitle) params.append('movie', movieTitle);
        forumUrl += '?' + params.toString();
    }
    
    window.location.href = forumUrl;
};
// 3. PAGE INITIALIZATION
document.addEventListener('DOMContentLoaded', async () => {
                // --- Insert soft hyphens into long words in .movie-title for mobile hyphenation ---
                function insertSoftHyphens(text, minLen = 12) {
                    // Insert &shy; every 6 chars in words longer than minLen
                    return text.split(/(\s+)/).map(word => {
                        if (word.length > minLen && !/\s/.test(word)) {
                            return word.replace(/(.{6})/g, '$1\u00AD');
                        }
                        return word;
                    }).join('');
                }

                function updateMovieTitleHyphens() {
                    const titleEl = document.getElementById('title');
                    if (!titleEl) return;
                    if (window.innerWidth <= 730) {
                        // Only apply on mobile
                        const orig = titleEl.getAttribute('data-orig') || titleEl.innerText;
                        titleEl.setAttribute('data-orig', orig);
                        // Use innerText to avoid double-escaping
                        titleEl.innerHTML = insertSoftHyphens(orig);
                    } else {
                        // Restore original
                        const orig = titleEl.getAttribute('data-orig');
                        if (orig) titleEl.innerText = orig;
                    }
                }
                updateMovieTitleHyphens();
                window.addEventListener('resize', updateMovieTitleHyphens);
        // --- Plot Read More/Less Logic (mobile-only) ---
        // Previously watched for the real plot text arriving via a
        // MutationObserver on #plot, reacting to the setText('plot', ...)
        // side effect instead of the actual event. That's the classic setup
        // for exactly the bug reported here: an indirect, async-microtask-
        // delayed link between "data arrived" and "reset + redisplay" that a
        // click landing in the same window can race against. Replaced with a
        // direct call (window.__setMoviePlotText, invoked synchronously by
        // both setText('plot', ...) call sites below) -- no observer, no gap
        // for a click to land in.
        let isPlotExpanded = false;
        let fullPlotText = '';
        const plotEl = document.getElementById('plot');
        const plotBtn = document.getElementById('plotReadMoreBtn');

        function truncateWords(text, wordLimit) {
            const words = text.split(/\s+/);
            if (words.length <= wordLimit) return {truncated: text, isTruncated: false};
            return {truncated: words.slice(0, wordLimit).join(' ') + '...', isTruncated: true};
        }

        function updatePlotDisplay() {
            if (!plotEl) return;
            const text = fullPlotText || plotEl.innerText;
            let wordLimit = 100;
            if (window.innerWidth <= 510) {
                wordLimit = 50;
            } else if (window.innerWidth <= 800) {
                wordLimit = 100;
            } else {
                wordLimit = null;
            }
            if (wordLimit) {
                const {truncated, isTruncated} = truncateWords(text, wordLimit);
                if (!isPlotExpanded && isTruncated) {
                    plotEl.innerHTML = truncated + ' <a href="#" id="plotReadMoreLink" class="plot-readmore-link" style="text-decoration:underline;cursor:pointer;color:#f96d00;">Read More</a>';
                } else {
                    plotEl.innerHTML = text + (isTruncated ? ' <a href="#" id="plotReadMoreLink" class="plot-readmore-link" style="text-decoration:underline;cursor:pointer;color:#f96d00;">Read Less</a>' : '');
                }
            } else {
                // On desktop, always show full plot and hide button
                plotEl.innerHTML = text;
            }

            // Attach event listener to the new link (if present)
            const readMoreLink = document.getElementById('plotReadMoreLink');
            if (readMoreLink) {
                readMoreLink.addEventListener('click', function(e) {
                    e.preventDefault();
                    isPlotExpanded = !isPlotExpanded;
                    updatePlotDisplay();
                });
            }
        }

        if (plotBtn) {
            plotBtn.addEventListener('click', function(e) {
                e.preventDefault(); // Prevent anchor navigation
                isPlotExpanded = !isPlotExpanded;
                updatePlotDisplay();
            });
        }

        // Called directly (synchronously) by the code that fetches the real
        // movie/show overview, instead of being inferred after the fact.
        window.__setMoviePlotText = function(text) {
            fullPlotText = text;
            isPlotExpanded = false;
            updatePlotDisplay();
        };

        // Initial setup (placeholder text until the real fetch resolves)
        updatePlotDisplay();

        // Re-apply truncation logic on resize
        window.addEventListener('resize', () => {
            updatePlotDisplay();
        });
    console.log('[MovieInfo] DOMContentLoaded');
    // Show loading overlay
    const loadingOverlay = document.getElementById('movieLoadingOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'flex';

    // Animate spinner grow, collapse, then fade overlay after 2s
    setTimeout(() => {
        if (!loadingOverlay) return;
        const spinner = loadingOverlay.querySelector('.loading-spinner');
        if (spinner) spinner.classList.add('grow');
        setTimeout(() => {
            if (spinner) spinner.classList.remove('grow');
            if (spinner) spinner.classList.add('collapse');
            setTimeout(() => {
                loadingOverlay.classList.add('fade-out');
                // Fade-up main content
                // No fade-up entrance, just normal fade-out for loader
                setTimeout(() => {
                    loadingOverlay.style.display = 'none';

                    // Preload episode sources in background (500ms after loading screen disappears)
                    setTimeout(() => {
                        window.preloadEpisodeSources?.();
                    }, 500);
                }, 500);
            }, 350);
        }, 350);
    }, 2000);

    // --- YouTube Trailer Button Logic ---
    const vidSrcBtn = document.getElementById('watchVidsrcBtn');
    if (vidSrcBtn) {
        vidSrcBtn.addEventListener('click', async function() {
            const urlParams = new URLSearchParams(window.location.search);
            const tmdbId = urlParams.get('id');
            const typeParam = (urlParams.get('type') || '').toLowerCase();
            if (!tmdbId) return alert('No TMDB id found!');
            const isSeries = typeParam === 'tv' || typeParam === 'series' || typeParam === 'anime';
            try {
                const res = await fetch(`/api/tmdb-proxy/${isSeries ? 'tv' : 'movie'}/${tmdbId}/videos`);
                if (!res.ok) throw new Error('Failed to fetch videos');
                const data = await res.json();
                const trailers = data.results.filter(v => v.site === 'YouTube' && v.type === 'Trailer');
                if (trailers.length > 0) {
                    const ytKey = trailers[0].key;
                    window.open(`https://www.youtube.com/watch?v=${ytKey}`, '_blank');
                } else {
                    // Fallback: open YouTube search
                    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(tmdbId + ' trailer')}`,'_blank');
                }
            } catch (e) {
                alert('Could not fetch trailer.');
            }
        });
    }
    const urlParams = new URLSearchParams(window.location.search);
    const movieId = urlParams.get('id');
    const typeParam = (urlParams.get('type') || '').toLowerCase();
    const isTV = typeParam === 'tv' || typeParam === 'series' || typeParam === 'anime';
    if (!movieId) return;

    // Helper functions
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    const cleanList = (str) => str ? String(str).replace(/[\[\]']/g, '').split(',').map(s => s.trim()) : [];
    const formatMoney = (v) => v > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v) : "N/A";
    const cap = (v) => String(v || '').charAt(0).toUpperCase() + String(v || '').slice(1);

async function applyAnimeMalDetailsIfAvailable(tmdbItem, tmdbId) {
    const isLikelyAnime = (typeof typeParam !== 'undefined' && typeParam === 'anime') ||
        (!!(tmdbItem && (Array.isArray(tmdbItem.genres) && tmdbItem.genres.some(g => (g.name || '').toLowerCase() === 'animation')) && ((tmdbItem.original_language || '').toLowerCase() === 'ja' || (Array.isArray(tmdbItem.origin_country) && tmdbItem.origin_country.includes('JP')))));
    
    if (!isLikelyAnime) return false;

    try {
        const mapRes = await fetch(`/api/anime-mal-id?tmdbId=${encodeURIComponent(tmdbId)}&season=1`);
        if (!mapRes.ok) return false;
        const mapData = await mapRes.json();
        const malId = mapData?.mal_id;
        const anilistId = mapData?.anilist_id;
        
        if (!anilistId) return false;

        console.log(`[Anime] TMDB ${tmdbId} → MAL ${malId} → AniList ${anilistId}`);
        console.log(`[Anime] Checking cache...`);

        // Comments used to only load once Watch Now was clicked AND the Neko server picked
        // (moviePlayer.js's anime-episode-changed event, which is the only thing that ever
        // set window.__currentAnimeMalId). malId is already known here, at normal page load,
        // so fire the comments load now instead of waiting on either of those. Defaults to
        // episode 1 - if the player later resolves a different episode (e.g. resuming a
        // continue-watching position), the anime-episode-changed listener already reloads
        // comments for the real one, so this is just a better starting point, not final state.
        // On a slow/shaky connection, don't compete with the critical TMDB/AniList fetches
        // above for bandwidth - just record the state and let comments load lazily once Watch
        // Now fires anime-episode-changed instead (same as before this whole eager-load existed).
        if (malId && !window.__currentAnimeMalId) {
            window.__currentAnimeMalId = malId;
            window.__currentAnimeSeason = window.__currentAnimeSeason || 1;
            window.__currentAnimeEpisode = window.__currentAnimeEpisode || 1;
            if (!window.__isSlowConnection && typeof loadAnimeComments === 'function') loadAnimeComments();
        }

        let anime;

        // 1. Check cache
        const cacheRes = await fetch(`/api/anime-info?anilistId=${anilistId}`);
        if (cacheRes.ok) {
            const cache = await cacheRes.json();
            if (cache.exists) {
                anime = cache.anime;
                console.log(`[Anime] Cache HIT for AniList ${anilistId}`);
            }
        }

        // 2. Fetch from AniList on miss
        if (!anime) {
            console.log(`[Anime] Cache MISS for AniList ${anilistId}. Fetching AniList API...`);
            
            const query = `
                query ($id:Int) {
                    Media(id:$id,type:ANIME){
                        title {
                            romaji
                            english
                        }
                        description(asHtml:false)
                        studios(isMain:true){
                            nodes{
                                name
                            }
                        }
                        source
                        episodes
                        status
                        season
                        seasonYear
                        averageScore
                        duration
                        genres
                        popularity
                        rankings{
                            rank
                            type
                        }
                        idMal
                    }
                }
            `;

            const aniRes = await fetch("https://graphql.anilist.co", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    query,
                    variables: { id: anilistId }
                })
            });

            if (!aniRes.ok) return false;
            const aniData = await aniRes.json();
            
            anime = aniData?.data?.Media;
            if (!anime) return false;

            console.log(`[Anime] AniList returned "${anime.title?.english || anime.title?.romaji}"`);
            console.log(`[Anime] Saving anime info to cache...`);

            // Cache the newly fetched data - fire-and-forget, `anime` below is already in hand
            // from the AniList response above regardless of whether this save succeeds, so
            // there's nothing gained by waiting on it before rendering the details grid.
            fetch("/api/cache-anime-info", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    anilistId,
                    malId,
                    tmdbId,
                    anime
                })
            }).then(cacheSaveRes => {
                if (cacheSaveRes.ok) {
                    console.log("[Anime] Anime cached successfully.");
                } else {
                    console.error("[Anime] Failed to cache anime:", cacheSaveRes.status, cacheSaveRes.statusText);
                }
            }).catch(err => console.error("[Anime] Cache save failed:", err));
        }

        // 3. Update the UI DOM
        const detailsGrid = document.querySelector('.details-grid');
        const labels = detailsGrid ? detailsGrid.querySelectorAll('.detail-label') : [];
        if (labels.length >= 7) {
            labels[0].textContent = 'Studios:';
            labels[1].textContent = 'Source:';
            labels[2].textContent = 'Episodes:';
            labels[3].textContent = 'Status:';
            labels[4].textContent = 'Season:';
            labels[5].textContent = 'Members / Rank:';
            labels[6].textContent = 'MAL ID:';
        }

        const studios = anime.studios?.nodes?.map(s => s.name).join(", ") || "N/A";
        const source = anime.source || 'N/A';
        // anime.episodes is AniList's count for the single season=1 entry we mapped to above -
        // TMDB, unlike anikoto/AniList, lists every season of a show like Tower of God under
        // one shared id, so its own seasons[] already has the real per-season episode_count
        // breakdown. Sum that (excluding season 0 "Specials") instead of trusting one season's
        // AniList number as if it were the whole show.
        const tmdbSeasonEpisodeTotal = Array.isArray(tmdbItem?.seasons)
            ? tmdbItem.seasons.filter(s => s && s.season_number > 0).reduce((sum, s) => sum + (Number(s.episode_count) || 0), 0)
            : 0;
        const episodes = tmdbSeasonEpisodeTotal > 0
            ? String(tmdbSeasonEpisodeTotal)
            : (anime.episodes != null ? String(anime.episodes) : 'Unknown');
        const status = anime.status ? anime.status.replaceAll("_", " ") : "N/A";
        
        const season = anime.season
            ? `${cap(anime.season)}${anime.seasonYear ? ` ${anime.seasonYear}` : ''}`
            : (anime.seasonYear ? String(anime.seasonYear) : 'N/A');
            
        const members = anime.popularity?.toLocaleString() || "N/A";
        
        const ratingRank = anime.rankings?.find(r => r.type === "RATED");
        const rank = ratingRank ? `#${ratingRank.rank}` : "N/A";

        setText('directors', studios);
        setText('genre', source);
        setText('votes', episodes);
        setText('budget', status);
        setText('revenue', season);
        setText('financialStatus', `${members} / ${rank}`);
        
        setText('imdbId', `MAL ${anime.idMal}`);

        if (anime.description) window.__setMoviePlotText(anime.description);
        if (anime.averageScore != null) setText('rating', (anime.averageScore / 10).toFixed(1));
        if (anime.duration) setText('runtime', `${anime.duration} min`);  
        if (anime.seasonYear) setText('year', anime.seasonYear);

        return true;
    } catch (e) {
        console.error("Error applying anime details:", e);
        return false;
    }
}

    try {
        let movie = null;
        let movieYear = null;
        let directors = [];
        let stars = [];
        if (isTV) {
            // --- Streaming server display logic ---
            const serverRow = document.getElementById('serverRow');
            if (serverRow) {
                let serverHtml = '';
                if (typeParam === 'anime') {
                    serverHtml = '<span style="color:#888;">No anime servers yet</span>';
                } else {
                    serverHtml = '<span class="server-badge">2embed</span> <span class="server-badge">superembed</span> <span class="server-badge">vidlink</span>';
                }
                serverHtml += ' <span class="server-badge">megacloud</span>';
                serverRow.innerHTML = serverHtml;
            }
            // 1. FIX: Fetch 'aggregate_credits' to get every actor across all seasons
            const tmdbRes = await fetch(`/api/tmdb-proxy/tv/${movieId}?append_to_response=external_ids,aggregate_credits,credits`);
            movie = await tmdbRes.json();
            if (!movie.name && !movie.title) throw new Error("Item not found");

            // Auto-detect anime and flip the nav lever if so
            const _isAnimeTitle = (typeParam === 'anime') ||
                (!!(movie && (Array.isArray(movie.genres) && movie.genres.some(g => (g.name || '').toLowerCase() === 'animation')) && ((movie.original_language || '').toLowerCase() === 'ja' || (Array.isArray(movie.origin_country) && movie.origin_country.includes('JP')))));
            if (_isAnimeTitle && localStorage.getItem('animeMode') !== 'true') {
                localStorage.setItem('animeMode', 'true');
                const cb = document.getElementById('animeModeCheck');
                if (cb) { cb.checked = true; cb.closest('.mode-toggle-wrap')?.classList.add('anime-active'); }
            }
            
            // 2. Define fullTvCast using the massive aggregate list
            const fullTvCast = movie.aggregate_credits?.cast || movie.credits?.cast || [];
            
            const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '/img/LOGO_Short.png';
            movieYear = movie.first_air_date ? parseInt(movie.first_air_date.split('-')[0]) : null;
            if(document.getElementById('posterImg')) document.getElementById('posterImg').src = posterUrl;
            if(document.getElementById('bgBackdrop')) document.getElementById('bgBackdrop').style.backgroundImage = `url('${tmdbImgUrl(movie.poster_path, 'w500', 'w300')}')`; // heavily blurred anyway (30px), low-res is invisible here
            setText('title', movie.name || movie.original_name || 'Unknown');
            // Retry now that the real title is in -- the initial DOMContentLoaded call
            // (see bottom of file) ran before this and had nothing but "Loading..." to
            // send, so the kinogo RU comment lookup never got a usable title until now.
            if (typeof window.loadComments === 'function') window.loadComments();
            setText('rating', movie.vote_average ? movie.vote_average.toFixed(1) : '--');
            setText('runtime', movie.episode_run_time?.[0] ? `${movie.episode_run_time[0]} min` : 'N/A');
            window.__setMoviePlotText(movie.overview || 'No description available.');
            setText('genre', movie.genres?.map(g => g.name).join(', ') || 'N/A');
            setText('votes', movie.vote_count || '0');
            setText('year', movieYear || '----');
            setText('imdbId', movie.external_ids?.imdb_id || 'N/A');

            const badgeSlot = document.getElementById('episodeCountBadgesSlot');
            if (badgeSlot && window.buildEpisodeCountBadgesPlaceholder) {
                badgeSlot.innerHTML = window.buildEpisodeCountBadgesPlaceholder({
                    type: _isAnimeTitle ? 'anime' : 'tv',
                    title: movie.name || movie.original_name || '',
                    tmdbId: movieId,
                    inline: true
                });
                window.mountEpisodeCountBadges?.(badgeSlot);
            }
            directors = [movie.created_by?.[0]?.name || 'N/A'];
            
            // Show main cast (up to 5 names) for text
            stars = fullTvCast.slice(0, 5).map(c => c.name);
            setText('directors', directors[0]);
            setText('actors', stars.length ? stars.join(', ') : 'N/A');

            // If this title maps to MAL, upgrade details-grid with richer anime metadata.
            // NOT awaited: on a cache miss this chains 3-4 sequential fetches (our backend
            // twice, then the external AniList GraphQL API), which was blocking everything
            // below - actor thumbnails, recommendation rows - from even starting until it
            // finished. On slow/high-latency wifi that alone easily accounted for several
            // seconds of "nothing visible happening" before the rest of the page rendered.
            applyAnimeMalDetailsIfAvailable(movie, movieId).catch(err => console.error('[Anime] Enrichment failed:', err));
            
            // 🔥 TV ACTOR BLOCKS WITH IMAGES 🔥 (LIMITED TO 5 FOR SPACE)
            const actorList = document.getElementById('actorList');
            if (actorList && fullTvCast.length) {
                actorList.innerHTML = '';
                fullTvCast.slice(0, 5).forEach(actor => {
                    const li = document.createElement('li');
                    li.className = 'actor-block';
                    li.dataset.actorId = actor.id;
                    li.dataset.actorName = actor.name;
                    // Check if they have a profile image, else use a gray background
                    const bgStyle = actor.profile_path 
                        ? `background-image: url('${tmdbImgUrl(actor.profile_path, 'w185', 'w92')}'); background-size: cover; background-position: center;`
                        : `background-color: #333;`;

                    li.innerHTML = `<div class="actor-block-pic" style="${bgStyle}"></div><span class="actor-block-name">${escapeHtml(actor.name)}</span>`;
                    li.addEventListener('click', function() {
                        // Scroll to castPicker section
                        const castPickerSection = document.getElementById('castPicker');
                        if (castPickerSection) {
                            castPickerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                        // Auto-select actor in actorSelect
                        const actorSelect = document.getElementById('actorSelect');
                        if (actorSelect) {
                            actorSelect.value = actor.id;
                            actorSelect.dispatchEvent(new Event('change'));
                        }
                    });
                    actorList.appendChild(li);
                });
            }
            
            // Populate actorSelect dropdown with ALL cast members
            const actorSelect = document.getElementById('actorSelect');
            if (actorSelect && fullTvCast.length) {
                // Deduplicate (aggregate_credits occasionally lists the same voice actor twice for different characters)
                const uniqueActors = [];
                const map = new Set();
                for (const item of fullTvCast) {
                    if (!map.has(item.id)) {
                        map.add(item.id);
                        uniqueActors.push(item);
                    }
                }
                actorSelect.innerHTML = uniqueActors.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
            }
            setupTrailerButton(movie.name, movieYear);

            // Track this TV/anime page visit with full metadata
            if (window.recommendationsSystem?.trackMovieClick) {
                const tvGenre = (movie.genres || []).map(g => g.name).join(', ');
                const tvRating = movie.vote_average ? String(movie.vote_average.toFixed(1)) : '';
                const tvTitle = movie.name || movie.title || '';
                window.recommendationsSystem.trackMovieClick(String(movieId), tvGenre, String(movieYear || ''), tvRating, tvTitle, 'tv');
            }

            // --- TV Carousels ---
            // 1. GenreRow (Similar Genre)
            // Wrapped in an IIFE and NOT awaited: for anime titles this can poll
            // /api/anime-recommendations up to 20 times at 500ms apart (waitForAnimeRecommendations
            // below) waiting for the backend's cache to finish building - a full 10 seconds in the
            // worst case. That was blocking the director row, era row, and the main TV
            // recommendations carousel below from rendering at all until it finished, which was
            // almost certainly the actual "10000ms of nothing happening" - not image sizes.
            (async () => {
            const genreRow = document.getElementById('genreRow');
            if (genreRow && movie.genres?.length) {
                genreRow.innerHTML = '<p style="color:#888;">Loading...</p>';

                async function waitForAnimeRecommendations(tmdbId) {
                    for (let attempt = 0; attempt < 20; attempt++) {
                        try {
                            const response = await fetch(`/api/anime-recommendations?tmdbId=${tmdbId}`);
                            if (!response.ok) break;
                            const body = await response.json();
                            if (body.status === 'ready') {
                                return body.recommendations || [];
                            }
                            if (body.status === 'processing') {
                                await new Promise(r => setTimeout(r, 500));
                                continue;
                            }
                            return body.recommendations || [];
                        } catch (err) {
                            console.warn('[AnimeReco] Poll failed', err);
                            await new Promise(r => setTimeout(r, 500));
                        }
                    }
                    return [];
                }

                // Real per-title anime detection (Animation genre + Japanese origin), not the
                // site-wide toggle -- an anime title should get AniList-flavored recommendations
                // even if the user happens to be browsing with the Movie/Anime toggle off.
                const isAnime = movie.genres.some(g => g.name === 'Animation' || g.name === 'Anime') && (movie.original_language === 'ja' || movie.origin_country?.includes('JP'));

                const rowHeadings = document.querySelectorAll('.vertical-recommend .row-title, .vertical-recommend-row .row-title');
                rowHeadings.forEach(h => {
                    h.innerHTML = isAnime
                        ? 'Animes Like This <span>Based on Genre</span>'
                        : 'Movies Like This <span>Based on Genre</span>';
                });

                // Shared TMDB recommendations/similar renderer -- used as the primary source in
                // movie mode, and as a fallback for anime titles when AniList/the anime-rec cache
                // comes back empty (e.g. AniList having an outage) instead of a dead-end row.
                // Backed by the server-side cache in movieCache.db (cache-first, TMDB on miss).
                async function renderTmdbTvRecommendations() {
                    const d = await fetch(`/api/movie-recommendations?tmdbId=${movieId}&type=tv`).then(r => r.json()).catch(() => null);
                    const results = d?.results || [];
                    const label = d?.source === 'similar' ? 'Similar Titles' : 'Recommended';

                    genreRow.innerHTML = '';
                    const cards = [];
                    results.forEach(item => {
                        if (item.id === movie.id) return;
                        const displayName = item.name || item.title || 'Unknown';
                        const year = (item.first_air_date || '').split('-')[0] || 'N/A';
                        const poster = tmdbImgUrl(item.poster_path, 'w342', 'w154');
                        const card = document.createElement('div');
                        card.className = 'mini-card';
                        card.innerHTML = `
                            <img src="${poster}" alt="${displayName}">
                            <div class="mini-info">
                                <h4>${displayName}</h4>
                                <p>⭐ ${item.vote_average || '--'} (${item.vote_count || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">${label}</p>
                            </div>
                        `;
                        card.onclick = () => {
                            window.location.href = `movieInfo.html?id=${item.id}&type=tv`;
                        };
                        genreRow.appendChild(card);
                        cards.push(card.outerHTML);
                    });
                    const genreRowClone = document.getElementById('genreRowClone');
                    if (genreRowClone) {
                        genreRowClone.innerHTML = cards.join('');
                        Array.from(genreRowClone.querySelectorAll('.mini-card')).forEach((el, idx) => {
                            el.onclick = () => {
                                const item = results.filter(item => item.id !== movie.id)[idx];
                                if (item) {
                                    window.location.href = `movieInfo.html?id=${item.id}&type=tv`;
                                }
                            };
                        });
                    }
                    if (cards.length === 0) {
                        genreRow.innerHTML = `<p style="color:#666; padding:20px;">No similar titles found.</p>`;
                    } else {
                        buildPlaylist(movie.name);
                    }
                }

                if (isAnime) {
                    const recs = await waitForAnimeRecommendations(movieId);
                    if (!recs.length) {
                        // AniList/anime-rec cache came back empty -- could be a genuine miss or
                        // AniList being down. Either way, fall back to TMDB rather than dead-ending.
                        await renderTmdbTvRecommendations();
                    } else {
                        genreRow.innerHTML = '';
                        const cards = [];
                        const mappedItems = recs.filter(item => item && item.anilistId && item.ID !== movie.id);
                        mappedItems.forEach(item => {
                            const displayName = item['Movie Name'] || 'Unknown';
                            const year = item.Year || 'N/A';
                            const poster = item.poster_full_url || '/img/LOGO_Short.png';
                            const card = document.createElement('div');
                            card.className = 'mini-card';
                            card.dataset.anilistId = item.anilistId;
                            card.innerHTML = `
                                <img src="${poster}" alt="${displayName}">
                                <div class="mini-info">
                                    <h4>${displayName}</h4>
                                    <p>⭐ ${item.Rating || '--'} (${item.Votes || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                    <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">AniList Recommendations</p>
                                </div>
                            `;
                            card.onclick = () => navigateToAnimeRecommendation(card, item.anilistId, displayName, item.ID);
                            genreRow.appendChild(card);
                            cards.push(card.outerHTML);
                        });
                        const genreRowClone = document.getElementById('genreRowClone');
                        if (genreRowClone) {
                            genreRowClone.innerHTML = cards.join('');
                            Array.from(genreRowClone.querySelectorAll('.mini-card')).forEach((el, idx) => {
                                el.onclick = () => {
                                    const item = mappedItems[idx];
                                    if (item) navigateToAnimeRecommendation(el, item.anilistId, item['Movie Name'], item.ID);
                                };
                            });
                        }
                        if (cards.length === 0) {
                            genreRow.innerHTML = `<p style="color:#666; padding:20px;">No similar titles found.</p>`;
                        } else {
                            buildPlaylist(movie.name);
                        }
                    }

                } else {
                    await renderTmdbTvRecommendations();
                }
            } else {
                // (Overlay hiding handled globally after 2s)
            }
            })().catch(err => console.error('[GenreRow] Failed to populate:', err));

            // 2. Director/Creator Row (The Ultimate Anime Fallback)
            const directorRow = document.getElementById('directorRow');
            const directorTitle = document.getElementById('directorTitle');
            
            // Waterfall search: TMDB hides anime directors in different places
            let targetPerson = null;
            let roleLabel = "Director";

            if (movie.aggregate_credits?.crew) {
                targetPerson = movie.aggregate_credits.crew.find(c => c.job === 'Series Director' || c.job === 'Director');
            }
            if (!targetPerson && movie.credits?.crew) {
                targetPerson = movie.credits.crew.find(c => c.job === 'Series Director' || c.job === 'Director');
            }
            if (!targetPerson && movie.created_by?.length > 0) {
                targetPerson = movie.created_by[0];
                roleLabel = "Creator"; // Usually the mangaka for anime adaptations
            }

            if (directorRow && targetPerson) {
                directors = [targetPerson.name]; // Save it for the recommendations logic!
                directorRow.innerHTML = '<p style="color:#888;">Loading...</p>';
                if (directorTitle) directorTitle.innerText = `More from ${targetPerson.name}`;
                
                const discoverUrl = `/api/tmdb-proxy/person/${targetPerson.id}/tv_credits`;
                fetch(discoverUrl)
                    .then(r => r.json())
                    .then(d => {
                        directorRow.innerHTML = '';
                        
                        // Grab crew credits and deduplicate them
                        const uniqueShows = [];
                        const seenIds = new Set();
                        
                        (d.crew || []).sort((a, b) => b.popularity - a.popularity).forEach(item => {
                            if (item.id !== movie.id && !seenIds.has(item.id)) {
                                seenIds.add(item.id);
                                uniqueShows.push(item);
                            }
                        });

                        const tvResults = uniqueShows.slice(0, 20);
                        
                        if (tvResults.length === 0) {
                            const dSec = directorRow.closest('.recommend-section');
                            if (dSec) dSec.style.display = 'none';
                            return;
                        }

                        tvResults.forEach(item => {
                            const displayName = item.name || item.title || 'Unknown';
                            const year = (item.first_air_date || '').split('-')[0] || 'N/A';
                            const poster = tmdbImgUrl(item.poster_path, 'w342', 'w154');
                            const card = document.createElement('div');
                            card.className = 'mini-card';
                            card.innerHTML = `
                                <img src="${poster}" alt="${displayName}">
                                <div class="mini-info">
                                    <h4>${displayName}</h4>
                                    <p>⭐ ${item.vote_average || '--'} (${item.vote_count || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                    <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">${roleLabel}: ${targetPerson.name}</p>
                                </div>
                            `;
                            card.onclick = () => {
                                window.location.href = `movieInfo.html?id=${item.id}&type=tv`;
                            };
                            directorRow.appendChild(card);
                        });
                    }).catch(() => {
                        const dSec = directorRow.closest('.recommend-section');
                        if (dSec) dSec.style.display = 'none';
                    });
            } else if (directorRow) {
                const dSec = directorRow.closest('.recommend-section');
                if (dSec) dSec.style.display = 'none';
            }

            // Studio Row (anime only)
            const isAnimeShow = movie.genres?.some(g => g.name === 'Animation' || g.name === 'Anime') &&
                                (movie.original_language === 'ja' || movie.origin_country?.includes('JP'));
            if (isAnimeShow) {
                const studioSection = document.getElementById('studioSection');
                const studioTitle   = document.getElementById('studioTitle');
                const studioRow     = document.getElementById('studioRow');
                if (studioSection && studioRow) {
                    const company = (movie.production_companies || [])[0] || (movie.networks || [])[0];
                    if (company) {
                        studioSection.style.display = '';
                        if (studioTitle) studioTitle.innerText = `More from ${company.name}`;
                        studioRow.innerHTML = '<p style="color:#888;">Loading...</p>';
                        fetch(`/api/tmdb-proxy/discover/tv?with_companies=${company.id}&with_original_language=ja&sort_by=popularity.desc`)
                            .then(r => r.json())
                            .then(d => {
                                studioRow.innerHTML = '';
                                const results = (d.results || []).filter(item => item.id !== movie.id).slice(0, 20);
                                if (!results.length) {
                                    studioSection.style.display = 'none';
                                    return;
                                }
                                results.forEach(item => {
                                    const displayName = item.name || item.title || 'Unknown';
                                    const year = (item.first_air_date || '').split('-')[0] || 'N/A';
                                    const poster = tmdbImgUrl(item.poster_path, 'w342', 'w154');
                                    const card = document.createElement('div');
                                    card.className = 'mini-card';
                                    card.innerHTML = `
                                        <img src="${poster}" alt="${displayName}">
                                        <div class="mini-info">
                                            <h4>${displayName}</h4>
                                            <p>⭐ ${item.vote_average || '--'} (${item.vote_count || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                            <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">From ${company.name}</p>
                                        </div>
                                    `;
                                    card.onclick = () => {
                                        window.location.href = `movieInfo.html?id=${item.id}&type=tv`;
                                    };
                                    studioRow.appendChild(card);
                                });
                            }).catch(() => {
                                studioSection.style.display = 'none';
                            });
                    }
                }
            }

            // 3. ActorRow (More from Cast)
            const actorRow = document.getElementById('actorRow');
            const actorTitle = document.getElementById('actorTitle');
            if (actorRow && fullTvCast.length) {
                actorRow.innerHTML = '<p style="color:#888;">Loading...</p>';
                const allCast = fullTvCast;
                if (actorSelect) {
                    // actorSelect is already populated with ALL cast members above
                    actorSelect.onchange = (e) => {
                        const actorId = e.target.value;
                        const selectedActor = allCast.find(c => c.id == actorId);
                        if (actorTitle) actorTitle.innerText = `More from ${selectedActor?.name || 'Actor'}`;
                        const discoverUrl = `/api/tmdb-proxy/person/${actorId}/tv_credits`;
                        fetch(discoverUrl)
                            .then(r => r.json())
                            .then(d => {
                                actorRow.innerHTML = '';
                                // Use d.cast for TV credits. A recurring guest role (e.g. voicing
                                // several one-off characters on the same show) comes back from
                                // TMDB as one cast entry per appearance, all sharing the same show
                                // id -- dedupe on id so the row doesn't fill up with repeats of one
                                // show, keeping the highest-popularity entry via the sort above.
                                const seenShowIds = new Set();
                                const tvResults = (d.cast || [])
                                    .sort((a, b) => b.popularity - a.popularity)
                                    .filter(item => {
                                        if (seenShowIds.has(item.id)) return false;
                                        seenShowIds.add(item.id);
                                        return true;
                                    })
                                    .slice(0, 20);
                                tvResults.forEach(item => {
                                    if (item.id === movie.id) return;
                                    const displayName = item.name || item.title || 'Unknown';
                                    const year = (item.first_air_date || '').split('-')[0] || 'N/A';
                                    const poster = tmdbImgUrl(item.poster_path, 'w342', 'w154');
                                    const card = document.createElement('div');
                                    card.className = 'mini-card';
                                    card.style.position = 'relative';
                                    card.innerHTML = `
                                        ${window.buildEpisodeCountBadgesPlaceholder ? window.buildEpisodeCountBadgesPlaceholder({ type: 'tv', title: displayName, tmdbId: item.id }) : ''}
                                        <img src="${poster}" alt="${displayName}">
                                        <div class="mini-info">
                                            <h4>${displayName}</h4>
                                            <p>⭐ ${item.vote_average || '--'} (${item.vote_count || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                            <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">Starring ${selectedActor?.name || 'Actor'}</p>
                                        </div>
                                    `;
                                    card.onclick = () => {
                                        window.location.href = `movieInfo.html?id=${item.id}&type=tv`;
                                    };
                                    actorRow.appendChild(card);
                                });
                                window.mountEpisodeCountBadges?.(actorRow);
                            });
                    };
                    // Initial load
                    actorSelect.dispatchEvent(new Event('change'));
                }
            }


            // 4. TimelineRow (Same Era)
            const timelineRow = document.getElementById('timelineRow');
            const eraTitle = document.getElementById('eraTitle');
            if (timelineRow && movieYear) {
                timelineRow.innerHTML = '<p style="color:#888;">Loading...</p>';
                if (eraTitle) eraTitle.innerHTML = `Series from ${movieYear - 5} - ${movieYear + 5}`;

                // Per-title anime detection (matches the Recommended row above) -- not gated on
                // the site-wide toggle, so an anime title always gets AniList-based "Same Era"
                // results regardless of what mode the user happens to be browsing in.
                const isAnimeEra = movie.genres.some(g => g.name === 'Animation' || g.name === 'Anime');

                async function renderTmdbEraRow() {
                    const d = await fetch(`/api/tmdb-proxy/discover/tv?first_air_date.gte=${movieYear - 5}-01-01&first_air_date.lte=${movieYear + 5}-12-31&sort_by=popularity.desc&vote_count.gte=20&page=1`).then(r => r.json()).catch(() => null);
                    timelineRow.innerHTML = '';
                    (d?.results || []).forEach(item => {
                        if (item.id === movie.id) return;
                        const displayName = item.name || item.title || 'Unknown';
                        const year = (item.first_air_date || '').split('-')[0] || 'N/A';
                        const poster = tmdbImgUrl(item.poster_path, 'w342', 'w154');
                        const card = document.createElement('div');
                        card.className = 'mini-card';
                        card.innerHTML = `
                            <img src="${poster}" alt="${displayName}">
                            <div class="mini-info">
                                <h4>${displayName}</h4>
                                <p>⭐ ${item.vote_average || '--'} (${item.vote_count || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">Same Era</p>
                            </div>
                        `;
                        card.onclick = () => {
                            window.location.href = `movieInfo.html?id=${item.id}&type=tv`;
                        };
                        timelineRow.appendChild(card);
                    });
                    if (!timelineRow.children.length) {
                        timelineRow.innerHTML = '<p style="color:#888;">No similar titles found.</p>';
                    }
                }

                if (isAnimeEra) {
                    fetchAniListTimelineRow(movieYear).then(async items => {
                        timelineRow.innerHTML = '';
                        const seen = new Set();
                        // tmdbId is already resolved+embedded server-side by /api/anime-timeline-row
                        // (same pattern /api/anime-library uses) - no more per-item /api/anime-tmdb-id
                        // round trip needed here at all.
                        for (const item of items || []) {
                            const displayName = item?.title?.english || item?.title?.romaji || item?.title?.native || 'Unknown';
                            if (!displayName) continue;
                            const key = displayName.toLowerCase();
                            if (seen.has(key)) continue;
                            seen.add(key);

                            const poster = item?.coverImage?.extraLarge || item?.coverImage?.large || '/img/LOGO_Short.png';
                            const year = item?.startDate?.year || 'N/A';
                            const tmdbId = item?.tmdbId || null;
                            if (!tmdbId) continue;

                            const card = document.createElement('div');
                            card.className = 'mini-card';
                            card.innerHTML = `
                                <img src="${poster}" alt="${displayName}">
                                <div class="mini-info">
                                    <h4>${displayName}</h4>
                                    <p>⭐ ${item?.averageScore || '--'} (${item?.popularity || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                    <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">Same Era</p>
                                </div>
                            `;
                            card.onclick = () => {
                                window.location.href = `movieInfo.html?id=${encodeURIComponent(tmdbId)}&type=tv`;
                            };
                            timelineRow.appendChild(card);
                        }
                        if (!timelineRow.children.length) {
                            // AniList timeline came back empty -- genuine miss or AniList down.
                            // Fall back to TMDB's date-range discover instead of a dead-end row.
                            await renderTmdbEraRow();
                        }
                    });
                } else {
                    await renderTmdbEraRow();
                }
            }

            // TV Recommendations (main carousel)
            initTVRecommendations(movieId);
        } else {
            // MOVIE LOGIC (Bypassing deprecated local DB, using TMDB directly)
            const tmdbRes = await fetch(`/api/tmdb-proxy/movie/${movieId}?append_to_response=external_ids,credits`);
            movie = await tmdbRes.json();
            
            if (!movie.title && !movie.original_title) throw new Error("Movie not found");

            // --- Polyfill for downstream functions expecting local DB formatting ---
            movie.ID = movie.id;
            movie.Genre = movie.genres?.map(g => g.name).join(', ') || '';
            movie['Movie Name'] = movie.title || movie.original_title || '';

            // 1. Set Background and Poster
            const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '/img/LOGO_Short.png';
            if(document.getElementById('posterImg')) document.getElementById('posterImg').src = posterUrl;
            if(document.getElementById('bgBackdrop')) document.getElementById('bgBackdrop').style.backgroundImage = `url('${tmdbImgUrl(movie.poster_path, 'w500', 'w300')}')`; // heavily blurred anyway (30px), low-res is invisible here
            
            // 2. Safely extract variables from TMDB
            const revenue = movie.revenue || 0;
            const budget = movie.budget || 0;
            movieYear = movie.release_date ? parseInt(movie.release_date.split('-')[0]) : null;

            const dirObj = movie.credits?.crew?.find(c => c.job === 'Director');
            if (dirObj) directors = [dirObj.name];

            const movieCast = movie.credits?.cast || [];
            stars = movieCast.slice(0, 5).map(c => c.name);

            // 3. WRITE TO THE HTML UI
            setText('title', movie['Movie Name']);
            // Retry now that the real title is in -- the initial DOMContentLoaded call
            // (see bottom of file) ran before this and had nothing but "Loading..." to
            // send, so the kinogo RU comment lookup never got a usable title until now.
            if (typeof window.loadComments === 'function') window.loadComments();
            setText('rating', movie.vote_average ? movie.vote_average.toFixed(1) : "--");
            setText('runtime', movie.runtime ? `${movie.runtime} min` : 'N/A');
            window.__setMoviePlotText(movie.overview || 'No description available.');
            setText('genre', movie.Genre || 'N/A');
            setText('votes', movie.vote_count || '0');
            setText('year', movieYear || '----');
            setText('imdbId', movie.external_ids?.imdb_id || movie.imdb_id || 'N/A');
            setText('directors', directors.length > 0 ? directors[0] : 'N/A');
            setText('actors', stars.length > 0 ? stars.join(', ') : 'N/A');

            const movieBadgeSlot = document.getElementById('episodeCountBadgesSlot');
            if (movieBadgeSlot && window.buildEpisodeCountBadgesPlaceholder) {
                movieBadgeSlot.innerHTML = window.buildEpisodeCountBadgesPlaceholder({ type: 'movie', inline: true });
                window.mountEpisodeCountBadges?.(movieBadgeSlot);
            }

            // 4. Financials
            const revEl = document.getElementById('revenue');
            if (revEl) revEl.innerText = formatMoney(revenue);
            const budgetEl = document.getElementById('budget');
            if (budgetEl) budgetEl.innerText = formatMoney(budget);
            
            var statusEl_movie = document.getElementById('financialStatus');
            if (statusEl_movie) {
                if (budget > 0 && revenue > 0) {
                    const perc = (((revenue - budget) / budget) * 100).toFixed(0);
                    statusEl_movie.innerHTML = revenue > budget ? `<span style="color:#46d369;">+${perc}% (Hit)</span>` : `<span style="color:#ff4444;">${perc}% (Flop)</span>`;
                } else {
                    statusEl_movie.innerText = 'Insufficient Data';
                }
            }

            // Anime movies can also have MAL metadata; keep TMDB as fallback.
            await applyAnimeMalDetailsIfAvailable(movie, movieId);

            // 5. Actor Visual Blocks
            const actorList = document.getElementById('actorList');
            if (actorList && movieCast.length > 0) {
                actorList.innerHTML = '';
                movieCast.slice(0, 5).forEach(actor => {
                    const li = document.createElement('li');
                    li.className = 'actor-block';
                    li.dataset.actorId = actor.id;
                    li.dataset.actorName = actor.name;
                    const bgStyle = actor.profile_path 
                        ? `background-image: url('${tmdbImgUrl(actor.profile_path, 'w185', 'w92')}'); background-size: cover; background-position: center;`
                        : `background-color: #333;`;
                    li.innerHTML = `<div class="actor-block-pic" style="${bgStyle}"></div><span class="actor-block-name">${escapeHtml(actor.name)}</span>`;
                    li.addEventListener('click', function() {
                        const castPickerSection = document.getElementById('castPicker');
                        if (castPickerSection) castPickerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        const actorSelect = document.getElementById('actorSelect');
                        if (actorSelect) {
                            actorSelect.value = actor.id;
                            actorSelect.dispatchEvent(new Event('change'));
                        }
                    });
                    actorList.appendChild(li);
                });
            }
            
            // Populate actorSelect dropdown with ALL cast members
            const actorSelect = document.getElementById('actorSelect');
            if (actorSelect && movieCast.length) {
                actorSelect.innerHTML = movieCast.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            }
            
            setupTrailerButton(movie['Movie Name'], movieYear);

            // Track this movie page visit in activity.db
            if (window.recommendationsSystem?.trackMovieClick) {
                window.recommendationsSystem.trackMovieClick(
                    String(movieId),
                    movie.Genre || '',
                    String(movieYear || ''),
                    movie.vote_average ? String(movie.vote_average.toFixed(1)) : '',
                    movie['Movie Name'] || '',
                    'movie'
                );
            }
            
            // Recommendations, etc.
            const source = window.getMovieSource ? window.getMovieSource() : 'api';
            initRecommendations(movie, movieYear, directors[0], stars);
            
            // Only run the following for movies, not for series
            const prefsKey = 'userPreferences';
            const prefs = JSON.parse(localStorage.getItem(prefsKey) || '{}');
            const genreClicks = prefs.genreClicks || {};
            if (movie.Genre) {
                movie.Genre.split(',').map(g => g.trim()).forEach(g => {
                    if (!g) return;
                    genreClicks[g] = (genreClicks[g] || 0) + 1;
                });
            }
            prefs.genreClicks = genreClicks;
            localStorage.setItem(prefsKey, JSON.stringify(prefs));
        }


        // Forum CTA visibility (only if forum data exists for this movie/series)
        try {
            const forumCta = document.getElementById('forumCtaBar');
            if (forumCta) {
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const baseUrl = isLocal ? '' : window.location.origin;
                const response = await fetch(`${baseUrl}/forum/movies`);
                const forumMovies = await response.json();
                const movieTitle = (movie['Movie Name'] || movie.title || movie.name || '').trim();
                const normalize = (value) => String(value || '')
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                const movieNorm = normalize(movieTitle);
                const found = (forumMovies || []).find(m => {
                    const forumTitle = normalize(m.movieTitle);
                    return String(m.movieId) === String(movieId)
                        || (movieNorm && forumTitle && (forumTitle === movieNorm || forumTitle.includes(movieNorm) || movieNorm.includes(forumTitle)));
                });
                forumCta.style.display = found ? 'flex' : 'none';
            }
        } catch (err) {
            const forumCta = document.getElementById('forumCtaBar');
            if (forumCta) forumCta.style.display = 'none';
        }

    } catch (err) {
        console.error("Initialization Error:", err);
        // Hide loading overlay on error
        // (Overlay hiding handled by animation block only)
    }
});

// 4. RECOMMENDATIONS LOGIC
// --- TV Recommendations ---
async function initTVRecommendations(tvId) {
    const recommendationsGrid = document.getElementById('recommendationsGrid');
    if (!recommendationsGrid) return;
    recommendationsGrid.innerHTML = '<p style="color:#888;">Loading recommendations...</p>';
    try {
        const recUrl = `/api/tmdb-proxy/tv/${tvId}/recommendations`;
        const recRes = await fetch(recUrl);
        const recData = await recRes.json();
        if (recData.results && recData.results.length > 0) {
            recommendationsGrid.innerHTML = '';
            recData.results.forEach(item => {
                const displayName = item.title || item.name || "Unknown";
                const displayDate = item.release_date || item.first_air_date || "";
                const year = displayDate ? displayDate.split('-')[0] : "N/A";
                const poster = tmdbImgUrl(item.poster_path, 'w342', 'w154');
                const card = document.createElement('div');
                card.className = 'carousel-card';
                card.innerHTML = `
                    <div class="card-img-container">
                        <img src="${poster}" alt="${displayName}">
                    </div>
                    <div class="card-details">
                        <h4>${displayName}</h4>
                        <div class="card-meta">
                            <span>${year}</span>
                            <span class="type-badge">Series</span>
                        </div>
                    </div>
                `;
                card.onclick = () => {
                    window.location.href = `movieInfo.html?id=${item.id}&type=tv`;
                };
                recommendationsGrid.appendChild(card);
            });
        } else {
            recommendationsGrid.innerHTML = '<p class="no-data">No recommendations found.</p>';
        }
    } catch (err) {
        recommendationsGrid.innerHTML = '<p class="no-data">Error loading recommendations.</p>';
        console.error("Carousel Error:", err);
    }
}
async function initRecommendations(movie, movieYear, firstDirector, starsList) {
    const source = window.getMovieSource ? window.getMovieSource() : 'local';
    const isApi = source === 'api';
    // Determine type (movie or tv) from URL or movie object
    let type = (new URLSearchParams(window.location.search)).get('type') || '';
    if (!type) {
        // fallback: try to guess from movie object
        if (movie && movie.first_air_date) type = 'tv';
        else type = 'movie';
    }
    type = type.toLowerCase();
    console.log('[Reco] initRecommendations', {
        source,
        isApi,
        movieId: movie.ID,
        movieYear,
        firstDirector,
        starsList,
        type
    });

    // Map TMDB result for both movie and tv
    const mapTmdbResult = (m) => {
        const title = m.title || m.name || 'Unknown';
        const dateStr = m.release_date || m.first_air_date || '';
        const year = dateStr.split('-')[0] || '';
        return {
            ID: m.id,
            poster_full_url: m.poster_path ? tmdbImgUrl(m.poster_path, 'w500', 'w300') : '/img/LOGO_Short.png',
            'Movie Name': title,
            Rating: m.vote_average || 'N/A',
            Votes: m.vote_count || 0,
            Year: year
        };
    };

    // Dynamic endpoint for recommendations
    const tmdbFetch = async (path, params = {}) => {
        const url = window.tmdbBuildUrl ? window.tmdbBuildUrl(path, params) : null;
        if (!url) {
            console.warn('[TMDB] No URL for', path, params);
            return null;
        }
        console.log('[TMDB] Fetch', path, params);
        const res = await fetch(url);
        console.log('[TMDB] Response', path, res.status);
        if (!res.ok) return null;
        return res.json();
    };

    // Dynamic credits endpoint
    const getCredits = async (movieId) => {
        if (type === 'tv') {
            return await tmdbFetch(`/tv/${movieId}/credits`, { language: 'en-US' });
        } else {
            return await tmdbFetch(`/movie/${movieId}/credits`, { language: 'en-US' });
        }
    };

    // Render row for both movie and tv
    const renderRow = (data, containerId, label) => {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn('[Reco] No container for', containerId);
            return;
        }

        // --- FIX: Filter out missing IDs AND deduplicate the results ---
        const uniqueData = [];
        const seenIds = new Set();
        
        data.forEach(m => {
            // Check if ID is valid and NOT already in our Set
            if (m && m.ID && m.ID !== 'undefined' && m.ID !== null && m.ID !== '') {
                if (!seenIds.has(m.ID)) {
                    seenIds.add(m.ID);
                    uniqueData.push(m);
                }
            }
        });

        if (uniqueData.length === 0) {
            container.innerHTML = `<p style="color:#666; padding:20px;">No similar titles found.</p>`;
            if (containerId === 'genreRow') {
                const clone = document.getElementById('genreRowClone');
                if (clone) clone.innerHTML = container.innerHTML;
            }
            return;
        }

        // Build the cards using the cleaned, unique array
        container.innerHTML = uniqueData.map(m => {
            const safeId = m.ID || '';
            const year = m.Year ? `<span style='font-size:11px;color:#aaa;'>${m.Year}</span>` : '';
            return `<div class="mini-card" onclick="window.location.href='movieInfo.html?id=${encodeURIComponent(safeId)}&type=${type}'">
                <img src="${m.poster_full_url}" onerror="this.src='/img/LOGO_Short.png'">
                <div class="mini-info">
                    <h4>${m['Movie Name']}</h4>
                    <p>⭐ ${m.Rating || m.imdb_rating} (${m.Votes || 0}) ${year}</p>
                    <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">${label}</p>
                </div>
            </div>`;
        }).join('');

        if (containerId === 'genreRow') {
            // #genreRowClone is what's actually shown at narrower widths (see
            // toggleVerticalRecommendRow() further down the page) -- that
            // function only copies genreRow's CURRENT innerHTML into the clone
            // on page load and on resize. Without this, a narrow-screen load
            // captures the "Loading..." placeholder (this fetch hasn't
            // resolved yet at DOMContentLoaded time) and the clone never
            // updates again until something happens to fire a resize event.
            const clone = document.getElementById('genreRowClone');
            if (clone) clone.innerHTML = container.innerHTML;
            buildPlaylist(document.getElementById('title').innerText);
        }
    };

    const isAnimeModeEnabled = () => window.__animeMode === true || localStorage.getItem('animeMode') === 'true';

    let apiCredits = null;
    if (isApi) {
        const tmdbMovieId = movie.ID;
        if (tmdbMovieId) {
            apiCredits = await getCredits(tmdbMovieId);
            console.log('[TMDB] Credits', apiCredits);
            // Cache-first recommendations (falls back to /similar server-side for titles that
            // don't have recommendations yet) via movieCache.db.
            const recData = await fetch(`/api/movie-recommendations?tmdbId=${tmdbMovieId}&type=${type}`).then(r => r.json()).catch(() => null);
            console.log('[TMDB] Recommendations raw', recData);
            const recLabel = recData?.source === 'similar' ? 'Similar Titles' : 'Recommended';
            const recs = (recData?.results || []).map(mapTmdbResult);
            console.log('[TMDB] Recommendations count', recs.length);
            renderRow(recs, 'genreRow', recLabel);
        }
    } else {
        fetch(`/recommend/genre?genre=${encodeURIComponent(movie.Genre)}&exclude=${movie.ID}`)
            .then(r => r.json()).then(d => renderRow(d, 'genreRow', 'Similar Genre'));
    }

    if (firstDirector) {
        const dirTitle = document.getElementById('directorTitle');
        if (dirTitle) dirTitle.innerText = `More from ${firstDirector}`;
        if (isApi) {
            let directorId = null;
            if (type === 'tv') {
                directorId = apiCredits?.crew?.find(c => c.job === 'Director' || c.job === 'Series Director')?.id || null;
            } else {
                directorId = apiCredits?.crew?.find(c => c.job === 'Director')?.id || null;
            }
            console.log('[TMDB] Director ID', directorId, 'for', firstDirector, 'type', type);
            if (directorId) {
                // For TV, use /discover/tv, for movie use /discover/movie
                const discoverPath = type === 'tv' ? '/discover/tv' : '/discover/movie';
                const data = await tmdbFetch(discoverPath, {
                    with_crew: directorId,
                    sort_by: 'vote_average.desc',
                    'vote_count.gte': 100,
                    'primary_release_date.lte': new Date().toISOString().slice(0, 10),
                    page: 1
                });
                renderRow((data?.results || []).map(mapTmdbResult), 'directorRow', `Director: ${firstDirector}`);
            }
        } else {
            fetch(`/recommend/director?val=${encodeURIComponent(firstDirector)}&exclude=${movie.ID}`)
                .then(r => r.json()).then(d => renderRow(d, 'directorRow', `Director: ${firstDirector}`));
        }
    }

    const actorSelect = document.getElementById('actorSelect');
    
    // 1. Force fetch ALL cast members directly from TMDB for the dropdown
    let dropDownCast = starsList && starsList.length > 0 ? starsList : []; 
    const pageId = (new URLSearchParams(window.location.search)).get('id');

    if (pageId) {
        try {
            // Bypass the local DB and fetch full credits straight from TMDB
            const creditRes = await fetch(`/api/tmdb-proxy/${type === 'tv' ? 'tv' : 'movie'}/${pageId}/credits`);
            if (creditRes.ok) {
                const creditData = await creditRes.json();
                if (creditData && creditData.cast && creditData.cast.length > 0) {
                    // Extract ALL actors and filter out any empty names
                    dropDownCast = creditData.cast.map(c => c.name).filter(Boolean);
                }
            }
        } catch(e) {
            console.error('[Reco] Failed to fetch full cast for dropdown', e);
        }
    }

    if (actorSelect && dropDownCast.length > 0) {
        // 2. Populate the dropdown with ALL 50+ cast members
        actorSelect.innerHTML = dropDownCast.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        
        const fetchActorRow = async (name) => {
            const actTitle = document.getElementById('actorTitle');
            if (actTitle) actTitle.innerText = `More from ${name}`;
            
            if (isApi) {
                let actorId = null;
                if (apiCredits && apiCredits.cast) {
                    actorId = apiCredits.cast.find(c => c.name === name)?.id || null;
                } else {
                    try {
                        const res = await fetch(`/api/tmdb-proxy/${type === 'tv' ? 'tv' : 'movie'}/${pageId}/credits`);
                        const data = await res.json();
                        actorId = data.cast.find(c => c.name === name)?.id || null;
                    } catch(e){}
                }
                
                if (actorId) {
                    const discoverPath = type === 'tv' ? '/discover/tv' : '/discover/movie';
                    const data = await tmdbFetch(discoverPath, {
                        with_cast: actorId,
                        sort_by: 'vote_average.desc',
                        'vote_count.gte': 1,
                        'primary_release_date.lte': new Date().toISOString().slice(0, 10),
                        page: 1
                    });
                    renderRow((data?.results || []).map(mapTmdbResult), 'actorRow', `Starring ${name}`);
                }            } else {
                fetch(`/recommend/actors?val=${encodeURIComponent(name)}&exclude=${movie.ID}`)
                    .then(r => r.json()).then(d => renderRow(d, 'actorRow', `Starring ${name}`));
            }
        };
        
        actorSelect.onchange = (e) => fetchActorRow(e.target.value);
        // Trigger the initial load with the first actor
        fetchActorRow(dropDownCast[0]);
    }

    if (movieYear) {
        if (isApi) {
            // For TV, use /discover/tv, for movie use /discover/movie
            const discoverPath = type === 'tv' ? '/discover/tv' : '/discover/movie';
            const dateFieldGte = type === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte';
            const dateFieldLte = type === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte';
            const data = await tmdbFetch(discoverPath, {
                [dateFieldGte]: `${movieYear - 5}-01-01`,
                [dateFieldLte]: `${movieYear + 5}-12-31`,
                sort_by: 'vote_average.desc',
                'vote_count.gte': 100,
                page: 1
            });
            const eraTitle = document.getElementById('eraTitle');
            if (eraTitle) eraTitle.innerHTML = `${type === 'tv' ? 'Series' : 'Movies'} from ${movieYear - 5} - ${movieYear + 5}`;
            renderRow((data?.results || []).map(mapTmdbResult), 'timelineRow', 'Same Era');
        } else {
            fetch(`/recommend/timeline?year=${movieYear}&exclude=${encodeURIComponent(movie.ID)}`)
                .then(r => r.json()).then(d => {
                    const eraTitle = document.getElementById('eraTitle');
                    if(eraTitle) eraTitle.innerHTML = `Movies from ${movieYear - 5} - ${movieYear + 5}`;
                    renderRow(d, 'timelineRow', 'Same Era');
                });
        }
    }
}

// 5. TRAILER & PLAYLIST NAVIGATION
async function setupTrailerButton(movieName, movieYear) {
    // Only target the trailer button, not all .btn-watch
    const watchBtn = document.getElementById('watchVidsrcBtn');
    const modal = document.getElementById('trailerModal');
    const player = document.getElementById('trailerPlayer');
    
    if (!watchBtn || !modal || !player) return;

    watchBtn.innerText = "Searching...";
    watchBtn.classList.remove('btn-unavailable'); 
    watchBtn.style.color = "";
    watchBtn.style.backgroundColor = "";

    try {
        const vId = await window.fetchYTId(`${movieName} ${movieYear}`);
        console.log("THE RAW ID IS:", vId, "TYPE:", typeof vId);

        if (!vId || (typeof vId === 'string' && vId.trim().length === 0)) {
            console.warn("⚠️ TRAILER NOT FOUND - Triggering Fallback");
            watchBtn.disabled = false;
            watchBtn.style.pointerEvents = "auto";
            watchBtn.style.cursor = "pointer";
            watchBtn.classList.remove('btn-unavailable');
            watchBtn.innerText = "Search on YouTube ↗";
            watchBtn.style.backgroundColor = "";
            watchBtn.onclick = (e) => {
                e.preventDefault();
                console.log("🔥 CLICK DETECTED - Opening YouTube...");
                const query = encodeURIComponent(`${movieName} ${movieYear} trailer`);
                window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
            };
            return;
        }

        // --- PRIORITY 3: ALL CLEAR (SUCCESS) ---
        watchBtn.innerText = "▶ Watch Trailer";
        watchBtn.classList.remove('btn-unavailable');
        watchBtn.style.backgroundColor = "";
        watchBtn.style.color = "";
        watchBtn.onclick = () => {
            const currentViews = parseInt(localStorage.getItem('viewCount')) || 0;
            localStorage.setItem('viewCount', currentViews + 1);
            if (window.persistUserStats) window.persistUserStats();
            player.src = `https://www.youtube.com/embed/${vId}?autoplay=1&enablejsapi=1`;
            modal.classList.add('show');
            document.body.classList.add('blur-active');
            if (typeof activeTrailerIdx !== 'undefined') activeTrailerIdx = 0;
            if (window.setupNavigation) window.setupNavigation();
        };
    } catch (err) {
        console.error("Trailer Logic Error:", err);
        watchBtn.innerText = "Search on YouTube ↗";
        watchBtn.classList.remove('btn-unavailable');
        watchBtn.style.backgroundColor = "";
        watchBtn.style.color = "";
        watchBtn.onclick = () => {
            console.log("Manual Fallback Triggered (Reason: API Error)");
            const query = encodeURIComponent(`${movieName} trailer`);
            window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
        };
    }
}
// sets up there playlist based on genre row
function buildPlaylist(currentName) {
    const cards = Array.from(document.querySelectorAll('#genreRow .mini-card'));
    currentPlaylist = [{ name: currentName, id: null }];
    cards.forEach(card => {
        const titleElement = card.querySelector('h4');
        if(titleElement) currentPlaylist.push({ name: titleElement.innerText, id: null });
    });
}
// buttons for switching videos in the modal
function setupNavigation() {
    const nextBtn = document.getElementById('nextTrailer');
    const prevBtn = document.getElementById('prevTrailer');
    const player = document.getElementById('trailerPlayer');

    const changeVideo = async (offset) => {
        let newIdx = activeTrailerIdx + offset;
        if (newIdx < 0 || newIdx >= currentPlaylist.length) return;
        activeTrailerIdx = newIdx;
        const movie = currentPlaylist[activeTrailerIdx];
        
        if (!movie.id) {
            const btn = document.querySelector('.btn-watch');
            if (btn) btn.innerText = "Loading Next...";
            movie.id = await window.fetchYTId(movie.name);
            if (btn) btn.innerText = "▶ Watch Trailer";
        }
        
        if (movie.id) player.src = `https://www.youtube.com/embed/${movie.id}?autoplay=1&enablejsapi=1`;
    };

    if (nextBtn) nextBtn.onclick = () => changeVideo(1);
    if (prevBtn) prevBtn.onclick = () => changeVideo(-1);

    window.onmessage = (e) => {
        if (e.origin === "https://www.youtube.com") {
            try {
                const data = JSON.parse(e.data);
                if (data.event === "onStateChange" && data.info === 0) changeVideo(1);
            } catch (err) {}
        }
    };
}

// 6. MODAL CLOSING LOGIC
document.addEventListener('click', (e) => {
    const modal = document.getElementById('trailerModal');
    const player = document.getElementById('trailerPlayer');
    if (!modal || !player) return;
    if (e.target.classList.contains('close-modal') || e.target === modal) {
        modal.classList.remove('show');
        document.body.classList.remove('blur-active');
        player.src = ""; 
    }
});


// Threaded per-movie comments (replaces the old JSON-file star-rating reviews).
// One level of nesting: top-level comments, with replies lazy-loaded on click.

function getCommentsMovieId() {
    return (new URLSearchParams(window.location.search)).get('id') || '';
}

// Lightweight markdown: **bold**, *italic*, ~~strike~~, "> quoted line", ||spoiler||.
// Escaped first, then markup is applied on the already-safe string, so none of these can be
// used to smuggle raw HTML.
function renderCommentText(text) {
    let safe = escapeHtml(text);
    safe = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="comment-image" style="max-width: 100%; max-height: 300px; border-radius: 6px; margin: 8px 0;" />');
    safe = safe.replace(/^&gt; ?(.*)$/gm, '<blockquote class="comment-quote">$1</blockquote>');
    safe = safe.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, '<em>$1</em>');
    safe = safe.replace(/~~([^\n]+?)~~/g, '<s>$1</s>');
    safe = safe.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="comment-spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');
    return safe;
}

// Wraps the current textarea selection in `marker` on both sides (or inserts marker||marker
// with the cursor in between if nothing is selected), matching how the formatting toolbar
// buttons work in the reference UI.
window.wrapCommentSelection = function (textareaId, marker) {
    const el = document.getElementById(textareaId);
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    const selected = value.slice(start, end);
    el.value = value.slice(0, start) + marker + selected + marker + value.slice(end);
    el.focus();
    el.setSelectionRange(start + marker.length, start + marker.length + selected.length);
};

window.quoteCommentSelection = function (textareaId) {
    const el = document.getElementById(textareaId);
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    const selected = value.slice(start, end) || 'Quote';
    const quoted = selected.split('\n').map(line => `> ${line}`).join('\n');
    el.value = value.slice(0, start) + quoted + value.slice(end);
    el.focus();
    el.setSelectionRange(start, start + quoted.length);
};

const COMMENT_EMOJI_LIST = [
    '😀', '😂', '🤣', '😊', '😍', '🤩', '😎', '🤔', '😭', '😡',
    '👍', '👎', '👏', '🙏', '🔥', '💯', '❤️', '💀', '🤡', '😴',
    '😱', '🥲', '😅', '🙄', '😏', '🤯', '🥳', '😤', '👀', '💩',
    '🎉', '✨', '⭐', '💔', '😢', '🤝', '👌', '🫡', '😬', '🤨'
];

let commentEmojiPickerEl = null;

window.toggleCommentEmojiPicker = function (targetTextareaId, anchorBtn) {
    if (commentEmojiPickerEl) {
        const wasForSameBtn = commentEmojiPickerEl.dataset.anchor === targetTextareaId;
        commentEmojiPickerEl.remove();
        commentEmojiPickerEl = null;
        if (wasForSameBtn) return;
    }

    const picker = document.createElement('div');
    picker.className = 'comment-emoji-picker';
    picker.dataset.anchor = targetTextareaId;
    picker.innerHTML = COMMENT_EMOJI_LIST.map(e =>
        `<button type="button" class="comment-emoji-option" onclick="insertCommentEmoji('${targetTextareaId}', '${e}')">${e}</button>`
    ).join('');

    anchorBtn.closest('.comment-emoji-wrap').appendChild(picker);
    commentEmojiPickerEl = picker;

    setTimeout(() => {
        document.addEventListener('pointerdown', closeCommentEmojiPickerOnOutsideClick, { capture: true });
    }, 0);
};

function closeCommentEmojiPickerOnOutsideClick(e) {
    if (commentEmojiPickerEl && !commentEmojiPickerEl.contains(e.target) && !e.target.closest('.comment-emoji-wrap')) {
        commentEmojiPickerEl.remove();
        commentEmojiPickerEl = null;
        document.removeEventListener('pointerdown', closeCommentEmojiPickerOnOutsideClick, { capture: true });
    }
}

window.insertCommentEmoji = function (textareaId, emoji) {
    const el = document.getElementById(textareaId);
    if (el) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const value = el.value;
        el.value = value.slice(0, start) + emoji + value.slice(end);
        el.focus();
        el.setSelectionRange(start + emoji.length, start + emoji.length);
    }
    if (commentEmojiPickerEl) {
        commentEmojiPickerEl.remove();
        commentEmojiPickerEl = null;
    }
};

const KIPLY_API_KEY = 'tqWRM3nomvLhbMbDVedLJR4GT8uNtmP7Cb5UIQZKwyILU7nwKyS166SKRXgNOqga';
let commentGifPickerEl = null;
let gifPickerSearchTimer = null;

window.toggleCommentGifPicker = async function (textareaId, anchorBtn) {
    console.log('[toggleCommentGifPicker] called', {textareaId, anchorBtn});
    try {
        if (commentGifPickerEl) {
            const wasForSameBtn = commentGifPickerEl.dataset.anchor === textareaId;
            commentGifPickerEl.remove();
            commentGifPickerEl = null;
            if (wasForSameBtn) return;
        }

        const picker = document.createElement('div');
        picker.className = 'comment-gif-picker';
        picker.dataset.anchor = textareaId;
        picker.innerHTML = `
            <div class="gif-picker-content">
                <input type="text" class="gif-search-input" placeholder="Search GIFs..." />
                <div class="gif-grid" id="gifGrid"></div>
            </div>
        `;

        const wrap = anchorBtn.closest('.comment-gif-wrap');
        console.log('[toggleCommentGifPicker] wrap:', wrap);
        if (!wrap) {
            console.error('[toggleCommentGifPicker] Could not find .comment-gif-wrap');
            return;
        }
        wrap.appendChild(picker);
        commentGifPickerEl = picker;

        const searchInput = picker.querySelector('.gif-search-input');
        const gifGrid = picker.querySelector('#gifGrid');

        let currentQuery = '';
        let currentOffset = 0;
        let isLoading = false;
        let hasMore = true;

        const attachGifClickHandlers = () => {
            gifGrid.querySelectorAll('.gif-option:not([data-listener-attached])').forEach(btn => {
                btn.dataset.listenerAttached = 'true';
                btn.addEventListener('click', () => {
                    const gifUrl = btn.dataset.gifUrl;
                    console.log('[gifGrid click] Inserting GIF:', gifUrl);
                    window.insertCommentGif(textareaId, gifUrl);
                });
            });
        };

        const loadGifs = async (query = '', append = false) => {
            if (isLoading || !hasMore) return;
            isLoading = true;

            console.log('[loadGifs] Loading with query:', query, 'offset:', currentOffset, 'append:', append);
            try {
                if (!append) {
                    gifGrid.innerHTML = '<p style="padding: 10px; text-align: center; color: #999;">Loading GIFs...</p>';
                }

                const endpoint = query
                    ? `https://api.klipy.com/v2/search?q=${encodeURIComponent(query)}&limit=50&offset=${currentOffset}&key=${KIPLY_API_KEY}`
                    : `https://api.klipy.com/v2/featured?limit=50&offset=${currentOffset}&key=${KIPLY_API_KEY}`;

                console.log('[loadGifs] Fetching from:', endpoint);
                const res = await fetch(endpoint);
                console.log('[loadGifs] Response status:', res.status);
                if (!res.ok) {
                    if (!append) gifGrid.innerHTML = '<p style="padding: 10px; text-align: center; color: #999;">Failed to load GIFs (status ' + res.status + ')</p>';
                    isLoading = false;
                    return;
                }

                const data = await res.json();
                console.log('[loadGifs] Response data:', data);
                const gifs = data.results || data.gifs || [];

                if (!gifs.length) {
                    if (!append) gifGrid.innerHTML = '<p style="padding: 10px; text-align: center; color: #999;">No GIFs found</p>';
                    hasMore = false;
                    isLoading = false;
                    return;
                }

                const gifsHtml = gifs.map((gif, idx) => {
                    const url = gif.media?.[0]?.gif || gif.gif || gif.url || gif.media_url || '';
                    const thumbUrl = gif.media?.[0]?.preview || gif.preview || gif.preview_url || url || '';
                    const safeUrl = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
                    return `<button type="button" class="gif-option" data-gif-url="${safeUrl}" title="Insert GIF" style="cursor: pointer;"><img src="${thumbUrl}" alt="GIF" style="width: 100%; height: 100%; object-fit: cover;" /></button>`;
                }).join('');

                if (append) {
                    gifGrid.innerHTML += gifsHtml;
                } else {
                    gifGrid.innerHTML = gifsHtml;
                }

                currentOffset += gifs.length;
                if (gifs.length < 50) hasMore = false;

                attachGifClickHandlers();
            } catch (err) {
                console.error('[loadGifs] Error:', err);
                if (!append) gifGrid.innerHTML = '<p style="padding: 10px; text-align: center; color: #999;">Error loading GIFs: ' + err.message + '</p>';
            } finally {
                isLoading = false;
            }
        };

        // Scroll listener for infinite loading
        gifGrid.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = gifGrid;
            if (scrollHeight - scrollTop - clientHeight < 100 && hasMore && !isLoading) {
                loadGifs(currentQuery, true);
            }
        });

        searchInput.addEventListener('input', (e) => {
            clearTimeout(gifPickerSearchTimer);
            gifPickerSearchTimer = setTimeout(() => {
                currentQuery = e.target.value;
                currentOffset = 0;
                hasMore = true;
                loadGifs(currentQuery);
            }, 300);
        });

        await loadGifs();

        setTimeout(() => {
            document.addEventListener('pointerdown', closeCommentGifPickerOnOutsideClick, { capture: true });
        }, 0);
    } catch (err) {
        console.error('[toggleCommentGifPicker] Outer error:', err);
    }
};

function closeCommentGifPickerOnOutsideClick(e) {
    if (commentGifPickerEl && !commentGifPickerEl.contains(e.target) && !e.target.closest('.comment-gif-wrap')) {
        commentGifPickerEl.remove();
        commentGifPickerEl = null;
        document.removeEventListener('pointerdown', closeCommentGifPickerOnOutsideClick, { capture: true });
    }
}

window.insertCommentGif = function (textareaId, gifUrl) {
    const el = document.getElementById(textareaId);
    if (el && gifUrl) {
        const gifCount = (el.value.match(/!\[GIF\]/g) || []).length;
        const isReply = textareaId.startsWith('replyInput-');
        const maxGifs = isReply ? 1 : 2;
        if (gifCount >= maxGifs) {
            const msg = isReply ? 'You can only add 1 GIF per reply' : 'You can only add up to 2 GIFs per comment';
            showLimitToast(msg);
            return;
        }
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const value = el.value;
        const gifMarkdown = `\n![GIF](${gifUrl})`;
        el.value = value.slice(0, start) + gifMarkdown + value.slice(end);
        el.focus();
        el.setSelectionRange(start + gifMarkdown.length, start + gifMarkdown.length);
    }
    if (commentGifPickerEl) {
        commentGifPickerEl.remove();
        commentGifPickerEl = null;
    }
};

function commentAuthHeaders(json) {
    const token = localStorage.getItem('authToken');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
}

function commentAvatarHTML(profilePic, username) {
    if (profilePic) {
        // Pentest (2026-08-17/18, round 5) found this was the one interpolation site in the
        // whole comment-rendering path that skipped escapeHtml() - every other field (comment
        // text, usernames) already goes through it. profilePic is server-stored user input
        // (POST /users/profile-picture), so a crafted value breaking out of the quoted url('')
        // was a real stored-XSS sink here even though the server-side check is also being
        // hardened separately.
        return `<div class="comment-avatar" style="background-image:url('${escapeHtml(profilePic)}')"></div>`;
    }
    const letter = (username || '?').trim().charAt(0).toUpperCase();
    return `<div class="comment-avatar comment-avatar-fallback">${escapeHtml(letter)}</div>`;
}

function renderOneComment(c, isReply) {
    const myUID = localStorage.getItem('userUID');
    const isOwner = myUID && String(c.user_uid) === String(myUID);
    const timeAgo = typeof notifTimeAgo === 'function' ? notifTimeAgo(c.created_at) : new Date(c.created_at * 1000).toLocaleDateString();
    const score = (c.upvotes || 0) - (c.downvotes || 0);

    return `
        <div class="comment-row${isReply ? ' comment-reply' : ''}" id="comment-${c.id}" data-comment-id="${c.id}">
            ${commentAvatarHTML(c.profile_pic, c.username)}
            <div class="comment-body-wrap">
                <div class="comment-meta-line">
                    <span class="comment-username">${escapeHtml(c.username)}</span>
                    <span class="comment-time">${timeAgo}</span>
                </div>
                <div class="comment-text">${renderCommentText(c.text)}</div>
                <div class="comment-actions">
                    <button class="comment-vote-btn" onclick="voteOnComment(${c.id}, 'up')" title="Upvote">▲</button>
                    <span class="comment-score">${score}</span>
                    <button class="comment-vote-btn" onclick="voteOnComment(${c.id}, 'down')" title="Downvote">▼</button>
                    ${!isReply ? `<button class="comment-reply-btn" onclick="toggleReplyComposer(${c.id})">Reply</button>` : ''}
                    ${isOwner ? `<button class="comment-delete-btn-text" onclick="deleteComment(${c.id})">Delete</button>` : ''}
                </div>
                ${!isReply ? `
                    <div class="comment-reply-composer" id="replyComposer-${c.id}" style="display:none;">
                        <div class="comment-fmt-bar" style="gap: 4px; margin-bottom: 6px;">
                            <div class="comment-emoji-wrap">
                                <button type="button" class="comment-fmt-btn" onclick="toggleCommentEmojiPicker('replyInput-${c.id}', this)" title="Emoji">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" /></svg>
                                </button>
                            </div>
                            <div class="comment-gif-wrap">
                                <button type="button" class="comment-fmt-btn" onclick="toggleCommentGifPicker('replyInput-${c.id}', this)" title="GIF">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M12.75 8.25v7.5m6-7.5h-3V12m0 0v3.75m0-3.75H18M9.75 9.348c-1.03-1.464-2.698-1.464-3.728 0-1.03 1.465-1.03 3.84 0 5.304 1.03 1.464 2.699 1.464 3.728 0V12h-1.5M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <textarea id="replyInput-${c.id}" placeholder="Write a reply..." rows="2"></textarea>
                        <button class="btn-small" onclick="postReplyComment(${c.id})">Reply</button>
                    </div>
                    ${c.reply_count > 0 ? `
                        <button class="comment-show-replies-btn" id="showReplies-${c.id}" onclick="toggleReplies(${c.id})">
                            <i></i><span>${c.reply_count} ${c.reply_count === 1 ? 'reply' : 'replies'}</span>
                        </button>
                        <div class="comment-replies-wrap" id="repliesWrap-${c.id}" style="display:none;"></div>
                    ` : ''}
                ` : ''}
            </div>
        </div>
    `;
}

window.loadComments = async function () {
    // Anime pages show imported Anikoto comments instead once malId/episode are known
    // (set by moviePlayer.js after Watch Now is clicked - see anime-episode-changed listener
    // below). Until then, fall through to the normal movie/TV comment system so the section
    // isn't empty while the page loads.
    if (window.__currentAnimeMalId) {
        return loadAnimeComments();
    }

    const container = document.getElementById('commentsList');
    const countEl = document.getElementById('commentsCount');
    if (!container) return;

    const movieId = getCommentsMovieId();
    if (!movieId) { container.innerHTML = ''; return; }

    const sort = document.getElementById('commentsSortSelect')?.value || 'newest';

    try {
        // loadComments() fires on raw DOMContentLoaded (see bottom of this file), well
        // before the real TMDB title is written into #title -- it shows a "Loading..."
        // placeholder until then. Sending that as a search query 100% fails on kinogo, so
        // just omit title entirely rather than waste a doomed request; the title-set code
        // paths below call loadComments() again once the real title is in, which retries
        // properly. (The backend also independently rejects this exact placeholder, but
        // catching it here avoids the request altogether.)
        const rawTitleText = document.getElementById('title')?.textContent.trim() || '';
        const title = /^loading\.*$/i.test(rawTitleText) ? '' : rawTitleText;
        const yearText = document.getElementById('year')?.textContent.trim() || '';
        const yearMatch = yearText.match(/\d{4}/);
        const releaseYear = yearMatch ? yearMatch[0] : '';
        const res = await fetch(`/movie-comments?movieId=${encodeURIComponent(movieId)}&sort=${encodeURIComponent(sort)}&title=${encodeURIComponent(title)}&releaseYear=${encodeURIComponent(releaseYear)}`);
        const comments = await res.json();

        if (countEl) countEl.textContent = `(${comments.length})`;

        if (!Array.isArray(comments) || !comments.length) {
            container.innerHTML = `<p class="setting-hint">No comments yet. Be the first to share your thoughts!</p>`;
            return;
        }

        container.innerHTML = comments.map(c => renderOneComment(c, false)).join('');
    } catch (err) {
        console.error('Failed to load comments:', err);
        container.innerHTML = `<p class="setting-hint">Could not load comments.</p>`;
    }
};

// --- Anime comments: Anikoto imports (source:'anikoto') threaded together with our own
// users' comments (source:'user') in the same anime_comments table/tree. ---

// notifTimeAgo has no upper bound ("65d ago"), which reads badly for older comments once
// sorting actually reflects real post dates. Past a week, switch to a plain d/m/y date -
// kept local here rather than changing notifTimeAgo itself, which the notification bell
// also uses.
function formatAnimeCommentTime(unixSeconds) {
    const days = (Date.now() - unixSeconds * 1000) / 86400000;
    if (days < 7 && typeof notifTimeAgo === 'function') return notifTimeAgo(unixSeconds);
    const d = new Date(unixSeconds * 1000);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
}

function renderAnikotoComment(c, isReply) {
    const myUID = localStorage.getItem('userUID');
    const isOwner = c.source === 'user' && myUID && String(c.user_uid) === String(myUID);
    const score = (c.upvotes || 0) - (c.downvotes || 0);
    // Anikoto's own posted_time_text mixes relative ("16 hours ago") and absolute ("on 7/6/26")
    // formats depending on age, which looked broken sitting side by side. created_at is now
    // parsed from that text at scrape time (see parseAnikotoPostedTime on the backend), so
    // always deriving the label from it here gives one consistent format for every comment.
    const timeLabel = formatAnimeCommentTime(c.created_at);

    return `
        <div class="comment-row${isReply ? ' comment-reply' : ''}" id="comment-anime-${c.id}" data-comment-id="${c.id}">
            ${commentAvatarHTML(c.avatar_url, c.username)}
            <div class="comment-body-wrap">
                <div class="comment-meta-line">
                    <span class="comment-username">${escapeHtml(c.username || 'Anikoto User')}</span>
                    <span class="comment-time">${escapeHtml(timeLabel)}</span>
                </div>
                <div class="comment-text">${renderCommentText(c.text || '')}</div>
                <div class="comment-actions">
                    <button class="comment-vote-btn" onclick="voteOnAnimeComment(${c.id}, 'up')" title="Upvote">▲</button>
                    <span class="comment-score">${score}</span>
                    <button class="comment-vote-btn" onclick="voteOnAnimeComment(${c.id}, 'down')" title="Downvote">▼</button>
                    ${!isReply ? `<button class="comment-reply-btn" onclick="toggleReplyComposer('anime-${c.id}')">Reply</button>` : ''}
                    ${isOwner ? `<button class="comment-delete-btn-text" onclick="deleteAnimeComment(${c.id})">Delete</button>` : ''}
                </div>
                ${!isReply ? `
                    <div class="comment-reply-composer" id="replyComposer-anime-${c.id}" style="display:none;">
                        <textarea id="replyInput-anime-${c.id}" placeholder="Write a reply..." rows="2"></textarea>
                        <button class="btn-small" onclick="postAnimeReplyComment(${c.id})">Reply</button>
                    </div>
                ` : ''}
                ${!isReply && Array.isArray(c.replies) && c.replies.length ? `
                    <div class="comment-replies-wrap">
                        ${c.replies.map(r => renderAnikotoComment(r, true)).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

window.loadAnimeComments = async function (forceReload) {
    const container = document.getElementById('commentsList');
    const countEl = document.getElementById('commentsCount');
    if (!container) return;

    const malId = window.__currentAnimeMalId;
    const episode = window.__currentAnimeEpisode || 1;
    const season = window.__currentAnimeSeason || 1;
    const title = document.getElementById('title')?.textContent.trim() || '';
    const sort = document.getElementById('commentsSortSelect')?.value || 'newest';
    if (!malId) return;

    // Comments already load once malId is known at page load, well before Watch Now. But
    // updateSource() fires anime-episode-changed unconditionally on every server/episode/season
    // change - including when Watch Now resolves the *same* episode we already loaded (no
    // continue-watching history, so it lands on ep1 same as the page-load default). Without
    // this, that redundant call still wiped an already-correct comment list to a loading
    // spinner and re-fetched it, which read as "resets and comes back" even though nothing
    // had actually changed. Only skip on an exact repeat - a genuinely different episode
    // (continue-watching landed elsewhere) or a sort change still reloads normally.
    const key = `${malId}:${season}:${episode}:${sort}`;
    if (!forceReload && window.__lastLoadedAnimeCommentsKey === key) return;

    // Covers the composer + list together (not just the list) so you can't start typing into
    // stale context while a different episode's comments are still loading. Sized off
    // #commentsBody's own box via CSS inset:0, so it scales to whatever that area is at any
    // screen size rather than a fixed pixel overlay.
    const bodyEl = document.getElementById('commentsBody') || container;
    const overlay = document.createElement('div');
    overlay.className = 'comments-loading-overlay';
    overlay.innerHTML = `<span class="comments-loading-ring"></span><span class="comments-loading-text">Loading comments...</span>`;
    bodyEl.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const params = new URLSearchParams({ malId, episode, season, title, sort });

    const render = (data) => {
        const comments = Array.isArray(data?.comments) ? data.comments : [];
        if (countEl) {
            const total = comments.reduce((sum, c) => sum + 1 + (c.replies?.length || 0), 0);
            countEl.textContent = `(${total})`;
        }
        if (!comments.length) {
            container.innerHTML = `<p class="setting-hint">No comments yet. Be the first to share your thoughts!</p>`;
            return;
        }
        container.innerHTML = comments.map(c => renderAnikotoComment(c, false)).join('');
    };

    // The overlay lives in #commentsBody now, a separate element from #commentsList, so
    // replacing the list's innerHTML above no longer removes it automatically.
    let overlayRemoved = false;
    const removeOverlayOnce = () => {
        if (overlayRemoved) return;
        overlayRemoved = true;
        overlay.remove();
    };

    // Anikoto (EN) and animego (RU) are fetched as two independent requests rather than
    // one combined call, so whichever source resolves first renders immediately and clears
    // the loading overlay - animego is often noticeably slower, and there's no reason to
    // make users stare at a blurred/loading screen for EN comments that are already ready.
    // Whichever source lands second just quietly re-renders the (now-merged, since the
    // backend always reads the full cached set) comment list - no overlay, no flicker reset.
    const fetchSource = (source) => fetch(`/api/anime-comments?${params.toString()}&only=${source}`)
        .then(res => res.json())
        .then(data => { render(data); removeOverlayOnce(); });

    const results = await Promise.allSettled([fetchSource('anikoto'), fetchSource('animego')]);

    if (results.every(r => r.status === 'rejected')) {
        console.error('Failed to load anime comments:', results[0].reason, results[1].reason);
        container.innerHTML = `<p class="setting-hint">Could not load comments.</p>`;
    }

    window.__lastLoadedAnimeCommentsKey = key;
    removeOverlayOnce();
};

window.postAnimeTopLevelComment = async function () {
    const input = document.getElementById('commentInputMain');
    const text = (input?.value || '').trim();
    if (!text || !window.__currentAnimeMalId) return;

    try {
        const res = await fetch('/anime-comments', {
            method: 'POST',
            headers: commentAuthHeaders(true),
            body: JSON.stringify({
                malId: window.__currentAnimeMalId,
                episodeNumber: window.__currentAnimeEpisode || 1,
                text
            })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showLimitToast(data.error || 'Could not post comment.');
            return;
        }
        input.value = '';
        showLimitToast('Comment posted!');
        loadAnimeComments(true); // force - same key, but new content was just added
    } catch (err) {
        console.error(err);
        showLimitToast('Server connection failed.');
    }
};

window.postAnimeReplyComment = async function (parentId) {
    const input = document.getElementById(`replyInput-anime-${parentId}`);
    const text = (input?.value || '').trim();
    if (!text || !window.__currentAnimeMalId) return;

    try {
        const res = await fetch('/anime-comments', {
            method: 'POST',
            headers: commentAuthHeaders(true),
            body: JSON.stringify({
                malId: window.__currentAnimeMalId,
                episodeNumber: window.__currentAnimeEpisode || 1,
                text,
                parentId
            })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showLimitToast(data.error || 'Could not post reply.');
            return;
        }
        input.value = '';
        showLimitToast('Reply posted!');
        loadAnimeComments(true); // force - same key, but new content was just added
    } catch (err) {
        console.error(err);
        showLimitToast('Server connection failed.');
    }
};

window.voteOnAnimeComment = async function (commentId, vote) {
    const token = localStorage.getItem('authToken');
    if (!token) { showLimitToast('Sign in to vote.'); return; }

    try {
        const res = await fetch(`/anime-comments/${commentId}/vote`, {
            method: 'POST',
            headers: commentAuthHeaders(true),
            body: JSON.stringify({ vote })
        });
        if (!res.ok) return;
        const data = await res.json();
        const row = document.getElementById(`comment-anime-${commentId}`);
        const scoreEl = row?.querySelector('.comment-score');
        if (scoreEl) scoreEl.textContent = (data.upvotes || 0) - (data.downvotes || 0);
    } catch (err) {
        console.error(err);
    }
};

window.deleteAnimeComment = async function (commentId) {
    try {
        const res = await fetch(`/anime-comments/${commentId}`, {
            method: 'DELETE',
            headers: commentAuthHeaders(false)
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showLimitToast(data.error || 'Could not delete comment.');
            return;
        }
        document.getElementById(`comment-anime-${commentId}`)?.remove();
        showLimitToast('Comment deleted.');
    } catch (err) {
        console.error(err);
        showLimitToast('Server connection failed.');
    }
};

window.addEventListener('anime-episode-changed', (e) => {
    window.__currentAnimeMalId = e.detail.malId;
    window.__currentAnimeSeason = e.detail.season;
    window.__currentAnimeEpisode = e.detail.episode;
    loadAnimeComments();
});

document.addEventListener('DOMContentLoaded', () => {
    loadComments();
    const token = localStorage.getItem('authToken');
    const avatarEl = document.getElementById('commentComposerAvatar');
    if (avatarEl) {
        const pfp = localStorage.getItem('userPFP');
        const username = localStorage.getItem('username') || '?';
        avatarEl.innerHTML = commentAvatarHTML(pfp, username);
    }
    if (!token) {
        const hint = document.getElementById('commentSigninHint');
        const btn = document.getElementById('commentSubmitBtn');
        const input = document.getElementById('commentInputMain');
        const fmtBtns = document.querySelectorAll('.comment-fmt-btn');
        if (hint) hint.style.display = '';
        if (btn) btn.disabled = true;
        if (input) input.disabled = true;
        fmtBtns.forEach(b => b.disabled = true);
    }
});

window.postTopLevelComment = async function () {
    if (window.__currentAnimeMalId) return postAnimeTopLevelComment();

    const input = document.getElementById('commentInputMain');
    const text = (input?.value || '').trim();
    if (!text) return;

    try {
        const res = await fetch('/movie-comments', {
            method: 'POST',
            headers: commentAuthHeaders(true),
            body: JSON.stringify({ movieId: getCommentsMovieId(), text })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showLimitToast(data.error || 'Could not post comment.');
            return;
        }
        input.value = '';
        showLimitToast('Comment posted!');
        loadComments();
    } catch (err) {
        console.error(err);
        showLimitToast('Server connection failed.');
    }
};

window.toggleReplyComposer = function (commentId) {
    const el = document.getElementById(`replyComposer-${commentId}`);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
};

window.postReplyComment = async function (parentId) {
    const input = document.getElementById(`replyInput-${parentId}`);
    const text = (input?.value || '').trim();
    if (!text) return;

    try {
        const res = await fetch('/movie-comments', {
            method: 'POST',
            headers: commentAuthHeaders(true),
            body: JSON.stringify({ movieId: getCommentsMovieId(), text, parentId })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showLimitToast(data.error || 'Could not post reply.');
            return;
        }
        input.value = '';
        document.getElementById(`replyComposer-${parentId}`).style.display = 'none';
        showLimitToast('Reply posted!');
        loadComments();
    } catch (err) {
        console.error(err);
        showLimitToast('Server connection failed.');
    }
};

window.toggleReplies = async function (commentId, forceOpen) {
    const wrap = document.getElementById(`repliesWrap-${commentId}`);
    const btn = document.getElementById(`showReplies-${commentId}`);
    if (!wrap) return;

    if (!forceOpen && wrap.style.display !== 'none' && wrap.dataset.loaded) {
        wrap.style.display = 'none';
        if (btn) btn.classList.remove('open');
        return;
    }

    wrap.style.display = '';
    if (btn) btn.classList.add('open');

    if (wrap.dataset.loaded) return;

    try {
        const res = await fetch(`/movie-comments/${commentId}/replies`);
        const replies = await res.json();
        wrap.innerHTML = (replies || []).map(r => renderOneComment(r, true)).join('');
        wrap.dataset.loaded = '1';
    } catch (err) {
        console.error(err);
        wrap.innerHTML = `<p class="setting-hint">Could not load replies.</p>`;
    }
};

window.voteOnComment = async function (commentId, vote) {
    const token = localStorage.getItem('authToken');
    if (!token) { showLimitToast('Sign in to vote.'); return; }

    try {
        const res = await fetch(`/movie-comments/${commentId}/vote`, {
            method: 'POST',
            headers: commentAuthHeaders(true),
            body: JSON.stringify({ vote })
        });
        if (!res.ok) return;
        const data = await res.json();
        const row = document.getElementById(`comment-${commentId}`);
        const scoreEl = row?.querySelector('.comment-score');
        if (scoreEl) scoreEl.textContent = (data.upvotes || 0) - (data.downvotes || 0);
    } catch (err) {
        console.error(err);
    }
};

window.deleteComment = async function (commentId) {
    try {
        const res = await fetch(`/movie-comments/${commentId}`, {
            method: 'DELETE',
            headers: commentAuthHeaders(false)
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showLimitToast(data.error || 'Could not delete comment.');
            return;
        }
        document.getElementById(`comment-${commentId}`)?.remove();
        showLimitToast('Comment deleted.');
    } catch (err) {
        console.error(err);
        showLimitToast('Server connection failed.');
    }
};
