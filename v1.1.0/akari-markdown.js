/* --- START OF FILE akari-markdown.js --- */

/*!
 * AKARI-Markdown.js v1.2.0 (Fix Mermaid Rendering)
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
            /* 錯誤顯示樣式 */
            .mermaid-error-msg {
                color: #ff6b6b;
                font-size: 0.8em;
                padding: 8px;
                background: rgba(255, 0, 0, 0.1);
                border-radius: 4px;
                margin-bottom: 5px;
                white-space: pre-wrap;
                font-family: monospace;
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
            throttleInterval: 30, 
            mermaidDebounce: 300, 
            hooks: {}
        };

        this.counter = 0;
        this.mathMap = new Map();
        this.codeMap = new Map();
        this._renderTimer = null;
        this._mermaidTimer = null;
        this._latestMarkdown = '';
        this._isRendering = false;
        this._isMermaidWorking = false; 

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
                // 如果沒有指定語言，默認為空
                lang = lang || '';

                if (lang === 'mermaid') {
                    // ★ 關鍵修復：解碼 HTML 實體 (如 &gt; 轉為 >)，否則 Mermaid 解析器會報錯
                    const cleanCode = this._decodeHtml(code);
                    
                    // 檢查完整性
                    const isClosed = this._checkMermaidIntegrity(cleanCode);

                    if (!isClosed) {
                        return `<div class="mermaid-streaming">${this._escapeHtml(cleanCode)}</div>`;
                    }

                    // 添加 data-code hash 用於 diff 對比
                    return `<div class="mermaid" data-code="${this._hashCode(cleanCode)}">${this._escapeHtml(cleanCode)}</div>`;
                }
                
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        const highlighted = hljs.highlight(code, { language: lang }).value;
                        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
                    } catch (e) { }
                }
                return `<pre><code class="hljs">${this._escapeHtml(code)}</code></pre>`;
            }
        };

        marked.use({ renderer });
    }

    _initMermaidConfig() {
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: this.options.theme,
            securityLevel: 'loose', // 允許寬鬆模式，這對於某些圖表在 Shadow DOM 渲染很重要
            suppressErrorRendering: true, // 我們自己處理錯誤渲染
        });

        mermaid.parseError = function(err, hash) {
            // 靜默全局錯誤，交由 _scheduleMermaidRender 的 try-catch 處理
        };
    }

    // 檢查 Markdown 是否完整閉合
    _checkMermaidIntegrity(codeSnippet) {
        if (!this._latestMarkdown) return false;
        
        const trimmedSnippet = codeSnippet.trim();
        if (trimmedSnippet.length === 0) return false;

        // 取代碼片段的最後一部分來進行定位
        // 增加長度以確保唯一性，但防止過長
        const searchPart = trimmedSnippet.slice(-Math.min(trimmedSnippet.length, 50)); 
        
        const index = this._latestMarkdown.lastIndexOf(searchPart);
        if (index === -1) return false;

        // 檢查該位置之後是否有 ```
        const stringAfter = this._latestMarkdown.slice(index + searchPart.length);
        
        // 允許代碼塊內容後有換行符，然後才是 ```
        return /^\s*```/.test(stringAfter);
    }

    // ★ 關鍵修復：HTML 實體解碼 helper
    _decodeHtml(html) {
        const txt = document.createElement("textarea");
        txt.innerHTML = html;
        return txt.value;
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
                ADD_ATTR: ['target', 'class', 'data-code', 'data-rendered'] 
            });

            if (this.options.hooks.afterSanitize) {
                html = this.options.hooks.afterSanitize(html);
            }

            html = this._restoreAndRenderMath(html);

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

    _updateDOM(container, newHtmlString) {
        const template = document.createElement('div');
        template.innerHTML = newHtmlString;
        
        const newNodes = Array.from(template.childNodes);
        const oldNodes = Array.from(container.childNodes);
        
        const maxLen = Math.max(newNodes.length, oldNodes.length);

        for (let i = 0; i < maxLen; i++) {
            const newNode = newNodes[i];
            const oldNode = oldNodes[i];

            if (!oldNode) {
                container.appendChild(newNode.cloneNode(true));
                continue;
            }

            if (!newNode) {
                oldNode.remove();
                continue;
            }

            if (newNode.nodeType !== oldNode.nodeType || newNode.tagName !== oldNode.tagName) {
                container.replaceChild(newNode.cloneNode(true), oldNode);
                continue;
            }

            if (newNode.nodeType === Node.TEXT_NODE) {
                if (newNode.textContent !== oldNode.textContent) {
                    oldNode.textContent = newNode.textContent;
                }
                continue;
            }

            if (newNode.nodeType === Node.ELEMENT_NODE) {
                // Mermaid 保護邏輯
                if (newNode.classList.contains('mermaid') && 
                    oldNode.classList.contains('mermaid') &&
                    oldNode.dataset.rendered === "true") { // 使用 rendered 標記更準確
                    
                    const newHash = newNode.getAttribute('data-code');
                    const oldHash = oldNode.getAttribute('data-code');
                    
                    if (newHash && newHash === oldHash) {
                        continue;
                    }
                }

                if (newNode.outerHTML !== oldNode.outerHTML) {
                    if (newNode.className === oldNode.className) {
                         // 這裡可以做更深層遞歸，目前為性能直接替換
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
            
            // 選取所有 mermaid 類別且尚未成功渲染的節點
            // 注意：我們不過濾 data-rendered="true" 的節點，因為如果是新的 DOM 結構，它們可能需要重新處理
            // 但我們會檢查內部是否已經有 svg
            const nodes = this.container.querySelectorAll('.mermaid');
            
            if (nodes.length === 0) return;

            this._isMermaidWorking = true;

            for (const node of nodes) {
                if (node.querySelector('svg')) continue;

                // 再次解碼，確保從 DOM 取回的代碼是乾淨的
                const code = this._decodeHtml(node.textContent); 
                if (!code.trim()) continue;

                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

                try {
                    // 嘗試渲染
                    const { svg } = await mermaid.render(id, code);
                    node.innerHTML = svg;
                    node.dataset.rendered = "true";
                    node.classList.remove('mermaid-error');
                } catch (err) {
                    // ★ 關鍵修復：顯示具體的錯誤訊息，而不僅僅是原始碼
                    console.warn('[AkariMarkdown] Mermaid Error:', err);
                    
                    // 保留原始碼方便修改
                    node.innerHTML = `
                        <div class="mermaid-error-msg">⚠️ Mermaid Error:\n${this._escapeHtml(err.message)}</div>
                        <div class="mermaid-source">${this._escapeHtml(code)}</div>
                    `;
                    node.classList.add('mermaid-error');
                    
                    // 清理可能產生的殘留 DOM (mermaid 有時會在 body 留垃圾)
                    const stray = document.getElementById('d' + id) || document.getElementById(id);
                    if (stray) stray.remove();
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
