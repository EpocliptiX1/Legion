/* Redesigned footer: category quick-links into the anime library, friends list,
   and the three feedback modals (Report a Bug / Request Anime / Contact Us). */
(function () {
    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;');
    }

    // ── Footer category quick-links -> allMovies.html anime library ───────────
    document.getElementById('footerCategories')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.footer-cat-btn');
        if (!btn) return;
        // Mirrors window.__toggleAnimeMode's pattern: set the flag before navigating
        // so animePage.js's synchronous top-of-file check picks it up on load.
        localStorage.setItem('animeMode', 'true');
        const params = new URLSearchParams();
        if (btn.dataset.animeTag) params.set('animeTag', btn.dataset.animeTag);
        if (btn.dataset.animeSort) params.set('animeSort', btn.dataset.animeSort);
        window.location.href = `/html/allMovies.html?${params.toString()}`;
    });

    // ── Friends list ────────────────────────────────────────────────────────
    async function loadFooterFriends() {
        const container = document.getElementById('footerFriendsList');
        if (!container) return;
        const token = localStorage.getItem('authToken');
        if (!token) {
            container.innerHTML = '<p class="footer-friends-empty">Sign in to see your friends.</p>';
            return;
        }
        try {
            const res = await fetch('/users/friends', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.status === 401) {
                // authToken is a 7-day JWT (JWT_EXPIRES_IN in server.js) with no refresh flow -
                // a 401 here just means it's expired or was issued for an account that no longer
                // exists, not a real failure. Clear it and show the same "sign in" message the
                // no-token case above already uses, instead of a scary generic error - and drop
                // the stale token so every OTHER authToken-gated feature on the page (My List
                // sync, watch2gether, etc.) stops silently 401ing on it too.
                localStorage.removeItem('authToken');
                container.innerHTML = '<p class="footer-friends-empty">Sign in to see your friends.</p>';
                return;
            }
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            const friends = data.friends || [];
            if (!friends.length) {
                container.innerHTML = '<p class="footer-friends-empty">No friends added yet.</p>';
                return;
            }
            // Online first, then alphabetical within each group.
            friends.sort((a, b) => (b.online - a.online) || a.username.localeCompare(b.username));
            container.innerHTML = friends.map(f => {
                const avatarStyle = f.profilePic ? `background-image:url('${escapeHtml(f.profilePic)}')` : '';
                return `<span class="footer-friend-chip ${f.online ? 'online' : 'offline'}" title="${f.online ? 'Online' : 'Offline'}">
                    <span class="footer-friend-avatar" style="${avatarStyle}"><span class="footer-friend-status-dot"></span></span>
                    ${escapeHtml(f.username)}
                </span>`;
            }).join('');
        } catch (err) {
            console.error('[Footer] Failed to load friends:', err);
            container.innerHTML = '<p class="footer-friends-empty">Could not load friends, re-log in required</p>';
        }
    }
    loadFooterFriends();

    // ── Modal open/close (reuses .settings-modal-overlay/.active from settings modal) ──
    window.closeFooterModal = function (id) {
        document.getElementById(id)?.classList.remove('active');
    };
    function openFooterModal(id) {
        document.getElementById(id)?.classList.add('active');
    }
    // Exposed so other scripts on the page (e.g. moviePlayer.js's "Report a Problem" button)
    // can open a footer modal without duplicating this one-line classList toggle themselves.
    window.openFooterModal = openFooterModal;
    document.addEventListener('mousedown', (e) => {
        ['footerReportBugModal', 'footerRequestAnimeModal', 'footerContactModal'].forEach(id => {
            if (e.target.id === id) window.closeFooterModal(id);
        });
    });

    document.getElementById('footerReportBugLink')?.addEventListener('click', () => openFooterModal('footerReportBugModal'));
    document.getElementById('footerRequestAnimeLink')?.addEventListener('click', () => openFooterModal('footerRequestAnimeModal'));
    document.getElementById('footerContactLink')?.addEventListener('click', () => openFooterModal('footerContactModal'));

    // ── Category toggle buttons (General/Specific, No Source/Not Found) ───────
    function wireCategoryToggle(containerId, sectionsByValue) {
        const container = document.getElementById(containerId);
        if (!container) return { get: () => null };
        let current = container.querySelector('.footer-form-category-btn.active')?.dataset.value || null;
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.footer-form-category-btn');
            if (!btn) return;
            container.querySelectorAll('.footer-form-category-btn').forEach(b => b.classList.toggle('active', b === btn));
            current = btn.dataset.value;
            Object.entries(sectionsByValue).forEach(([value, el]) => {
                if (el) el.style.display = (value === current) ? '' : 'none';
            });
        });
        return { get: () => current };
    }

    const bugCategory = wireCategoryToggle('bugCategoryToggle', {
        specific: document.getElementById('bugMediaSection')
    });
    const requestCategory = wireCategoryToggle('requestCategoryToggle', {
        no_source: document.getElementById('requestNoSourceSection'),
        not_found: document.getElementById('requestNotFoundSection')
    });

    // ── Shared media search-and-select widget ──────────────────────────────
    // Searches TMDB multi-search, and for whichever result gets picked, tries to
    // resolve a MAL/AniList id off the back of its TMDB id -- if that lookup 404s
    // (a live-action title, not in AniList at all) the anime-id fields are just
    // left blank rather than erroring, since not every reported title is anime.
    function setupMediaPicker({ inputId, resultsId, selectedId, selectedImgId, selectedTitleId, clearId, onSelect }) {
        const input = document.getElementById(inputId);
        const results = document.getElementById(resultsId);
        const selected = document.getElementById(selectedId);
        const selectedImg = document.getElementById(selectedImgId);
        const selectedTitle = document.getElementById(selectedTitleId);
        const clearBtn = document.getElementById(clearId);
        if (!input || !results) return;

        let searchTimer = null;

        input.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const query = input.value.trim();
            if (query.length < 2) {
                results.innerHTML = '';
                results.classList.remove('active');
                return;
            }
            searchTimer = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/tmdb-proxy/search/multi?query=${encodeURIComponent(query)}&language=en-US`);
                    if (!res.ok) throw new Error(String(res.status));
                    const data = await res.json();
                    const items = (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 8);
                    if (!items.length) {
                        results.innerHTML = '<div class="footer-media-picker-item">No results</div>';
                        results.classList.add('active');
                        return;
                    }
                    results.innerHTML = items.map((item, idx) => {
                        const title = escapeHtml(item.title || item.name || 'Unknown');
                        const year = (item.release_date || item.first_air_date || '').slice(0, 4);
                        const img = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : '/img/LOGO_Short.svg';
                        return `<div class="footer-media-picker-item" data-idx="${idx}">
                            <img src="${img}" alt="">
                            <div class="footer-media-picker-item-info">${title}${year ? ` (${year})` : ''} · ${item.media_type === 'tv' ? 'TV' : 'Movie'}</div>
                        </div>`;
                    }).join('');
                    results.classList.add('active');

                    results.querySelectorAll('.footer-media-picker-item[data-idx]').forEach(el => {
                        el.addEventListener('click', async () => {
                            const item = items[Number(el.dataset.idx)];
                            results.classList.remove('active');
                            input.value = '';

                            // Try both movies and TV -- anime films have TMDB movie entries too,
                            // so gating this to media_type 'tv' only was silently skipping every
                            // anime movie. /api/anime-mal-id already checks Fribb's mapping list,
                            // then the anime_tmdb_mapping cache, then falls back to a live AniList
                            // title search -- a 404 here just means it's genuinely live-action.
                            let malId = null, anilistId = null;
                            try {
                                const idRes = await fetch(`/api/anime-mal-id?tmdbId=${item.id}&season=1`);
                                if (idRes.ok) {
                                    const idData = await idRes.json();
                                    malId = idData.mal_id || null;
                                    anilistId = idData.anilist_id || null;
                                }
                            } catch (_) { /* not anime, or lookup failed -- leave blank */ }

                            const title = item.title || item.name || 'Unknown';
                            const img = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : '/img/LOGO_Short.svg';
                            if (selected && selectedImg && selectedTitle) {
                                selectedImg.src = img;
                                selectedTitle.textContent = title;
                                selected.classList.add('active');
                            }

                            onSelect({ tmdbId: item.id, mediaType: item.media_type, title, malId, anilistId });
                        });
                    });
                } catch (err) {
                    console.error('[Footer] Media search failed:', err);
                    results.innerHTML = '<div class="footer-media-picker-item">Search failed</div>';
                    results.classList.add('active');
                }
            }, 300);
        });

        clearBtn?.addEventListener('click', () => {
            selected?.classList.remove('active');
            onSelect(null);
        });
    }

    // Report a Bug: media picker fills the manual ID fields, which stay editable.
    setupMediaPicker({
        inputId: 'bugMediaSearchInput', resultsId: 'bugMediaSearchResults',
        selectedId: 'bugMediaSelected', selectedImgId: 'bugMediaSelectedImg', selectedTitleId: 'bugMediaSelectedTitle',
        clearId: 'bugMediaSelectedClear',
        onSelect: (media) => {
            document.getElementById('bugTmdbId').value = media ? media.tmdbId : '';
            document.getElementById('bugMalId').value = media ? (media.malId || '') : '';
            document.getElementById('bugAnilistId').value = media ? (media.anilistId || '') : '';
        }
    });

    // Request Anime (No Watch Source): same idea.
    setupMediaPicker({
        inputId: 'requestMediaSearchInput', resultsId: 'requestMediaSearchResults',
        selectedId: 'requestMediaSelected', selectedImgId: 'requestMediaSelectedImg', selectedTitleId: 'requestMediaSelectedTitle',
        clearId: 'requestMediaSelectedClear',
        onSelect: (media) => {
            document.getElementById('requestTmdbId').value = media ? media.tmdbId : '';
            document.getElementById('requestMalId').value = media ? (media.malId || '') : '';
            document.getElementById('requestAnilistId').value = media ? (media.anilistId || '') : '';
        }
    });

    // ── Manually-typed TMDB/MAL/AniList id -> auto-fill the other two ─────────
    // Whichever single id the user types (searching isn't the only way in), resolve
    // it server-side (Fribb's mapping list, then the anime_tmdb_mapping cache, then a
    // live AniList lookup as a last resort) and fill the rest plus the media preview,
    // same as picking a title from search would.
    function wireManualIdResolution({ tmdbInputId, malInputId, anilistInputId, selectedId, selectedImgId, selectedTitleId }) {
        const tmdbInput = document.getElementById(tmdbInputId);
        const malInput = document.getElementById(malInputId);
        const anilistInput = document.getElementById(anilistInputId);
        const selected = document.getElementById(selectedId);
        const selectedImg = document.getElementById(selectedImgId);
        const selectedTitle = document.getElementById(selectedTitleId);
        if (!tmdbInput || !malInput || !anilistInput) return;

        async function resolveFromCurrentInputs() {
            const tmdbId = tmdbInput.value.trim();
            const malId = malInput.value.trim();
            const anilistId = anilistInput.value.trim();
            if (!tmdbId && !malId && !anilistId) return;

            const params = new URLSearchParams();
            if (tmdbId) params.set('tmdbId', tmdbId);
            if (malId) params.set('malId', malId);
            if (anilistId) params.set('anilistId', anilistId);

            try {
                const res = await fetch(`/api/footer/resolve-media?${params.toString()}`);
                if (!res.ok) return;
                const data = await res.json();

                if (data.tmdbId) tmdbInput.value = data.tmdbId;
                if (data.malId) malInput.value = data.malId;
                if (data.anilistId) anilistInput.value = data.anilistId;

                if (selected && selectedImg && selectedTitle && data.title) {
                    selectedImg.src = data.poster ? `https://image.tmdb.org/t/p/w92${data.poster}` : '/img/LOGO_Short.svg';
                    selectedTitle.textContent = data.title;
                    selected.classList.add('active');
                }
            } catch (err) {
                console.error('[Footer] Manual ID resolution failed:', err);
            }
        }

        [tmdbInput, malInput, anilistInput].forEach(input => {
            input.addEventListener('change', resolveFromCurrentInputs);
        });
    }

    wireManualIdResolution({
        tmdbInputId: 'bugTmdbId', malInputId: 'bugMalId', anilistInputId: 'bugAnilistId',
        selectedId: 'bugMediaSelected', selectedImgId: 'bugMediaSelectedImg', selectedTitleId: 'bugMediaSelectedTitle'
    });
    wireManualIdResolution({
        tmdbInputId: 'requestTmdbId', malInputId: 'requestMalId', anilistInputId: 'requestAnilistId',
        selectedId: 'requestMediaSelected', selectedImgId: 'requestMediaSelectedImg', selectedTitleId: 'requestMediaSelectedTitle'
    });

    // ── Submissions ─────────────────────────────────────────────────────────
    function setStatus(elId, text, ok) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.textContent = text;
        el.className = `footer-form-status ${ok ? 'success' : 'error'}`;
    }

    async function submitFooterForm(endpoint, body, statusElId, submitBtnId, onSuccess) {
        const btn = document.getElementById(submitBtnId);
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
            setStatus(statusElId, 'Thanks -- your submission was sent.', true);
            if (onSuccess) onSuccess();
        } catch (err) {
            setStatus(statusElId, err.message || 'Something went wrong. Try again.', false);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function currentUser() {
        const userUID = localStorage.getItem('userUID');
        return { userUID: userUID ? parseInt(userUID, 10) : null, username: localStorage.getItem('username') || null };
    }

    document.getElementById('bugSubmitBtn')?.addEventListener('click', () => {
        const category = bugCategory.get() || 'general';
        const message = document.getElementById('bugMessage').value.trim();
        if (!message) return setStatus('bugFormStatus', 'Please describe the issue.', false);

        const { userUID, username } = currentUser();
        submitFooterForm('/api/footer/report-bug', {
            category,
            tmdbId: document.getElementById('bugTmdbId').value.trim() || null,
            malId: document.getElementById('bugMalId').value.trim() || null,
            anilistId: document.getElementById('bugAnilistId').value.trim() || null,
            mediaTitle: document.getElementById('bugMediaSelectedTitle').textContent || null,
            message, userUID, username
        }, 'bugFormStatus', 'bugSubmitBtn', () => {
            document.getElementById('bugMessage').value = '';
        });
    });

    document.getElementById('requestSubmitBtn')?.addEventListener('click', () => {
        const category = requestCategory.get() || 'no_source';
        const { userUID, username } = currentUser();

        let payload;
        if (category === 'not_found') {
            const title = document.getElementById('requestTitleInput').value.trim();
            if (!title) return setStatus('requestFormStatus', 'Please enter a title.', false);
            payload = {
                category, title,
                malId: document.getElementById('requestFallbackMalId').value.trim() || null,
                anilistId: document.getElementById('requestFallbackAnilistId').value.trim() || null,
                tmdbId: null
            };
        } else {
            const tmdbId = document.getElementById('requestTmdbId').value.trim();
            const malId = document.getElementById('requestMalId').value.trim();
            const anilistId = document.getElementById('requestAnilistId').value.trim();
            if (!tmdbId && !malId && !anilistId) {
                return setStatus('requestFormStatus', 'Search for the anime or enter an ID.', false);
            }
            payload = { category, tmdbId: tmdbId || null, malId: malId || null, anilistId: anilistId || null, title: document.getElementById('requestMediaSelectedTitle').textContent || null };
        }
        payload.message = document.getElementById('requestMessage').value.trim();
        payload.userUID = userUID;
        payload.username = username;

        submitFooterForm('/api/footer/request-anime', payload, 'requestFormStatus', 'requestSubmitBtn', () => {
            document.getElementById('requestMessage').value = '';
        });
    });

    document.getElementById('contactSubmitBtn')?.addEventListener('click', () => {
        const name = document.getElementById('contactName').value.trim();
        const email = document.getElementById('contactEmail').value.trim();
        const subject = document.getElementById('contactSubject').value;
        const message = document.getElementById('contactMessage').value.trim();
        if (!name || !email || !subject || !message) {
            return setStatus('contactFormStatus', 'Please fill in every field.', false);
        }
        const { userUID, username } = currentUser();
        submitFooterForm('/api/footer/contact', { name, email, subject, message, userUID, username }, 'contactFormStatus', 'contactSubmitBtn', () => {
            document.getElementById('contactName').value = '';
            document.getElementById('contactEmail').value = '';
            document.getElementById('contactSubject').value = '';
            document.getElementById('contactMessage').value = '';
        });
    });
})();
