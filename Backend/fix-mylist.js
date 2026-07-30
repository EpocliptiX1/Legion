const fs = require('fs');
const content = fs.readFileSync('js/myList.js', 'utf8');

// Find the start of window.removeFromList
const idx = content.indexOf('window.removeFromList = function');
const beforeFunctions = content.substring(0, idx);

const newContent = beforeFunctions + `window.removeFromList = function(id, evt) {
    const existing = document.getElementById('__deleteConfirmPopup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = '__deleteConfirmPopup';
    popup.style.cssText = \`
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
    \`;

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

    popup.innerHTML = \`
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
    \`;

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
        const card = document.querySelector(\`.grid-card [onclick*="removeFromList('\${id}"]\` )?.closest('.grid-card');
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
};

window.removeFromHistory = function(id, evt) {
    const existing = document.getElementById('__deleteConfirmPopup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = '__deleteConfirmPopup';
    popup.style.cssText = \`
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
    \`;

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

    popup.innerHTML = \`
        <div style="margin-bottom:12px;font-size:15px;font-weight:600;">
            🗑️ Remove from history?
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
    \`;

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

        const card = document.querySelector(\`.grid-card [onclick*="removeFromHistory('\${id}"]\` )?.closest('.grid-card');
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
`;

fs.writeFileSync('js/myList.js', newContent, 'utf8');
