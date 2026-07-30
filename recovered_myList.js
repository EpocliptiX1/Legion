
//====GUEST USER BLOCKER FOR SITES
// (Disabled: guest accounts are treated as real accounts now.)
// (function checkAccess() {
//     const user = localStorage.getItem('username');
//     
//     if (!user) {
//         // Create the UI block immediately
//         const lockMarkup = `
//             <div class="locked-overlay">
//                 <div class="locked-box">
//                     <div class="lock-icon" style="font-size: 50px; margin-bottom: 20px;">🔒</div>
//                     <h2>Private Collection</h2>
//                     <p style="display: block;margin-bottom: 10px;">This list is only available to registered members.</p>
//                     <a href="indexMain.html#promoMarquee">
//                         <button class="btn-locked-signin">Sign In / Join</button>
//                     </a>
//                     <br><br>
//                     <a href="indexMain.html" style="color: #666; font-size: 13px; text-decoration: none;">← Back to Home</a>
//                 </div>
//             </div>
//         `;

//         const injectLock = () => {
//             document.body.innerHTML = lockMarkup;
//             document.body.style.overflow = 'hidden';
//         };

//         // If body is ready, inject now. If not, wait for it.
//         if (document.body) injectLock();
//         else window.addEventListener('DOMContentLoaded', injectLock);

//         const keepLocked = () => {
//             if (!document.querySelector('.locked-overlay')) {
//                 injectLock();
//             }
        };

//         setInterval(keepLocked, 1000);
        
//         // STOPPPPPPPPP PLS
//         throw new Error("Access Denied: Redirecting to Login UI");
//     }
// })();
// 🚨 FRONTEND BROWSER SPAMMER 🚨
// Put this in your main.js, script.js, or HTML file!

 


