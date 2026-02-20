/* =========================================
   DISCUSSION FORUM JAVASCRIPT
   Handles movie discussions, threads, voting
   ========================================= */

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'https://localhost:3000'
    : window.location.origin;
let currentMovieId = null;
let currentThreadId = null;
let forumMovies = [];
let forumThreads = [];
let currentComments = [];
let pendingForumNav = null;
let threadDetailHome = null;
let pendingConfirmAction = null;

// Initialize forum on page load
document.addEventListener('DOMContentLoaded', async function() {
    await loadForumMovies();
    await handlePendingForumNav();

    const threadForm = document.getElementById('createThreadForm');
    if (threadForm) threadForm.addEventListener('submit', submitThread);

    const threadDetailModal = document.getElementById('threadDetailModal');
    if (threadDetailModal) {
        threadDetailHome = threadDetailModal.parentElement;
    }

    const commentInput = document.getElementById('commentInput');
    if (commentInput) {
        commentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitComment(e);
            }
        });
    }
});

// Load all movies that have discussion threads
async function loadForumMovies() {
    try {
        const response = await fetch(`${API_BASE}/forum/movies`);
        if (!response.ok) throw new Error('Failed to load forum movies');
        forumMovies = await response.json();
        renderMoviesList();
    } catch (error) {
        console.error('Error loading forum movies:', error);
        renderMoviesList(); 
    }
}

