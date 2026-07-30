// Custom Playlists UI & API client
const API_BASE = '';

let activePlaylistId = null;
let activePlaylistOwnerUID = null;
let activePlaylistMovieIds = new Set();
let moviePickerPage = 0;
const moviePickerLimit = 24;
let playlistSearchTimeout;

async function fetchJson(path, options) {
    const res = await fetch(`${API_BASE}${path}`, options);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
}
async function fetchPlaylists() {
    try {
        return await fetchJson('/playlists');
    } catch (err) {
        console.error('Could not fetch playlists', err);
        return [];
    }
}

async function createPlaylist(name, desc) {
    try {
        const owner = localStorage.getItem('username') || 'Guest';
        const ownerUID = parseInt(localStorage.getItem('userUID')) || 0;
        if (ownerUID === 0) {
            showToast('Sign in to create playlists', true);
            return null;
        }
        return await fetchJson('/playlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, desc, owner, ownerUID })
        });
    } catch (err) {
        console.error('Create playlist error', err);
    }
}

async function addMovieToPlaylist(playlistId, movie) {
    try {
        const userUID = parseInt(localStorage.getItem('userUID')) || 0;
        return await fetchJson(`/playlists/${playlistId}/movies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...movie, userUID })
        });
    } catch (err) {
        console.error('Add movie error', err);
    }
}

async function deletePlaylist(id) {
    try {
        const userUID = parseInt(localStorage.getItem('userUID')) || 0;
        await fetchJson(`/playlists/${id}`, { 
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userUID })
        });
        return true;
    } catch (err) {
        console.error('Delete playlist error', err);
        showToast('Failed to delete playlist', true);
        return false;
    }
}

// Render grid in customPlaylists.html
async function renderPlaylistsGrid() {
    const grid = document.getElementById('playlistsGrid');
    if (!grid) return;
    grid.innerHTML = '<p style="color:#888; padding:20px;">Loading...</p>';
    const pls = await fetchPlaylists();
    if (!pls || pls.length === 0) {
        grid.innerHTML = '<p style="color:#666; padding:20px;">No playlists yet. Create one above.</p>';
        return;
    }

    // Sort by score desc, randomize ties
    const sorted = pls.slice().sort((a, b) => {
        const aScore = (a.score !== undefined && a.score !== null) ? a.score : 0;
        const bScore = (b.score !== undefined && b.score !== null) ? b.score : 0;
        if (bScore !== aScore) return bScore - aScore;
        return Math.random() - 0.5;
    });

    const cards = [];
    for (const p of sorted) {
        const moviesHTML = (p.movies || []).length > 0 
            ? p.movies.map(m => `
                <div class="playlist-movie-item">
                    <img src="${m.poster || '/img/LOGO_Short.png'}" alt="${m.movieTitle || 'Movie'}">
                    <span>${m.movieTitle || 'Unknown'}</span>
                </div>
            `).join('')
            : '<div class="playlist-empty">No movies yet</div>';

        // Check if current user owns this playlist
        const userUID = parseInt(localStorage.getItem('userUID')) || 0;
        const isOwner = parseInt(p.ownerUID) === userUID;
        const deleteBtn = isOwner ? `<button class="btn-small btn-delete" data-id="${p.id}" style="background:#3a2b2b;">Delete</button>` : '';

        // Vote status
        const voters = p.voters || {};
        const currentVote = userUID !== 0 ? voters[String(userUID)] : null;
        const score = (p.score !== undefined && p.score !== null) ? p.score : 0;
        const voteHint = userUID === 0 ? 'Sign in to vote' : 'Vote';
        const voteHTML = `
            <div class="playlist-votes">
                <button class="vote-btn vote-up ${currentVote === 'up' ? 'active' : ''}" data-id="${p.id}" ${userUID === 0 || currentVote === 'up' ? 'disabled' : ''} title="${voteHint}">▲</button>
                <span class="vote-count">${score}</span>
                <button class="vote-btn vote-down ${currentVote === 'down' ? 'active' : ''}" data-id="${p.id}" ${userUID === 0 || currentVote === 'down' ? 'disabled' : ''} title="${voteHint}">▼</button>
            </div>
        `;

        const descText = (p.desc || '').trim();
        const descHTML = descText ? `<div class="playlist-desc">${descText}</div>` : '';

        // Build genres from stored genre or fetch movie details when missing
        const genreSet = new Set();
        const missingGenreIds = [];
        (p.movies || []).forEach(m => {
            const raw = String(m.genre || '').trim();
            if (raw) {
                raw.split(',').map(s => s.trim()).filter(Boolean).forEach(g => genreSet.add(g));
            } else if (m.movieId) {
                missingGenreIds.push(m.movieId);
            }
        });

        if (missingGenreIds.length > 0) {
            const details = await Promise.all(missingGenreIds.map(async id => {
                try {
                    return await fetchJson(`/movie/${id}`);
                } catch {
                    return null;
                }
            }));
            details.filter(Boolean).forEach(d => {
                const raw = d.Genre || d['Genre'] || '';
                String(raw).split(',').map(s => s.trim()).filter(Boolean).forEach(g => genreSet.add(g));
            });
        }

        const genres = Array.from(genreSet);
        const genresHTML = genres.length
            ? `<div class="playlist-genres">${genres.map(g => `<span class="tech-badge">${g}</span>`).join('')}</div>`
            : '';

        cards.push(`
            <div class="mini-card playlist-card" data-id="${p.id}">
                <div class="mini-info">
                    <h4>${p.name}</h4>
                    ${descHTML}
                    <div class="playlist-movie-count">${(p.movies || []).length} movies</div>
                    ${genresHTML}
                </div>
                <div class="playlist-movies-list">
                    ${moviesHTML}
                </div>
                <div class="playlist-actions">
                    <button class="btn-small btn-open" data-id="${p.id}">Open</button>
                    ${deleteBtn}
                    ${voteHTML}
                </div>
            </div>
        `);
    }

    grid.innerHTML = cards.join('');

    // Attach handlers
    grid.querySelectorAll('.btn-open').forEach(b => b.onclick = () => openPlaylistModal(b.dataset.id));
    grid.querySelectorAll('.btn-delete').forEach(b => b.onclick = async () => {
        if (!confirm('Delete playlist?')) return;
        const ok = await deletePlaylist(b.dataset.id);
        if (ok) renderPlaylistsGrid();
    });

    grid.querySelectorAll('.vote-btn').forEach(b => b.onclick = async (e) => {
        e.stopPropagation();
        const userUID = parseInt(localStorage.getItem('userUID')) || 0;
        if (userUID === 0) {
            showToast('Sign in to vote', true);
            return;
        }
        const id = b.dataset.id;
        const vote = b.classList.contains('vote-up') ? 'up' : 'down';
        try {
            await fetchJson(`/playlists/${id}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userUID, vote })
            });
            renderPlaylistsGrid();
        } catch (err) {
            console.error('Vote error', err);
            showToast('Unable to vote', true);
        }
    });
}