// -----------------------------above is the blocking mechanism, below loading movies goes-----------------------------\\
document.addEventListener('DOMContentLoaded', async () => {

    const username = localStorage.getItem('username');
    const userUID = parseInt(localStorage.getItem('userUID')) || 0;
    const titleElement = document.querySelector('.list-title');
    
    if (username && titleElement) {
        titleElement.innerText = `${username}'s List`;
    }

    const grid = document.getElementById('myListGrid');
    const rawList = JSON.parse(localStorage.getItem('myList')) || [];

    // Normalize legacy bare-string entries to {id, type} objects
    const savedItems = rawList.map(item =>
        typeof item === 'object' && item !== null ? item : { id: String(item), type: 'movie' }
    );

    if (savedItems.length > 0) {
            // Build a typeMap from watch history to fix legacy items that have no stored type
            let historyTypeMap = {};
            try {
                if (window.recommendationsSystem?.fetchActivityHistory) {
                    const hist = await window.recommendationsSystem.fetchActivityHistory(200) || [];
                    hist.forEach(h => { historyTypeMap[String(h.movie_id)] = h.item_type || 'movie'; });
                }
            } catch(e) {}
            // Fix legacy items: if type is 'movie' but history says 'tv', trust history
            savedItems.forEach(item => {
                if (historyTypeMap[String(item.id)]) {
                    item.type = historyTypeMap[String(item.id)];
                }
            });
        try {
            // Split: local movies vs TV/anime (always TMDB)
            const localItems  = savedItems.filter(i => i.type === 'movie');
            const tvItems     = savedItems.filter(i => i.type === 'tv' || i.type === 'anime');

            const allMovies = [];

            // Fetch local/TMDB movies
            if (localItems.length > 0) {
                const baseUrl = '/movies/get-list';
                const requestUrl = window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl;
                const response = await fetch(requestUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: localItems.map(i => i.id) })
                });
                const movies = await response.json();
                movies.forEach(m => allMovies.push({ data: m, type: 'movie', id: String(m.ID) }));
            }

            // Fetch TV shows from TMDB
            for (const item of tvItems) {
                try {
                    const res = await fetch(`/api/tmdb-proxy/tv/${item.id}`);
                    const tv = await res.json();
                    if (tv && (tv.name || tv.title)) {
                        allMovies.push({
                            data: {
                                ID: item.id,
                                'Movie Name': tv.name || tv.title || 'Unknown',
                                poster_full_url: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : '/img/LOGO_Short.png',
                                Rating: tv.vote_average ? tv.vote_average.toFixed(1) : '--'
                            },
                            type: item.type,
                            id: item.id
                        });
                    }
                } catch(e) {}
            }

            if (allMovies.length > 0) {
                const escapeQuotes = (str) => String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
                const movieHtml = allMovies.map(({ data: movie, type, id }) => {
                    const safeName = escapeQuotes(movie['Movie Name']);
                    const tagLabel = (type === 'tv' || type === 'anime') ? 'ANIME' : 'MOVIE';
                    return `
                    <div class="grid-card" onmouseenter="console.log('Hover on card:', '${safeName}')">
                        ${movie.Rating !== '--' ? `<span class="card-rating-badge"><span style="color:#f5c518;font-size:0.75rem">★</span>${movie.Rating}</span>` : ''}
                        <img src="${movie.poster_full_url}" onclick="window.location.href='movieInfo.html?id=${movie.ID}&type=${type}'">
                        
                        <div class="card-title-label">
                            <div class="card-title-name">${movie['Movie Name'] || 'Unknown'}</div>
                            <div class="card-title-tag">${tagLabel}</div>
                        </div>

                        <div class="card-hover-info">
                            <div class="hover-btns">
                                <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${movie.ID}&type=${type}'">▶</button>
                                
                                <button class="hover-remove hover-delete-btn" title="Remove from list" onmouseenter="console.log('Hovering trash icon for:', '${safeName}')" onclick="console.log('Clicked delete for: ${safeName}'); removeFromList('${movie.ID}', event)">
                                    🗑
                                </button>
                            </div>
                        </div>
                    </div>
                `}).join('');

                grid.insertAdjacentHTML('afterbegin', movieHtml);
            }
        } catch (err) { console.error(err); }
    }

    await loadMyHistoryRow();

    // --- Render owner playlists under My List ---
    const playlistsGrid = document.getElementById('myPlaylistsGrid');
    if (!playlistsGrid || userUID === 0) return;

    try {
        const res = await fetch('/playlists');
        const playlists = await res.json();
        const owned = (playlists || []).filter(p => parseInt(p.ownerUID, 10) === userUID);

        if (!owned || owned.length === 0) {
            playlistsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">No playlists yet. Create one to get started!</p>';
        } else {
            const html = owned.map(p => {
                const poster = (p.movies && p.movies[0] && p.movies[0].poster) ? p.movies[0].poster : '/img/LOGO_Short.png';
                const count = (p.movies || []).length;
                return `
                    <div class="playlist-item" onclick="window.location.href='customPlaylists.html'" style="display: flex; gap: 12px; padding: 12px; background: var(--bg-tertiary); border-radius: 8px; cursor: pointer; transition: all 0.3s ease; border: 1px solid var(--border-color);">
                        <img src="${poster}" onerror="this.src='/img/LOGO_Short.png'" style="width: 60px; height: 90px; border-radius: 6px; object-fit: cover;">
                        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
                            <h4 style="margin: 0 0 5px 0; font-size: 1rem; color: var(--text-primary);">${p.name}</h4>
                            <span style="font-size: 0.85rem; color: var(--text-muted);">${count} movies</span>
                        </div>
                    </div>
                `;
            }).join('');

            playlistsGrid.innerHTML = html;
        }
    } catch (err) {
        console.error('Playlist load error:', err);
        playlistsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">Could not load playlists.</p>';
    }

    await loadRecentPosts(userUID);
});

