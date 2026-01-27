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
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js';
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
            .markdown-body { background: transparent; font-family: sans-serif; line-height: 1.6; }
            .mermaid { display: flex; justify-content: center; margin: 1em 0; background: transparent; }
            pre { position: relative; }
        `;

        this.shadowRoot.appendChild(hostStyle);
        this.shadowRoot.appendChild(this.container);
        this._injectShadowStyles();

        this.options = {
            theme: 'default',
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
        // Mermaid Init
        mermaid.initialize({ 
            startOnLoad: false, 
            theme: this.options.theme,
            securityLevel: 'loose'
        });

        // Marked Init (Fix: 使用 renderer 物件實字，並修正參數)
        const renderer = {
            code(code, lang) {
                // Mermaid 攔截
                if (lang === 'mermaid') {
                    return `<div class="mermaid">${code}</div>`;
                }
                // Highlight.js
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        const highlighted = hljs.highlight(code, { language: lang }).value;
                        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
                    } catch (e) {
                        console.warn('Highlight error:', e);
                    }
                }
                return `<pre><code class="hljs">${code}</code></pre>`;
            }
        };

        marked.use({ renderer });
    }

    async render(markdownText, force = false) {
        this._latestMarkdown = markdownText || ''; // 防止 undefined

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
            // Hooks: beforeParse
            if (this.options.hooks.beforeParse) {
                text = this.options.hooks.beforeParse(text);
            }

            // Reset
            this.mathMap.clear();
            this.codeMap.clear();
            this.counter = 0;

            // 1. 保護代碼與公式
            let processed = this._protectCodeAndMath(text);
            
            // 2. Marked 解析
            let html = marked.parse(processed);

            // 3. DOMPurify 淨化
            html = DOMPurify.sanitize(html, {
                ADD_TAGS: ['iframe'],
                ADD_ATTR: ['target', 'class'] 
            });

            // Hooks: afterSanitize
            if (this.options.hooks.afterSanitize) {
                html = this.options.hooks.afterSanitize(html);
            }

            // 4. 還原並渲染公式
            html = this._restoreAndRenderMath(html);

            // 5. 更新 DOM
            this.container.innerHTML = html;

            // 6. 排程 Mermaid
            this._scheduleMermaidRender();

            // Hooks: onRendered
            if (this.options.hooks.onRendered) {
                this.options.hooks.onRendered(this.container);
            }

        } catch (err) {
            console.error('[AkariMarkdown] Render Error:', err);
            this.container.innerHTML = `<div style="color:red; border:1px solid red; padding:10px;">
                <strong>Render Error:</strong> ${err.message}
            </div>`;
        }
    }

    _scheduleMermaidRender() {
        if (this._mermaidTimer) clearTimeout(this._mermaidTimer);
        
        this._mermaidTimer = setTimeout(async () => {
            const nodes = this.container.querySelectorAll('.mermaid');
            if (nodes.length === 0) return;
            try {
                // Mermaid 10+ run API
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
        if (!text) return '';
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
        // Restore Code Maps (讓 marked 處理程式碼，但 math 已被挖空)
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
                console.warn('[KaTeX Error]', e);
                result = result.split(key).join(`<span style="color:red">${value.tex}</span>`);
            }
        });
        return result;
    }
}

customElements.define('akari-markdown', AkariMarkdownElement);
