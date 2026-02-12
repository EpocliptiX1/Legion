/* =========================================
   LIVE TRANSLATION FRAMEWORK
   Uses backend /translate proxy (LibreTranslate or other provider)
   ========================================= */

class LiveTranslator {
    constructor() {
        this.useBackend = true;
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        this.backendEndpoint = isLocal ? 'http://localhost:3000/translate' : '/translate';
        this.cacheEndpoint = isLocal ? 'http://localhost:3000/translation-cache' : '/translation-cache';
        this.sourceLanguage = 'EN';
        this.targetLanguage = localStorage.getItem('targetLanguage') || 'EN';
        this.cache = {};
        this.isTranslating = false;
        this.translateTimer = null;
        this.mutationObserver = null;
        this.remoteSaveTimer = null;
        this.persistedCacheKey = 'translationCache_v1';
        this.persistedCacheMax = 500;
        this.loadPersistedCache();
        this.loadRemoteCache();
    }

    loadPersistedCache() {
        try {
            const raw = localStorage.getItem(this.persistedCacheKey);
            this.persistedCache = raw ? JSON.parse(raw) : {};
        } catch (err) {
            this.persistedCache = {};
        }
    }

    savePersistedCache() {
        try {
            const entries = Object.entries(this.persistedCache || {});
            if (entries.length > this.persistedCacheMax) {
                const trimmed = entries.slice(-this.persistedCacheMax);
                this.persistedCache = Object.fromEntries(trimmed);
            }
            localStorage.setItem(this.persistedCacheKey, JSON.stringify(this.persistedCache || {}));
        } catch (err) {
        }
        this.scheduleRemoteSave();
    }

    getCached(cacheKey) {
        return this.cache[cacheKey] || this.persistedCache?.[cacheKey];
    }

    clearCache() {
        this.cache = {};
        this.persistedCache = {};
        try {
            localStorage.removeItem(this.persistedCacheKey);
        } catch (err) {
            // ignore pls
        }
        this.saveRemoteCache({});
    }

    async loadRemoteCache() {
        try {
            if (!this.cacheEndpoint) return;
            const response = await fetch(this.cacheEndpoint);
            if (!response.ok) return;
            const data = await response.json();
            const remoteCache = data?.cache && typeof data.cache === 'object' ? data.cache : {};
            this.persistedCache = { ...(this.persistedCache || {}), ...remoteCache };
            this.savePersistedCache();
        } catch (err) {
            // ignore fetch errors
        }
    }

    scheduleRemoteSave(delayMs = 800) {
        if (this.remoteSaveTimer) clearTimeout(this.remoteSaveTimer);
        this.remoteSaveTimer = setTimeout(() => {
            this.saveRemoteCache(this.persistedCache || {});
        }, delayMs);
    }

