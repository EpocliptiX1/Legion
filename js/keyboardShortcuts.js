/* =========================================
   KEYBOARD SHORTCUTS FOR POWER USERS
   ========================================= */

const KeyboardShortcuts = {
    shortcuts: {
        'h': () => window.location.href = '/html/indexMain.html',
        'Home': () => window.location.href = '/html/indexMain.html',
        'm': () => window.location.href = '/html/allMovies.html',
        'l': () => window.location.href = '/html/personalList.html',
        'p': () => window.location.href = '/html/customPlaylists.html',
        
        // Search
        '/': () => {
            const searchInput = document.getElementById('mainSearch');
            if (searchInput) {
                searchInput.focus();
            }
        },
        'Escape': () => {
            // Close modals
            if (window.closeMovie) window.closeMovie();
            if (window.closeSignupModal) window.closeSignupModal();
            if (window.closeSettings) window.closeSettings();
            if (window.closeRedirectModal) window.closeRedirectModal();
            
            // Blur search
            const searchInput = document.getElementById('mainSearch');
            if (searchInput && document.activeElement === searchInput) {
                searchInput.blur();
            }
        },
        
        // Theme toggle
        't': () => {
            if (window.toggleSiteTheme) window.toggleSiteTheme();
        },
        
        // Language toggle
        'Shift+L': () => {
            const langs = ['en', 'ru', 'kz'];
            const currentLang = window.i18n.getCurrentLanguage();
            const currentIndex = langs.indexOf(currentLang);
            const nextLang = langs[(currentIndex + 1) % langs.length];
            if (window.selectLanguage) window.selectLanguage(nextLang);
        },
        
        // Hero slider navigation
        'ArrowLeft': () => {
            if (window.prevSlide && !isInputFocused()) window.prevSlide();
        },
        'ArrowRight': () => {
            if (window.nextSlide && !isInputFocused()) window.nextSlide();
        },
        
        // Account menu
        'a': () => {
            if (window.toggleAccountMenu) window.toggleAccountMenu();
        },
        
        // Settings
        ',': () => {
            if (window.openSettings) window.openSettings();
        },
        
        // Sign in/Sign up
        's': () => {
            if (window.openSignInModal) window.openSignInModal();
        },
        'Shift+S': () => {
            if (window.openSignupModal) window.openSignupModal();
        },
        
        // Help dialog
        '?': () => {
            showKeyboardShortcuts();
        },
        'Shift+/': () => {
            showShortcutToast();
        },
        
        // Refresh/Reload
        'r': () => {
            if (!isInputFocused() && !window.location.pathname.includes('movieInfo.html')) {
                window.location.reload();
            }
        }
    },
    
    // Initialize keyboard shortcuts
    init() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (isInputFocused() && !['Escape', 'Enter'].includes(e.key)) {
                return;
            }

            if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
                e.preventDefault();
                showShortcutToast();
                return;
            }
            
            // Build key combination
            let key = e.key;
            if (e.shiftKey && key.length === 1) {
                key = 'Shift+' + key.toUpperCase();
            }
            
            // Execute shortcut if exists
            if (this.shortcuts[key]) {
                e.preventDefault();
                this.shortcuts[key]();
            }
        });
        
        console.log('⌨️ Keyboard shortcuts enabled. Press ? for help.');
    }
};

// Helper function to check if input is focused
function isInputFocused() {
    const activeElement = document.activeElement;
    return activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
    );
}

