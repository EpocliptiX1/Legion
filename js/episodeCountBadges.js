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

    // A cold grid can have 250+ unique shows across all rows (confirmed live: indexBrowse's
    // IntersectionObserver rootMargin is generous enough that most/all 15 rows end up loading
    // within the first couple seconds, not just the 3 "eager" ones), each needing its own multi-
    // hop fetch chain (malId lookup + TMDB details + anikoto-episode-counts) - that's 750+
    // requests flooding the browser's ~6-connections-per-origin limit (HTTP/1.1; the HTTP/2
    // upgrade that would remove this cap was tried and reverted, see middleware.js), stuck
    // fighting the hero's own trailer/recommendation fetches for a slot (mitigated separately via
    // fetch priority hints below).
    //
    // This is a GLOBAL semaphore, not a per-call limit - mountEpisodeCountBadges gets invoked
    // once per MutationObserver batch (see setupAutoMount below), i.e. roughly once per row as
    // each one renders, NOT once for the whole page. A per-call concurrency cap would only limit
    // chains within a single row's own batch, doing nothing to stop 15 rows landing close
    // together from each spinning up their own independent pool (15 rows x 8 = 120 concurrent
    // chains again, right back where this started).
    const BADGE_FETCH_CONCURRENCY = 8;
    let activeBadgeChains = 0;
    const badgeChainQueue = [];

    function runBadgeChainGloballyLimited(task) {
        return new Promise((resolve) => {
            const run = async () => {
                activeBadgeChains++;
                try {
                    await task();
                } finally {
                    activeBadgeChains--;
                    const next = badgeChainQueue.shift();
                    if (next) next();
                    resolve();
                }
            };
            if (activeBadgeChains < BADGE_FETCH_CONCURRENCY) run();
            else badgeChainQueue.push(run);
        });
    }

    function escapeAttr(value) {
        return String(value || '').replace(/"/g, '&quot;');
    }

    function badgeKey({ type, title, tmdbId }) {
        if (type === 'movie') return 'movie';
        if (type === 'tv') return `tv:${tmdbId}`;
        // Title-only (no tmdbId) used to be the ONLY key for anime cards - fine when every card
        // on a page really is the same show, but two DIFFERENT shows that happen to render the
        // same title text (a franchise's main TV entry and a movie/spinoff both just called
        // "One Piece", for instance) silently shared one cached result, with whichever card's
        // fetch resolved first winning for both. movieInfo.html only ever renders one card, so
        // this collision could never show up there - only on pages with many cards at once
        // (confirmed live: indexMain showing a wrong, unrelated count for a title that resolved
        // correctly on its own page). Real tmdbId is a genuinely unique key here and always wins
        // when it's known; the title-only fallback is only for the rare card that hasn't resolved
        // a tmdbId yet at render time (e.g. lazy "Because You Watched" cards).
        // Season number folded into the key too - TMDB routinely keeps every season of a
        // franchise under ONE tmdb_id instead of splitting into separate show entries
        // (confirmed live throughout this session: Re:ZERO, Saga of Tanya the Evil, Attack on
        // Titan all do this). Without it, a row like "Kaiju" that renders several season-cards
        // of the same franchise back to back (AoT Season 2, Final Season, Final Season Part 2 -
        // all tmdb_id 1429) collapsed onto ONE shared key, so mountEpisodeCountBadges grouped
        // them into a single fetch that only ever used whichever card's title happened to be
        // first in the group - the other cards in that group never got their own fetch at all,
        // which is exactly what an unfilled/never-loading badge looks like.
        const numericTmdbId = Number(tmdbId);
        if (Number.isFinite(numericTmdbId) && numericTmdbId > 0) return `anime:${numericTmdbId}:s${extractSeasonNumber(title)}`;
        return `anime:${String(title || '').toLowerCase().trim()}`;
    }

    // Heroicons outline "chat-bubble-left" (sub) and "microphone" (dub) - swapped in for
    // the FontAwesome icons per the exact SVGs specified.
    const SUB_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>';
    const DUB_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>';

    function buildEpisodeCountBadgesHtml(counts, inline) {
        if (!counts) return '';
        // Genuinely hasn't released yet (movie with a future release_date, or a TV show whose
        // first_air_date is still ahead) - showing 0s/empty badges here used to look identical to
        // "we just couldn't find this title", which isn't true and isn't useful. One explicit
        // label instead.
        if (counts.upcoming) {
            const cls = inline ? 'card-episode-badges inline' : 'card-episode-badges';
            // toLocaleDateString with no locale arg uses the viewer's own browser locale/timezone -
            // date-only formatting (no time-of-day) since TMDB's air dates are day-precision anyway.
            const dateLabel = counts.releaseDate
                ? new Date(counts.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                : null;
            const label = dateLabel ? `Upcoming: ${dateLabel}` : 'Upcoming';
            return `<span class="${cls}"><span class="ep-badge ep-badge-upcoming" title="Not yet released">${label}</span></span>`;
        }
        const parts = [];
        if (Number.isFinite(counts.sub)) {
            parts.push(`<span class="ep-badge ep-badge-sub" title="Sub episodes">${SUB_ICON_SVG}${counts.sub}</span>`);
        }
        if (Number.isFinite(counts.dub) && counts.dub > 0) {
            parts.push(`<span class="ep-badge ep-badge-dub" title="Dub episodes">${DUB_ICON_SVG}${counts.dub}</span>`);
        } else if (Number.isFinite(counts.ruDub) && counts.ruDub > 0) {
            // No real (English) dub, but animego.me (a Russian site) has one - shown as an
            // explicit fallback, styled blue instead of the normal red specifically so it never
            // reads as a real English dub count (see ru_dub_count's migration comment in
            // server.js for the full story on why these are tracked separately at all).
            parts.push(`<span class="ep-badge ep-badge-dub-ru" title="No English dub found - Russian dub episodes shown instead">${DUB_ICON_SVG}${counts.ruDub}</span>`);
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
        const realSeasons = seasons.filter(s => s.season_number >= 1);
        const released = realSeasons.filter(s => s.air_date && new Date(s.air_date).getTime() <= now);
        const firstAirDate = tmdbData?.first_air_date;
        const hasStartedAiring = firstAirDate && new Date(firstAirDate).getTime() <= now;

        // Sparse per-season air-date coverage - confirmed live: One Piece has usable air_date
        // data for only 5 of its 23 real TMDB seasons - means summing "released" below would
        // badly UNDERcount (401 instead of the real ~1181). That's a different failure mode than
        // the one this function exists to catch (a single not-yet-aired season inflating
        // number_of_episodes, see the comment above) - it's TMDB's own per-season metadata being
        // incomplete for a long-running show, not "one season hasn't aired yet". Below a 50%
        // coverage threshold, number_of_episodes (occasional single-season overcount and all) is
        // still a far better estimate than a sum built from under half the real seasons.
        const coverage = realSeasons.length ? released.length / realSeasons.length : 0;
        if (released.length && coverage >= 0.5) {
            return released.reduce((acc, s) => acc + (Number.isFinite(s.episode_count) ? s.episode_count : 0), 0) || null;
        }
        // No usable per-season air-date data, or too sparse to trust - fall back to the raw
        // total only if the show has definitely started airing overall (top-level first_air_date
        // already in the past), so a brand-new, completely unreleased show still doesn't get a
        // misleading "N episodes" badge either way.
        return hasStartedAiring && Number.isFinite(tmdbData?.number_of_episodes) ? tmdbData.number_of_episodes : null;
    }

    // 1 season, 1 problem (server.js pivoted the whole native-counts backend to this same
    // scoping after cross-season summing kept producing unstable, hard-to-predict results - see
    // that file's comments on findMegaplayDubTotalAcrossSeasons' removal). The anime path's
    // malId is always season 1's own id (see /api/anime-mal-id's &season=1 below), so `total`
    // needs to match that exact scope too - the whole-franchise computeReleasedTmdbEpisodeTotal
    // above made a fully-subbed season 1 look "half done" next to a combined multi-season total
    // (confirmed live: Code Geass R1, genuinely 25/25 complete, read as 25/50 - half-finished -
    // against the franchise's real 50-episode total). Only used for the anime path; the plain
    // 'tv' badge below still wants the whole series' total, so it keeps using the function above.
    // A show gets special-cased here when TMDB has split it into an unusual number of its own
    // "seasons" - confirmed live: One Piece has 23 real TMDB seasons, each one a story arc
    // ("East Blue", "Alabasta", ...), and season 1 alone ("East Blue") has a real, correct
    // episode_count of 61 - showing that as the badge's total isn't a bug, it's exactly what "1
    // season, 1 problem" is supposed to do, but for a show fragmented this many ways it reads as
    // badly broken (61 next to a franchise everyone knows has 1000+ episodes) rather than just
    // "showing one season". A normal multi-cour anime (Code Geass, Mushoku Tensei, SAO) never
    // clears this - they max out around 2-5 real TMDB seasons.
    const MANY_SEASONS_THRESHOLD = 8;

    // Card titles carry the real season number as text ("... Season 4", "...3rd Season", or a
    // trailing roman numeral like "... II") - the only signal available here for which season a
    // card is actually about, since nothing upstream threads a real season number through.
    // Defaults to 1 (the overwhelmingly common case: a show with no season suffix at all really
    // is just season 1).
    const ROMAN_SEASON_MAP = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    function extractSeasonNumber(title) {
        if (!title) return 1;
        const t = String(title);
        const wordMatch = t.match(/\bSeason\s+(\d+)\b/i) || t.match(/\b(\d+)(?:st|nd|rd|th)\s+Season\b/i);
        if (wordMatch) {
            const n = parseInt(wordMatch[1], 10);
            if (Number.isFinite(n) && n > 0) return n;
        }
        const romanMatch = t.match(/[:\-–]\s*(II|III|IV|V|VI|VII|VIII|IX|X)\s*$/i);
        if (romanMatch) {
            const n = ROMAN_SEASON_MAP[romanMatch[1].toLowerCase()];
            if (n) return n;
        }
        return 1;
    }

    function computeSeasonOneEpisodeTotal(tmdbData, seasonNumber) {
        const targetSeason = Number.isFinite(seasonNumber) && seasonNumber > 0 ? seasonNumber : 1;
        const seasons = Array.isArray(tmdbData?.seasons) ? tmdbData.seasons : [];
        const now = Date.now();
        const realSeasonCount = seasons.filter(s => s.season_number >= 1).length;
        const seasonEntry = realSeasonCount <= MANY_SEASONS_THRESHOLD ? seasons.find(s => s.season_number === targetSeason) : null;
        if (seasonEntry && Number.isFinite(seasonEntry.episode_count) && seasonEntry.episode_count > 0) {
            // This season itself hasn't aired yet - no released total to show at all.
            if (seasonEntry.air_date && new Date(seasonEntry.air_date).getTime() > now) return null;
            return seasonEntry.episode_count;
        }
        // TMDB doesn't have this season split out at all - common for a just-announced/airing
        // sequel TMDB hasn't caught up on yet, or (confirmed live) a franchise TMDB never splits
        // by cour at all: Re:ZERO's TMDB entry lists ONE combined "Season 1" of 85 episodes
        // covering everything through what fans call "Season 4" - falling back to the whole-show
        // total here would cap a "Season 4" badge's total at that unrelated 85, not this season's
        // real count. Only safe to use the whole-show fallback when we were actually looking for
        // season 1 (a genuinely single-season show, nothing to conflate) - for season 2+, return
        // null and let the raw provider (anikoto/KAA) total pass through uncapped instead.
        if (targetSeason > 1) return null;
        const firstAirDate = tmdbData?.first_air_date;
        const hasStartedAiring = firstAirDate && new Date(firstAirDate).getTime() <= now;
        return hasStartedAiring && Number.isFinite(tmdbData?.number_of_episodes) ? tmdbData.number_of_episodes : null;
    }

    function fetchAnikotoCounts(title, altTitles, numberOfSeasons, malId, tmdbTotal, tmdbId, upcomingDate, seasonNumber) {
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
        // malId lets the backend's native lookup probe MegaPlay directly by MAL id for a dub
        // backfill (KAA itself just doesn't carry many dubs). tmdbTotal is our own already-
        // computed released-episode total - the backend uses it as the authoritative `total`
        // over whatever KAA/animego added up to on their own, since a provider's own per-
        // episode numbering can have gaps/quirks TMDB's total doesn't. tmdbId (alongside
        // numberOfSeasons) lets the dub backfill probe MegaPlay under EACH season's own MAL id
        // instead of just the one malId above - MegaPlay numbers episodes per season, so a
        // multi-season show's dub coverage past season 1 is invisible without this.
        const malIdParam = Number.isFinite(malId) ? `&malId=${malId}` : '';
        const tmdbTotalParam = Number.isFinite(tmdbTotal) && tmdbTotal > 0 ? `&tmdbTotal=${tmdbTotal}` : '';
        // tmdbId comes from a DOM dataset attribute at the call site (mountEpisodeCountBadges),
        // which is always a string even for numeric ids - Number.isFinite() on a raw string is
        // ALWAYS false (it doesn't coerce), so this silently never sent tmdbId to the backend at
        // all until fixed. Confirmed live: every row in native_episode_counts had tmdb_id NULL,
        // meaning every card-based badge fetch (grids, movieInfo, everywhere) was falling back to
        // the collision-prone title-only cache key instead of the real tmdbId one.
        const numericTmdbId = Number(tmdbId);
        const tmdbIdParam = Number.isFinite(numericTmdbId) && numericTmdbId > 0 ? `&tmdbId=${numericTmdbId}` : '';
        // Already computed by the caller (from the SAME tmdbDetailsPromise fetch, no extra
        // request) - only ever used server-side as a fallback label when the native lookup finds
        // nothing at all, never overrides a real result. Cached alongside the row so "Upcoming"
        // survives a cache hit instead of only showing on the one call that computed it live.
        const upcomingDateParam = upcomingDate ? `&upcomingDate=${encodeURIComponent(upcomingDate)}` : '';
        // The real season this card is about (see extractSeasonNumber's comment) - required
        // server-side for the cache row to be a real, unique identity when tmdbId is known.
        // Confirmed live this was the actual bug behind the Kaiju row: Attack on Titan Season 2,
        // Final Season, and an OVA card all share ONE tmdb_id, and without season in the cache
        // key too, the backend was collapsing all of them onto a single row - whichever season's
        // request happened to write last silently won for every other season's badge as well.
        const seasonParam = Number.isFinite(seasonNumber) && seasonNumber > 0 ? `&season=${seasonNumber}` : '';
        return fetch(`/api/anikoto-episode-counts?title=${encodeURIComponent(title)}${altParam}${seasonsParam}${malIdParam}${tmdbTotalParam}${tmdbIdParam}${upcomingDateParam}${seasonParam}`, { priority: 'low' })
            .then(res => {
                if (!res.ok) {
                    console.warn('[EpisodeBadges] anikoto lookup HTTP error', { title, status: res.status });
                    return null;
                }
                return res.json();
            })
            .then(data => {
                if (data?.upcoming) return { upcoming: true, releaseDate: data.releaseDate };
                if (data?.ok) return { sub: data.sub, dub: data.dub, total: data.total, ruDub: data.ruDub };
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
    async function fetchAnikotoCountsWithFallback(title, altTitles, numberOfSeasons, malId, tmdbTotal, tmdbId, upcomingDate, seasonNumber) {
        const primary = await fetchAnikotoCounts(title, altTitles, numberOfSeasons, malId, tmdbTotal, tmdbId, upcomingDate, seasonNumber);
        if (primary) return primary;
        for (const alt of (altTitles || [])) {
            if (!alt || alt === title) continue;
            const result = await fetchAnikotoCounts(alt, altTitles, numberOfSeasons, malId, tmdbTotal, tmdbId, upcomingDate, seasonNumber);
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
            promise = !tmdbId ? Promise.resolve(null) : fetch(`/api/tmdb-proxy/tv/${encodeURIComponent(tmdbId)}`, { priority: 'low' })
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
            // TMDB movie ids and TV ids are separate numbering spaces that happen to overlap
            // numerically - an anime MOVIE routed through this 'anime' badge type with its own
            // movie-namespace tmdbId can collide with a totally unrelated TV show at that same
            // number (confirmed live: Ghost in the Shell's real movie id, fetched as /tv/, comes
            // back as some unrelated 1992 drama miniseries). Japanese origin is the gate, NOT the
            // Animation genre tag - genre turned out unreliable both ways: Popeye the Sailor (US)
            // IS genuinely tagged Animation, while Devils' Crest (a real, correctly-matched
            // upcoming anime, confirmed live) is tagged only Action & Adventure / Sci-Fi &
            // Fantasy with no Animation id at all - requiring it rejected a real match and sent
            // it into the movie-fallback branch below, which then ALSO collided (id 328010's
            // movie-namespace entry is an unrelated 2015 Serbian documentary) and confidently
            // returned a wrong 1/1/1. Origin alone correctly separates both real cases.
            const tmdbDetailsPromise = !tmdbId ? Promise.resolve(null) : fetch(`/api/tmdb-proxy/tv/${encodeURIComponent(tmdbId)}`)
                .then(res => res.ok ? res.json() : null)
                .then(data => {
                    if (!data) return null;
                    const isJapaneseOrigin = data.original_language === 'ja' ||
                        (Array.isArray(data.origin_country) && data.origin_country.includes('JP'));
                    return isJapaneseOrigin ? data : null;
                })
                .catch(() => null);

            // The real season this card is about - see extractSeasonNumber's comment. Everything
            // below (malId lookup, TMDB total) needs to stay scoped to this SAME season, or the
            // two end up describing two different seasons of the same franchise (confirmed live:
            // a hardcoded season=1 here resolved "Saga of Tanya the Evil Season 2"'s malId to
            // Season 1's own MAL id, so the MegaPlay dub probe checked Season 1's dub coverage
            // instead of Season 2's).
            const seasonNumber = extractSeasonNumber(title);

            // malId lets the backend's native lookup (KAA + RU-MV/animego + MegaPlay dub-
            // backfill, see server.js) probe MegaPlay directly - resolved the same way
            // movieLoading.js already does elsewhere on this page. Best-effort: a badge still
            // renders fine without it, just skips that one backfill step.
            const malIdPromise = !tmdbId ? Promise.resolve(null) : fetch(`/api/anime-mal-id?tmdbId=${encodeURIComponent(tmdbId)}&season=${seasonNumber}`, { priority: 'low' })
                .then(res => res.ok ? res.json() : null)
                .then(data => Number.isFinite(data?.mal_id) ? data.mal_id : null)
                .catch(() => null);

            // Deliberately sequential (TMDB/malId first, then anikoto) rather than parallel: the
            // anikoto request wants TMDB's season count and malId as parameters, so it can't
            // fire until those are known. Costs one extra hop, but badges are async placeholders
            // that fill in after render, so nothing user-visible blocks on it - and the TMDB
            // call hits our own proxy, not the public API.
            promise = Promise.all([tmdbDetailsPromise, malIdPromise])
                .then(async ([tmdbData, malId]) => {
                    const seasonCount = Number.isFinite(tmdbData?.number_of_seasons) ? tmdbData.number_of_seasons : undefined;
                    // This season's own RELEASED total (not TMDB's raw number_of_episodes, which
                    // can be inflated by an announced-but-unaired season, AND not the whole
                    // franchise's total - see computeSeasonOneEpisodeTotal above for why this
                    // has to match malId's own scope) is what the backend uses as its
                    // authoritative `total` ceiling, since a provider's own per-episode
                    // numbering can have gaps/quirks a season-level TMDB count doesn't
                    // (confirmed live: Tower of God's real total is 39, but KAA's own episode
                    // list for one cour had 15 entries instead of 13 due to a numbering
                    // artifact on their end). No outer "?? whole-show total" fallback here on
                    // purpose - computeSeasonOneEpisodeTotal already returns null instead of a
                    // wrong number when season 2+ isn't split out on TMDB at all.
                    const tmdbTotal = computeSeasonOneEpisodeTotal(tmdbData, seasonNumber);
                    const now = Date.now();
                    // The SEASON-specific air_date when we have one, not tmdbData's own
                    // first_air_date (that's always season 1's launch date - showing it on a
                    // "Season 2" card that hasn't aired yet would display the wrong, years-old
                    // date instead of the actual upcoming one). Computed BEFORE the anikoto call
                    // (free - already have tmdbData) and sent along with it, so the backend can
                    // cache "Upcoming: <date>" directly instead of only ever answering it here on
                    // this one call.
                    const seasonEntry = Array.isArray(tmdbData?.seasons) ? tmdbData.seasons.find(s => s.season_number === seasonNumber) : null;
                    const seasonAirDate = seasonEntry?.air_date || tmdbData?.first_air_date;
                    const upcomingDate = seasonAirDate && new Date(seasonAirDate).getTime() > now ? seasonAirDate : null;

                    const nativeResult = await fetchAnikotoCountsWithFallback(title, altTitles, seasonCount, malId, tmdbTotal, tmdbId, upcomingDate, seasonNumber);
                    if (nativeResult?.upcoming) return nativeResult;
                    // Requires sub AND total specifically (not just "any field") - dub alone
                    // being null is normal (plenty of shows have no dub at all), but a missing
                    // total is exactly the movie symptom below: anikoto lists a movie as its own
                    // entry with sub:1/dub:1 but a blank total field (confirmed live: Ghost in
                    // the Shell, Princess Mononoke, Akira all come back this way) - a partial
                    // "1/1/blank" result isn't more trustworthy than the clean 1/1/1 the TMDB
                    // movie check below gives, so it's worth the extra request to get it right.
                    if (nativeResult && Number.isFinite(nativeResult.sub) && Number.isFinite(nativeResult.total)) {
                        return nativeResult;
                    }

                    // Nothing complete from anikoto/KAA/animego/MegaPlay, and the backend didn't
                    // have/use the upcomingDate signal above (e.g. a first cold lookup racing
                    // ahead of the cache write) - three real reasons this happens that aren't
                    // "couldn't find it" and shouldn't render as empty badges or a wrong-looking
                    // number: (1) a TV show that genuinely hasn't started airing yet, (2) an
                    // anime MOVIE, which every provider above tracks by sub/dub EPISODE markers a
                    // movie just doesn't have a real one of, or (3) anikoto listing the movie
                    // itself but leaving its total field blank.
                    if (upcomingDate) {
                        return { upcoming: true, releaseDate: upcomingDate };
                    }
                    if (!Array.isArray(tmdbData?.seasons) || !tmdbData.seasons.length) {
                        // This tmdbId has no real TV season data at all - try it as a movie
                        // instead (anime films render through this same 'anime' badge type, not
                        // the plain 'movie' one, since callers don't always know in advance).
                        // Same namespace-collision risk as the TV fetch above applies here too -
                        // confirmed live: Devils' Crest's movie-namespace id 328010 is an
                        // unrelated 2015 Serbian documentary ("The Loop"), which this trusted
                        // outright before the origin check was added, confidently returning a
                        // wrong 1/1/1 for a show that hadn't even aired yet.
                        try {
                            const movieRes = await fetch(`/api/tmdb-proxy/movie/${encodeURIComponent(tmdbId)}`, { priority: 'low' });
                            const movieData = movieRes.ok ? await movieRes.json() : null;
                            const movieIsJapanese = movieData?.original_language === 'ja';
                            if (movieData?.id && movieData.release_date && movieIsJapanese) {
                                if (new Date(movieData.release_date).getTime() > now) {
                                    return { upcoming: true, releaseDate: movieData.release_date };
                                }
                                return { sub: 1, dub: 1, total: 1 };
                            }
                        } catch (e) { /* not a movie either, or the proxy failed - fall through */ }
                    }

                    // Last resort: fall back to TMDB's own episode count, same as a plain 'tv'
                    // badge would use. dub is left null (not guessed) - TMDB doesn't track dub
                    // availability at all.
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

        await Promise.all(Array.from(byKey.values()).map(els => runBadgeChainGloballyLimited(async () => {
            const { badgeType: type, badgeTitle: title, badgeTmdbid: tmdbId, badgeAltTitles } = els[0].dataset;
            let altTitles = [];
            if (badgeAltTitles) {
                try { altTitles = JSON.parse(badgeAltTitles); } catch (e) { altTitles = []; }
            }
            const counts = await fetchCountsFor({ type, title, tmdbId, altTitles });
            els.forEach(el => {
                const inline = el.dataset.badgeInline === '1';
                // Badges sit position:absolute over the poster corner (see .card-episode-badges
                // in style.css), so they're out of normal flow and never affect the card's own
                // width on their own - a wide combined sub/dub/total (confirmed live: One Piece's
                // 1174/1155/1181) can visually overflow a fixed-width card's edges as a result.
                // Captured before the outerHTML swap below, since `el` itself gets detached and
                // this ancestor reference would otherwise go stale with it.
                const card = !inline ? el.closest('.grid-card, .disc-card, .disc-card-schedule') : null;
                const html = buildEpisodeCountBadgesHtml(counts, inline);
                if (html) el.outerHTML = html;
                else el.remove();

                // Widens just THIS card (not the whole row/grid) only when its own badges
                // genuinely don't fit - simpler and less disruptive than resizing every card for
                // the rare few titles with unusually large numbers. Deferred a frame so the
                // outerHTML swap above has actually landed and can be measured.
                if (card && html) {
                    requestAnimationFrame(() => {
                        const badgeEl = card.querySelector('.card-episode-badges');
                        if (!badgeEl) return;
                        // The star-rating badge (top-left) and these episode badges (top-right)
                        // are BOTH position:absolute, anchored from opposite corners with no
                        // collision awareness of each other - checking the episode badges' own
                        // width against the card's full width missed the actual failure mode
                        // entirely (confirmed live: neither badge alone exceeds the card's width,
                        // they just collide into each other in the middle once both are wide
                        // enough - One Piece's rating badge + its 1174/1155/1181 episode badges
                        // together need more room than either one checked alone would show).
                        const ratingEl = card.querySelector('.card-rating-badge');
                        const ratingWidth = ratingEl ? ratingEl.scrollWidth : 0;
                        const needed = ratingWidth + badgeEl.scrollWidth + 24; // 8px left inset + 8px right inset + 8px breathing room between them
                        if (needed > card.clientWidth) {
                            card.style.flex = `0 0 ${needed}px`;
                            card.style.width = `${needed}px`;
                        }
                    });
                }
            });
        })));
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
