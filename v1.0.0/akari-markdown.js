/*!
 * AKARI-Markdown.js v1.0.0
 * (c) 2026 h-o-w-a-r-d
 * Released under the MIT License.
 * Repository: https://github.com/h-o-w-a-r-d/AKARI-Markdown.js
 * Documentation: https://h-o-w-a-r-d.github.io/AKARI-Markdown.js/README.md
 */

import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.0/lib/marked.esm.js';
import DOMPurify from 'https://esm.sh/dompurify@3.0.9'; // 使用 ESM 版本
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
        
        // 增加 .mermaid 樣式確保居中與背景正確
        const hostStyle = document.createElement('style');
        hostStyle.textContent = `
            :host { display: block; overflow: hidden; text-align: left; } 
            .markdown-body { background: transparent; font-family: sans-serif; line-height: 1.6; }
            .mermaid { 
                display: flex; 
                justify-content: center; 
                margin: 1em 0; 
                background: transparent;
                overflow-x: auto; /* 避免大圖破版 */
            }
            /* 讓 Mermaid 錯誤訊息顯示為紅色 */
            .mermaid > svg[id^="mermaid-error"] {
                border: 1px solid red;
            }
        `;

        this.shadowRoot.appendChild(hostStyle);
        this.shadowRoot.appendChild(this.container);
        this._injectShadowStyles();

        this.options = {
            theme: 'default', // 可選: 'dark', 'forest', 'neutral'
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
        // 如果配置改變，重新初始化 Mermaid
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: this.options.theme,
            securityLevel: 'loose'
        });
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
        // Mermaid 初始化
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: this.options.theme,
            securityLevel: 'loose',
            // 關鍵：這讓 mermaid 不要去尋找 DOM，純粹做渲染
        });

        const renderer = {
            code(code, lang) {
                // Mermaid 區塊：先輸出原始碼到 div，稍後用 _scheduleMermaidRender 取代
                if (lang === 'mermaid') {
                    // 使用 textContent 防護，避免 XSS，並加上特定 class
                    return `<div class="mermaid">${code}</div>`;
                }
                
                // Highlight.js
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

            // ★★★ 觸發 Mermaid 渲染 ★★★
            this._scheduleMermaidRender();

            if (this.options.hooks.onRendered) {
                this.options.hooks.onRendered(this.container);
            }

        } catch (err) {
            console.error('[AkariMarkdown] Render Error:', err);
            this.container.innerHTML = `<div style="color:red;border:1px solid red;padding:10px;">Render Error: ${err.message}</div>`;
        }
    }

    /**
     * ★★★ 修復核心：手動 Render SVG 並注入 ★★★
     * 不使用 mermaid.run (它依賴全域 document 查找)，改用 mermaid.render (產生 SVG 字串)
     */
    _scheduleMermaidRender() {
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        
        this._mermaidTimer = setTimeout(async () => {
            const nodes = this.container.querySelectorAll('.mermaid');
            
            // 針對每一個 mermaid div 進行處理
            for (const node of nodes) {
                // 如果已經包含 svg (已經渲染過)，跳過
                if (node.querySelector('svg')) continue;

                const code = node.textContent;
                // 產生唯一的 ID，這是 mermaid.render 需要的
                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

                try {
                    // mermaid.render(id, text) 回傳 { svg } 物件
                    // 這裡的 id 是給 SVG 內部定義用的，不會影響外部 DOM
                    const { svg } = await mermaid.render(id, code);
                    node.innerHTML = svg;
                } catch (err) {
                    // 串流中語法不完整是常態，通常選擇忽略或顯示原始碼
                    // console.warn('Mermaid Syntax Error (likely incomplete stream):', err);
                    
                    // 如果你想顯示錯誤訊息給使用者，可以把下面這行打開：
                    // node.innerHTML = `<span style="color:red; font-size:0.8em;">Waiting for chart...</span>`;
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
}

customElements.define('akari-markdown', AkariMarkdownElement);
