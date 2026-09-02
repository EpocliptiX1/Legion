/*
 * One place for expired-account-session handling.
 *
 * Only requests carrying the exact current AniKino JWT are observed. This is
 * intentional: 429s, provider failures, server restarts and unrelated 401s
 * must never look like an account logout.
 */
(function () {
    'use strict';

    const EXPIRY_WARNING_MS = 5 * 60 * 1000;
    const EXPIRED_PROMPT_ID = 'authSessionExpiredPrompt';
    const POST_AUTH_RETURN_KEY = 'aniKinoPostAuthReturn';
    const AUTO_SIGNIN_KEY = 'aniKinoOpenSignInAfterExpiry';
    const ACCOUNT_STATE_KEYS = [
        'authToken',
        'username',
        'userUID',
        'userEmail',
        'userTier',
        'loginCode',
        'accountUID',
        'is_guest_local',
        'allUIDs',
        'searchCount',
        'viewCount',
        'userPFP',
        'w2gHostingSessionId'
    ];

    let expiryTimer = null;
    let warningTimer = null;
    let expired = false;
    const nativeFetch = window.fetch.bind(window);

    function getHeader(headers, name) {
        if (!headers) return '';
        if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name) || '';
        if (Array.isArray(headers)) {
            const match = headers.find(([key]) => String(key).toLowerCase() === name.toLowerCase());
            return match ? match[1] : '';
        }
        return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || '';
    }

    function requestUsesCurrentToken(input, init) {
        const token = localStorage.getItem('authToken');
        if (!token) return false;
        const headers = init?.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : null);
        return String(getHeader(headers, 'Authorization')).trim() === `Bearer ${token}`;
    }

    function getTokenExpiry(token) {
        try {
            const payload = token.split('.')[1];
            if (!payload) return null;
            const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
            const decoded = JSON.parse(atob(normalized));
            return Number.isFinite(Number(decoded.exp)) ? Number(decoded.exp) * 1000 : null;
        } catch (_) {
            return null;
        }
    }

    function clearExpiredAccountState() {
        ACCOUNT_STATE_KEYS.forEach((key) => localStorage.removeItem(key));
        sessionStorage.removeItem('w2gIsHostingTab');
    }

    function safeReturnPath() {
        return `${location.pathname}${location.search}${location.hash}`;
    }

    function removePrompt() {
        document.getElementById(EXPIRED_PROMPT_ID)?.remove();
        document.body?.classList.remove('auth-session-prompt-open');
    }

    function openSignInFromPrompt() {
        removePrompt();
        if (typeof window.openSignInModal === 'function') {
            window.openSignInModal();
            return;
        }

        // The compact Watch2Gether viewer has no full account modal. Preserve
        // its URL and take the user to the normal page that owns sign-in.
        sessionStorage.setItem(POST_AUTH_RETURN_KEY, safeReturnPath());
        sessionStorage.setItem(AUTO_SIGNIN_KEY, '1');
        location.assign('/html/indexMain.html');
    }

    function renderPrompt({ warning = false } = {}) {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', () => renderPrompt({ warning }), { once: true });
            return;
        }
        if (document.getElementById(EXPIRED_PROMPT_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = EXPIRED_PROMPT_ID;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'authSessionPromptTitle');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:100001', 'display:flex',
            'align-items:center', 'justify-content:center', 'padding:20px',
            'background:rgba(0,0,0,.76)', 'backdrop-filter:blur(5px)'
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'width:min(390px,100%)', 'padding:25px', 'border:1px solid rgba(249,109,0,.72)',
            'border-radius:14px', 'background:#151515', 'box-shadow:0 18px 55px rgba(0,0,0,.55)',
            'color:#fff', 'font-family:inherit', 'text-align:center'
        ].join(';');
        card.innerHTML = `
            <h2 id="authSessionPromptTitle" style="margin:0 0 10px;color:#ff8500;font-size:1.2rem;">${warning ? 'Session ending soon' : 'Session expired'}</h2>
            <p style="margin:0;color:#d5d5d5;line-height:1.45;font-size:.93rem;">${warning
                ? 'Sign in again now to keep friends, comments, and Watch2Gether working without interruption.'
                : 'Sign in again to use friends, comments, Watch2Gether, and other account features.'}</p>
            <div style="display:flex;gap:10px;justify-content:center;margin-top:21px;">
                <button type="button" data-auth-session-signin style="border:0;border-radius:8px;padding:10px 17px;background:#ff7900;color:#101010;font-weight:750;cursor:pointer;">Sign in again</button>
                <button type="button" data-auth-session-later style="border:1px solid #5b5b5b;border-radius:8px;padding:10px 17px;background:#242424;color:#eee;font-weight:650;cursor:pointer;">Not now</button>
            </div>`;

        overlay.appendChild(card);
        overlay.querySelector('[data-auth-session-signin]')?.addEventListener('click', openSignInFromPrompt);
        overlay.querySelector('[data-auth-session-later]')?.addEventListener('click', removePrompt);
        document.body.appendChild(overlay);
        document.body.classList.add('auth-session-prompt-open');
        overlay.querySelector('[data-auth-session-signin]')?.focus();
    }

    function handleExpiredSession() {
        if (!expired) {
            expired = true;
            if (expiryTimer) clearTimeout(expiryTimer);
            if (warningTimer) clearTimeout(warningTimer);
            clearExpiredAccountState();
        }
        renderPrompt();
    }

    function scheduleSessionExpiryCheck() {
        if (expiryTimer) clearTimeout(expiryTimer);
        if (warningTimer) clearTimeout(warningTimer);
        expiryTimer = null;
        warningTimer = null;
        expired = false;

        const token = localStorage.getItem('authToken');
        const expiry = token && getTokenExpiry(token);
        if (!expiry) return;

        const remaining = expiry - Date.now();
        if (remaining <= 0) {
            handleExpiredSession();
            return;
        }

        const warnIn = remaining - EXPIRY_WARNING_MS;
        if (warnIn <= 0) {
            renderPrompt({ warning: true });
        } else {
            warningTimer = window.setTimeout(() => {
                renderPrompt({ warning: true });
            }, warnIn);
        }
        expiryTimer = window.setTimeout(handleExpiredSession, remaining + 50);
    }

    window.fetch = function authAwareFetch(input, init) {
        const observesCurrentToken = requestUsesCurrentToken(input, init);
        return nativeFetch(input, init).then((response) => {
            if (observesCurrentToken && response.status === 401) handleExpiredSession();
            return response;
        });
    };
    window.authFetch = window.fetch;
    window.scheduleAuthSessionExpiryCheck = scheduleSessionExpiryCheck;

    window.addEventListener('focus', () => {
        if (!expired) scheduleSessionExpiryCheck();
    });
    window.addEventListener('storage', (event) => {
        if (event.key === 'authToken') scheduleSessionExpiryCheck();
    });
    document.addEventListener('DOMContentLoaded', () => {
        scheduleSessionExpiryCheck();
        if (sessionStorage.getItem(AUTO_SIGNIN_KEY) === '1') {
            sessionStorage.removeItem(AUTO_SIGNIN_KEY);
            window.setTimeout(openSignInFromPrompt, 0);
        }
    });
})();
