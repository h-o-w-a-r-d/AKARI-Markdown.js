/* --- START OF FILE akari-markdown.js --- */

/*!
 * AKARI-Markdown.js v1.1.0 (Streaming Optimized)
 * (c) 2026 h-o-w-a-r-d
 * Released under the MIT License.
 * Repository: https://github.com/h-o-w-a-r-d/AKARI-Markdown.js
 */

import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.0/lib/marked.esm.js';
import DOMPurify from 'https://esm.sh/dompurify@3.0.9';
import katex from 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.mjs';
import hljs from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/highlight.min.js';
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.esm.min.mjs';

const SHADOW_STYLES = [
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.0/github-markdown-dark.min.css'
];

export class AkariMarkdownElement extends HTMLElement {
    
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.container = document.createElement('div');
        this.container.classList.add('markdown-body');
        
        const hostStyle = document.createElement('style');
        hostStyle.textContent = `
            :host { display: block; overflow: hidden; text-align: left; } 
            .markdown-body { 
                background: transparent; 
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; 
                line-height: 1.6; 
            }
            .mermaid { 
                display: flex; 
                justify-content: center; 
                margin: 1.5em 0; 
                background: rgba(255, 255, 255, 0.02);
                border-radius: 8px;
                padding: 10px;
                overflow-x: auto;
                transition: opacity 0.3s ease;
            }
            /* 原始碼退回模式 / 串流中模式的樣式 */
            .mermaid-source, .mermaid-streaming {
                font-family: Consolas, Monaco, 'Andale Mono', monospace;
                font-size: 0.85em;
                color: #8b949e; 
                white-space: pre-wrap;
                text-align: left;
                width: 100%;
                opacity: 0.8;
                border-left: 2px solid #30363d;
                padding-left: 10px;
            }
            .mermaid-streaming::after {
                content: ' ▋';
                animation: blink 1s infinite;
            }
            @keyframes blink { 50% { opacity: 0; } }
        `;

        this.shadowRoot.appendChild(hostStyle);
        this.shadowRoot.appendChild(this.container);
        this._injectShadowStyles();

        this.options = {
            theme: 'dark',
            throttleInterval: 30, // 稍微加快 Markdown 解析頻率
            mermaidDebounce: 300, // Mermaid 檢查頻率
            hooks: {}
        };

        this.counter = 0;
        this.mathMap = new Map();
        this.codeMap = new Map();
        this._renderTimer = null;
        this._mermaidTimer = null;
        this._latestMarkdown = '';
        this._isRendering = false;
        this._isMermaidWorking = false; // Mermaid 鎖