// Modal
async function openPlaylistModal(id) {
    let pl;
    try {
        pl = await fetchJson(`/playlists/${id}`);
    } catch (err) {
        console.error('Fetch playlist error', err);
        return;
    }
    activePlaylistId = pl.id;
    activePlaylistOwnerUID = pl.ownerUID;
    activePlaylistMovieIds = new Set((pl.movies || []).map(m => String(m.movieId)));
    const titleDisplay = `${pl.name} - ${pl.owner || 'Guest'}`;
    document.getElementById('playlistTitle').innerText = titleDisplay;
    const uidDisplay = (pl.ownerUID !== undefined && pl.ownerUID !== null) ? `UID: ${pl.ownerUID}` : 'UID: Unknown';
    document.getElementById('playlistUID').innerText = uidDisplay;
    const descEl = document.getElementById('playlistDesc');
    if (descEl) {
        const descText = (pl.desc || '').trim();
        if (descText) {
            descEl.innerText = descText;
            descEl.style.display = 'block';
        } else {
            descEl.innerText = '';
            descEl.style.display = 'none';
        }
    }
    const userUID = parseInt(localStorage.getItem('userUID')) || 0;
    const isOwner = parseInt(userUID) === parseInt(pl.ownerUID);
    const addMoreBtn = document.getElementById('addMoreToPlaylistBtn');
    if (addMoreBtn) addMoreBtn.style.display = isOwner ? '' : 'none';
    const container = document.getElementById('playlistMovies');
    container.innerHTML = '<p style="color:#888; padding:20px;">Loading movie details...</p>';
    const commentsList = document.getElementById('playlistCommentsList');
    if (commentsList) commentsList.innerHTML = '';
    
    // Fetch full details for each movie
    const movieDetailsPromises = (pl.movies || []).map(async m => {
        try {
            const source = window.getMovieSource ? window.getMovieSource() : 'local';
            const path = source === 'api'
                ? `/movie/${m.movieId}?source=api`
                : `/movie/${m.movieId}`;
            const details = await fetchJson(path);
            return { ...m, details };
        } catch {
            return m; // fallback if fetch fails
        }
    });
    
    const moviesWithDetails = await Promise.all(movieDetailsPromises);
    container.innerHTML = '';

    // Render genre badges
    const genresEl = document.getElementById('playlistGenres');
    if (genresEl) {
        const genreSet = new Set();
        moviesWithDetails.forEach(m => {
            const details = m.details;
            const raw = details?.Genre || details?.['Genre'] || '';
            String(raw).split(',').map(s => s.trim()).filter(Boolean).forEach(g => genreSet.add(g));
        });
        const genres = Array.from(genreSet);
        genresEl.innerHTML = genres.length
            ? genres.map(g => `<span class="tech-badge">${g}</span>`).join('')
            : '<span class="tech-badge">No Genres</span>';
    }
    
    moviesWithDetails.forEach(m => {
        const item = document.createElement('div');
        item.className = 'playlist-modal-item';
        
        const details = m.details;
        const title = details?.['Movie Name'] || m.movieTitle || 'Unknown';
        const desc = details?.['Plot'] || 'No description available';
        const rating = details?.['Rating'] || 'N/A';
        const poster = details?.poster_full_url || m.poster || '/img/LOGO_Short.png';
        
        const removeBtnHTML = isOwner ? `
            <button class="btn-remove-from-playlist" data-movie-id="${m.movieId}" title="Remove from playlist">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        ` : '';

        item.innerHTML = `
            <img src="${poster}" alt="${title}" onclick="window.location.href='movieInfo.html?id=${m.movieId}'" style="cursor:pointer;">
            <div class="playlist-modal-info">
                <h4 onclick="window.location.href='movieInfo.html?id=${m.movieId}'" style="cursor:pointer;">${title}</h4>
                <p class="playlist-modal-desc">${desc.length > 150 ? desc.substring(0, 150) + '...' : desc}</p>
                <div class="playlist-modal-meta">
                    <span class="rating-badge">⭐ ${rating}</span>
                </div>
            </div>
            ${removeBtnHTML}
        `;
        container.appendChild(item);
    });
    
    // Attach remove handlers
    container.querySelectorAll('.btn-remove-from-playlist').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const movieId = btn.dataset.movieId;
            try {
                const userUID = parseInt(localStorage.getItem('userUID')) || 0;
                await fetchJson(`/playlists/${activePlaylistId}/movies/${movieId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userUID })
                });
                showToast('Removed from playlist');
                openPlaylistModal(activePlaylistId); 
                renderPlaylistsGrid(); 
            } catch (err) {
                console.error('Remove error:', err);
                showToast('Failed to remove');
            }
        };
    });

    // Render comments
    if (commentsList) {
        const comments = (pl.comments || []).slice();
        if (comments.length === 0) {
            commentsList.innerHTML = '<p style="color:#777; padding:6px 0;">No comments yet.</p>';
        } else {
            // Sort by upvotes desc, randomize ties
            comments.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
            for (let i = 0; i < comments.length; ) {
                const score = comments[i].upvotes || 0;
                let j = i + 1;
                while (j < comments.length && (comments[j].upvotes || 0) === score) j++;
                if (j - i > 1) {
                    const slice = comments.slice(i, j);
                    for (let k = slice.length - 1; k > 0; k--) {
                        const r = Math.floor(Math.random() * (k + 1));
                        [slice[k], slice[r]] = [slice[r], slice[k]];
                    }
                    comments.splice(i, j - i, ...slice);
                }
                i = j;
            }

            const userUID = parseInt(localStorage.getItem('userUID')) || 0;
            commentsList.innerHTML = comments.map(c => {
                const voters = c.voters || {};
                const voted = userUID !== 0 && !!voters[String(userUID)];
                const isOwner = userUID !== 0 && parseInt(c.userUID, 10) === userUID;
                const deleteBtn = isOwner ? `<button class="comment-delete-btn" data-comment-id="${c.id}" title="Delete">×</button>` : '';
                return `
                <div class="comment-item">
                    <div class="comment-header">
                        <span class="comment-user">${c.username || 'User'}</span>
                        <span class="comment-date">${new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <div class="comment-text">${c.text}</div>
                    <div class="comment-meta">
                        <span class="comment-uid">UID: ${c.userUID ?? '—'}</span>
                        ${deleteBtn}
                    </div>
                    <div class="comment-votes">
                        <button class="comment-vote-btn" data-comment-id="${c.id}" ${userUID === 0 || voted ? 'disabled' : ''} title="${userUID === 0 ? 'Sign in to vote' : (voted ? 'Voted' : 'Upvote')}">▲</button>
                        <span class="comment-vote-count">${c.upvotes || 0}</span>
                    </div>
                </div>
            `;
            }).join('');
        }
    }

    // Comment form handler
    const commentForm = document.getElementById('playlistCommentForm');
    if (commentForm) {
        commentForm.onsubmit = async (e) => {
            e.preventDefault();
            const input = document.getElementById('playlistCommentInput');
            const text = input ? input.value.trim() : '';
            const userUID = parseInt(localStorage.getItem('userUID')) || 0;
            const username = localStorage.getItem('username') || 'User';
            if (userUID === 0) {
                showToast('Sign in to comment', true);
                return;
            }
            if (!text) return;
            try {
                await fetchJson(`/playlists/${activePlaylistId}/comments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userUID, username, text })
                });
                if (input) input.value = '';
                openPlaylistModal(activePlaylistId);
            } catch (err) {
                console.error('Comment error:', err);
                showToast('Failed to comment', true);
            }
        };
    }

    // Comment upvotes
    if (commentsList) {
        commentsList.querySelectorAll('.comment-vote-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const userUID = parseInt(localStorage.getItem('userUID')) || 0;
                if (userUID === 0) {
                    showToast('Sign in to vote', true);
                    return;
                }
                const commentId = btn.dataset.commentId;
                try {
                    await fetchJson(`/playlists/${activePlaylistId}/comments/${commentId}/vote`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userUID })
                    });
                    openPlaylistModal(activePlaylistId);
                } catch (err) {
                    console.error('Comment vote error:', err);
                    showToast('Unable to vote', true);
                }
            };
        });

        commentsList.querySelectorAll('.comment-delete-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const userUID = parseInt(localStorage.getItem('userUID')) || 0;
                if (userUID === 0) {
                    showToast('Sign in to delete', true);
                    return;
                }
                const commentId = btn.dataset.commentId;
                try {
                    await fetchJson(`/playlists/${activePlaylistId}/comments/${commentId}`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userUID })
                    });
                    openPlaylistModal(activePlaylistId);
                } catch (err) {
                    console.error('Comment delete error:', err);
                    showToast('Unable to delete comment', true);
                }
            };
        });
    }

    document.getElementById('playlistModal').classList.add('active');
}

