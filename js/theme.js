/* =========================================
   THEME MANAGEMENT SYSTEM
   Supports: Dark (Orange-Black) and Light themes
   ========================================= */

// Theme definitions
const themes = {
    dark: {
        // Main colors
        '--bg-primary': '#000000',
        '--bg-secondary': '#0a0a0a',
        '--bg-tertiary': '#1a1a1a',
        '--bg-card': '#111111',
        '--bg-hover': '#222222',
        
        // Text colors
        '--text-primary': '#ffffff',
        '--text-secondary': '#cccccc',
        '--text-muted': '#888888',
        
        // Accent colors (orange theme)
        '--accent-primary': '#ff6b00',
        '--accent-secondary': '#ff8533',
        '--accent-hover': '#ff9d5c',
        
        // Border colors
        '--border-color': 'rgba(43, 43, 43, 1)',
        '--border-light': 'rgba(255, 255, 255, 0.1)',
        
        // Overlay colors
        '--overlay-bg': 'rgba(0, 0, 0, 0.85)',
        '--glass-bg': 'rgba(0, 0, 0, 0.7)',
        
        // Status colors
        '--success-color': '#4caf50',
        '--error-color': '#f44336',
        '--warning-color': '#ff9800',
        '--info-color': '#2196f3',
        
        // Shadows
        '--shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.3)',
        '--shadow-md': '0 4px 8px rgba(0, 0, 0, 0.4)',
        '--shadow-lg': '0 8px 16px rgba(0, 0, 0, 0.5)',
        
        // Special
        '--gradient-hero': 'linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0) 100%)'
    },
    
    light: {
        // Main colors
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#f5f5f5',
        '--bg-tertiary': '#e8e8e8',
        '--bg-card': '#fafafa',
        '--bg-hover': '#eeeeee',
        
        // Text colors
        '--text-primary': '#1a1a1a',
        '--text-secondary': '#333333',
        '--text-muted': '#666666',
        
        // Accent colors (orange theme)
        '--accent-primary': '#ff6b00',
        '--accent-secondary': '#ff8533',
        '--accent-hover': '#ff9d5c',
        
        // Border colors
        '--border-color': 'rgba(200, 200, 200, 1)',
        '--border-light': 'rgba(0, 0, 0, 0.1)',
        
        // Overlay colors
        '--overlay-bg': 'rgba(255, 255, 255, 0.95)',
        '--glass-bg': 'rgba(255, 255, 255, 0.8)',
        
        // Status colors
        '--success-color': '#388e3c',
        '--error-color': '#d32f2f',
        '--warning-color': '#f57c00',
        '--info-color': '#1976d2',
        
        // Shadows
        '--shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.1)',
        '--shadow-md': '0 4px 8px rgba(0, 0, 0, 0.15)',
        '--shadow-lg': '0 8px 16px rgba(0, 0, 0, 0.2)',
        
        // Special
        '--gradient-hero': 'linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0) 100%)'
    }
};

// Current theme state
let currentTheme = localStorage.getItem('userTheme') || 'dark';

// Apply theme to document
function applyTheme(themeName) {
    const theme = themes[themeName];
    if (!theme) {
        console.warn(`Theme "${themeName}" not found, using dark theme`);
        themeName = 'dark';
    }
    
    const root = document.documentElement;
    
    Object.entries(themes[themeName]).forEach(([property, value]) => {
        root.style.setProperty(property, value);
    });
    
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(`theme-${themeName}`);
    
    currentTheme = themeName;
    localStorage.setItem('userTheme', themeName);
    
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: themeName } }));
}

// Toggle between themes
function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    return newTheme;
}

// Get current theme
function getCurrentTheme() {
    return currentTheme;
}

// Initialize theme on page load
function initTheme() {
    applyTheme(currentTheme);
}

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
} else {
    initTheme();
}

// Export theme management
window.themeManager = {
    applyTheme,
    toggleTheme,
    getCurrentTheme,
    themes
};