// Show keyboard shortcuts help
function showKeyboardShortcuts() {
    const helpModal = document.createElement('div');
    helpModal.className = 'shortcuts-modal-overlay';
    helpModal.innerHTML = `
        <div class="shortcuts-content">
            <span class="close-shortcuts" onclick="this.parentElement.parentElement.remove()"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></span>
            <h2>⌨️ Keyboard Shortcuts</h2>
            
            <div class="shortcuts-grid">
                <div class="shortcuts-section">
                    <h3>Navigation</h3>
                    <div class="shortcut-item">
                        <kbd>H</kbd> or <kbd>Home</kbd>
                        <span>Go to Home</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>M</kbd>
                        <span>Go to Movies</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>L</kbd>
                        <span>Go to My List</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>P</kbd>
                        <span>Go to Playlists</span>
                    </div>
                </div>
                
                <div class="shortcuts-section">
                    <h3>Actions</h3>
                    <div class="shortcut-item">
                        <kbd>/</kbd>
                        <span>Focus Search</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Esc</kbd>
                        <span>Close Modal/Unfocus</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>T</kbd>
                        <span>Toggle Theme</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Shift+L</kbd>
                        <span>Cycle Language</span>
                    </div>
                </div>
                
                <div class="shortcuts-section">
                    <h3>Hero Slider</h3>
                    <div class="shortcut-item">
                        <kbd>←</kbd>
                        <span>Previous Slide</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>→</kbd>
                        <span>Next Slide</span>
                    </div>
                </div>
                
                <div class="shortcuts-section">
                    <h3>Account</h3>
                    <div class="shortcut-item">
                        <kbd>A</kbd>
                        <span>Toggle Account Menu</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>,</kbd>
                        <span>Open Settings</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>S</kbd>
                        <span>Sign In</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>Shift+S</kbd>
                        <span>Sign Up</span>
                    </div>
                </div>
                
                <div class="shortcuts-section">
                    <h3>Other</h3>
                    <div class="shortcut-item">
                        <kbd>R</kbd>
                        <span>Refresh Page</span>
                    </div>
                    <div class="shortcut-item">
                        <kbd>?</kbd>
                        <span>Show This Help</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(helpModal);
    
    // Close on click outside
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) {
            helpModal.remove();
        }
    });
}

function showShortcutToast() {
    const existing = document.querySelector('.shortcuts-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'shortcuts-toast';
    toast.innerHTML = `
        <div class="shortcuts-toast-title">Keyboard Shortcuts</div>
        <ul class="shortcuts-toast-list">
            <li><span class="shortcut-key">H</span>/<span class="shortcut-key">Home</span> <span>Home</span></li>
            <li><span class="shortcut-key">M</span> <span>Movies</span></li>
            <li><span class="shortcut-key">L</span> <span>My List</span></li>
            <li><span class="shortcut-key">P</span> <span>Playlists</span></li>
            <li><span class="shortcut-key">/</span> <span>Search</span></li>
            <li><span class="shortcut-key">Esc</span> <span>Close</span></li>
            <li><span class="shortcut-key">T</span> <span>Theme</span></li>
            <li><span class="shortcut-key">Shift+L</span> <span>Language</span></li>
            <li><span class="shortcut-key">←/→</span> <span>Hero</span></li>
            <li><span class="shortcut-key">A</span> <span>Account</span></li>
            <li><span class="shortcut-key">,</span> <span>Settings</span></li>
            <li><span class="shortcut-key">S</span>/<span class="shortcut-key">Shift+S</span> <span>Sign-in/up</span></li>
            <li><span class="shortcut-key">?</span> <span>Full list</span></li>
        </ul>
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Styles for shortcuts modal
const shortcutsStyles = document.createElement('style');
shortcutsStyles.textContent = `
.shortcuts-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--overlay-bg, rgba(0, 0, 0, 0.85));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.3s ease;
}

.shortcuts-content {
    background: var(--bg-card, #111);
    color: var(--text-primary, #fff);
    padding: 40px;
    border-radius: 12px;
    max-width: 900px;
    max-height: 90vh;
    overflow-y: auto;
    position: relative;
    box-shadow: var(--shadow-lg, 0 8px 16px rgba(0, 0, 0, 0.5));
}

.close-shortcuts {
    position: absolute;
    top: 20px;
    right: 20px;
    cursor: pointer;
    color: var(--text-muted, #888);
    transition: color 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
}

.close-shortcuts svg {
    width: 22px;
    height: 22px;
}

.close-shortcuts:hover {
    color: var(--text-primary, #fff);
}

.shortcuts-content h2 {
    margin: 0 0 30px 0;
    font-size: 1.8rem;
}

.shortcuts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 30px;
}

.shortcuts-section h3 {
    margin: 0 0 15px 0;
    color: var(--accent-primary, #ff6b00);
    font-size: 1.1rem;
    border-bottom: 2px solid var(--border-color, #333);
    padding-bottom: 8px;
}

.shortcut-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    color: var(--text-secondary, #ccc);
}

.shortcut-item kbd {
    background: var(--bg-tertiary, #1a1a1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: monospace;
    font-size: 0.9rem;
    min-width: 40px;
    text-align: center;
    box-shadow: 0 2px 0 var(--border-color, #333);
}

.shortcut-item span {
    flex: 1;
}

@media (max-width: 768px) {
    .shortcuts-content {
        padding: 20px;
        max-width: 95%;
    }
    
    .shortcuts-grid {
        grid-template-columns: 1fr;
        gap: 20px;
    }
}
`;
document.head.appendChild(shortcutsStyles);

function initLeftNavToggle() {
    const toggle = document.getElementById('leftNavToggle');
    if (!toggle) return;

    const updateAria = () => {
        const isCollapsed = document.body.classList.contains('left-nav-collapsed');
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
    };

    toggle.addEventListener('click', () => {
        document.body.classList.toggle('left-nav-collapsed');
        updateAria();
    });

    updateAria();
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        KeyboardShortcuts.init();
        initLeftNavToggle();
        initSidebarMenu();
    });
} else {
    KeyboardShortcuts.init();
    initLeftNavToggle();
    initSidebarMenu();
}

// Export for use in other scripts
window.KeyboardShortcuts = KeyboardShortcuts;
window.showKeyboardShortcuts = showKeyboardShortcuts;

console.log('✅ Keyboard shortcuts loaded');

function initSidebarMenu() {
    const nav = document.getElementById('navLinks');
    if (!nav) return;

    let overlay = document.querySelector('.nav-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'nav-overlay';
        document.body.appendChild(overlay);
    }

    if (!nav.querySelector('.nav-close-btn')) {
        const closeItem = document.createElement('li');
        closeItem.className = 'nav-close-item';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'nav-close-btn';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close navigation');
        closeBtn.innerHTML = '<span>Close menu</span><span>✕</span>';
        closeBtn.addEventListener('click', () => setNavOpen(false));
        closeItem.appendChild(closeBtn);
        nav.prepend(closeItem);
    }

    overlay.addEventListener('click', () => setNavOpen(false));

    function setNavOpen(isOpen) {
        nav.classList.toggle('active', isOpen);
        overlay.classList.toggle('active', isOpen);
    }

    window.toggleMobileMenu = function() {
        setNavOpen(!nav.classList.contains('active'));
    };
}
