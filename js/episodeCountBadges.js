// Shared "CC 13 / mic 13 / 13" episode-count badges (same idea as anikoto.cz's own browse
// grid badges) - used by every card renderer across the site (animePage.js, mainPageControls.js,
// indexmainGetManager.js, calendarPage.js, movieInfo detail page) so there's one implementation
// instead of duplicating this per file.
//
// Card grids render synchronously as HTML strings (container.innerHTML = cards.map(...).join('')),
// but the actual counts require a network call (anikoto scrape for anime, a TMDB details fetch
// for TV, nothing for movies). So renderers emit a placeholder span via
// buildEpisodeCountBadgesPlaceholder(), then call mountEpisodeCountBadges() once after the grid
// is in the DOM to fill them in - this never blocks or delays the initial render.
(function () {
    'use strict';

    const badgeCountCache = new Map(); // badgeKey -> Promise<{sub,dub,total}|null>

    function escapeAttr(value) {
        return String(value || '').replace(/"/g, '&quot;');
    }

    function badgeKey({ type, title, tmdbId }) {
        if (type === 'movie') return 'movie';
        if (type === 'tv') return `tv:${tmdbId}`;
        return `anime:${String(title || '').toLowerCase().trim()}`;
    }

    // Heroicons outline "chat-bubble-left" (sub) and "microphone" (dub) - swapped in for
    // the FontAwesome icons per the exact SVGs specified.
    const SUB_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>';
    const DUB_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>';

    function buildEpisodeCountBadgesHtml(counts, inline) {
        if (!counts) return '';
        const parts = [];
        if (Number.isFinite(counts.sub)) {
            parts.push(`<span class="ep-badge ep-badge-sub" title="Sub episodes">${SUB_ICON_SVG}${counts.sub}</span>`);
        }
        if (Number.isFinite(counts.dub)) {
            parts.push(`<span class="ep-badge ep-badge-dub" title="Dub episodes">${DUB_ICON_SVG}${counts.dub}</span>`);
        }
        if (Number.isFinite(counts.total)) {
            parts.push(`<span class="ep-badge ep-badge-total" title="Total episodes">${counts.total}</span>`);
        }
        const cls = inline ? 'card-episode-badges inline' : 'card-episode-badges';
        return parts.length ? `<span class="${cls}">${parts.join('')}</span>` : '';
    }

    // TMDB's own number_of_episodes can be inflated by a season that hasn't aired yet -
    // confirmed live on "The Detective Is Already Dead": TMDB already lists a Season 2 with
    // episode_count:1 and air_date:null (nothing has actually released), pushing the show's
    // aggregate number_of_episodes from the real 12 up to a misleading 13. Recomputing from
    // the already-fetched seasons array - summing only seasons whose air_date has actually
    // passed - gives the real "episodes released so far" total without an extra request.
    function computeReleasedTmdbEpisodeTotal(tmdbData) {
        const seasons = Array.isArray(tmdbData?.seasons) ? tmdbData.seasons : [];
        const now = Date.now();
        const released = seasons.filter(s => s.season_number >= 1 && s.air_date && new Date(s.air_date).getTime() <= now);
        if (released.length) {
            return released.reduce((acc, s) => acc + (Number.isFinite(s.episode_count) ? s.episode_count : 0), 0) || null;
        }
        // No usable per-season air-date data (sparse TMDB data, not necessarily unreleased) -
        // fall back to the raw total only if the show has definitely started airing overall
        // (top-level first_air_date already in the past), so a brand-new, completely
        // unreleased show still doesn't get a misleading "N episodes" badge either way.
        const firstAirDate = tmdbData?.first_air_date;
        const hasStartedAiring = firstAirDate && new Date(firstAirDate).getTime() <= now;
        return hasStartedAiring && Number.isFinite(tmdbData?.number_of_episodes) ? tmdbData.number_of_episodes : null;
    }

    function fetchAnikotoCounts(title, altTitles, numberOfSeasons) {
        if (!title) return Promise.resolve(null);
        // altTitles rides along even on this primary-title call (not just the alt-title
        // retries below) - the backend's animego dub-backfill needs them too, for shows
        // where animego's own search only has a romaji-style secondary title that the
        // English query alone won't match.
        const altParam = Array.isArray(altTitles) && altTitles.length
            ? `&altTitles=${encodeURIComponent(JSON.stringify(altTitles))}`
            : '';
        // TMDB's season count for this title (already fetched below for the episode-total
        // logic, so this is free) - the backend records it alongside the cached counts, and
        // a later increase is what tells it a "finished" show actually got a sequel season
        // and needs re-scraping, instead of sitting on stale numbers until its long TTL runs
        // out. Omitted entirely when unknown, so the backend just falls back to that TTL.
        const seasonsParam = Number.isFinite(numberOfSeasons)
            ? `&numberOfSeasons=${numberOfSeasons}`
            : '';
        return fetch(`/api/anikoto-episode-counts?title=${encodeURIComponent(title)}${altParam}${seasonsParam}`)
            .then(res => {
                if (!res.ok) {
                    console.warn('[EpisodeBadges] anikoto lookup HTTP error', { title, status: res.status });
                    return null;
                }
                return res.json();
            })
            .then(data => {
                if (data?.ok) return { sub: data.sub, dub: data.dub, total: data.total };
                console.debug('[EpisodeBadges] anikoto lookup found no match', { title, data });
                return null;
            })
            .catch(err => {
                console.warn('[EpisodeBadges] anikoto lookup fetch failed', { title, error: err.message || String(err) });
                return null;
            });
    }

    // Tries each alt title in turn, in order, stopping at the first one that resolves to
    // real counts. Sequential (not Promise.all) on purpose - most titles match on the
    // first try, so firing every alt title in parallel would usually just be wasted
    // anikoto requests for the common case.
    async function fetchAnikotoCountsWithFallback(title, altTitles, numberOfSeasons) {
        const primary = await fetchAnikotoCounts(title, altTitles, numberOfSeasons);
        if (primary) return primary;
        for (const alt of (altTitles || [])) {
            if (!alt || alt === title) continue;
            const result = await fetchAnikotoCounts(alt, altTitles, numberOfSeasons);
            if (result) return result;
        }
        if (title) console.warn('[EpisodeBadges] no match for title or any alt title', { title, altTitles });
        return null;
    }

    // type: 'anime' | 'tv' | 'movie'. title only matters for anime (anikoto lookup key);
    // tmdbId only matters for tv (episode count lookup key). altTitles: anime only - extra
    // title variants (e.g. AniList's romaji/native forms) tried in order if the primary
    // title doesn't resolve, for shows anikoto only lists under a non-English name.
    // inline: true renders the badges in normal document flow (e.g. a calendar list row)
    // instead of overlaid on a poster's corner (the default, for grid-card style poster grids).
    function buildEpisodeCountBadgesPlaceholder({ type, title, tmdbId, altTitles, inline }) {
        if (!type) return '';
        const key = badgeKey({ type, title, tmdbId });
        const cls = inline ? 'card-episode-badges inline' : 'card-episode-badges';
        const altTitlesJson = Array.isArray(altTitles) && altTitles.length
            ? JSON.stringify(altTitles.filter(Boolean))
            : '';
        return `<span class="${cls}" data-episode-badge
            data-badge-type="${escapeAttr(type)}"
            data-badge-title="${escapeAttr(title || '')}"
            data-badge-tmdbid="${escapeAttr(tmdbId || '')}"
            data-badge-key="${escapeAttr(key)}"
            data-badge-inline="${inline ? '1' : ''}"
            data-badge-alt-titles="${escapeAttr(altTitlesJson)}"></span>`;
    }

    function fetchCountsFor({ type, title, tmdbId, altTitles }) {
        const key = badgeKey({ type, title, tmdbId });
        if (badgeCountCache.has(key)) return badgeCountCache.get(key);

        let promise;
        if (type === 'movie') {
            // Movies are always "1 episode" in every slot - nothing to fetch.
            promise = Promise.resolve({ sub: 1, dub: 1, total: 1 });
        } else if (type === 'tv') {
            // Regular (non-anime) TV has no sub/dub distinction on our side - all three
            // slots just show the show's total episode count, so the badge still reads
            // consistently across anime and non-anime cards.
            promise = !tmdbId ? Promise.resolve(null) : fetch(`/api/tmdb-proxy/tv/${encodeURIComponent(tmdbId)}`)
                .then(res => res.ok ? res.json() : null)
                .then(data => {
                    const n = computeReleasedTmdbEpisodeTotal(data) ?? data?.number_of_episodes;
                    return Number.isFinite(n) ? { sub: n, dub: n, total: n } : null;
                })
                .catch(() => null);
        } else {
            // TMDB groups some multi-season anime under one show id (e.g. "Love, Chunibyo &
            // Other Delusions!" totals 24 episodes across two 12-episode seasons), but
            // anikoto lists each season as its own separate entry - so anikoto's match can
            // legitimately be for just ONE season while tmdbId represents the whole show.
            // Fetching both in parallel lets that be caught below instead of confidently
            // showing a single season's count on a franchise-level card. (Tried summing each
            // season's own anikoto entry for a fuller fix - reverted, see server.js's
            // /api/anikoto-episode-counts comment for why that wasn't reliable.)
            const tmdbDetailsPromise = !tmdbId ? Promise.resolve(null) : fetch(`/api/tmdb-proxy/tv/${encodeURIComponent(tmdbId)}`)
                .then(res => res.ok ? res.json() : null)
                .catch(() => null);

            // Deliberately sequential (TMDB first, then anikoto) rather than parallel: the
            // anikoto request wants TMDB's season count as a parameter, so it can't fire until
            // that's known. Costs one extra hop, but badges are async placeholders that fill in
            // after render, so nothing user-visible blocks on it - and the TMDB call hits our
            // own proxy, not the public API.
            promise = tmdbDetailsPromise
                .then(async (tmdbData) => {
                    const seasonCount = Number.isFinite(tmdbData?.number_of_seasons) ? tmdbData.number_of_seasons : undefined;
                    const anikotoResult = await fetchAnikotoCountsWithFallback(title, altTitles, seasonCount);
                    const tmdbTotal = Number.isFinite(tmdbData?.number_of_episodes) ? tmdbData.number_of_episodes : null;
                    // anikoto's total covers less than TMDB's combined total for this id AND
                    // TMDB confirms this id actually spans 2+ seasons - only then is a lower
                    // anikoto total actual evidence of a partial-season match, not just an
                    // ongoing show correctly showing fewer released episodes than TMDB's
                    // already-known full season order (confirmed live: a single-season,
                    // still-airing show had anikoto/animego correctly reporting "7 released",
                    // while TMDB already listed all 12 planned episodes in advance - without
                    // this season-count gate, that got wrongly overridden to a stale "12").
                    // dub is left null (not guessed) same as the below no-match fallback -
                    // TMDB doesn't track dub availability at all.
                    const isMultiSeasonId = Number.isFinite(tmdbData?.number_of_seasons) && tmdbData.number_of_seasons >= 2;
                    if (anikotoResult && Number.isFinite(anikotoResult.total) && Number.isFinite(tmdbTotal) &&
                        anikotoResult.total < tmdbTotal && isMultiSeasonId) {
                        return { sub: tmdbTotal, dub: null, total: tmdbTotal };
                    }
                    if (anikotoResult) return anikotoResult;
                    // Last resort when neither anikoto nor its animego backfill found
                    // anything at all: fall back to TMDB's own episode count, same as a
                    // plain 'tv' badge would use.
                    return Number.isFinite(tmdbTotal) ? { sub: tmdbTotal, dub: null, total: tmdbTotal } : null;
                });
        }

        badgeCountCache.set(key, promise);
        return promise;
    }

    async function mountEpisodeCountBadges(root) {
        const scope = root || document;
        const nodes = Array.from(scope.querySelectorAll('[data-episode-badge]'));
        if (!nodes.length) return;

        // Group by key first so N identical cards (same show in two different rows) only
        // trigger one network request between them.
        const byKey = new Map();
        nodes.forEach(node => {
            const key = node.getAttribute('data-badge-key');
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(node);
        });

        await Promise.all(Array.from(byKey.values()).map(async (els) => {
            const { badgeType: type, badgeTitle: title, badgeTmdbid: tmdbId, badgeAltTitles } = els[0].dataset;
            let altTitles = [];
            if (badgeAltTitles) {
                try { altTitles = JSON.parse(badgeAltTitles); } catch (e) { altTitles = []; }
            }
            const counts = await fetchCountsFor({ type, title, tmdbId, altTitles });
            els.forEach(el => {
                const html = buildEpisodeCountBadgesHtml(counts, el.dataset.badgeInline === '1');
                if (html) el.outerHTML = html;
                else el.remove();
            });
        }));
    }

    window.buildEpisodeCountBadgesPlaceholder = buildEpisodeCountBadgesPlaceholder;
    window.mountEpisodeCountBadges = mountEpisodeCountBadges;

    // Explicit mountEpisodeCountBadges() calls after each render site are easy to miss -
    // this codebase has dozens of scattered card-rendering call sites across several files,
    // and manually chasing every one of them is exactly the kind of thing that silently
    // rots the first time a new row/grid gets added. A DOMobserver picks up ANY placeholder
    // that lands anywhere in the page, regardless of which function put it there, so this
    // stays correct without needing to be re-wired every time a new render path shows up.
    // The explicit calls elsewhere stay too - they're not wrong, just no longer load-bearing.
    function setupAutoMount() {
        if (!('MutationObserver' in window)) return;
        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                mountEpisodeCountBadges(document);
            });
        });
        const start = () => observer.observe(document.body, { childList: true, subtree: true });
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start);
    }
    setupAutoMount();
})();