    async saveRemoteCache(cacheObj) {
        try {
            if (!this.cacheEndpoint) return;
            const payload = { cache: cacheObj || {}, replace: true };
            await fetch(this.cacheEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            // ignore fetch errors
        }
    }

    setCached(cacheKey, value) {
        this.cache[cacheKey] = value;
        if (!this.persistedCache) this.persistedCache = {};
        this.persistedCache[cacheKey] = value;
        this.savePersistedCache();
    }

    isConfigured() {
        return this.useBackend && !!this.backendEndpoint;
    }

    setTargetLanguage(lang) {
        this.targetLanguage = lang;
        localStorage.setItem('targetLanguage', lang);
    }

    getTargetLanguage() {
        return this.targetLanguage;
    }

    async translate(text, options = {}) {
        if (!this.isConfigured()) return text;
        if (!text || text.trim() === '') return text;

        const targetLang = String(options.targetLang || this.targetLanguage || 'EN').toUpperCase();
        const sourceLang = options.sourceLang || this.sourceLanguage;

        const cacheKey = `${sourceLang}:${targetLang}:${text}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const sourcePayload = sourceLang && String(sourceLang).toUpperCase() !== 'AUTO'
                ? String(sourceLang).toUpperCase()
                : undefined;

            const response = await fetch(this.backendEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    target_lang: targetLang,
                    source_lang: sourcePayload
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error('Translation proxy error body:', errorBody);
                throw new Error(`Translation proxy error: ${response.status}`);
            }

            const data = await response.json();
            const translatedText = data.translations?.[0]?.text || text;
            if (this.isRefusalTranslation(translatedText)) return text;

            this.setCached(cacheKey, translatedText);
            return translatedText;
        } catch (error) {
            console.error('Translation error:', error);
            return text;
        }
    }

    async translateBatch(texts, options = {}) {
        if (!this.isConfigured() || !texts || texts.length === 0) return texts;

        const targetLang = String(options.targetLang || this.targetLanguage || 'EN').toUpperCase();
        const sourceLang = options.sourceLang || this.sourceLanguage;

        const sourcePayload = sourceLang && String(sourceLang).toUpperCase() !== 'AUTO'
            ? String(sourceLang).toUpperCase()
            : undefined;

        const cacheKeyFor = (t) => `${sourceLang}:${targetLang}:${t}`;
        const cachedResults = new Array(texts.length);
        const toTranslate = [];
        const toTranslateIdx = [];

        texts.forEach((t, idx) => {
            const cached = this.getCached(cacheKeyFor(t));
            if (cached) {
                cachedResults[idx] = cached;
            } else {
                toTranslate.push(t);
                toTranslateIdx.push(idx);
            }
        });

        if (toTranslate.length === 0) return cachedResults;

        try {
            const response = await fetch(this.backendEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: toTranslate,
                    target_lang: targetLang,
                    source_lang: sourcePayload
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error('Translation proxy error body:', errorBody);
                throw new Error(`Translation proxy error: ${response.status}`);
            }

            const data = await response.json();
            const translated = (data.translations || []).map((t, idx) => {
                const candidate = t.text;
                return this.isRefusalTranslation(candidate) ? toTranslate[idx] : candidate;
            });
            translated.forEach((val, i) => {
                const originalText = toTranslate[i];
                const cacheKey = cacheKeyFor(originalText);
                this.setCached(cacheKey, val);
                cachedResults[toTranslateIdx[i]] = val;
            });
            return cachedResults;
        } catch (error) {
            console.error('Batch translation error:', error);
            return texts;
        }
    }

    async translateElement(element, options = {}) {
        if (!element) return;

        const originalText = element.getAttribute('data-original-text') || element.textContent;
        if (!element.hasAttribute('data-original-text')) {
            element.setAttribute('data-original-text', originalText);
        }

        const translatedText = await this.translate(originalText, options);
        element.textContent = translatedText;
    }

    async translatePage() {
        if (!this.isConfigured()) return;

        const elements = document.querySelectorAll('[data-translate]');
        const promises = [];
        elements.forEach(element => promises.push(this.translateElement(element)));
        await Promise.all(promises);
    }

    resetPage() {
        const elements = document.querySelectorAll('[data-original-text]');
        elements.forEach(element => {
            element.textContent = element.getAttribute('data-original-text');
        });
    }

    resetAll() {
        this.resetTextNodes();
        this.resetPage();
    }

    normalizeTargetLanguage(lang) {
        const map = {
            en: 'EN',
            ru: 'RU',
            kz: 'RU'
        };
        return map[String(lang || '').toLowerCase()] || 'EN';
    }

    shouldTranslateText(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) return false;
        if (trimmed.length < 2) return false;
        if (!/[A-Za-zА-Яа-яЁё]/.test(trimmed)) return false;
        return true;
    }

    isNodeVisible(node, buffer = 800) {
        try {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            const viewH = window.innerHeight || document.documentElement.clientHeight;
            return rect.bottom >= -buffer && rect.top <= (viewH + buffer);
        } catch (err) {
            const parent = node.parentElement;
            if (!parent) return true;
            const rect = parent.getBoundingClientRect();
            const viewH = window.innerHeight || document.documentElement.clientHeight;
            return rect.bottom >= -buffer && rect.top <= (viewH + buffer);
        }
    }

    async translateTextNodes(root = document.body, options = {}) {
        if (!root || this.isTranslating) return;
        this.isTranslating = true;

        try {
            const nodes = [];
            const texts = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    const tag = parent.tagName;
                    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'].includes(tag)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (parent.closest('[data-no-translate], .no-translate')) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    const originalText = node.__ltOriginalText ?? node.nodeValue;
                    if (!this.shouldTranslateText(originalText)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            let current;
            const allNodes = [];
            const allTexts = [];

            while ((current = walker.nextNode())) {
                const originalText = current.__ltOriginalText ?? current.nodeValue;
                if (!current.__ltOriginalText) {
                    current.__ltOriginalText = current.nodeValue;
                }
                allNodes.push(current);
                allTexts.push(originalText);
                if (this.isNodeVisible(current, 800)) {
                    nodes.push(current);
                    texts.push(originalText);
                }
            }

            if (nodes.length === 0 && allNodes.length > 0) {
                nodes.push(...allNodes);
                texts.push(...allTexts);
            }

            const chunkSize = 40;
            for (let i = 0; i < texts.length; i += chunkSize) {
                const chunkTexts = texts.slice(i, i + chunkSize);
                const translated = await this.translateBatch(chunkTexts, {
                    targetLang: options.targetLang || this.targetLanguage,
                    sourceLang: options.sourceLang || 'AUTO'
                });

                translated.forEach((text, idx) => {
                    const node = nodes[i + idx];
                    if (node) node.nodeValue = text;
                });
            }
            if (texts.length > 0) {
                console.log(`🌐 Live translation applied (${texts.length} nodes)`);
            }
        } finally {
            this.isTranslating = false;
        }
    }

    resetTextNodes(root = document.body) {
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let current;
        while ((current = walker.nextNode())) {
            if (current.__ltOriginalText !== undefined) {
                current.nodeValue = current.__ltOriginalText;
            }
        }
    }

    isRefusalTranslation(text) {
        const normalized = String(text || '').trim().toLowerCase();
        return normalized === 'извините, но я не могу вам в этом помочь.'
            || normalized === 'извините, но я не могу вам помочь.';
    }

    async translatePageAuto() {
        if (!this.isConfigured()) return;
        const userLang = localStorage.getItem('userLanguage') || 'en';
        const target = this.normalizeTargetLanguage(userLang);
        if (target === 'EN') {
            this.resetAll();
            this.clearCache();
            return;
        }

        this.setTargetLanguage(target);
        await this.translateTextNodes(document.body, { targetLang: target, sourceLang: 'EN' });
    }

    scheduleAutoTranslate(delayMs = 150) {
        if (this.translateTimer) clearTimeout(this.translateTimer);
        this.translateTimer = setTimeout(() => {
            this.translatePageAuto();
        }, delayMs);
    }

    startObserver() {
        if (this.mutationObserver || !document.body) return;
        this.mutationObserver = new MutationObserver(() => {
            const userLang = localStorage.getItem('userLanguage') || 'en';
            if (userLang !== 'en') {
                this.scheduleAutoTranslate(200);
            }
        });
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }
}

const translator = new LiveTranslator();
window.translator = translator;

window.addEventListener('targetLanguageChanged', (event) => {
    const targetLang = event.detail.language;
    translator.setTargetLanguage(targetLang);
    translator.translatePage();
});

window.addEventListener('languageChanged', (event) => {
    const targetLang = translator.normalizeTargetLanguage(event.detail.language);
    if (targetLang === 'EN') {
        translator.resetAll();
        translator.clearCache();
        translator.setTargetLanguage('EN');
        return;
    }
    translator.setTargetLanguage(targetLang);
    translator.scheduleAutoTranslate(250);
});

document.addEventListener('DOMContentLoaded', () => {
    translator.scheduleAutoTranslate(200);
    translator.startObserver();
});

window.translateText = async function(text, targetLang) {
    return await translator.translate(text, { targetLang });
};

window.toggleTranslation = function(enabled) {
    if (enabled && translator.isConfigured()) {
        translator.translatePage();
    } else {
        translator.resetAll();
    }
};

console.log('✅ Live Translation Framework loaded');
console.log('💡 Uses backend /translate proxy');