// Render movies list in sidebar
function renderMoviesList() {
    const container = document.getElementById('moviesList');
    if (!container) return;

    if (forumMovies.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">🎬</div>
                <p>No movies yet. Add one to start a discussion!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = forumMovies.map(movie => `
           <div class="movie-item ${currentMovieId === movie.movieId ? 'active' : ''}" 
               onclick="selectMovie('${movie.movieId}', '${escapeHtml(movie.movieTitle)}', event)">
            <img class="movie-item-poster" src="${movie.poster || '/img/LOGO_Short.png'}" alt="${escapeHtml(movie.movieTitle)}">
            <div class="movie-item-info">
                <h4>${escapeHtml(movie.movieTitle)}</h4>
                <p>${movie.threadCount || 0} threads</p>
            </div>
        </div>
    `).join('');
}

// Select a movie and load its threads
async function selectMovie(movieId, movieTitle, evt) {
    console.log('[Forum] selectMovie called for movieId:', movieId, 'movieTitle:', movieTitle);
    if (typeof closeThreadDetailModal === 'function') closeThreadDetailModal();
    currentMovieId = movieId;

    const titleEl = document.getElementById('currentMovieTitle');
    if (titleEl) {
        titleEl.textContent = movieTitle;
        titleEl.setAttribute('data-original-text', movieTitle);
        translateDynamicText(titleEl);
    }
    document.getElementById('currentMovieDesc').textContent = 'Discussion threads for this movie';
    document.getElementById('createThreadBtn').style.display = 'block';

    document.querySelectorAll('.movie-item').forEach(item => {
        item.classList.remove('active');
    });
    evt?.target?.closest('.movie-item')?.classList.add('active');

    await loadThreads(movieId);
}

// Load threads for a specific movie
async function loadThreads(movieId) {
    try {
        const response = await fetch(`${API_BASE}/forum/threads?movieId=${movieId}`);
        if (!response.ok) throw new Error('Failed to load threads');
        forumThreads = await response.json();
        renderThreads();
    } catch (error) {
        console.error('Error loading threads:', error);
        renderThreads(); 
    }
}

// Render threads list
function renderThreads() {
    const container = document.getElementById('threadsContainer');
    if (!container) return;

    if (forumThreads.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">💬</div>
                <h3>No discussions yet</h3>
                <p>Be the first to start a discussion about this movie!</p>
            </div>
        `;
        return;
    }

    const userUID = localStorage.getItem('userUID');
    container.innerHTML = forumThreads.map(thread => {
        const userVote = getUserVote(thread);
        const isOwner = userUID && String(thread.userUID) === String(userUID);
        return `
            <div class="thread-card" id="thread-${thread.id}" onclick="openThreadDetail('${thread.id}')">
                <div class="thread-votes-column">
                    <button type="button" class="vote-btn upvote ${userVote === 'up' ? 'active' : ''}" 
                            onclick="event.stopPropagation(); voteThreadInList('${thread.id}', 'up')">
                        <span>▲</span>
                    </button>
                    <span class="vote-score">${thread.score || 0}</span>
                    <button type="button" class="vote-btn downvote ${userVote === 'down' ? 'active' : ''}" 
                            onclick="event.stopPropagation(); voteThreadInList('${thread.id}', 'down')">
                        <span>▼</span>
                    </button>
                </div>
                <div class="thread-content">
                    <div class="thread-header">
                        ${thread.image ? `<img class="thread-thumbnail" src="${thread.image}" alt="Thread image">` : ''}
                        <div class="thread-info">
                            <h3 class="thread-title">${escapeHtml(thread.title)}</h3>
                            <p class="thread-meta">Posted by ${escapeHtml(thread.username)} • UID: ${thread.userUID}</p>
                        </div>
                        ${isOwner ? `
                            <button type="button" class="thread-delete-btn" onclick="event.stopPropagation(); requestDeleteThread('${thread.id}')">✕</button>
                        ` : ''}
                    </div>
                    <p class="thread-description">${escapeHtml(truncate(thread.description, 200))}</p>
                    <div class="thread-stats">
                        <span class="thread-stat">
                            💬 ${thread.commentCount || 0} comments
                        </span>
                        <span class="thread-stat">
                            📅 ${formatDate(thread.createdAt)}
                        </span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Get user's vote for a thread
function getUserVote(thread) {
    const userUID = localStorage.getItem('userUID');
    if (!userUID || !thread.voters) return null;
    return thread.voters[userUID] || null;
}

// Open add movie modal
function openAddMovieModal() {
    const userUID = localStorage.getItem('userUID');
    if (!userUID || userUID === '0') {
        showLimitToast('⚠️ Sign in to add movies to the forum!');
        return;
    }
    document.getElementById('addMovieModal').classList.add('active');
}

function closeAddMovieModal() {
    document.getElementById('addMovieModal').classList.remove('active');
    document.getElementById('movieSearchInput').value = '';
    document.getElementById('movieSearchResults').innerHTML = '';
}

// Search movies for forum with autocomplete dropdown
let searchTimeout;
async function searchMoviesForForum() {
    clearTimeout(searchTimeout);
    const query = document.getElementById('movieSearchInput').value.trim();
    const container = document.getElementById('movieSearchResults');
    
    if (query.length < 2) {
        container.innerHTML = '';
        container.classList.remove('active');
        return;
    }

    container.classList.add('active');
    container.innerHTML = `
        <div class="search-loading" style="padding: 15px; text-align: center; color: var(--text-muted);">
            Searching...
        </div>
    `;

    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Search failed');
            const movies = await response.json();
            
            if (movies.length === 0) {
                container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No movies found</div>';
                return;
            }

            container.innerHTML = movies.slice(0, 8).map(movie => `
                <div class="search-item-forum" onclick="selectMovieForForum(${movie.ID}, '${escapeHtml(movie['Movie Name'])}', '${movie.poster_full_url || ''}', '${escapeHtml(movie.Genre || '')}')">
                    <img src="${movie.poster_full_url || '/img/LOGO_Short.png'}" 
                         alt="${escapeHtml(movie['Movie Name'])}"
                        onerror="this.src='/img/LOGO_Short.png'"
                         style="width: 50px; height: 75px; object-fit: cover; border-radius: 4px;">
                    <div class="search-info-forum">
                        <h5 style="margin: 0; font-size: 0.95rem; color: var(--text-primary);">${escapeHtml(movie['Movie Name'])}</h5>
                        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-muted);">
                            ${movie.Year || 'N/A'} • ${movie.Genre || 'Unknown'} • ⭐ ${movie.Rating || 'N/A'}
                        </p>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error searching movies:', error);
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--error-color);">Search failed. Please try again.</div>';
        }
    }, 300);
}

// Select movie from dropdown and add to forum
async function selectMovieForForum(movieId, movieTitle, poster, genre) {
    const container = document.getElementById('movieSearchResults');
    container.classList.remove('active');
    container.innerHTML = '';
    
    document.getElementById('movieSearchInput').value = '';
    
    await addMovieToForum(movieId, movieTitle, poster, genre);
}

async function addMovieToForum(movieId, movieTitle, poster, genre) {
    try {
        const userUID = localStorage.getItem('userUID');
        const username = localStorage.getItem('username');

        const response = await fetch(`${API_BASE}/forum/movies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movieId: String(movieId),
                movieTitle,
                poster,
                genre,
                userUID: parseInt(userUID),
                username
            })
        });

        if (!response.ok) throw new Error('Failed to add movie');
        
        showLimitToast('✅ Movie added to forum!');
        closeAddMovieModal();
        await loadForumMovies();
    } catch (error) {
        console.error('Error adding movie:', error);
        showLimitToast('❌ Failed to add movie');
    }
}