async function loadMyHistoryRow() {
    const section = document.getElementById('myHistorySection');
    const historyGrid = document.getElementById('myHistoryGrid');
    if (!section || !historyGrid) return;

    let historyRows = [];
    if (window.recommendationsSystem?.fetchActivityHistory) {
        historyRows = await window.recommendationsSystem.fetchActivityHistory(20) || [];
    }
    if (historyRows.length === 0) return;

    const typeMap = Object.fromEntries(historyRows.map(h => [String(h.movie_id), h.item_type || 'movie']));
    const movieItems = historyRows.filter(h => (h.item_type || 'movie') === 'movie');
    const tvItems    = historyRows.filter(h => h.item_type === 'tv' || h.item_type === 'anime');
    const allCards = [];

    const escapeQuotes = (str) => String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');

    const createHistoryCardHTML = (m) => {
        const type = m._type || 'movie';
        const tagLabel = (type === 'tv' || type === 'anime') ? 'ANIME' : 'MOVIE';
        const safeName = escapeQuotes(m['Movie Name']);
        return `
            <div class="grid-card" onmouseenter="console.log('Hover on history card:', '${safeName}')">
                ${m.Rating !== '--' ? `<span class="card-rating-badge"><span style="color:#f5c518;font-size:0.75rem">★</span>${m.Rating}</span>` : ''}
                <img src="${m.poster_full_url || '/img/LOGO_Short.png'}" onerror="this.src='/img/LOGO_Short.png'" onclick="window.location.href='movieInfo.html?id=${m.ID}&type=${type}'">
                
                <div class="card-title-label">
                    <div class="card-title-name">${m['Movie Name'] || 'Unknown'}</div>
                    <div class="card-title-tag">${tagLabel}</div>
                </div>

                <div class="card-hover-info">
                    <div class="hover-btns">
                        <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${m.ID}&type=${type}'">▶</button>
                        
                        <button class="hover-remove hover-delete-btn" title="Remove from history" onmouseenter="console.log('Hovering trash icon for:', '${safeName}')" onclick="removeFromHistory('${m.ID}', event)">
                            🗑
                        </button>
                    </div>
                </div>
            </div>
        `;
    };

    if (movieItems.length > 0) {
        const localMovies = await fetchMoviesByIds(movieItems.map(h => h.movie_id));
        localMovies.forEach(m => {
            m._type = typeMap[String(m.ID)] || 'movie';
            allCards.push({ sortKey: historyRows.findIndex(h => String(h.movie_id) === String(m.ID)), card: createHistoryCardHTML(m) });
        });
    }
    for (const h of tvItems) {
        try {
            const res = await fetch(`/api/tmdb-proxy/tv/${h.movie_id}`);
            const tv = await res.json();
            if (tv && (tv.name || tv.title)) {
                const m = {
                    ID: h.movie_id,
                    'Movie Name': tv.name || tv.title,
                    poster_full_url: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : '/img/LOGO_Short.png',
                    Rating: tv.vote_average ? tv.vote_average.toFixed(1) : '--',
                    Genre: (tv.genres || []).map(g => g.name).join(', '),
                    Year: (tv.first_air_date || '').slice(0, 4),
                    _type: h.item_type || 'tv'
                };
                allCards.push({ sortKey: historyRows.findIndex(hr => String(hr.movie_id) === String(h.movie_id)), card: createHistoryCardHTML(m) });
            }
        } catch(e) {}
    }
    if (allCards.length === 0) return;
    allCards.sort((a, b) => a.sortKey - b.sortKey);
    section.style.display = 'block';
    historyGrid.innerHTML = allCards.map(c => c.card).join('');
}

