/*!
 * AKARI-Markdown.js v1.0.0
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
            }
            /* 原始碼退回模式的樣式 */
            .mermaid-source {
                font-family: Consolas, Monaco, 'Andale Mono', monospace;
                font-size: 0.85em;
                color: #8b949e; 
                white-space: pre-wrap;
                text-align: left;
                width: 100%;
                opacity: 0.8;
            }
        `;

        this.shadowRoot.appendChild(hostStyle);
        this.shadowRoot.appendChild(this.container);
        this._injectShadowStyles();

        this.options = {
            theme: 'dark', // 保持 dark 主題
            throttleInterval: 50,
            mermaidDebounce: 800,
            hooks: {}
        };

        this.counter = 0;
        this.mathMap = new Map();
        this.codeMap = new Map();
        this._renderTimer = null;
        this._mermaidTimer = null;
        this._latestMarkdown = '';
        this._isRendering = false;

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
            code(code, lang) {
                if (lang === 'mermaid') {
                    // 使用 div 包裹並加上 class，稍後處理
                    return `<div class="mermaid">${code}</div>`;
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

    // 獨立出來配置 Mermaid，確保配置更新時也能生效
    _initMermaidConfig() {
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: this.options.theme,
            securityLevel: 'loose',
            suppressErrorRendering: true, // 嘗試告訴 Mermaid 不要渲染錯誤
        });

        // ★★★ 關鍵修復：覆蓋 Mermaid 的預設錯誤處理器 ★★★
        // 這會阻止 Mermaid 在 document body 底部插入紅色的錯誤 SVG
        mermaid.parseError = function(err, hash) {
            // 這裡留空，什麼都不做。
            // 錯誤會繼續拋出，並由我們的 catch 區塊接管。
            // console.debug('Mermaid parse error suppressed:', err);
        };
    }

    async render(markdownText, force = false) {
        this._latestMarkdown = markdownText || ''; 

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
                ADD_ATTR: ['target', 'class'] 
            });

            if (this.options.hooks.afterSanitize) {
                html = this.options.hooks.afterSanitize(html);
            }

            html = this._restoreAndRenderMath(html);

            this.container.innerHTML = html;

            this._scheduleMermaidRender();

            if (this.options.hooks.onRendered) {
                this.options.hooks.onRendered(this.container);
            }

        } catch (err) {
            console.error('[AkariMarkdown] Render Error:', err);
            this.container.innerHTML = `<div style="color:red;border:1px solid red;padding:10px;">Render Error: ${err.message}</div>`;
        }
    }

    _scheduleMermaidRender() {
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        
        this._mermaidTimer = setTimeout(async () => {
            const nodes = this.container.querySelectorAll('.mermaid');
            
            for (const node of nodes) {
                if (node.querySelector('svg')) continue;

                const code = node.textContent; 
                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

                try {
                    const { svg } = await mermaid.render(id, code);
                    node.innerHTML = svg;
                } catch (err) {
                    // 1. 顯示原始碼作為退回方案
                    node.innerHTML = `<div class="mermaid-source">${this._escapeHtml(code)}</div>`;
                    
                    // 2. ★★★ 防禦性清除 ★★★
                    // 即使我們覆蓋了 parseError，有時 Mermaid 還是會嘗試建立一個帶有 ID 的元素
                    // 為了確保萬無一失，我們檢查文檔中是否存在這個 ID 的元素並移除它
                    const strayErrorElement = document.getElementById('d' + id);
                    if (strayErrorElement) {
                        strayErrorElement.remove();
                    }
                    // 有些版本的 mermaid 會直接用 id 當作錯誤框 id
                    const directErrorElement = document.getElementById(id);
                    if (directErrorElement && directErrorElement !== node) {
                         directErrorElement.remove();
                    }
                }
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
        if (!text) return '';
        let processed = text;
        
        processed = processed.replace(/(\n|^)```[\s\S]*?```/g, (match) => {
            const key = `CODEBLOCK${this.counter++}ENDCODE`; 
            this.codeMap.set(key, match);
            return key;
        });
        processed = processed.replace(/(`+)(.*?)\1/g, (match) => {
            const key = `CODEINLINE${this.counter++}ENDCODE`;
            this.codeMap.set(key, match);
            return key;
        });
        processed = processed.replace(/\\\$/g, (match) => {
            const key = `ESCAPEDDOLLAR${this.counter++}END`;
            this.codeMap.set(key, match);
            return key;
        });
        processed = processed.replace(/(^|\n)\$\$([\s\S]+?)\$\$($|\n)/g, (match, prefix, tex, suffix) => {
            const key = `MATHBLOCK${this.counter++}ENDMATH`;
            this.mathMap.set(key, { tex: tex, display: true });
            return prefix + key + suffix; 
        });
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
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
}

customElements.define('akari-markdown', AkariMarkdownElement);