function openCreateThreadModal() {
    const userUID = localStorage.getItem('userUID');
    if (!userUID || userUID === '0') {
        showLimitToast('⚠️ Sign in to create threads!');
        return;
    }
    if (!currentMovieId) {
        showLimitToast('⚠️ Select a movie first!');
        return;
    }
    document.getElementById('createThreadModal').classList.add('active');
}

function closeCreateThreadModal() {
    document.getElementById('createThreadModal').classList.remove('active');
    document.getElementById('createThreadForm').reset();
}

// Submit new thread
async function submitThread(event) {
    if (event) event.preventDefault();
    
    const title = document.getElementById('threadTitle').value.trim();
    const description = document.getElementById('threadDescription').value.trim();
    const image = document.getElementById('threadImage').value.trim();
    const userUID = localStorage.getItem('userUID');
    const username = localStorage.getItem('username');

    try {
        const response = await fetch(`${API_BASE}/forum/threads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movieId: currentMovieId,
                title,
                description,
                image,
                userUID: parseInt(userUID),
                username
            })
        });

        if (!response.ok) throw new Error('Failed to create thread');

        const newThread = await response.json();
        forumThreads.unshift({
            ...newThread,
            commentCount: 0
        });
        renderThreads();

        setPendingForumNav({
            movieId: currentMovieId,
            threadId: newThread.id,
            openThreadDetail: true
        });

        showLimitToast('✅ Thread created!');
        closeCreateThreadModal();
    } catch (error) {
        console.error('Error creating thread:', error);
        showLimitToast('❌ Failed to create thread');
    }
}

// Vote on thread from list
async function voteThreadInList(threadId, vote) {
    const result = await voteOnThread(threadId, vote);
    if (!result) return;

    updateThreadVoteState(threadId, vote, result.score);
    renderThreads();

    setPendingForumNav({
        movieId: currentMovieId,
        threadId,
        openThreadDetail: false
    });
}

// Open thread detail modal
async function openThreadDetail(threadId) {
    console.log('[Forum] openThreadDetail called for threadId:', threadId);
    currentThreadId = threadId;
    const thread = forumThreads.find(t => t.id === threadId);
    if (!thread) {
        console.warn('[Forum] openThreadDetail: thread not found for id', threadId);
        return;
    }

    const titleEl = document.getElementById('threadDetailTitle');
    if (titleEl) titleEl.textContent = thread.title;
    const authorEl = document.getElementById('threadDetailAuthor');
    if (authorEl) authorEl.textContent = `Posted by ${thread.username} • UID: ${thread.userUID}`;
    const descEl = document.getElementById('threadDetailDescription');
    if (descEl) descEl.textContent = thread.description;
    const scoreEl = document.getElementById('threadScore');
    if (scoreEl) scoreEl.textContent = thread.score || 0;

    const imageEl = document.getElementById('threadDetailImage');
    if (imageEl) {
        if (thread.image) {
            imageEl.src = thread.image;
            imageEl.style.display = 'block';
        } else {
            imageEl.style.display = 'none';
        }
    }

    const userVote = getUserVote(thread);
    document.querySelectorAll('#threadDetailModal .vote-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (userVote) {
        document.querySelector(`#threadDetailModal .vote-btn.${userVote}vote`)?.classList.add('active');
    }

    const userUID = localStorage.getItem('userUID');
    const deleteBtn = document.getElementById('threadDeleteBtn');
    if (deleteBtn) {
        deleteBtn.style.display = userUID && String(thread.userUID) === String(userUID) ? 'inline-flex' : 'none';
    }

    await loadComments(threadId);
    await scrollToPendingComment(threadId);

    const threadDetailModal = document.getElementById('threadDetailModal');
    const threadsContainer = document.getElementById('threadsContainer');

    if (threadDetailModal && threadsContainer) {
        threadsContainer.classList.add('show-detail');
        if (threadDetailModal.parentElement !== threadsContainer) {
            threadsContainer.appendChild(threadDetailModal);
        }
    }

    threadDetailModal?.classList.add('active');
}

function closeThreadDetailModal() {
    console.log('[Forum] closeThreadDetailModal called');
    const threadDetailModal = document.getElementById('threadDetailModal');
    const threadsContainer = document.getElementById('threadsContainer');

    threadDetailModal?.classList.remove('active');
    if (threadsContainer) {
        threadsContainer.classList.remove('show-detail');
    }
    if (threadDetailModal && threadDetailHome && threadDetailModal.parentElement !== threadDetailHome) {
        threadDetailHome.appendChild(threadDetailModal);
    }
    renderThreads();
    currentThreadId = null;
}

async function deleteThread(threadId) {
    const userUID = localStorage.getItem('userUID');
    if (!userUID || userUID === '0') {
        showLimitToast('⚠️ Sign in to delete threads!');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/forum/threads/${threadId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userUID: parseInt(userUID) })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            showLimitToast(`⚠️ ${error.error || 'Failed to delete thread'}`);
            return;
        }

        forumThreads = forumThreads.filter(t => String(t.id) !== String(threadId));
        renderThreads();

        if (currentThreadId === threadId) {
            closeThreadDetailModal();
        }

        showLimitToast('✅ Thread deleted!');
    } catch (error) {
        console.error('Error deleting thread:', error);
        showLimitToast('❌ Failed to delete thread');
    }
}

