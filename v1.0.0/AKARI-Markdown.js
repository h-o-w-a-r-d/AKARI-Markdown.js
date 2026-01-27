/*!
 * AKARI-Markdown.js v1.0.0
 * (c) 2026 h-o-w-a-r-d
 * Released under the MIT License.
 * Repository: https://github.com/h-o-w-a-r-d/AKARI-Markdown.js
 * Documentation: https://h-o-w-a-r-d.github.io/AKARI-Markdown.js/README.md
 */

// ==========================================
// 硬編碼外部依賴 (使用穩定的 CDN 版本)
// ==========================================
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.0/lib/marked.esm.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.es.min.js';
import katex from 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.mjs';
import hljs from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/highlight.min.js';
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.esm.min.mjs';

/**
 * 依賴的 CSS 資源連結
 * @constant {Object}
 */
const STYLES = {
    katex: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
    highlight: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css' 
};

/**
 * Hook 函式定義
 * @typedef {Object} AkariHooks
 * @property {function(string): string} [beforeParse] - 在 Markdown 解析前觸發，接收原始字串，需回傳修改後的字串。
 * @property {function(string): string} [afterSanitize] - 在 HTML 淨化後觸發，接收純 HTML 字串，需回傳修改後的 HTML。
 * @property {function(HTMLElement): void} [onRendered] - DOM 更新完成後觸發，接收容器元素。
 */

/**
 * 初始化選項定義
 * @typedef {Object} AkariOptions
 * @property {string} [theme='default'] - Mermaid 圖表主題。
 * @property {string} [securityLevel='loose'] - Mermaid 安全性層級。
 * @property {number} [throttleInterval=50] - 文字渲染的節流間隔 (毫秒)，用於優化高頻串流輸入。
 * @property {number} [mermaidDebounce=800] - Mermaid 圖表渲染的防抖時間 (毫秒)，避免輸入未完成時報錯。
 * @property {AkariHooks} [hooks] - 生命週期鉤子物件。
 */

/**
 * AkariMarkdown 渲染引擎類別
 * @class
 */
export class AkariMarkdown {

    /**
     * 建立 AkariMarkdown 實例
     * @param {HTMLElement|string} targetElement - 要渲染內容的目標 DOM 元素或是 CSS ID/Class 選擇器。
     * @param {AkariOptions} [options={}] - 設定選項。
     * @throws {Error} 如果找不到目標元素則拋出錯誤。
     */
    constructor(targetElement, options = {}) {
        /**
         * @type {HTMLElement}
         * @private
         */
        this.container = typeof targetElement === 'string' 
            ? document.querySelector(targetElement) 
            : targetElement;

        if (!this.container) {
            throw new Error(`[AkariMarkdown] 找不到目標元素: ${targetElement}`);
        }

        /**
         * @type {AkariOptions}
         * @private
         */
        this.options = {
            theme: 'default',
            securityLevel: 'loose',
            throttleInterval: 50,
            mermaidDebounce: 500,
            hooks: {},
            ...options
        };

        // 內部狀態變數
        this.counter = 0;
        this.mathMap = new Map();
        this.codeMap = new Map();
        
        // 防抖/節流計時器
        this._renderTimer = null;
        this._mermaidTimer = null;
        this._latestMarkdown = '';
        this._isRendering = false;

        // 初始化
        this._injectStyles();
        this._initLibraries();
    }

    /**
     * 靜態方法：自動掃描並渲染頁面上符合選擇器的所有元素。
     * 適合用於靜態頁面的一次性轉換。
     * 
     * @static
     * @async
     * @param {string} selector - CSS 選擇器 (例如: '.akari-md-content')。
     * @param {AkariOptions} [options={}] - 共用的設定選項。
     * @returns {Promise<void>} 當所有元素渲染完成後回傳 Promise。
     * 
     * @example
     * AkariMarkdown.renderElements('.markdown-post');
     */
    static async renderElements(selector, options = {}) {
        const elements = document.querySelectorAll(selector);
        const tasks = Array.from(elements).map(async (el) => {
            // 優先讀取 data-markdown 屬性，其次讀取 textContent
            let rawText = el.getAttribute('data-markdown') || el.textContent;
            const renderer = new AkariMarkdown(el, options);
            await renderer.render(rawText.trim());
            // 渲染完成後顯示元素
            el.style.display = 'block'; 
        });
        await Promise.all(tasks);
    }

    /**
     * 渲染 Markdown 字串。
     * 
     * 針對 LLM 串流場景優化：
     * 1. 文字渲染採用「節流 (Throttle)」機制，預設每 50ms 更新一次 DOM。
     * 2. 圖表渲染採用「防抖 (Debounce)」機制，預設停頓 500ms 後才繪製。
     * 
     * @async
     * @param {string} markdownText - 原始 Markdown 文字內容。
     * @param {boolean} [force=false] - 是否強制立即渲染 (忽略節流機制)。通常在串流結束時設為 true。
     * @returns {Promise<void>}
     */
    async render(markdownText, force = false) {
        this._latestMarkdown = markdownText;

        // 強制渲染 (例如串流結束)
        if (force) {
            this._clearTimers();
            await this._performRender();
            return;
        }

        // 節流邏輯：如果正在渲染或已有排程，則跳過
        if (this._isRendering) return;

        // 啟動節流計時器
        if (!this._renderTimer) {
            this._renderTimer = setTimeout(async () => {
                this._isRendering = true;
                await this._performRender();
                this._isRendering = false;
                this._renderTimer = null;
                // 注意：在極高頻輸入下，可能會有殘留文字未渲染，建議串流結束時務必呼叫 render(text, true)
            }, this.options.throttleInterval);
        }
    }

