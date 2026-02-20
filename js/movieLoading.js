/* 
   Handles Movie Details Page population, Recommendations, and Global Trailer Fetching
*/
let currentPlaylist = []; 
let activeTrailerIdx = -1; 
 
// 2. GLOBAL TRAILER FETCHER (Used by this file AND mainPageControls.js)
window.fetchYTId = async function(name) {
    try {
        const query = encodeURIComponent(name + " official trailer");
        const res = await fetch(`/youtube/search?name=${query}`);
        if (!res.ok) {
            console.error('[YouTube API] Backend error. Status:', res.status);
            return "";
        }
        const data = await res.json();
        return data.videoId || "";
    } catch (e) {
        console.error('[YouTube API] Error:', e);
        return "";
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
    const titleEl = document.getElementById('title');
    const movieTitle = titleEl ? titleEl.innerText.trim() : '';
    const forumUrl = movieTitle
        ? `/html/forum.html?movie=${encodeURIComponent(movieTitle)}`
        : '/html/forum.html';
    window.location.href = forumUrl;
};
// 3. PAGE INITIALIZATION
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[MovieInfo] DOMContentLoaded');
    // --- VidSrc Button Logic ---
    const vidSrcBtn = document.getElementById('watchVidsrcBtn');
    if (vidSrcBtn) {
        vidSrcBtn.addEventListener('click', function() {
            const urlParams = new URLSearchParams(window.location.search);
            const tmdbId = urlParams.get('id');
            if (!tmdbId) return alert('No TMDB id found!');
            let modal = document.getElementById('vidsrcModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'vidsrcModal';
                modal.className = 'modal';
                modal.innerHTML = `
                    <div class="modal-content">
                        <span class="close-modal" id="closeVidsrcModal">&times;</span>
                        <div class="video-container">
                            <iframe id="vidsrcPlayer" src="" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width:100%;height:60vh;"></iframe>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            // Set iframe src
            const iframe = document.getElementById('vidsrcPlayer');
            iframe.src = `https://vidsrc.me/embed/${tmdbId}`;
            modal.classList.add('show');
            document.body.classList.add('blur-active');
            // Close logic
            document.getElementById('closeVidsrcModal').onclick = function() {
                modal.classList.remove('show');
                document.body.classList.remove('blur-active');
                iframe.src = '';
            };
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
            const tmdbApiKey = 'f4705f0e34fafba5ccef5cc38a703fc5';
            // Get IMDB ID in one fetch
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/tv/${movieId}?api_key=${tmdbApiKey}&append_to_response=external_ids,credits`);
            movie = await tmdbRes.json();
            if (!movie.name && !movie.title) throw new Error("Item not found");
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
            // Show main cast (up to 5 names) for actors
            stars = movie.credits?.cast?.slice(0, 5)?.map(c => c.name) || [];
            setText('directors', directors[0]);
            setText('actors', stars.length ? stars.join(', ') : 'N/A');
            // Set hidden fields for reviews
            const revMovie = document.getElementById('revMovie');
            if (revMovie) { revMovie.value = movie.name; revMovie.readOnly = true; }
            const revMovieId = document.getElementById('revMovieId');
            if (revMovieId) revMovieId.value = movieId;
            setupTrailerButton(movie.name, movieYear);

            // --- TV Carousels ---
            // 1. GenreRow (Similar Genre)
            const genreRow = document.getElementById('genreRow');
            if (genreRow && movie.genres?.length) {
                genreRow.innerHTML = '<p style="color:#888;">Loading...</p>';
                const genreNames = movie.genres.map(g => g.name).join('|');
                const discoverUrl = `https://api.themoviedb.org/3/discover/tv?api_key=${tmdbApiKey}&with_genres=${movie.genres.map(g=>g.id).join(',')}&page=1`;
                fetch(discoverUrl)
                    .then(r => r.json())
                    .then(d => {
                        genreRow.innerHTML = '';
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
                        });
                        buildPlaylist(movie.name);
                    });
            }

            // 2. DirectorRow (More from Director)
            const directorRow = document.getElementById('directorRow');
            const directorTitle = document.getElementById('directorTitle');
            if (directorRow && directors[0] && movie.credits?.crew?.length) {
                directorRow.innerHTML = '<p style="color:#888;">Loading...</p>';
                if (directorTitle) directorTitle.innerText = `More from ${directors[0]}`;
                const directorObj = movie.credits.crew.find(c => c.job === 'Director' || c.job === 'Series Director');
                if (directorObj) {
                    const discoverUrl = `https://api.themoviedb.org/3/discover/tv?api_key=${tmdbApiKey}&with_crew=${directorObj.id}&sort_by=vote_average.desc&vote_count.gte=100&page=1`;
                    fetch(discoverUrl)
                        .then(r => r.json())
                        .then(d => {
                            directorRow.innerHTML = '';
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
                                        <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">Director: ${directors[0]}</p>
                                    </div>
                                `;
                                card.onclick = () => {
                                    window.location.href = `movieInfo.html?id=${item.id}&type=tv`;
                                };
                                directorRow.appendChild(card);
                            });
                        });
                } else {
                    directorRow.innerHTML = '<p class="no-data">No director found.</p>';
                }
            }

            // 3. ActorRow (More from Cast)
            const actorRow = document.getElementById('actorRow');
            const actorSelect = document.getElementById('actorSelect');
            const actorTitle = document.getElementById('actorTitle');
            if (actorRow && movie.credits?.cast?.length) {
                actorRow.innerHTML = '<p style="color:#888;">Loading...</p>';
                const mainCast = movie.credits.cast.slice(0, 5);
                if (actorSelect) {
                    actorSelect.innerHTML = mainCast.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
                    actorSelect.onchange = (e) => {
                        const actorId = e.target.value;
                        if (actorTitle) actorTitle.innerText = `More from ${mainCast.find(c => c.id == actorId)?.name || 'Actor'}`;
                        const discoverUrl = `https://api.themoviedb.org/3/discover/tv?api_key=${tmdbApiKey}&with_cast=${actorId}&sort_by=vote_average.desc&vote_count.gte=100&page=1`;
                        fetch(discoverUrl)
                            .then(r => r.json())
                            .then(d => {
                                actorRow.innerHTML = '';
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
                                            <p style="color:#f96d00; font-size:11px; font-weight:bold; margin-top:5px;">Starring ${mainCast.find(c => c.id == actorId)?.name || 'Actor'}</p>
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
                const discoverUrl = `https://api.themoviedb.org/3/discover/tv?api_key=${tmdbApiKey}&first_air_date.gte=${movieYear - 5}-01-01&first_air_date.lte=${movieYear + 5}-12-31&sort_by=vote_average.desc&vote_count.gte=100&page=1`;
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

            // TV Recommendations (main carousel)
            initTVRecommendations(movieId);
        } else {
            // MOVIE LOGIC (do not change anything for movies)
            // ...existing code...
            const baseUrl = `https://localhost:3000/movie/${movieId}`;
            const requestUrl = window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl;
            const response = await fetch(requestUrl);
            movie = await response.json();
            // ...existing code for movies untouched...
            if(document.getElementById('posterImg')) document.getElementById('posterImg').src = movie.poster_full_url || '/img/LOGO_Short.png';
            if(document.getElementById('bgBackdrop')) document.getElementById('bgBackdrop').style.backgroundImage = `url('${movie.poster_full_url}')`;
            document.getElementById('title').innerText = movie['Movie Name'] || movie.title || "Unknown";
            document.getElementById('rating').innerText = movie.Rating || movie.imdb_rating || "--";
            document.getElementById('runtime').innerText = movie.Runtime || "N/A";
            document.getElementById('plot').innerText = movie.Plot || movie.Overview || "No description available.";
            document.getElementById('genre').innerText = movie.Genre || "N/A";
            document.getElementById('votes').innerText = movie.Votes || "0";
            const movieYear = parseInt(String(movie.release_date || movie.Released_Year || "").match(/\d{4}/)?.[0]) || null;
            document.getElementById('year').innerText = movieYear || "----";
            const directors = cleanList(movie.Directors);
            const stars = cleanList(movie.Stars);
            document.getElementById('directors').innerText = directors[0] || "N/A";
            document.getElementById('actors').innerText = stars.join(', ');
            // IMDB ID display
            var imdbIdEl_movie = document.getElementById('imdbId');
            if (imdbIdEl_movie) imdbIdEl_movie.textContent = movie.imdb_id || 'N/A';
            const budget = parseFloat(movie.budget) || 0;
            const revenue = parseFloat(movie.revenue) || 0;
            document.getElementById('budget').innerText = formatMoney(budget);
            document.getElementById('revenue').innerText = formatMoney(revenue);
            var statusEl_movie = document.getElementById('financialStatus');
            if (statusEl_movie) {
                if (budget > 0 && revenue > 0) {
                    const perc = (((revenue - budget) / budget) * 100).toFixed(0);
                    statusEl_movie.innerHTML = revenue > budget ? `<span style=\"color:#46d369;\">+${perc}% (Hit)</span>` : `<span style=\"color:#ff4444;\">${perc}% (Flop)</span>`;
                } else {
                    statusEl_movie.innerText = 'Insufficient Data';
                }
            }
            // PREFILL REVIEW FIELDS (link reviews to this movie)
            var revMovieEl_movie = document.getElementById('revMovie');
            if (revMovieEl_movie) {
                revMovieEl_movie.value = movie['Movie Name'] || movie.title || '';
                revMovieEl_movie.readOnly = true;
            }
            var revMovieIdEl_movie = document.getElementById('revMovieId');
            if (revMovieIdEl_movie) revMovieIdEl_movie.value = movieId;
            setupTrailerButton(movie['Movie Name'] || movie.title, movieYear);
            // Recommendations, etc.
            const source = window.getMovieSource ? window.getMovieSource() : 'local';
            if (source === 'local') {
                initRecommendations(movie, movieYear, directors[0], stars);
            } else {
                initRecommendations(movie, movieYear, directors[0], stars);
            }

            // Only run the following for movies, not for series
            // ...existing code for prefs, genreClicks, etc...
            const prefsKey = 'userPreferences';
            const prefs = JSON.parse(localStorage.getItem(prefsKey) || '{}');
            const genreClicks = prefs.genreClicks || {};
            const clickedMovies = Array.isArray(prefs.clickedMovies) ? prefs.clickedMovies : [];

            if (movie.Genre) {
                movie.Genre.split(',').map(g => g.trim()).forEach(g => {
                    if (!g) return;
                    genreClicks[g] = (genreClicks[g] || 0) + 1;
                });
            }

            if (movieId && !clickedMovies.includes(String(movieId))) {
                clickedMovies.unshift(String(movieId));
                if (clickedMovies.length > 20) clickedMovies.length = 20;
            }

            prefs.genreClicks = genreClicks;
            prefs.clickedMovies = clickedMovies;
            localStorage.setItem(prefsKey, JSON.stringify(prefs));

            const recentKey = 'recentMovieClicks';
            const recent = JSON.parse(localStorage.getItem(recentKey) || '[]');
            if (movieId && !recent.includes(String(movieId))) {
                recent.unshift(String(movieId));
                if (recent.length > 20) recent.length = 20;
                localStorage.setItem(recentKey, JSON.stringify(recent));
            }
        }


        // Forum CTA visibility (only if forum data exists for this movie/series)
        try {
            const forumCta = document.getElementById('forumCtaBar');
            if (forumCta) {
                const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const baseUrl = isLocal ? 'https://localhost:3000' : window.location.origin;
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
    }
});

// 4. RECOMMENDATIONS LOGIC
// --- TV Recommendations ---
async function initTVRecommendations(tvId) {
    const tmdbApiKey = 'f4705f0e34fafba5ccef5cc38a703fc5';
    const recommendationsGrid = document.getElementById('recommendationsGrid');
    if (!recommendationsGrid) return;
    recommendationsGrid.innerHTML = '<p style="color:#888;">Loading recommendations...</p>';
    try {
        const recUrl = `https://api.themoviedb.org/3/tv/${tvId}/recommendations?api_key=${tmdbApiKey}`;
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
            poster_full_url: m.poster_path ? `${window.TMDB_IMAGE_BASE}${m.poster_path}` : '/img/LOGO_Short.png',
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
        // Filter out items with missing/invalid IDs
        const safeData = data.filter(m => m && m.ID && m.ID !== 'undefined' && m.ID !== null && m.ID !== '');
        if (safeData.length === 0) {
            container.innerHTML = `<p style="color:#666; padding:20px;">No similar titles found.</p>`;
            return;
        }
        container.innerHTML = safeData.map(m => {
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
        fetch(`https://localhost:3000/recommend/genre?genre=${encodeURIComponent(movie.Genre)}&exclude=${movie.ID}`)
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
            fetch(`https://localhost:3000/recommend/director?val=${encodeURIComponent(firstDirector)}&exclude=${movie.ID}`)
                .then(r => r.json()).then(d => renderRow(d, 'directorRow', `Director: ${firstDirector}`));
        }
    }

    const actorSelect = document.getElementById('actorSelect');
    if (actorSelect && starsList.length > 0) {
        console.log('[Reco] actorSelect found, starsList length', starsList.length);
        actorSelect.innerHTML = starsList.map(name => `<option value="${name}">${name}</option>`).join('');
        const fetchActorRow = async (name) => {
            const actTitle = document.getElementById('actorTitle');
            if (actTitle) actTitle.innerText = `More from ${name}`;
            if (isApi) {
                let actorId = null;
                if (type === 'tv') {
                    actorId = apiCredits?.cast?.find(c => c.name === name)?.id || null;
                } else {
                    actorId = apiCredits?.cast?.find(c => c.name === name)?.id || null;
                }
                console.log('[TMDB] Actor ID', actorId, 'for', name, 'type', type);
                if (actorId) {
                    const discoverPath = type === 'tv' ? '/discover/tv' : '/discover/movie';
                    const data = await tmdbFetch(discoverPath, {
                        with_cast: actorId,
                        sort_by: 'vote_average.desc',
                        'vote_count.gte': 100,
                        'primary_release_date.lte': new Date().toISOString().slice(0, 10),
                        page: 1
                    });
                    renderRow((data?.results || []).map(mapTmdbResult), 'actorRow', `Starring ${name}`);
                }
            } else {
                fetch(`https://localhost:3000/recommend/actors?val=${encodeURIComponent(name)}&exclude=${movie.ID}`)
                    .then(r => r.json()).then(d => renderRow(d, 'actorRow', `Starring ${name}`));
            }
        };
        actorSelect.onchange = (e) => fetchActorRow(e.target.value);
        fetchActorRow(starsList[0]);
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
            fetch(`https://localhost:3000/recommend/timeline?year=${movieYear}&exclude=${encodeURIComponent(movie.ID)}`)
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
    const watchBtn = document.querySelector('.btn-watch');
    const modal = document.getElementById('trailerModal');
    const player = document.getElementById('trailerPlayer');
    
    if (!watchBtn || !modal || !player) return;

    const views = parseInt(localStorage.getItem('viewCount')) || 0;
    const tier = localStorage.getItem('userTier') || "Free";
    const limit = (tier === 'Gold') ? Infinity : (tier === 'Premium' ? 20 : 3);

    if (views >= limit) {
        watchBtn.innerText = "Search on YouTube ↗";
        watchBtn.classList.remove('btn-unavailable');
        watchBtn.style.backgroundColor = "#c4302b";
        const newBtn = watchBtn.cloneNode(true);
        watchBtn.parentNode.replaceChild(newBtn, watchBtn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const query = encodeURIComponent(`${movieName} ${movieYear} trailer`);
            window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
        });
        return;
    }

    watchBtn.innerText = "Searching...";
    watchBtn.classList.remove('btn-unavailable'); 
    watchBtn.style.color = "#fff";

    try {
        const vId = await window.fetchYTId(`${movieName} ${movieYear}`);
        console.log("THE RAW ID IS:", vId, "TYPE:", typeof vId);


        if (!vId || (typeof vId === 'string' && vId.trim().length === 0)) {
            console.warn("⚠️ TRAILER NOT FOUND - Triggering Fallback");

            watchBtn.disabled = false;              
            watchBtn.style.pointerEvents = "auto";  
            watchBtn.style.cursor = "pointer";     
            watchBtn.classList.remove('btn-unavailable');
            
            // 2. red=goood)
            watchBtn.innerText = "Search on YouTube ↗";
            watchBtn.style.backgroundColor = "#c4302b"; 

            const newBtn = watchBtn.cloneNode(true);
            watchBtn.parentNode.replaceChild(newBtn, watchBtn);

            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log("🔥 CLICK DETECTED - Opening YouTube...");
                
                const query = encodeURIComponent(`${movieName} ${movieYear} trailer`);
                window.open(`https://www.youtube.com/results?search_query=${query}`, '_blank');
            });

            return;
        }

        // --- PRIORITY 3: ALL CLEAR (SUCCESS) ---
        watchBtn.innerText = "▶ Watch Trailer";
        watchBtn.classList.remove('btn-unavailable');
        watchBtn.style.backgroundColor = ""; 
        watchBtn.style.color = "#fff";
        watchBtn.onclick = () => {
            const currentViews = parseInt(localStorage.getItem('viewCount')) || 0;
            if (currentViews >= limit) {
                alert("Limit reached! Please refresh.");
                return;
            }

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
        watchBtn.style.backgroundColor = "#c4302b";

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
        const fetchUrl = pageMovieId ? `https://localhost:3000/reviews?movieId=${encodeURIComponent(pageMovieId)}` : 'https://localhost:3000/reviews';
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
        const res = await fetch('https://localhost:3000/reviews', {
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
// runnn