function requestDeleteThread(threadId) {
    openConfirmModal({
        title: 'Delete thread?',
        message: 'This will permanently remove the thread and its comments.',
        confirmText: 'Delete',
        onConfirm: () => deleteThread(threadId)
    });
}

function openConfirmModal({ title, message, confirmText, onConfirm }) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;

    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const confirmBtn = document.getElementById('confirmYesBtn');

    if (titleEl) titleEl.textContent = title || 'Are you sure?';
    if (messageEl) messageEl.textContent = message || 'This action cannot be undone.';
    if (confirmBtn) confirmBtn.textContent = confirmText || 'Confirm';

    pendingConfirmAction = typeof onConfirm === 'function' ? onConfirm : null;
    modal.classList.add('active');
}

function confirmModalProceed() {
    if (pendingConfirmAction) pendingConfirmAction();
    closeConfirmModal();
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    modal?.classList.remove('active');
    pendingConfirmAction = null;
}

// Load comments for a thread
async function loadComments(threadId) {
    console.log('[loadComments] Triggered for ID:', threadId);
    if (!threadId || threadId === "null") {
        console.warn('[loadComments] Aborted: threadId is null');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/forum/threads/${threadId}/comments`);
        if (!response.ok) throw new Error('Failed to load comments');
        const comments = await response.json();
        currentComments = comments;
        renderComments(comments);
    } catch (error) {
        console.error('Error loading comments:', error);
        currentComments = [];
        renderComments([]);
    }
}

// Render comments
function renderComments(comments) {
    const container = document.getElementById('threadComments');
    if (!container) return;

    if (comments.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No comments yet. Be the first!</p>';
        return;
    }

    const userUID = localStorage.getItem('userUID');
    container.innerHTML = comments.map(comment => {
        const hasUpvoted = comment.voters && comment.voters[userUID];
        const isOwner = userUID && String(comment.userUID) === String(userUID);
        return `
            <div class="comment-item" id="comment-${comment.id}" data-comment-id="${comment.id}">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(comment.username)}</span>
                    <span class="comment-meta">UID: ${comment.userUID} • ${formatDate(comment.createdAt)}</span>
                </div>
                <p class="comment-text">${escapeHtml(comment.text)}</p>
                <div class="comment-actions">
                    <button type="button" class="comment-upvote ${hasUpvoted ? 'active' : ''}" 
                        onclick="upvoteComment('${comment.id}')">
                        <span>▲</span>
                        <span>${comment.upvotes || 0}</span>
                    </button>
                    ${isOwner ? `<button type="button" class="comment-delete-btn" title="Delete comment" onclick="deleteComment('${comment.id}')">🗑</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Delete comment (only for owner)
window.deleteComment = async function deleteComment(commentId) {
    const userUID = localStorage.getItem('userUID');
    if (!userUID || userUID === '0') {
        showLimitToast('⚠️ Sign in to delete!');
        return;
    }
    // Find the comment to check ownership
    const comment = currentComments.find(c => String(c.id) === String(commentId));
    if (!comment || String(comment.userUID) !== String(userUID)) {
        showLimitToast('❌ You can only delete your own comment!');
        return;
    }
    // Show custom confirmation modal
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = 'Delete Comment?';
    document.getElementById('confirmMessage').textContent = 'This will permanently remove your comment.';
    pendingConfirmAction = async function() {
        try {
            const response = await fetch(`${API_BASE}/forum/threads/${currentThreadId}/comments/${commentId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userUID: parseInt(userUID) })
            });
            if (!response.ok) throw new Error('Failed to delete comment');
            showLimitToast('✅ Comment deleted!');
            await loadComments(currentThreadId);
        } catch (error) {
            console.error('Error deleting comment:', error);
            showLimitToast('❌ Failed to delete comment');
        }
    };
    modal.classList.add('active');
}