// Load recent forum posts for the user
async function loadRecentPosts(userUID) {
    const container = document.getElementById('recentPostsContainer');
    if (!container || userUID === 0) return;

    const API_BASE = window.location.origin.includes('localhost')
        ? ''
        : window.location.origin;

    try {
        const response = await fetch(`${API_BASE}/forum/movies`);
        const forumMovies = await response.json();

        const threadPromises = forumMovies.map(async (movie) => {
            try {
                const threadsRes = await fetch(`${API_BASE}/forum/threads?movieId=${movie.movieId}`);
                const threads = await threadsRes.json();

                return threads
                    .filter(t => parseInt(t.userUID, 10) === userUID)
                    .map(t => ({ ...t, movieTitle: movie.movieTitle, movieId: movie.movieId }));
            } catch (err) {
                console.error(`Error fetching threads for movie ${movie.movieId}:`, err);
                return [];
            }
        });

        const threadArrays = await Promise.all(threadPromises);
        const userThreads = threadArrays.flat();

        userThreads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const recentThreads = userThreads.slice(0, 5);

        if (recentThreads.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">No forum posts yet. Share your thoughts on the forum!</p>';
            return;
        }

        container.innerHTML = recentThreads.map(thread => {
            const timeAgo = formatTimeAgo(thread.createdAt);
            return `
                <div class="post-item" onclick="window.location.href='/html/forum.html'" style="padding: 12px; background: var(--bg-tertiary); border-radius: 8px; cursor: pointer; transition: all 0.3s ease; border: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: start; gap: 10px; margin-bottom: 8px;">
                        <span style="font-size: 1.2rem;">💬</span>
                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; color: var(--text-primary); font-weight: 600;">${escapeHtml(thread.title)}</h4>
                            <p style="margin: 0 0 6px 0; font-size: 0.85rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                                ${escapeHtml(thread.description || '').substring(0, 100)}${thread.description && thread.description.length > 100 ? '...' : ''}
                            </p>
                            <div style="display: flex; gap: 12px; font-size: 0.8rem; color: var(--text-muted);">
                                <span>🎬 ${escapeHtml(thread.movieTitle)}</span>
                                <span>📅 ${timeAgo}</span>
                                <span>💬 ${thread.commentCount || 0} comments</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Error loading recent posts:', err);
        container.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">Could not load recent posts.</p>';
    }
}

// Format time ago
function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// HTML escape function
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.removeFromList = function(id, evt) {
    const existing = document.getElementById('__deleteConfirmPopup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = '__deleteConfirmPopup';
    popup.style.cssText = `
        position: fixed;
        z-index: 99999;
        background: #1a1a1a;
        border: 1.5px solid #e53935;
        border-radius: 10px;
        padding: 16px 20px;
        color: #fff;
        font-family: inherit;
        font-size: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        min-width: 220px;
        text-align: center;
    `;

    if (evt) {
        const x = Math.min(evt.clientX, window.innerWidth - 260);
        const y = Math.min(evt.clientY, window.innerHeight - 120);
        popup.style.left = x + 'px';
        popup.style.top  = y + 'px';
    } else {
        popup.style.left = '50%';
        popup.style.top  = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
    }

    popup.innerHTML = `
        <div style="margin-bottom:12px;font-size:15px;font-weight:600;">
            🗑️ Remove from history?
        </div>
        <div style="display:flex;gap:10px;justify-content:center;">
            <button id="__deleteYes" style="background:#e53935;color:#fff;border:none;border-radius:6px;padding:7px 18px;font-size:13px;cursor:pointer;font-weight:600;transition:background 0.2s;">Yes, remove</button>
            <button id="__deleteNo" style="background:#333;color:#ccc;border:none;border-radius:6px;padding:7px 18px;font-size:13px;cursor:pointer;transition:background 0.2s;">Cancel</button>
        </div>
    `;

    document.body.appendChild(popup);
    document.getElementById('__deleteNo').onclick = () => popup.remove();

    document.getElementById('__deleteYes').onclick = async () => {
        popup.remove();
        try {
            const userUID = localStorage.getItem('userUID');
            if (userUID) {
                await fetch('/activity/history/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userUID, movie_id: String(id) })
                });
            }
        } catch(e) { console.warn('[removeFromHistory] Backend delete failed:', e.message); }

        const card = document.querySelector(`.grid-card [onclick*="removeFromHistory('${id}"]`)?.closest('.grid-card');
        if (card) {
            card.style.transition = 'opacity 0.25s, transform 0.25s';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => card.remove(), 250);
        } else {
            location.reload();
        }
    };

    setTimeout(() => {
        document.addEventListener('click', function closePopup(e) {
            if (!popup.contains(e.target)) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        });
    }, 50);
};
    // Build a confirm popup anchored near the button
    const existing = document.getElementById('__deleteConfirmPopup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = '__deleteConfirmPopup';
    popup.style.cssText = `
        position: fixed;
        z-index: 99999;
        background: #1a1a1a;
        border: 1.5px solid #e53935;
        border-radius: 10px;
        padding: 16px 20px;
        color: #fff;
        font-family: inherit;
        font-size: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        min-width: 220px;
        text-align: center;
    `;

    // Position near click
    if (evt) {
        const x = Math.min(evt.clientX, window.innerWidth - 260);
        const y = Math.min(evt.clientY, window.innerHeight - 120);
        popup.style.left = x + 'px';
        popup.style.top  = y + 'px';
    } else {
        popup.style.left = '50%';
        popup.style.top  = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
    }

    popup.innerHTML = `
        <div style="margin-bottom:12px;font-size:15px;font-weight:600;">
            🗑️ Remove from list?
        </div>
        <div style="display:flex;gap:10px;justify-content:center;">
            <button id="__deleteYes" style="
                background:#e53935;color:#fff;border:none;border-radius:6px;
                padding:7px 18px;font-size:13px;cursor:pointer;font-weight:600;
                transition:background 0.2s;">Yes, remove</button>
            <button id="__deleteNo" style="
                background:#333;color:#ccc;border:none;border-radius:6px;
                padding:7px 18px;font-size:13px;cursor:pointer;
                transition:background 0.2s;">Cancel</button>
        </div>
    `;

    document.body.appendChild(popup);

    document.getElementById('__deleteNo').onclick = () => popup.remove();

    document.getElementById('__deleteYes').onclick = async () => {
        popup.remove();

        // 1. Remove from localStorage
        let list = JSON.parse(localStorage.getItem('myList')) || [];
        list = list.filter(item => {
            if (typeof item === 'object' && item !== null) return String(item.id) !== String(id);
            return String(item) !== String(id);
        });
        localStorage.setItem('myList', JSON.stringify(list));

        // 2. Remove from backend DB
        try {
            const token = localStorage.getItem('token');
            const userUID = localStorage.getItem('userUID');
            if (token && userUID) {
                await fetch('/activity/list/remove', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ userUID, item_id: String(id) })
                });
            }
        } catch(e) {
            console.warn('[removeFromList] Backend delete failed:', e.message);
        }

        // 3. Remove card from DOM without full reload
        const card = document.querySelector(`.grid-card [onclick*="removeFromList('${id}"]`)?.closest('.grid-card');
        if (card) {
            card.style.transition = 'opacity 0.25s, transform 0.25s';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => card.remove(), 250);
        } else {
            location.reload();
        }
    };

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function closePopup(e) {
            if (!popup.contains(e.target)) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        });
    }, 50);



}