# Legion Space: Fullstack Movie Platform

## Table of Contents
1. Project Overview
2. Architecture
3. Core Technologies & Libraries
4. Installation & Setup
   - Node.js & NPM
   - Backend Dependencies
   - Frontend
   - Database
   - Translation Service (LibreTranslate)
5. APIs Used
6. How the App Functions
   - Backend
   - Frontend
7. Major JavaScript Functions (Detailed)
8. Helper Functions (Detailed)
9. Security Practices
10. FAQ & Troubleshooting

---

## 1. Project Overview
Legion Space is a fullstack movie platform for browsing, searching, and discussing movies, creating playlists, and interacting with a global or local movie database. It features user authentication, account management, translation, and a forum system.

---

## 2. Architecture
- **Frontend:** Static HTML, CSS, and JavaScript (no build step required).
- **Backend:** Node.js with Express, SQLite3 for persistent storage, and various supporting libraries.
- **Database:** SQLite3 for movies and users.
- **Translation:** LibreTranslate (runs as a separate service).
- **APIs:** TMDB (The Movie Database), YouTube Data API, LibreTranslate.

---

## 3. Core Technologies & Libraries
- **Node.js**: JavaScript runtime for backend.
- **Express**: Web server and API routing.
- **sqlite3**: Local database for movies and users.
- **csv-parse**: For reading CSV files (movie data).
- **node-fetch**: For making HTTP requests (e.g., YouTube, TMDB).
- **axios**: Alternative HTTP client (sometimes used).
- **bcrypt**: Password hashing.
- **cors**: Cross-origin resource sharing.
- **jsonwebtoken (jwt)**: User authentication.
- **LibreTranslate**: Open-source translation API (runs as a separate process).

---

## 4. Installation & Setup

