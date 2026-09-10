# AniList-down fallback plan — what to scrape / call instead

**Context:** `graphql.anilist.co` returns `403 "The AniList API has been temporarily
disabled due to severe stability issues."` to datacenter-classified IPs (the production
server, and — via IP-reputation misclassification / Kaspersky VPN — the dev machine too).
Residential IPs still work. AniList themselves say this may last a long time. Jikan is NOT
an option (dead for us, that's why we left it).

The app is keyed on **TMDB id ↔ MAL id ↔ AniList id**, joined by the Fribb anime-lists
mapping (`anime_tmdb_mapping` + `_animeMalList`). Any replacement source must yield at
least one of `{mal_id, anilist_id}` so the existing machinery can get the rest.

---

## 1. Sources (probed live 2026-09-10, all reachable from the datacenter IP)

### A. AnimeSchedule.net API — `https://animeschedule.net/api/v3` — PRIMARY

Near-total AniList replacement for airing + seasonal + browse data. Public read endpoints
work with **no auth**; the weekly timetable needs a **free API token** (`Authorization:
Bearer <token>` — sign up, one-time).

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /anime?q=&genres=&years=&seasons=&mt=&airing-statuses=&sort=&page=` | list: `{id, title, route, premier, subPremier, dubPremier, season, episodes, status}` | `sort=popularity\|score\|…`; `airing-statuses=ongoing\|finished\|upcoming`; filterable by genre route, year, season, media type |
| `GET /anime/{route}` | **full detail** incl. `websites:{ mal, aniList, kitsu, anidb, official }`, `names:{native,synonyms[]}`, `genres[]`, `studios[]`, `episodes`, `status`, `jpnTime/subTime/dubTime` (broadcast), `relations:{sequels[],prequels[],other[]}`, `stats:{averageScore(0-100), ratingCount, trackedCount}` | `websites.mal` = `myanimelist.net/anime/52299/…` → **parse MAL id**; `websites.aniList` = `anilist.co/anime/151807/…` → **parse AniList id** |
| `GET /anime?mal-ids=X` / `?anilist-ids=X` | same list shape, filtered | **reverse ID lookup, no auth** — MAL id → AnimeSchedule `route` in one call |
| `GET /timetables/sub?year=&week=` (also `/dub`, `/raw`) | week's airing episodes: per-entry `episodeDate`, `episodeNumber`, `episodes` (total), `route`, air time | **needs token.** This is the real per-date, per-episode calendar — the one thing Jikan/MAL can't do cleanly |

**Gap:** catalog is airing-focused (current/recent/upcoming seasons + seasonal archive).
Thin for deep-catalog / obscure OVAs / old shows → fall through to MAL scrape or Kitsu.

### B. MAL scrape — `myanimelist.net` — DEEP CATALOG + already built here

The codebase already scrapes MAL (`buildSeasonGroupsFromMalRelations`,
`buildSeasonCardsFromMalRelations`, MAL og:image/JSON-LD parsing near server.js:20777+).
Extend that muscle. Needs a browser-ish UA; route through `getGotScraping()` if plain axios
gets challenged. Rate: gentle, cache hard (MAL bans aggressive scraping).

| Page | Parse for | Powers |
|---|---|---|
| `/topanime.php?type=airing\|bypopularity\|favorite&limit=N` | ranked table of `{mal_id, title, score}` | homepage rows |
| `/anime.php?genre[]=1&aired[]=&status=&type=1&o=3&w=1` (advanced search) | results table `{mal_id, title, type, eps, score, dates}` | library filters (genre ids are static; `o`=sort, `status`, `type`, year via `aired[]`) |
| `/anime/{id}` | JSON-LD + sidebar: `episodes`, `status`, `aired`, `broadcast` (day+time), `score`, `genres[]`, `studios[]`, `synopsis`, `og:image` | enrichment, anikoto validation, timeline node data |
| `/anime/{id}/{slug}/episode` | episode list w/ `aired` dates (for currently-airing shows) | next-episode fallback for notifications |
| `/anime/{id}` "Related Anime" table | `{relation, mal_id, title, type}` | timeline row (related), season siblings |
| `/anime/season/{year}/{season}` | seasonal grid `{mal_id, title, members, score, broadcast}` | seasonal rows, calendar fallback |

MAL id is native → no bridging needed.

### C. Kitsu API — `https://kitsu.io/api/edge` — UNIVERSAL ID BRIDGE + secondary

Proper JSON:API, no auth, CORS-open, not blocked. Weaker/staler metadata than AniList for
brand-new shows, but its **`mappings`** relationship is the clean cross-ID resolver.

| Call | Returns |
|---|---|
| `GET /anime?filter[text]={title}&include=mappings&page[limit]=1` | anime + `included[]` = `[{externalSite:"myanimelist/anime", externalId:"44511"}, {externalSite:"anilist/anime", externalId:"127230"}, {externalSite:"anidb", externalId:"15914"}]` |
| `GET /anime/{id}/mappings` | same mappings for a known Kitsu id |
| `GET /trending/anime` , `GET /anime?sort=-userCount&filter[...]` | trending / popular / filtered lists (secondary to A/B) |
| `GET /anime/{id}/episodes?sort=number` | per-episode `airdate` (secondary calendar source) |

Use Kitsu whenever a source hands us only a **romaji title or a foreign id** and we need
MAL/AniList: `filter[text]=romaji` → read the mappings.

---

## 2. ID-bridge strategy (the main worry — solved)

```
Need: any source result → {mal_id and/or anilist_id} → existing Fribb/anime_tmdb_mapping → tmdb_id
```

- **AnimeSchedule list item** → has `route` → `GET /anime/{route}` → `websites.mal` / `websites.aniList` → regex the numeric id out of the URL.
- **AnimeSchedule ← our MAL id** → `GET /anime?mal-ids={id}` → `route` (one hop, no auth).
- **Romaji title only** (AS synonyms, or a timetable row we can't resolve) → Kitsu
  `filter[text]=` → `included` mappings → mal/anilist id.
- **MAL scrape** → id is native.
- Cache every resolved bridge in a small table (`anime_id_bridge`: `mal_id ↔ anilist_id ↔
  animeschedule_route ↔ kitsu_id`) so each cross-walk is paid once.

---

## 3. Per-path plan (the 🔴 / 🟡 rows from the audit)

| Broken path | server.js | New primary | New fallback | Cadence / cache (existing) |
|---|---|---|---|---|
| **New-episode notifications** (`nextAiringEpisode`) | `generateNewEpisodeNotifications` :5081 | AnimeSchedule `/timetables/sub` + `/dub` for the current week → find rows whose `route` bridges to a watched show's mal/anilist id → `episodeDate` + `episodeNumber` | MAL `/anime/{id}/…/episode` last-aired + `broadcast` day → project next date | weekly job (unchanged); add a 1×/day timetable pull cached in memory |
| **Homepage rows** (Trending/Popular/Action/…) | `fetchAniListRowFromAniList` :9169 → `/api/anime-row` | AnimeSchedule `/anime?sort=popularity&airing-statuses=ongoing` (Trending), `sort=score` / `sort=popularity` all-time-ish (Popular), `genres={route}` (genre rows) | MAL `/topanime.php?type=…` ; Kitsu `/trending/anime` | `anime_row_cache` — rebuild daily |
| **Library browse** (filters) | `fetchAnimeLibraryFromAniList` :9325 → `/api/anime-library` | AnimeSchedule `/anime?genres=&years=&seasons=&mt=&sort=` | MAL `/anime.php` advanced search | `anime_row_cache` — on demand + cache |
| **Timeline row** (related-by-year) | `fetchTimelineRowFromAniList` :9462 → `/api/anime-timeline-row` | MAL `/anime/{id}` "Related Anime" table (need mal_id first) | AnimeSchedule `/anime/{route}.relations` ; Kitsu media-relationships | `anime_row_cache` — 30d (relations ~never change) |
| **Airing calendar** (per-date) | `fetchAniListDaySchedule` / `…Range` :10362/:10389 → `/api/anime-schedule[-range]` | AnimeSchedule `/timetables/sub?year=&week=` → group by `episodeDate` UTC | MAL `/anime/season/{y}/{s}` + per-show `broadcast` (day-granularity only) | `anime_schedule` per-date — daily refresh |
| **Bulk enrichment** (score/genre/cover) | `backfillAnimeCacheEnrichment` :8939 | AnimeSchedule `/anime/{route}` (`stats.averageScore`, `genres`, `imageVersionRoute` poster) | MAL `/anime/{id}` JSON-LD + og:image ; Kitsu `/anime/{id}` | background, low priority |
| **Title→id mapping** | `searchAniListByTitle` :8543 / `aniListGetMediaBasic` :9680 | Kitsu `filter[text]=` → mappings | MAL search scrape ; AnimeSchedule `?q=` → `/anime/{route}.websites` | `anime_tmdb_mapping` — 30d |
| **Anikoto match check** (ep count/status) | `validateAnikotoFuzzyMatchAgainstAniList` :13899 | MAL `/anime/{id}` (`episodes`, `status`) via title→id bridge | AnimeSchedule `/anime/{route}` (`episodes`, `status`) | none (already fails safe → reject) |

Already fine (no work): season groups (`buildSeasonGroupsFromMalRelations` fallback exists),
season cards (MAL already primary). Frontend direct AniList calls in `js/animePage.js` /
`js/movieLoading.js` work from most visitor IPs — leave for a later pass, they already
degrade to the backend routes.

---

## 4. Architecture

- **Fallback wrapper, not replacement.** One helper:
  ```
  withAniListFallback(primaryAniListFn, fallbackFn, { cacheKey })
  ```
  Try AniList first; on `403 "temporarily disabled"` / network fail / empty → run
  `fallbackFn`. When AniList recovers it silently returns to primary. Add a short
  circuit-breaker so a run of 403s parks AniList calls for ~2h instead of retrying every
  tick (kills the current log spam meanwhile).
- **Keep every existing cache table and route contract.** New source functions must return
  the **same item shape** `fetchAniListRowFromAniList` etc. already produce (`{ id (anilist
  or synthetic), idMal, title:{romaji,english,native}, coverImage:{large}, … }`) so
  `animeCacheUpsertFromAniListItem` / `anime_row_cache` / the frontend need zero changes.
  Where a source only gives a MAL id, carry `idMal` and let the existing tmdb resolver run;
  set `id` to the bridged anilist id when known, else a stable synthetic (`mal:{id}`).
- **New table** `anime_id_bridge` (mal_id, anilist_id, as_route, kitsu_id, resolved_at) —
  every cross-walk paid once.
- **Rate discipline:** AnimeSchedule — generous, but batch (one `/timetables` pull per day,
  not per request). MAL — space requests, hard cache, got-scraping on challenge. Kitsu —
  fine, still cache.

---

## 5. Phases

0. **De-risk (½ day):** get an AnimeSchedule API token; confirm `/timetables/sub` shape +
   that timetable rows carry a `route` we can bridge. Confirm MAL advanced-search HTML is
   still parseable. Write `_probe-anilist-fallbacks.js`.
1. **Calendar + notifications** onto AnimeSchedule (highest visible breakage, cleanest
   source). `animeScheduleFetch()` adapter + `fetchAnimeScheduleDay/Range()` mirroring the
   AniList fn signatures so routes barely change. Circuit-breaker lands here too.
2. **Rows + library** onto AnimeSchedule primary / MAL fallback. `fetchAnimeRowFallback` /
   `fetchAnimeLibraryFallback`, output-shape compatible.
3. **Timeline + enrichment + mapping** onto MAL scrape + Kitsu bridge.
4. **Wrap everything** in `withAniListFallback` so recovery is automatic. Optional: point
   the frontend direct calls at the backend routes too.

---

## 6. Open questions / risks

- AnimeSchedule token: rate limit / ToS for automated use — check on signup.
- AnimeSchedule catalog depth for non-airing / old titles — measure during phase 0; MAL
  covers the tail.
- MAL scraping stability — they've tightened before; keep it behind got-scraping + heavy
  cache, and it's the *fallback* tier for most paths, not primary.
- `nextAiringEpisode` precision: AnimeSchedule timetable gives exact date+ep; MAL fallback
  is day-granularity (broadcast day) — acceptable for a weekly "new episode this week"
  notification.
- Kitsu mapping coverage for the newest shows can lag a few weeks — AnimeSchedule
  `websites.*` is the better bridge for current-season titles.

---

## 7. Status (implemented 2026-09-10)

Committed to `anime-badges-kino-megaplay`:

| Commit | What landed |
|---|---|
| `a7642666` | `anilistPost()` gateway - all 12 call sites; circuit-breaker on the "temporarily disabled" 403 (parks 2h, self-heals) |
| `248073ba` | `withAniListFallback(primary, fallback)`; AnimeSchedule adapter (`asGet`, `asExtractSiteId`, `animeScheduleToAniListItem`); **anime rows** |
| `5c23883e` | **anime-library** + **timeline row** onto AnimeSchedule |
| `d2483f66` | **Kitsu** `kitsuFindByTitle` (universal ID bridge) -> title->id mapping + anikoto validation; **AnimeSchedule /timetables** adapter -> airing **calendar** + new-episode **notifications** (gated on `ANIMESCHEDULE_API_TOKEN`) |

**Done & verified live (AniList 403 from this IP -> fallback served real, ID-bridged data):**
rows (all genre/format/season/status variants), library (filters + free-text
search), timeline row, title->id mapping (Kitsu), anikoto match validation.

**Code live but gated on `ANIMESCHEDULE_API_TOKEN`** (free signup, `Authorization:
Bearer`): airing calendar (`/api/anime-schedule[-range]`) and new-episode
notifications. Without the token these degrade gracefully - routes serve stale
cache, notifications skip, one-line warning logged. Set the env var to activate.

**Not done (low priority / already covered):**
- `backfillAnimeCacheEnrichment` (bulk score/genre/cover enrichment) - background
  only, existing `anime_cache` persists; can be pointed at AnimeSchedule
  `/anime/{route}` later.
- `aniListGetMediaBasic` - has a TMDB-search fallback already; a Kitsu hop could
  be added.
- Season groups / season cards - already prefer MAL scraping (audit rows 11-12).
- Frontend direct AniList calls (`js/animePage.js`, `js/movieLoading.js`) - run
  from each visitor's IP, work for most; a later pass points them at the backend
  routes.

**When AniList recovers:** nothing to undo. `withAniListFallback` tries AniList
first every call and the breaker self-resets on the first success - the fallbacks
just stop being reached.