async function fetchMoviesForPicker() {
    const params = new URLSearchParams({
        offset: moviePickerPage * moviePickerLimit,
        limit: moviePickerLimit,
        sort: 'rating_desc',
        year: 1930,
        genre: '',
        actor: '',
        director: ''
    });
    const source = window.getMovieSource ? window.getMovieSource() : 'local';
    const suffix = source === 'api' ? '&source=api&hydrate=1' : '';
    return fetchJson(`/movies/library?${params.toString()}${suffix}`);
}

async function renderMoviePicker(append = false) {
    const grid = document.getElementById('addMoviesGrid');
    if (!grid) return;
    if (!append) grid.innerHTML = '';

    const movies = await fetchMoviesForPicker();
    if (!movies || movies.length === 0) return;

    movies.forEach(movie => {
        const alreadyAdded = activePlaylistMovieIds.has(String(movie.ID));
        const card = document.createElement('div');
        card.className = 'grid-card';
        card.innerHTML = `
            <img src="${movie.poster_full_url}" onclick="window.location.href='movieInfo.html?id=${movie.ID}'">
            <div class="card-hover-info">
                <div class="hover-btns">
                    <button class="hover-add btn-add-to-playlist" data-movie-id="${movie.ID}" data-movie-title="${movie['Movie Name'].replace(/"/g, '&quot;')}" data-movie-genre="${(movie.Genre || '').replace(/"/g, '&quot;')}" ${alreadyAdded ? 'disabled' : ''}>${alreadyAdded ? 'Added' : 'Add to List'}</button>
                </div>
                <div class="info-text">
                    <h4>${movie['Movie Name']}</h4>
                    <span class="match-score">IMDb ${movie.Rating}</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    grid.querySelectorAll('.btn-add-to-playlist').forEach(b => b.onclick = async () => {
        if (!activePlaylistId) return;
        const movieId = b.dataset.movieId;
        const movieTitle = b.dataset.movieTitle || '';
        const img = b.closest('.grid-card')?.querySelector('img');
        const poster = img ? img.src : '';
        const genre = b.dataset.movieGenre || '';
        await addMovieToPlaylist(activePlaylistId, { movieId, movieTitle, poster, genre });
        showToast('Added to playlist');
        activePlaylistMovieIds.add(String(movieId));
        b.textContent = 'Added';
        b.disabled = true;
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function searchMoviesForPlaylist() {
    clearTimeout(playlistSearchTimeout);
    const query = document.getElementById('playlistSearchInput')?.value.trim();
    const container = document.getElementById('playlistSearchResults');
    if (!container) return;

    if (!query || query.length < 2) {
        container.innerHTML = '';
        container.classList.remove('active');
        return;
    }

    container.classList.add('active');
    container.innerHTML = '<div class="playlist-search-loading">Searching...</div>';

    playlistSearchTimeout = setTimeout(async () => {
        try {
            const movies = await fetchJson(`/search?q=${encodeURIComponent(query)}`);
            if (!movies || movies.length === 0) {
                container.innerHTML = '<div class="playlist-search-empty">No movies found</div>';
                return;
            }

            container.innerHTML = movies.slice(0, 8).map(movie => {
                const movieId = String(movie.ID);
                const exists = activePlaylistMovieIds.has(movieId);
                return `
                    <div class="playlist-search-item" data-movie-id="${movieId}" data-movie-title="${escapeHtml(movie['Movie Name'])}" data-movie-poster="${movie.poster_full_url || ''}" data-movie-genre="${escapeHtml(movie.Genre || '')}">
                        <img src="${movie.poster_full_url || '/img/LOGO_Short.png'}" alt="${escapeHtml(movie['Movie Name'])}" onerror="this.src='/img/LOGO_Short.png'">
                        <div class="playlist-search-info">
                            <h5>${escapeHtml(movie['Movie Name'])}</h5>
                            <p>${movie.Year || 'N/A'} • ${movie.Genre || 'Unknown'} • ⭐ ${movie.Rating || 'N/A'}</p>
                        </div>
                        <button class="playlist-search-add" ${exists ? 'disabled' : ''}>${exists ? 'Added' : 'Add'}</button>
                    </div>
                `;
            }).join('');

            container.querySelectorAll('.playlist-search-item').forEach(item => {
                const button = item.querySelector('.playlist-search-add');
                if (!button || button.disabled) return;
                button.onclick = async (e) => {
                    e.stopPropagation();
                    if (!activePlaylistId) return;
                    const movieId = item.dataset.movieId;
                    const movieTitle = item.dataset.movieTitle || '';
                    const poster = item.dataset.moviePoster || '';
                    const genre = item.dataset.movieGenre || '';
                    await addMovieToPlaylist(activePlaylistId, { movieId, movieTitle, poster, genre });
                    activePlaylistMovieIds.add(String(movieId));
                    button.textContent = 'Added';
                    button.disabled = true;
                    showToast('Added to playlist');
                };
            });
        } catch (error) {
            console.error('Playlist search error:', error);
            container.innerHTML = '<div class="playlist-search-empty">Search failed. Try again.</div>';
        }
    }, 300);
}

// Add current movie to playlist dialog (used on movieInfo page)
window.openAddToPlaylistDialog = async function() {
    const modal = document.getElementById('addToPlaylistModal');
    const list = document.getElementById('playlistPickerList');
    if (!modal || !list) return;

    const closeBtn = document.getElementById('closeAddToPlaylistModal');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');

    const userUID = parseInt(localStorage.getItem('userUID')) || 0;
    if (userUID === 0) {
        showToast('Sign in to add to playlist', true);
        return;
    }

    const pls = await fetchPlaylists();
    const owned = (pls || []).filter(p => parseInt(p.ownerUID, 10) === userUID);

    const movieId = (new URLSearchParams(window.location.search)).get('id');

    if (!owned || owned.length === 0) {
        list.innerHTML = '<p style="color:#777; padding:10px;">No playlists yet. Create one on the Playlists page.</p>';
    } else {
        list.innerHTML = owned.map(p => {
            const exists = (p.movies || []).some(m => String(m.movieId) === String(movieId));
            return `
            <div class="playlist-picker-item">
                <div class="playlist-picker-info">
                    <h4>${p.name}</h4>
                    <p>${p.desc || ''}</p>
                </div>
                <button class="apply-btn playlist-picker-add" data-id="${p.id}" ${exists ? 'disabled' : ''}>${exists ? 'Added' : 'Add'}</button>
            </div>
        `;
        }).join('');
    }

    modal.classList.add('active');

    list.querySelectorAll('.playlist-picker-add').forEach(btn => {
        btn.onclick = async () => {
            const playlistId = btn.dataset.id;
            const movieTitle = document.getElementById('title') ? document.getElementById('title').innerText : '';
            const poster = document.getElementById('posterImg') ? document.getElementById('posterImg').src : '';
            const genre = document.getElementById('genre') ? document.getElementById('genre').innerText : '';
            await addMovieToPlaylist(playlistId, { movieId, movieTitle, poster, genre });
            showToast('Added to playlist');
            modal.classList.remove('active');
        };
    });
};

// Init in playlists page
document.addEventListener('DOMContentLoaded', () => {
    const createBtn = document.getElementById('createPlaylistBtn');
    if (createBtn) {
        createBtn.onclick = () => {
            const modal = document.getElementById('createPlaylistModal');
            if (modal) modal.classList.add('active');
        };
    }

    const closeCreateBtn = document.getElementById('closeCreatePlaylistModal');
    if (closeCreateBtn) closeCreateBtn.onclick = () => document.getElementById('createPlaylistModal')?.classList.remove('active');

    const createForm = document.getElementById('createPlaylistForm');
    if (createForm) {
        createForm.onsubmit = async (e) => {
            e.preventDefault();
            const nameEl = document.getElementById('newPlaylistName');
            const descEl = document.getElementById('newPlaylistDesc');
            const name = nameEl.value && nameEl.value.trim();
            const desc = descEl ? descEl.value.trim() : '';
            if (!name) return showToast('Give your playlist a name', true);
            const res = await createPlaylist(name, desc);
            if (res && res.id) {
                nameEl.value = '';
                if (descEl) descEl.value = '';
                showToast('Playlist created');
                document.getElementById('createPlaylistModal')?.classList.remove('active');
                renderPlaylistsGrid();
            }
        };
    }

    // close modal
    const closeBtn = document.getElementById('closePlaylistModal');
    if (closeBtn) closeBtn.onclick = () => document.getElementById('playlistModal').classList.remove('active');

    const addMoreBtn = document.getElementById('addMoreToPlaylistBtn');
    if (addMoreBtn) addMoreBtn.onclick = async () => {
        moviePickerPage = 0;
        const grid = document.getElementById('addMoviesGrid');
        if (grid) {
            grid.innerHTML = '';
            grid.style.display = 'none';
        }
        const searchInput = document.getElementById('playlistSearchInput');
        const searchResults = document.getElementById('playlistSearchResults');
        if (searchInput) searchInput.value = '';
        if (searchResults) {
            searchResults.innerHTML = '';
            searchResults.classList.remove('active');
        }
        const loadMoreBtn = document.getElementById('loadMoreMoviesBtn');
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        document.getElementById('addMoviesModal').classList.add('active');
    };

    const closeAddMovies = document.getElementById('closeAddMoviesModal');
    if (closeAddMovies) closeAddMovies.onclick = () => {
        const modal = document.getElementById('addMoviesModal');
        if (modal) modal.classList.remove('active');
        const searchInput = document.getElementById('playlistSearchInput');
        const searchResults = document.getElementById('playlistSearchResults');
        if (searchInput) searchInput.value = '';
        if (searchResults) {
            searchResults.innerHTML = '';
            searchResults.classList.remove('active');
        }
        const grid = document.getElementById('addMoviesGrid');
        if (grid) {
            grid.innerHTML = '';
            grid.style.display = '';
        }
        const loadMoreBtn = document.getElementById('loadMoreMoviesBtn');
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    };

    const loadMoreBtn = document.getElementById('loadMoreMoviesBtn');
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';

    renderPlaylistsGrid();
});