### Node.js & NPM
- Download and install [Node.js](https://nodejs.org/).
- Ensure `npm` is available in your terminal.

### Backend Dependencies
Install all required Node.js packages:
```sh
npm install express sqlite3 csv-parse node-fetch axios bcrypt cors jsonwebtoken
```

### Frontend
- No build step required.
- All HTML, CSS, and JS files are in the `/html`, `/css`, and `/js` folders.
- Open any HTML file in your browser to start.

### Database
- Movies: `/datasets/AITUCAP_Final_Database.csv` (loaded at runtime or pre-imported into SQLite).
- Users: `/Backend/users.db` (auto-created if missing).

### Translation Service (LibreTranslate)
**Install and run LibreTranslate with only English and Russian:**
1. Download LibreTranslate from [LibreTranslate GitHub](https://github.com/LibreTranslate/LibreTranslate).
2. In PowerShell:
    ```sh
    $env:LIBRETRANSLATE_LOAD_ONLY="en,ru"
    .\start-libretranslate.ps1
    ```
3. Set the backend to use your local LibreTranslate:
    ```sh
    $env:LIBRETRANSLATE_URL="http://localhost:5000/translate"
    node server.js
    ```

---

## 5. APIs Used
- **TMDB (The Movie Database):** For global movie data, posters, and metadata.
- **YouTube Data API:** For fetching movie trailers.
- **LibreTranslate:** For translating movie descriptions and UI.
- **Local CSV:** For local movie data (offline mode).

---

## 6. How the App Functions

### Backend
- **Express server** serves API endpoints for movies, users, playlists, reviews, and translation.
- **SQLite3** stores user accounts, playlists, and movie data.
- **CSV-parse** loads local movie data from CSV if selected.
- **node-fetch/axios** fetches data from TMDB, YouTube, and LibreTranslate.
- **bcrypt** hashes user passwords before storing.
- **jsonwebtoken** issues and verifies JWTs for authentication.
- **CORS** allows frontend to access backend APIs.

### Frontend
- **HTML/CSS/JS** for all UI, modals, and navigation.
- **movieLoading.js**: Loads movie details, trailers, and recommendations.
- **apiStatusPanel.js**: Shows API status for TMDB, YouTube, LibreTranslate, etc.
- **forum.js**: Handles movie discussion threads and comments.
- **customPlaylist.js**: Manages user-created playlists.
- **mainPageControls.js**: Handles navigation, account, and settings logic.
- **i18n.js/translator.js**: Handles UI translation.

---

## 7. Major JavaScript Functions (Detailed)

### movieLoading.js
- `window.fetchYTId(name)`: Calls backend `/youtube/search` to get a YouTube trailer video ID for a movie. Keeps API key secure in backend.
- `setupTrailerButton(movieName, movieYear)`: Sets up the trailer button, handles API fallback, disables/enables button, and opens YouTube if no trailer is found.
- `initRecommendations(movie, movieYear, firstDirector, starsList)`: Loads and displays movie recommendations by genre, director, actor, and era.
- `loadReviews()`: Loads and displays user reviews for a movie.

### apiStatusPanel.js
- `checkTmdbApiStatus(circle, text)`: Checks TMDB API key status and updates UI.
- `checkYoutubeApiStatus(circle, text)`: Checks YouTube API key status and updates UI.
- `checkLibreTranslateStatus(circle, text)`: Checks LibreTranslate status and updates UI.
- `injectApiStatusPanel()`: Injects the status panel into settings/admin pages.

### forum.js
- `submitComment(event)`: Posts a comment to a thread, reloads comments, and scrolls to the new comment.
- `loadComments(threadId)`: Loads comments for a thread from backend.
- `selectMovie(movieId, movieTitle, evt)`: Switches forum context to a different movie, closes thread modal, and loads threads.
- `openThreadDetail(threadId)`: Opens a thread modal and loads thread details.
- `closeThreadDetailModal()`: Closes the thread modal and resets state.

### customPlaylist.js
- Handles creating, editing, and displaying user playlists.
- Manages playlist comments and adding/removing movies.

### mainPageControls.js
- Handles account dropdown, settings modal, and user stats.
- Hides ads for Gold/Premium users.
- Removes search limit UI.

---

## 8. Helper Functions (Detailed)
- **cleanList(str)**: Cleans and splits a string into an array (e.g., actors, genres).
- **formatMoney(v)**: Formats a number as USD currency.
- **escapeHtml(str)**: Escapes HTML for safe rendering.
- **showToast(msg, error)**: Shows a notification/toast message.
- **translateDynamicText(el)**: Translates UI text dynamically.
- **buildPlaylist(currentName)**: Builds a playlist from the genre row.
- **setupNavigation()**: Handles next/prev trailer navigation in the modal.

---

## 9. Security Practices
- **Password Hashing:** All user passwords are hashed with bcrypt before being stored in the database.
- **JWT Authentication:** User sessions are managed with JSON Web Tokens, which are signed and verified server-side.
- **API Key Security:** Sensitive API keys (YouTube, TMDB) are stored only in the backend and never exposed to the frontend.
- **CORS:** Only allows requests from trusted origins.
- **Input Validation:** All user input is validated and sanitized before being processed or stored.
- **Environment Variables:** API keys and service URLs are set via environment variables, not hardcoded.

---

## 10. FAQ & Troubleshooting

**Q: How do I add more languages to LibreTranslate?**  
A: Change `$env:LIBRETRANSLATE_LOAD_ONLY="en,ru"` to include more language codes.

**Q: Why is my API status panel showing “Offline”?**  
A: Check your API keys, backend server logs, and ensure all services (LibreTranslate, TMDB, YouTube) are running and reachable.

**Q: How do I reset the database?**  
A: Delete the relevant `.db` files in `/Backend` and restart the server. For movies, re-import or regenerate the CSV.

**Q: How do I run the app?**  
A:  
1. Start LibreTranslate (if using translation):
    ```sh
    $env:LIBRETRANSLATE_LOAD_ONLY="en,ru"
    .\start-libretranslate.ps1
    ```
2. Set environment variable for backend:
    ```sh
    $env:LIBRETRANSLATE_URL="http://localhost:5000/translate"
    node server.js
    ```
3. Open any HTML file in your browser.

---

## Final Notes
- All dependencies are managed via npm.
- The app is modular—each JS file handles a specific feature.
- Security is enforced via hashing, JWT, and backend-only API keys.
- The app is designed for easy local development and deployment.

---

For further details, see the code comments in each JS file, or ask for a breakdown of any specific function or module.
