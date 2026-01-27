/*!
 * AKARI-Markdown.js v1.0.0
 * (c) 2026 h-o-w-a-r-d
 * Released under the MIT License.
 * Repository: https://github.com/h-o-w-a-r-d/AKARI-Markdown.js
 * Documentation: https://h-o-w-a-r-d.github.io/AKARI-Markdown.js/README.md
 */

// ==========================================
// 外部依賴 (CDN)
// ==========================================
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.0/lib/marked.esm.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.es.min.js';
import katex from 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.mjs';
import hljs from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/highlight.min.js';
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.esm.min.mjs';

/**
 * Shadow DOM 內部需要的 CSS 資源
 * 包含 KaTeX, Highlight.js 以及一個基礎的 Markdown 樣式 (GitHub Style)
 */
const SHADOW_STYLES = [
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.0/github-markdown-dark.min.css' // 預設使用 Dark Mode 樣式，可選
];

/**
 * @typedef {Object} AkariHooks
 * @property {function(string): string} [beforeParse]
 * @property {function(string): string} [afterSanitize]
 * @property {function(HTMLElement): void} [onRendered]
 */

export class AkariMarkdownElement extends HTMLElement {
    
    constructor() {
        super();
        // 1. 開啟 Shadow DOM
        this.attachShadow({ mode: 'open' });

        // 2. 初始化內部容器 (加上 markdown-body class 以套用 GitHub 樣式)
        this.container = document.createElement('div');
        this.container.classList.add('markdown-body');
        
        // 為了確保樣式隔離且能滿版
        const hostStyle = document.createElement('style');
        hostStyle.textContent = `
            :host { display: block; overflow: hidden; } 
            .markdown-body { background: transparent; font-family: sans-serif; }
            /* 修正 Mermaid 在 Shadow DOM 中的置中問題 */
            .mermaid { display: flex; justify-content: center; margin: 1em 0; }
        `;

        this.shadowRoot.appendChild(hostStyle);
        this.shadowRoot.appendChild(this.container);

        // 3. 注入 CSS 到 Shadow Root
        this._injectShadowStyles();

        // 4. 設定預設參數
        this.options = {
            theme: 'default',
            throttleInterval: 50,
            mermaidDebounce: 800,
            hooks: {}
        };

        // 內部狀態
        this.counter = 0;
        this.mathMap = new Map();
        this.codeMap = new Map();
        this._renderTimer = null;
        this._mermaidTimer = null;
        this._latestMarkdown = '';
        this._isRendering = false;

        // 初始化函式庫
        this._initLibraries();
    }

    /**
     * 當元素被加入 DOM 時觸發
     */
    connectedCallback() {
        // 如果標籤內部有初始文字，且沒有設定 no-render 屬性，則渲染它
        if (!this.hasAttribute('no-render') && this.textContent.trim().length > 0) {
            this.render(this.textContent.trim());
        }
    }

    /**
     * 設定 Markdown 內容 (這是主要的輸入介面)
     * @param {string} val
     */
    set value(val) {
        this.render(val);
    }

    /**
     * 獲取當前 Markdown 原始碼
     */
    get value() {
        return this._latestMarkdown;
    }

    /**
     * 設定 Hook 與選項
     * @param {Object} opts 
     */
    set config(opts) {
        this.options = { ...this.options, ...opts };
        // 如果 mermaid 主題變更，可能需要重新 init (這裡簡化處理)
    }

