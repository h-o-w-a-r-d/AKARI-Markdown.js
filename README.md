# AKARI-Markdown.js 🌌

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Web Component](https://img.shields.io/badge/Web%20Component-Custom%20Element-orange)](https://developer.mozilla.org/en-US/docs/Web/API/Web_components)
[![LLM Optimized](https://img.shields.io/badge/LLM-Streaming%20Optimized-blue)](https://github.com/features/copilot)

**AKARI-Markdown** is a modern, zero-config, and high-performance Markdown rendering engine encapsulated as a **Web Component**. It is specifically architected for the **LLM (Large Language Model) era**, featuring smart throttling for real-time streaming and complete CSS isolation via **Shadow DOM**.

---

## ✨ Features

*   **🛡️ Perfect Isolation**: Powered by **Shadow DOM**. Styles from your host page won't leak in, and AKARI's styles won't break your site.
*   **🚀 LLM Streaming Ready**: 
    *   **Throttled Text Rendering**: Efficiently handles high-frequency updates (tokens) without freezing the UI.
    *   **Debounced Diagrams**: Mermaid charts wait for syntax completion before rendering to prevent flickering or errors.
*   **📊 Rich Syntax Support**:
    *   **Math**: Full LaTeX support via [KaTeX](https://katex.org/).
    *   **Diagrams**: Support for Flowcharts, Gantt, Sequence, and more via [Mermaid.js](https://mermaid.js.org/).
    *   **Syntax Highlighting**: Beautiful code blocks via [Highlight.js](https://highlightjs.org/).
*   **🔗 Hook API**: Flexible lifecycle hooks for pre-processing and post-rendering tasks.
*   **🔒 Security**: Deeply sanitized output using [DOMPurify](https://github.com/cure53/dompurify).

---

## 📦 Quick Start

### 1. Include the Module
Add the script to your HTML. Since it uses ES Modules and imports dependencies from CDNs, no build step is required.

```html
<script type="module" src="./js/akari-markdown.js"></script>
```

### 2. Use the Custom Element
Simply drop the tag into your HTML:

```html
<akari-markdown id="ai-chat"></akari-markdown>
```

### 3. Render Content
Update the content via JavaScript:

```javascript
const viewer = document.getElementById('ai-chat');

// Standard rendering
viewer.value = "# Hello World\nThis is **Markdown**.";

// Streaming simulation
function onTokenReceived(chunk) {
    viewer.value += chunk; // Automatically throttled internally
}
```

---

## ⚙️ Configuration & Hooks

You can fine-tune the behavior and hook into the rendering lifecycle using the `config` property.

```javascript
const viewer = document.querySelector('akari-markdown');

viewer.config = {
    throttleInterval: 50,  // Update text every 50ms
    mermaidDebounce: 800,  // Render charts 800ms after last token
    theme: 'default',      // Mermaid theme
    hooks: {
        beforeParse: (md) => {
            // Modify raw markdown before parsing
            return md.replace(/\[USER\]/g, 'Guest');
        },
        afterSanitize: (html) => {
            // Modify HTML string after security check
            return html;
        },
        onRendered: (container) => {
            // Fired after DOM update. Great for "Scroll to bottom"
            console.log("Render completed!");
            window.scrollTo(0, document.body.scrollHeight);
        }
    }
};
```

---

## 🛠 API Reference

### Properties
| Property | Type | Description |
| :--- | :--- | :--- |
| `value` | `string` | **Getter/Setter**. The raw Markdown content. |
| `config` | `object` | **Setter**. Configures options and lifecycle hooks. |

### Methods
| Method | Params | Description |
| :--- | :--- | :--- |
| `render(text, force)` | `string, boolean` | Renders text. If `force` is true, bypasses throttle (useful for the final token). |

### Attributes
| Attribute | Description |
| :--- | :--- |
| `no-render` | If present, prevents the component from rendering initial text content on load. |

---

## 🎨 Styling

AKARI-Markdown uses a built-in **GitHub Dark** theme for the Markdown body inside the Shadow DOM. To change the container's look (like height or border) from your main CSS:

```css
akari-markdown {
    height: 500px;
    border: 1px solid #333;
    border-radius: 8px;
}
```

Because of the **Shadow DOM**, if you want to change internal styles (like the color of `<h1>`), you must do so via the `hostStyle` inside the component source or use CSS Parts (if implemented).

---

## 🗂 Dependencies

AKARI-Markdown stands on the shoulders of giants:
*   [marked](https://github.com/markedjs/marked) - Markdown Parser
*   [DOMPurify](https://github.com/cure53/dompurify) - XSS Sanitizer
*   [KaTeX](https://github.com/KaTeX/KaTeX) - Math Rendering
*   [Mermaid.js](https://github.com/mermaid-js/mermaid) - Diagram Rendering
*   [Highlight.js](https://github.com/highlightjs/highlight.js) - Code Highlighting

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---messy world of streaming Markdown.