// Vote on thread
async function voteThread(vote) {
    const result = await voteOnThread(currentThreadId, vote);
    if (!result) return;

    updateThreadVoteState(currentThreadId, vote, result.score);
    updateThreadDetailVoteUI(currentThreadId, vote, result.score);

    setPendingForumNav({
        movieId: currentMovieId,
        threadId: currentThreadId,
        openThreadDetail: true
    });
}

// Vote on thread (shared function)
async function voteOnThread(threadId, vote) {
    const userUID = localStorage.getItem('userUID');
    if (!userUID || userUID === '0') {
        showLimitToast('⚠️ Sign in to vote!');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/forum/threads/${threadId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userUID: parseInt(userUID),
                vote
            })
        });

        if (!response.ok) {
            const error = await response.json();
            showLimitToast(`⚠️ ${error.error}`);
            return;
        }

        const result = await response.json();
        showLimitToast('✅ Vote recorded!');
        return result;
    } catch (error) {
        console.error('Error voting:', error);
        showLimitToast('❌ Failed to vote');
    }
    return null;
}

// Submit comment
async function submitComment(event) {
    console.log('--- SUBMIT COMMENT START ---');
    if (event) event.preventDefault();
    const commentInput = document.getElementById('commentInput');
    const text = commentInput?.value.trim();
    const userUID = localStorage.getItem('userUID');
    const username = localStorage.getItem('username');

    console.log('[Debug] currentThreadId:', currentThreadId);
    console.log('[Debug] text:', text);
    console.log('[Debug] userUID:', userUID);

    if (!currentThreadId || currentThreadId === "null") {
        console.error('❌ ERROR: currentThreadId is missing!');
        showLimitToast('❌ Error: Thread context lost. Please reopen the thread.');
        return;
    }

    if (!userUID || userUID === '0') {
        showLimitToast('⚠️ Sign in to comment!');
        return;
    }

    try {
        console.log(`[Network] Posting to: ${API_BASE}/forum/threads/${currentThreadId}/comments`);
        const response = await fetch(`${API_BASE}/forum/threads/${currentThreadId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userUID: parseInt(userUID),
                username,
                text
            })
        });

        if (!response.ok) throw new Error('Failed to post comment');

        if (typeof closeThreadDetailModal === 'function') closeThreadDetailModal();

        localStorage.setItem('pendingForumNav', JSON.stringify({
            movieId: currentMovieId,
            threadId: currentThreadId,
            openThreadDetail: true
        }));
        console.log('[Forum] submitComment: set pendingForumNav, closed modal, and reloading');
        window.location.reload();
    } catch (error) {
        console.error('--- SUBMIT COMMENT ERROR ---');
        console.error(error);
        showLimitToast('❌ Failed to post comment');
    }
}

// Upvote comment
async function upvoteComment(commentId) {
    const userUID = localStorage.getItem('userUID');
    if (!userUID || userUID === '0') {
        showLimitToast('⚠️ Sign in to upvote!');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/forum/threads/${currentThreadId}/comments/${commentId}/upvote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userUID: parseInt(userUID)
            })
        });

        if (!response.ok) {
            const error = await response.json();
            showLimitToast(`⚠️ ${error.error}`);
            return;
        }

        const result = await response.json();
        const target = currentComments.find(c => String(c.id) === String(commentId));
        if (target) {
            target.upvotes = result.upvotes;
            if (!target.voters) target.voters = {};
            target.voters[String(userUID)] = true;
        }
        renderComments(currentComments);

        showLimitToast('✅ Upvoted!');

        setPendingForumNav({
            movieId: currentMovieId,
            threadId: currentThreadId,
            commentId,
            openThreadDetail: true
        });
    } catch (error) {
        console.error('Error upvoting:', error);
        showLimitToast('❌ Failed to upvote');
    }
}

function updateThreadVoteState(threadId, vote, score) {
    const userUID = localStorage.getItem('userUID');
    const thread = forumThreads.find(t => t.id === threadId);
    if (!thread) return;

    thread.score = score;
    if (!thread.voters) thread.voters = {};
    if (userUID) thread.voters[String(userUID)] = vote;

    forumThreads.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function updateThreadDetailVoteUI(threadId, vote, score) {
    if (currentThreadId !== threadId) return;
    document.getElementById('threadScore').textContent = score || 0;

    document.querySelectorAll('#threadDetailModal .vote-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`#threadDetailModal .vote-btn.${vote}vote`)?.classList.add('active');
}

async function translateDynamicText(element) {
    if (!element || typeof window.translateText !== 'function') return;
    const userLang = localStorage.getItem('userLanguage') || 'en';
    if (userLang === 'en') return;

    const originalText = element.getAttribute('data-original-text') || element.textContent;
    try {
        const targetLang = window.translator
            ? window.translator.normalizeTargetLanguage(userLang)
            : userLang.toUpperCase();
        const translated = await window.translateText(originalText, targetLang);
        element.textContent = translated;
    } catch (err) {
        console.error('Dynamic translation failed:', err);
    }
}
// i feel nothing but pain when i see this code but it works so who am i to judge
async function handlePendingForumNav() {
    const stored = localStorage.getItem('pendingForumNav');
    if (!stored) return;

    try {
        pendingForumNav = JSON.parse(stored);
    } catch (err) {
        localStorage.removeItem('pendingForumNav');
        pendingForumNav = null;
        return;
    }

    console.log('[Forum] handlePendingForumNav: loaded pendingForumNav:', pendingForumNav);
    const movie = forumMovies.find(m => String(m.movieId) === String(pendingForumNav.movieId));
    const movieTitle = movie?.movieTitle || 'Discussion threads';

    await selectMovie(pendingForumNav.movieId, movieTitle);

    if (pendingForumNav && pendingForumNav.threadId && pendingForumNav.openThreadDetail) {
        console.log('[Forum] handlePendingForumNav: auto-opening thread', pendingForumNav.threadId);
        await openThreadDetail(pendingForumNav.threadId);
        localStorage.removeItem('pendingForumNav');
        pendingForumNav = null;
        return;
    }

    if (pendingForumNav && pendingForumNav.threadId) {
        console.log('[Forum] handlePendingForumNav: scrolling to thread', pendingForumNav.threadId);
        scrollToThreadCard(pendingForumNav.threadId);
        localStorage.removeItem('pendingForumNav');
        pendingForumNav = null;
    }
}

async function scrollToPendingComment(threadId) {
    if (!pendingForumNav || String(pendingForumNav.threadId) !== String(threadId)) return;
    if (!pendingForumNav.commentId) return;

    const commentEl = document.getElementById(`comment-${pendingForumNav.commentId}`);
    if (commentEl) {
        commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    localStorage.removeItem('pendingForumNav');
    pendingForumNav = null;
}

function scrollToThreadCard(threadId) {
    const threadEl = document.getElementById(`thread-${threadId}`);
    if (threadEl) {
        threadEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function setPendingForumNav(payload) {
    try {
        localStorage.setItem('pendingForumNav', JSON.stringify(payload));
    } catch (err) {
        // ignoreee
    }
}

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncate(text, length) {
    if (!text) return '';
    return text.length > length ? text.substring(0, length) + '...' : text;
}

function formatDate(dateString) {
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

// Toast notification function (if not already defined)
function showLimitToast(message) {
    if (window.showLimitToast) {
        window.showLimitToast(message);
    } else {
        alert(message);
    }
}