    /**
     * 注入樣式到 Shadow Root
     * 這確保了樣式只影響這個組件內部
     */
    _injectShadowStyles() {
        SHADOW_STYLES.forEach(url => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            // 插入到最前面，讓 hostStyle 權重較高
            this.shadowRoot.insertBefore(link, this.shadowRoot.firstChild);
        });
    }

    _initLibraries() {
        // Mermaid 初始化 (全域設定，但這部分較難完全隔離)
        // 建議在頁面載入時統一設定一次，或在此處設定
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: this.options.theme,
            securityLevel: 'loose'
        });

        const renderer = new marked.Renderer();
        renderer.code = ({ text, lang }) => {
            if (lang === 'mermaid') return `<div class="mermaid">${text}</div>`;
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return `<pre><code class="hljs language-${lang}">${hljs.highlight(text, { language: lang }).value}</code></pre>`;
                } catch (e) {}
            }
            return `<pre><code class="hljs">${text}</code></pre>`;
        };
        marked.use({ renderer });
    }

    /**
     * 渲染方法 (支援串流防抖)
     */
    async render(markdownText, force = false) {
        this._latestMarkdown = markdownText;

        if (force) {
            this._clearTimers();
            await this._performRender();
            return;
        }

        if (this._isRendering) return;

        if (!this._renderTimer) {
            this._renderTimer = setTimeout(async () => {
                this._isRendering = true;
                await this._performRender();
                this._isRendering = false;
                this._renderTimer = null;
            }, this.options.throttleInterval);
        }
    }

    async _performRender() {
        let text = this._latestMarkdown || '';

        // Hooks: beforeParse
        if (this.options.hooks.beforeParse) {
            text = this.options.hooks.beforeParse(text);
        }

        // Reset
        this.mathMap.clear();
        this.codeMap.clear();
        this.counter = 0;

        // Process
        let processed = this._protectCodeAndMath(text);
        
        let html = '';
        try {
            html = marked.parse(processed);
        } catch (err) {
            console.error('AkariMarkdown Parse Error:', err);
            html = `<p style="color:red">Parse Error</p>`;
        }

        // Sanitize
        html = DOMPurify.sanitize(html, {
            ADD_TAGS: ['iframe'],
            ADD_ATTR: ['target', 'class'] 
        });

        // Hooks: afterSanitize
        if (this.options.hooks.afterSanitize) {
            html = this.options.hooks.afterSanitize(html);
        }

        // Restore Math
        html = this._restoreAndRenderMath(html);

        // Update Shadow DOM
        this.container.innerHTML = html;

        // Schedule Mermaid
        this._scheduleMermaidRender();

        // Hooks: onRendered
        if (this.options.hooks.onRendered) {
            this.options.hooks.onRendered(this.container);
        }
    }

    _scheduleMermaidRender() {
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        
        this._mermaidTimer = setTimeout(async () => {
            // 注意：這裡必須在 shadowRoot 內尋找 mermaid 節點
            const nodes = this.container.querySelectorAll('.mermaid');
            if (nodes.length === 0) return;
            try {
                // Mermaid 支援傳入 nodes 陣列，這樣可以處理 Shadow DOM 內的元素
                await mermaid.run({ nodes, suppressErrors: true });
            } catch (e) {
                // console.warn('Mermaid incomplete syntax');
            }
        }, this.options.mermaidDebounce);
    }

    _clearTimers() {
        if (this._renderTimer) clearTimeout(this._renderTimer);
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        this._renderTimer = null;
        this._mermaidTimer = null;
    }

    _protectCodeAndMath(text) {
        let processed = text;
        // Code Block
        processed = processed.replace(/(\n|^)```[\s\S]*?```/g, (match) => {
            const key = `CODEBLOCK${this.counter++}ENDCODE`; 
            this.codeMap.set(key, match);
            return key;
        });
        // Inline Code
        processed = processed.replace(/(`+)(.*?)\1/g, (match) => {
            const key = `CODEINLINE${this.counter++}ENDCODE`;
            this.codeMap.set(key, match);
            return key;
        });
        // Escaped Dollar
        processed = processed.replace(/\\\$/g, (match) => {
            const key = `ESCAPEDDOLLAR${this.counter++}END`;
            this.codeMap.set(key, match);
            return key;
        });
        // Math Block
        processed = processed.replace(/(^|\n)\$\$([\s\S]+?)\$\$($|\n)/g, (match, prefix, tex, suffix) => {
            const key = `MATHBLOCK${this.counter++}ENDMATH`;
            this.mathMap.set(key, { tex: tex, display: true });
            return prefix + key + suffix; 
        });
        // Inline Math
        processed = processed.replace(/\$([^\n]+?)\$/g, (match, tex) => {
            if (/[\u4e00-\u9fa5]/.test(tex) && !tex.includes('\\text')) return match; 
            const key = `MATHINLINE${this.counter++}ENDMATH`;
            this.mathMap.set(key, { tex: tex, display: false });
            return key;
        });
        // Restore Code
        this.codeMap.forEach((value, key) => processed = processed.replace(key, value));
        return processed;
    }

    _restoreAndRenderMath(html) {
        let result = html;
        this.mathMap.forEach((value, key) => {
            try {
                const rendered = katex.renderToString(value.tex, {
                    displayMode: value.display,
                    throwOnError: false,
                    output: 'html'
                });
                result = result.split(key).join(rendered);
            } catch (e) {
                result = result.split(key).join(value.tex);
            }
        });
        return result;
    }
}

// 註冊 Custom Element
customElements.define('akari-markdown', AkariMarkdownElement);