        this._initLibraries();
    }

    connectedCallback() {
        if (!this.hasAttribute('no-render') && this.textContent.trim().length > 0) {
            this.render(this.textContent.trim());
        }
    }

    set value(val) {
        this.render(val);
    }

    get value() {
        return this._latestMarkdown;
    }

    set config(opts) {
        this.options = { ...this.options, ...opts };
        this._initMermaidConfig();
    }

    _injectShadowStyles() {
        SHADOW_STYLES.forEach(url => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            this.shadowRoot.insertBefore(link, this.shadowRoot.firstChild);
        });
    }

    _initLibraries() {
        this._initMermaidConfig();

        const renderer = {
            code: (code, lang) => {
                if (lang === 'mermaid') {
                    // ★★★ Mermaid 完整性檢查 ★★★
                    // 我們檢查這段 code 在原始 markdown 中是否被 ``` 包裹閉合
                    // 注意：marked 傳進來的 code 已經去掉了前後的 ```
                    
                    const isClosed = this._checkMermaidIntegrity(code);

                    if (!isClosed) {
                        // 如果未閉合，標記為 streaming 狀態，這會被 CSS 樣式化，且被排程器忽略
                        return `<div class="mermaid-streaming">${this._escapeHtml(code)}</div>`;
                    }

                    // 如果已閉合，標記為準備就緒的 mermaid
                    // 添加 data-code hash 用於 diff 對比
                    return `<div class="mermaid" data-code="${this._hashCode(code)}">${code}</div>`;
                }
                
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        const highlighted = hljs.highlight(code, { language: lang }).value;
                        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
                    } catch (e) { }
                }
                return `<pre><code class="hljs">${code}</code></pre>`;
            }
        };

        marked.use({ renderer });
    }

    _initMermaidConfig() {
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: this.options.theme,
            securityLevel: 'loose',
            suppressErrorRendering: true,
        });

        mermaid.parseError = function(err, hash) {
            // 靜默錯誤，交由 _scheduleMermaidRender 處理
        };
    }

    // ★★★ 新增：檢查 Mermaid 代碼塊是否完整閉合 ★★★
    _checkMermaidIntegrity(codeSnippet) {
        if (!this._latestMarkdown) return false;
        
        // 簡單且高效的檢查：
        // 1. 去除 snippet 前後空白，避免因空白差異導致匹配失敗
        // 2. 在原始 Markdown 中尋找 "snippet + 結尾 fences"
        // 為了避免正則特殊字符問題，我們使用字符串包含檢查
        
        const trimmedSnippet = codeSnippet.trim();
        if (trimmedSnippet.length === 0) return false;

        // 我們檢查原始 Markdown 中是否包含這段代碼，且後面緊跟著 ```
        // 這不是完美的 parser 級檢查，但對於串流場景非常有效
        // 由於 marked 可能會處理換行，我們嘗試匹配最後一部分
        const lastPart = trimmedSnippet.slice(-20); // 取最後20個字元
        const index = this._latestMarkdown.lastIndexOf(lastPart);
        
        if (index === -1) return false;

        // 檢查該位置之後是否有 ```
        const stringAfter = this._latestMarkdown.slice(index + lastPart.length);
        return /^\s*```/.test(stringAfter);
    }

    async render(markdownText, force = false) {
        this._latestMarkdown = markdownText || ''; 

        if (force) {
            this._clearTimers();
            await this._performRender(true);
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

    async _performRender(forceFullRender = false) {
        let text = this._latestMarkdown;

        try {
            if (this.options.hooks.beforeParse) {
                text = this.options.hooks.beforeParse(text);
            }

            this.mathMap.clear();
            this.codeMap.clear();
            this.counter = 0;

            let processed = this._protectCodeAndMath(text);
            let html = marked.parse(processed);

            html = DOMPurify.sanitize(html, {
                ADD_TAGS: ['iframe'],
                ADD_ATTR: ['target', 'class', 'data-code'] // 允許 data-code 用於 diff
            });

            if (this.options.hooks.afterSanitize) {
                html = this.options.hooks.afterSanitize(html);
            }

            html = this._restoreAndRenderMath(html);

            // ★★★ 核心修改：使用 Diff 更新 DOM，而不是直接 innerHTML ★★★
            if (forceFullRender) {
                this.container.innerHTML = html;
            } else {
                this._updateDOM(this.container, html);
            }

            this._scheduleMermaidRender();

            if (this.options.hooks.onRendered) {
                this.options.hooks.onRendered(this.container);
            }

        } catch (err) {
            console.error('[AkariMarkdown] Render Error:', err);
        }
    }

    // ★★★ 新增：輕量級 DOM Diff 與更新算法 ★★★
    // 這確保了已渲染的 Mermaid 圖表（以及其他元素）不會被銷毀重建
    _updateDOM(container, newHtmlString) {
        const template = document.createElement('div');
        template.innerHTML = newHtmlString;
        
        const newNodes = Array.from(template.childNodes);
        const oldNodes = Array.from(container.childNodes);
        
        const maxLen = Math.max(newNodes.length, oldNodes.length);

        for (let i = 0; i < maxLen; i++) {
            const newNode = newNodes[i];
            const oldNode = oldNodes[i];

            // 1. 如果舊節點不存在，追加新節點
            if (!oldNode) {
                container.appendChild(newNode.cloneNode(true));
                continue;
            }

            // 2. 如果新節點不存在，移除舊節點 (通常是刪減內容時)
            if (!newNode) {
                oldNode.remove();
                continue;
            }

            // 3. 節點類型不同，直接替換
            if (newNode.nodeType !== oldNode.nodeType || newNode.tagName !== oldNode.tagName) {
                container.replaceChild(newNode.cloneNode(true), oldNode);
                continue;
            }

            // 4. 文本節點處理
            if (newNode.nodeType === Node.TEXT_NODE) {
                if (newNode.textContent !== oldNode.textContent) {
                    oldNode.textContent = newNode.textContent;
                }
                continue;
            }

            // 5. 元素節點處理 (尤其是 Mermaid)
            if (newNode.nodeType === Node.ELEMENT_NODE) {
                // 特殊處理 Mermaid：如果 hash 相同，且舊節點已經包含了 SVG，則完全不做任何事
                // 這保護了已經渲染好的圖表不被替換回原始碼 div
                if (newNode.classList.contains('mermaid') && 
                    oldNode.classList.contains('mermaid') &&
                    oldNode.querySelector('svg')) {
                    
                    const newHash = newNode.getAttribute('data-code');
                    const oldHash = oldNode.getAttribute('data-code');
                    
                    if (newHash && newHash === oldHash) {
                        // 內容一樣，舊的已經是 SVG，保留舊的，跳過更新
                        continue;
                    }
                }

                // 簡單的屬性對比與內容更新 (如果不是保留的 mermaid)
                // 為了性能，如果 outerHTML 相似度極高可考慮跳過，但這裡簡單遞歸
                if (newNode.outerHTML !== oldNode.outerHTML) {
                    // 如果是普通節點，內容變了，我們選擇替換節點
                    // (為了更精細可以遞歸 diff children，但對於 Markdown 這種層級通常直接替換即可)
                    // 但為了避免輸入框丟焦點等問題，如果 class 沒變，可以嘗試只更新 innerHTML
                    if (newNode.className === oldNode.className) {
                         // 遞歸更新子節點 (除了 mermaid，前面已處理)
                         // 這裡簡化處理：直接替換，除非我們想做深度 diff
                         // 對於 Markdown 顯示器，直接替換變更的區塊通常足夠快
                         container.replaceChild(newNode.cloneNode(true), oldNode);
                    } else {
                        container.replaceChild(newNode.cloneNode(true), oldNode);
                    }
                }
            }
        }
    }

    _scheduleMermaidRender() {
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        
        this._mermaidTimer = setTimeout(async () => {
            if (this._isMermaidWorking) return;
            
            // 只選取 .mermaid 類別，這意味著已經通過了完整性檢查
            // .mermaid-streaming 類別的節點會被忽略
            const nodes = this.container.querySelectorAll('.mermaid');
            
            if (nodes.length === 0) return;

            this._isMermaidWorking = true;

            for (const node of nodes) {
                // 再次檢查：如果已經有 SVG，跳過
                if (node.querySelector('svg')) continue;

                const code = node.textContent; 
                if (!code) continue;

                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

                try {
                    const { svg } = await mermaid.render(id, code);
                    node.innerHTML = svg;
                    // 渲染成功後，確保 dataset 標記正確
                    node.dataset.rendered = "true";
                } catch (err) {
                    // 渲染失敗（語法錯誤），顯示原始碼
                    node.innerHTML = `<div class="mermaid-source">${this._escapeHtml(code)}</div>`;
                    node.classList.add('mermaid-error');
                    
                    const stray = document.getElementById('d' + id) || document.getElementById(id);
                    if (stray && stray !== node) stray.remove();
                }
            }
            this._isMermaidWorking = false;
        }, this.options.mermaidDebounce);
    }

    _clearTimers() {
        if (this._renderTimer) clearTimeout(this._renderTimer);
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        this._renderTimer = null;
        this._mermaidTimer = null;
    }

    _protectCodeAndMath(text) {
        if (!text) return '';
        let processed = text;
        
        // Code blocks
        processed = processed.replace(/(\n|^)```[\s\S]*?```/g, (match) => {
            const key = `CODEBLOCK${this.counter++}ENDCODE`; 
            this.codeMap.set(key, match);
            return key;
        });
        // Inline code
        processed = processed.replace(/(`+)(.*?)\1/g, (match) => {
            const key = `CODEINLINE${this.counter++}ENDCODE`;
            this.codeMap.set(key, match);
            return key;
        });
        // Escaped dollar
        processed = processed.replace(/\\\$/g, (match) => {
            const key = `ESCAPEDDOLLAR${this.counter++}END`;
            this.codeMap.set(key, match);
            return key;
        });
        // Math blocks
        processed = processed.replace(/(^|\n)\$\$([\s\S]+?)\$\$($|\n)/g, (match, prefix, tex, suffix) => {
            const key = `MATHBLOCK${this.counter++}ENDMATH`;
            this.mathMap.set(key, { tex: tex, display: true });
            return prefix + key + suffix; 
        });
        // Inline math
        processed = processed.replace(/\$([^\n]+?)\$/g, (match, tex) => {
            if (/[\u4e00-\u9fa5]/.test(tex) && !tex.includes('\\text')) return match; 
            const key = `MATHINLINE${this.counter++}ENDMATH`;
            this.mathMap.set(key, { tex: tex, display: false });
            return key;
        });
        
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

    _escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
    
    // 簡單的字串 hash 函數，用於比較代碼是否變更
    _hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }
}

customElements.define('akari-markdown', AkariMarkdownElement);