    /**
     * 執行核心渲染邏輯 (私有)
     * @private
     */
    async _performRender() {
        let text = this._latestMarkdown || '';

        // Hook: beforeParse
        if (this.options.hooks.beforeParse) {
            text = this.options.hooks.beforeParse(text);
        }

        // 1. 重置對照表
        this.mathMap.clear();
        this.codeMap.clear();
        this.counter = 0;

        // 2. 保護特殊區塊 (程式碼與數學公式)
        let processed = this._protectCodeAndMath(text);
        
        // 3. Marked 解析
        let html = '';
        try {
            html = marked.parse(processed);
        } catch (err) {
            console.error('[AkariMarkdown] Parse error:', err);
            html = `<p style="color:red">Markdown Parse Error</p>`;
        }

        // 4. DOMPurify 淨化
        html = DOMPurify.sanitize(html, {
            ADD_TAGS: ['iframe'],
            ADD_ATTR: ['target', 'class'] 
        });

        // Hook: afterSanitize
        if (this.options.hooks.afterSanitize) {
            html = this.options.hooks.afterSanitize(html);
        }

        // 5. 還原並渲染數學公式 (KaTeX)
        html = this._restoreAndRenderMath(html);

        // 6. 更新 DOM
        this.container.innerHTML = html;

        // 7. 排程 Mermaid 渲染 (獨立防抖)
        this._scheduleMermaidRender();

        // Hook: onRendered
        if (this.options.hooks.onRendered) {
            this.options.hooks.onRendered(this.container);
        }
    }

    /**
     * 排程 Mermaid 渲染 (防抖)
     * @private
     */
    _scheduleMermaidRender() {
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        
        this._mermaidTimer = setTimeout(async () => {
            const nodes = this.container.querySelectorAll('.mermaid');
            if (nodes.length === 0) return;
            try {
                await mermaid.run({ nodes, suppressErrors: true });
            } catch (e) {
                // 忽略串流過程中的語法錯誤
            }
        }, this.options.mermaidDebounce);
    }

    /**
     * 清除所有計時器
     * @private
     */
    _clearTimers() {
        if (this._renderTimer) clearTimeout(this._renderTimer);
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        this._renderTimer = null;
        this._mermaidTimer = null;
    }

    /**
     * 自動注入依賴的 CSS
     * @private
     */
    _injectStyles() {
        const loadStyle = (url, id) => {
            if (!document.querySelector(`link[href="${url}"]`)) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = url;
                link.dataset.dependency = id;
                document.head.appendChild(link);
            }
        };
        loadStyle(STYLES.katex, 'katex-css');
        loadStyle(STYLES.highlight, 'highlight-css');
    }

    /**
     * 初始化 Marked 與 Mermaid 設定
     * @private
     */
    _initLibraries() {
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: this.options.theme,
            securityLevel: this.options.securityLevel
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
     * 保護代碼區塊與數學公式，避免被 Marked 錯誤解析
     * @private
     * @param {string} text 
     * @returns {string}
     */
    _protectCodeAndMath(text) {
        let processed = text;
        // 1. 保護 ```程式碼```
        processed = processed.replace(/(\n|^)```[\s\S]*?```/g, (match) => {
            const key = `CODEBLOCK${this.counter++}ENDCODE`; 
            this.codeMap.set(key, match);
            return key;
        });
        // 2. 保護 `行內程式碼`
        processed = processed.replace(/(`+)(.*?)\1/g, (match) => {
            const key = `CODEINLINE${this.counter++}ENDCODE`;
            this.codeMap.set(key, match);
            return key;
        });
        // 3. 保護轉義 \$
        processed = processed.replace(/\\\$/g, (match) => {
            const key = `ESCAPEDDOLLAR${this.counter++}END`;
            this.codeMap.set(key, match);
            return key;
        });
        // 4. 保護 $$區塊公式$$
        processed = processed.replace(/(^|\n)\$\$([\s\S]+?)\$\$($|\n)/g, (match, prefix, tex, suffix) => {
            const key = `MATHBLOCK${this.counter++}ENDMATH`;
            this.mathMap.set(key, { tex: tex, display: true });
            return prefix + key + suffix; 
        });
        // 5. 保護 $行內公式$
        processed = processed.replace(/\$([^\n]+?)\$/g, (match, tex) => {
            // 排除中文常用句中的金錢符號誤判
            if (/[\u4e00-\u9fa5]/.test(tex) && !tex.includes('\\text')) return match; 
            const key = `MATHINLINE${this.counter++}ENDMATH`;
            this.mathMap.set(key, { tex: tex, display: false });
            return key;
        });
        // 6. 還原程式碼 (交給 marked 處理)
        this.codeMap.forEach((value, key) => processed = processed.replace(key, value));
        return processed;
    }

    /**
     * 還原數學公式佔位符並執行 KaTeX 渲染
     * @private
     * @param {string} html 
     * @returns {string}
     */
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
