# What changed & what to click — session of 2026-08-16 → 17

Everything below was verified server-side (curl against the real APIs) but **not**
in a browser. That's what this list is for. Start the backend + middleware first.

Legend: 🔴 = most likely to have a UI-level problem, check these first.

---

## 1. Kino (movies + series) — no longer uses Puppeteer

**What changed:** Kino extraction was a full headless-Chromium launch per request
(~6.6s). It's now 3 plain HTTP requests (~0.9s). Puppeteer is still there as an
automatic fallback if vidsrcme changes anything.

- [ ] Play a movie on **Kino** → should start noticeably faster than before
- [ ] Play a **series** episode on Kino (different show, and a mid-season episode)
- [ ] 🔴 Check backend console: expect `[Kino] API path OK for ...`
      If you instead see `falling back to browser extraction` *every* time, the
      fast path broke — playback still works, just slowly. See `vidscr.txt` §9.
- [ ] A movie vidsrcme doesn't have (e.g. tmdb **558144**) should fail **fast**
      (~0.3s) and let you switch servers — not hang 15-20s like before

## 2. MegaPlay — iframe ➜ native player 🔴

**What changed:** MegaPlay was an `<iframe>` (their UI, their ads, no subs, no
skip). Now extracted and played in *our* player, same as KAA/Neko.

- [ ] 🔴 Anime → **MegaVid** server → should play in OUR player, not an embedded page
- [ ] 🔴 Subtitles should be selectable (AoT ep1 returns 5 tracks)
- [ ] 🔴 **Skip intro/outro buttons should appear** (AoT ep1: intro 138-215s,
      outro 1452-1542s) — this is the new per-episode skip data
- [ ] Switch SUB ⇄ DUB on MegaVid — both should work
- [ ] 🔴 KAA fallback: if KickAssAnime has no sources it auto-switches to MegaPlay —
      that path is now native too (subs + skip), iframe only as last resort
- [ ] If extraction fails it silently falls back to the old iframe — so if you see
      megaplay's own player, extraction failed (check console)

## 3. HSUB (new audio option) 🔴

**What it is:** hard-subs = subtitles burned into the video (vs normal SUB which
is a separate toggleable track). Only NekoStream has it, only for some titles.

- [ ] 🔴 Anime → **NekoStream** → an **HSUB** button should appear next to SUB/DUB
- [ ] HSUB button should NOT appear on any other server
- [ ] Try HSUB on **Attack on Titan** (has it) → should play
- [ ] Try HSUB on **Demon Slayer / Solo Leveling** (no hardsub) → should show a
      clean *"This title has no hard-subbed (HSUB) version"* message, not a
      confusing extractor error
- [ ] Switch to another server while HSUB is active → should auto-revert to SUB
- [ ] Reload the page → should NOT still be stuck in HSUB (deliberately not saved)

## 4. Anime downloads — previously 100% broken 🔴

**What changed:** the download endpoint was a leftover placeholder that requested
a literal `".../api/v1/source/..."` string, so every attempt failed. Also
`animeDownload.js` isn't loaded by any page at all (dead file).

- [ ] 🔴 Anime → **Download SUB (External Neko)** → should open a download page
      in a new tab (Attack on Titan / Frieren are good tests)
- [ ] 🔴 Same for **Download DUB (External Neko)**
- [ ] These now work **regardless of which server is selected** (before they only
      worked if you were on Neko and its whole chain succeeded)
- [ ] Button should show "Getting link..." briefly, then re-enable
- [ ] One Piece ep1 has no dub → DUB button should say so cleanly, not hang

## 5. Episode-count badges (the CC/mic/total chips)

Lots changed here. Spot-check a few:

- [ ] **86 EIGHTY-SIX** → should show 23 (was showing 3/2 from a wrongly-matched
      recap Special)
- [ ] **Love, Chunibyo & Other Delusions!** → 24/24/24 (both seasons summed)
- [ ] **Chainsmoker Cat** → 7 sub / 5 dub (matched via its URL slug "Yani Neko")
- [ ] **My Love Story with Yamada-kun at Lv999** → 13 (AniList-corroborated match)
- [ ] **Devils' Crest** → NO badge (unreleased; must not show Devils' Line's 12)
- [ ] 🔴 **Attack on Titan Final Season** → currently NO badge. Known bug,
      diagnosed but not fixed — see "Known issues" below
- [ ] Badges should appear on indexMain, indexBrowse, allMovies, calendar, movieInfo

## 6. "Because You Watched" row

**What changed:** it only looked at your 5 most recent history entries, so a few
movies in a row made the whole anime row vanish (and vice versa).

- [ ] 🔴 Watch a movie, then open indexBrowse in **anime mode** → the
      "Because you watched X" row should still be there, seeded by the last *anime*
- [ ] Same in reverse: watch anime, then open in **movie mode** → row should
      still show, seeded by the last *movie*
- [ ] The row title should name the same show the recommendations are for
      (previously could say "Because you watched \<a movie\>" over anime recs)

## 7. movieInfo `type=anime`

**What changed:** `?type=anime` fell into the movie-only code path — no episode
list, no season picker, and it force-selected Kino instead of KickAssAnime.

- [ ] 🔴 Open an anime from **allMovies in anime mode** (URL will be `type=anime`)
- [ ] Should show the **episode list + season picker**
- [ ] Should auto-select **KickAssAnime**, not Kino

---

## Known issues (NOT fixed — deliberately deferred)

1. **Attack on Titan Final Season → no badge.** My divergence guard eliminates
   *every* correct candidate (all AoT entries), leaving only unrelated "Beastars
   Final Season" which the AniList gate then correctly rejects. Net result: no
   badge, which is the safe failure, but wrong. Fix needs the season-sibling
   summing rework (would otherwise sum the whole franchise = 89 eps instead of 30).
   Full diagnosis in `vidscr.txt`.

2. **`type=anime` + a non-anime TMDB id** renders garbage MAL data (studios,
   MAL ID etc. for an unrelated anime). Only reachable by hand-typing the URL.

3. **`js/animeDownload.js` is dead code** — not referenced by any HTML page. Its
   `btnSub`/`btnDub` ids also collide with the audio-toggle buttons. Candidate
   for deletion.

4. **MegaPlay `/api/anime-megaplay-download`** (server-side .ts stitching) works
   but is unused by the UI — the External Neko buttons are the better path
   (real .mp4, no server bandwidth). Kept as a fallback for titles animepahe
   doesn't carry.

---

## Reference docs written this session

- `vidscr.txt` — now ~70KB. Contains the full vidsrcme reverse-engineering
  walkthrough (methodology + commands so it can be re-derived), the MegaPlay
  addendum, the download/MPEG-TS analysis, and anikoto's server map.
