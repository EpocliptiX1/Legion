/* Handles Movie Details Page population, Recommendations, and Global Trailer Fetching
*/
console.log('[movieLoading.js] script loaded');
let currentPlaylist = []; 
let activeTrailerIdx = -1; 
 
const isAnimeModeEnabled = () => window.__animeMode === true || localStorage.getItem('animeMode') === 'true';

async function fetchAniListTimelineRow(movieYear) {
    const startYear = Number(movieYear) - 5;
    const endYear = Number(movieYear) + 5;
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return [];

    const query = `
        query ($startMin: FuzzyDateInt, $startMax: FuzzyDateInt) {
            Page(page: 1, perPage: 20) {
                media(
                    type: ANIME
                    startDate_greater: $startMin
                    startDate_lesser: $startMax
                    sort: SCORE_DESC
                ) {
                    id
                    title { romaji english native }
                    averageScore
                    popularity
                    startDate { year }
                    coverImage { large extraLarge }
                }
            }
        }
    `;

    try {
        const res = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                query,
                variables: {
                    startMin: Number(`${startYear}0101`),
                    startMax: Number(`${endYear}1231`)
                }
            })
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn('[AniListTimeline] HTTP error:', res.status, errText.slice(0, 300));
            return [];
        }
        const json = await res.json();
        if (json?.errors?.length) {
            console.warn('[AniListTimeline] GraphQL errors:', json.errors);
        }
        return Array.isArray(json?.data?.Page?.media) ? json.data.Page.media : [];
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
        // --- Plot Read More/Less Logic (fixed infinite loop, now mobile-only) ---
        let isPlotExpanded = false;
        let fullPlotText = '';
        const plotEl = document.getElementById('plot');
        const plotBtn = document.getElementById('plotReadMoreBtn');
        let plotObserver;

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
            // Disconnect observer before mutating DOM
            if (plotObserver) plotObserver.disconnect();
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
            // Reconnect observer after mutation
            if (plotObserver) plotObserver.observe(plotEl, { childList: true, characterData: true, subtree: true });

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

        if (plotEl) {
            plotObserver = new MutationObserver(() => {
                fullPlotText = plotEl.innerText;
                isPlotExpanded = false;
                updatePlotDisplay();
            });
            plotObserver.observe(plotEl, { childList: true, characterData: true, subtree: true });
            // Initial setup
            fullPlotText = plotEl.innerText;
            updatePlotDisplay();
        }

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
        ((tmdbItem?.genres || []).some(g => g?.id === 16 || g?.name === 'Animation' || g?.name === 'Anime') &&
        (tmdbItem?.original_language === 'ja' || tmdbItem?.origin_country?.includes('JP')));
    
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

            // Cache the newly fetched data
            const cacheSaveRes = await fetch("/api/cache-anime-info", {
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
            });

            if (cacheSaveRes.ok) {
                console.log("[Anime] Anime cached successfully.");
            }
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
        const episodes = anime.episodes != null ? String(anime.episodes) : 'Unknown';
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

        if (anime.description) setText('plot', anime.description);
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
                (movie.genres?.some(g => g.name === 'Animation' || g.name === 'Anime') &&
                 (movie.original_language === 'ja' || movie.origin_country?.includes('JP')));
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
            if(document.getElementById('bgBackdrop')) document.getElementById('bgBackdrop').style.backgroundImage = `url('${posterUrl}')`;
            setText('title', movie.name || movie.original_name || 'Unknown');
            setText('rating', movie.vote_average ? movie.vote_average.toFixed(1) : '--');
            setText('runtime', movie.episode_run_time?.[0] ? `${movie.episode_run_time[0]} min` : 'N/A');
            setText('plot', movie.overview || 'No description available.');
            setText('genre', movie.genres?.map(g => g.name).join(', ') || 'N/A');
            setText('votes', movie.vote_count || '0');
            setText('year', movieYear || '----');
            setText('imdbId', movie.external_ids?.imdb_id || 'N/A');
            directors = [movie.created_by?.[0]?.name || 'N/A'];
            
            // Show main cast (up to 5 names) for text
            stars = fullTvCast.slice(0, 5).map(c => c.name);
            setText('directors', directors[0]);
            setText('actors', stars.length ? stars.join(', ') : 'N/A');

            // If this title maps to MAL, upgrade details-grid with richer anime metadata.
            await applyAnimeMalDetailsIfAvailable(movie, movieId);
            
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
                        ? `background-image: url('https://image.tmdb.org/t/p/w185${actor.profile_path}'); background-size: cover; background-position: center;`
                        : `background-color: #333;`;

                    li.innerHTML = `<div class="actor-block-pic" style="${bgStyle}"></div><span class="actor-block-name">${actor.name}</span>`;
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
                actorSelect.innerHTML = uniqueActors.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            }
            // Set hidden fields for reviews
            const revMovie = document.getElementById('revMovie');
            if (revMovie) { revMovie.value = movie.name; revMovie.readOnly = true; }
            const revMovieId = document.getElementById('revMovieId');
            if (revMovieId) revMovieId.value = movieId;
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

                const isAnime = movie.genres.some(g => g.name === 'Animation' || g.name === 'Anime') && (movie.original_language === 'ja' || movie.origin_country?.includes('JP'));

                if (isAnime) {
                    const recs = await waitForAnimeRecommendations(movieId);
                    genreRow.innerHTML = '';
                    const cards = [];
                    recs.forEach(item => {
                        if (!item || !item.ID || item.ID === movie.id) return;
                        const displayName = item['Movie Name'] || 'Unknown';
                        const year = item.Year || 'N/A';
                        const poster = item.poster_full_url || '/img/LOGO_Short.png';
                        const card = document.createElement('div');
                        card.className = 'mini-card';
                        card.innerHTML = `
                            <img src="${poster}" alt="${displayName}">
                            <div class="mini-info">
                                <h4>${displayName}</h4>
                                <p>⭐ ${item.Rating || '--'} (${item.Votes || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">AniList Recommendations</p>
                            </div>
                        `;
                        card.onclick = () => {
                            window.location.href = `movieInfo.html?id=${item.ID}&type=tv`;
                        };
                        genreRow.appendChild(card);
                        cards.push(card.outerHTML);
                    });
                    const genreRowClone = document.getElementById('genreRowClone');
                    if (genreRowClone) {
                        genreRowClone.innerHTML = cards.join('');
                        Array.from(genreRowClone.querySelectorAll('.mini-card')).forEach((el, idx) => {
                            el.onclick = () => {
                                const mappedItems = recs.filter(item => item && item.ID && item.ID !== movie.id);
                                const item = mappedItems[idx];
                                if (item) {
                                    window.location.href = `movieInfo.html?id=${item.ID}&type=tv`;
                                }
                            };
                        });
                    }
                    if (cards.length === 0) {
                        genreRow.innerHTML = `<p style="color:#666; padding:20px;">No similar titles found.</p>`;
                    } else {
                        buildPlaylist(movie.name);
                    }

                } else {
                    let discoverUrl;
                    const genreIds = movie.genres.map(g=>g.id).join(',');
                    discoverUrl = `/api/tmdb-proxy/discover/tv?with_genres=${genreIds}&page=1`;
                    fetch(discoverUrl)
                        .then(r => r.json())
                        .then(d => {
                            genreRow.innerHTML = '';
                            const cards = [];
                            (d.results || []).forEach(item => {
                                if (item.id === movie.id) return;
                                const displayName = item.name || item.title || 'Unknown';
                                const year = (item.first_air_date || '').split('-')[0] || 'N/A';
                                const poster = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '/img/LOGO_Short.png';
                                const card = document.createElement('div');
                                card.className = 'mini-card';
                                card.innerHTML = `
                                    <img src="${poster}" alt="${displayName}">
                                    <div class="mini-info">
                                        <h4>${displayName}</h4>
                                        <p>⭐ ${item.vote_average || '--'} (${item.vote_count || 0}) <span style='font-size:11px;color:#aaa;'>${year}</span></p>
                                        <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">Similar Genre</p>
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
                                        const item = (d.results || []).filter(item => item.id !== movie.id)[idx];
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
                        });
                }
            } else {
                // (Overlay hiding handled globally after 2s)
            }

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
                            const poster = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '/img/LOGO_Short.png';
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
                                    const poster = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '/img/LOGO_Short.png';
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
                                // Use d.cast for TV credits
                                const tvResults = (d.cast || []).sort((a, b) => b.popularity - a.popularity).slice(0, 20);
                                tvResults.forEach(item => {
                                    if (item.id === movie.id) return;
                                    const displayName = item.name || item.title || 'Unknown';
                                    const year = (item.first_air_date || '').split('-')[0] || 'N/A';
                                    const poster = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '/img/LOGO_Short.png';
                                    const card = document.createElement('div');
                                    card.className = 'mini-card';
                                    card.innerHTML = `
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

                const isAnime = isAnimeModeEnabled() && movie.genres.some(g => g.name === 'Animation' || g.name === 'Anime');
                if (isAnime) {
                    fetchAniListTimelineRow(movieYear).then(async items => {
                        timelineRow.innerHTML = '';
                        const seen = new Set();
                        for (const item of items || []) {
                            const displayName = item?.title?.english || item?.title?.romaji || item?.title?.native || 'Unknown';
                            if (!displayName) continue;
                            const key = displayName.toLowerCase();
                            if (seen.has(key)) continue;
                            seen.add(key);

                            const poster = item?.coverImage?.extraLarge || item?.coverImage?.large || '/img/LOGO_Short.png';
                            const year = item?.startDate?.year || 'N/A';
                            const tmdbRes = await fetch(`/api/anime-tmdb-id?anilistId=${encodeURIComponent(item.id)}&title=${encodeURIComponent(displayName)}`);
                            const tmdbBody = tmdbRes.ok ? await tmdbRes.json().catch(() => ({})) : {};
                            const tmdbId = tmdbBody?.tmdb_id || tmdbBody?.tmdbId || tmdbBody?.id || null;
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
                            timelineRow.innerHTML = '<p style="color:#888;">No similar titles found.</p>';
                        }
                    });
                } else {
                    const discoverUrl = `/api/tmdb-proxy/discover/tv?first_air_date.gte=${movieYear - 5}-01-01&first_air_date.lte=${movieYear + 5}-12-31&sort_by=popularity.desc&vote_count.gte=20&page=1`;
                    fetch(discoverUrl)
                        .then(r => r.json())
                        .then(d => {
                            timelineRow.innerHTML = '';
                            (d.results || []).forEach(item => {
                                if (item.id === movie.id) return;
                                const displayName = item.name || item.title || 'Unknown';
                                const year = (item.first_air_date || '').split('-')[0] || 'N/A';
                                const poster = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '/img/LOGO_Short.png';
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
                        });
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
            if(document.getElementById('bgBackdrop')) document.getElementById('bgBackdrop').style.backgroundImage = `url('${posterUrl}')`;
            
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
            setText('rating', movie.vote_average ? movie.vote_average.toFixed(1) : "--");
            setText('runtime', movie.runtime ? `${movie.runtime} min` : 'N/A');
            setText('plot', movie.overview || 'No description available.');
            setText('genre', movie.Genre || 'N/A');
            setText('votes', movie.vote_count || '0');
            setText('year', movieYear || '----');
            setText('imdbId', movie.external_ids?.imdb_id || movie.imdb_id || 'N/A');
            setText('directors', directors.length > 0 ? directors[0] : 'N/A');
            setText('actors', stars.length > 0 ? stars.join(', ') : 'N/A');

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
                        ? `background-image: url('https://image.tmdb.org/t/p/w185${actor.profile_path}'); background-size: cover; background-position: center;`
                        : `background-color: #333;`;
                    li.innerHTML = `<div class="actor-block-pic" style="${bgStyle}"></div><span class="actor-block-name">${actor.name}</span>`;
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
            
            // PREFILL REVIEW FIELDS (link reviews to this movie)
            var revMovieEl_movie = document.getElementById('revMovie');
            if (revMovieEl_movie) {
                revMovieEl_movie.value = movie['Movie Name'] || '';
                revMovieEl_movie.readOnly = true;
            }
            var revMovieIdEl_movie = document.getElementById('revMovieId');
            if (revMovieIdEl_movie) revMovieIdEl_movie.value = movieId;
            
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
                const poster = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '/img/LOGO_Short.png';
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
            poster_full_url: m.poster_path ? `${window.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p/w500'}${m.poster_path}` : '/img/LOGO_Short.png',
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
            // Use dynamic recommendations endpoint
            const recData = await tmdbFetch(`/${type}/${tmdbMovieId}/recommendations`, { page: 1, language: 'en-US' });
            console.log('[TMDB] Recommendations raw', recData);
            const recs = (recData?.results || []).map(mapTmdbResult);
            console.log('[TMDB] Recommendations count', recs.length);
            renderRow(recs, 'genreRow', 'Recommended');
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
        actorSelect.innerHTML = dropDownCast.map(name => `<option value="${name}">${name}</option>`).join('');
        
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


async function loadReviews() {
    const container = document.getElementById('reviewsGrid');
    if (!container) return;

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const pageMovieId = urlParams.get('id');
        const fetchUrl = pageMovieId ? `/reviews?movieId=${encodeURIComponent(pageMovieId)}` : '/reviews';
        const res = await fetch(fetchUrl);
        let reviews = await res.json();

        // Client-side safeguard: filter out legacy reviews that lack movieId
        if (pageMovieId) {
            reviews = reviews.filter(r => r.movieId && String(r.movieId) === String(pageMovieId));
        }

        const addCardHTML = `
            <div class="review-card add-card" onclick="openReviewModal()">
                <div class="plus-icon">+</div>
                <h3>Write a Review</h3>
            </div>
        `;

        const reviewsHTML = reviews.map(r => {
            const movieLabel = r.movieTitle || r.movie || 'Unknown';
            const movieHTML = r.movieId ? `<a href="movieInfo.html?id=${r.movieId}">${movieLabel}</a>` : movieLabel;
            return `
            <div class="review-card">
                <div class="review-header">
                    <div class="review-pfp" 
                         style="width:40px; height:40px; border-radius:50%; background-color:#444; background-size:cover; background-position:center; ${r.pfp ? `background-image: url('${r.pfp}')` : ''}">
                    </div>
                    <div class="review-info">
                        <h4>${r.user}</h4>
                        <span class="stars">${"⭐".repeat(r.stars)}</span>
                    </div>
                </div>
                <div class="review-body">
                    <p>"${r.text}"</p>
                    <small>Watching: ${movieHTML}</small>
                </div>
            </div>
        `}).join('');

        container.innerHTML = addCardHTML + reviewsHTML;
        
    } catch (err) {
        console.error("Failed to load reviews:", err);
    }
}

document.addEventListener('DOMContentLoaded', loadReviews);
window.openReviewModal = () => document.getElementById('reviewModal').classList.add('active');
window.closeReviewModal = () => document.getElementById('reviewModal').classList.remove('active');

window.submitReview = async function() {
    const user = localStorage.getItem('username') || "Guest";
    const userPFP = localStorage.getItem('userPFP');
    
    const textVal = document.getElementById('revText').value;
    const movieTitleVal = document.getElementById('revMovie') ? document.getElementById('revMovie').value : '';
    const movieIdVal = document.getElementById('revMovieId') ? document.getElementById('revMovieId').value : (new URLSearchParams(window.location.search)).get('id') || null;

    if (!movieTitleVal || !textVal) {
        showToast("Please fill out all fields!", true);
        return;
    }

    const data = {
        user: user,
        pfp: userPFP,
        movieTitle: movieTitleVal,
        movieId: movieIdVal,
        stars: parseInt(document.getElementById('revStars').value, 10) || 0,
        text: textVal
    };

    try {
        const res = await fetch('/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            if (typeof closeReviewModal === 'function') closeReviewModal();
            else {
                 document.getElementById('reviewModal').classList.remove('active');
            }

            showToast("Review Posted Successfully!");
            
            if(window.loadReviews) window.loadReviews(); 
        } else {
            showToast("Error posting review.", true);
        }
    } catch (err) {
        console.error(err);
        showToast("Server connection failed.", true);
    }
};
