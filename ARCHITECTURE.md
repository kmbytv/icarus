# KAI — Project Architecture

## Frontend (GitHub Pages — `kmbytv.github.io/icarus/`)

| File | Description |
|------|-------------|
| `index.html` | Pure markup, no inline styles or scripts. Loads CDN libs, `styles.css`, and `src/app.js` as an ES module. |
| `styles.css` | All CSS — variables, layout, components, animations, markdown styling, mobile breakpoints. |
| `src/app.js` | Entry point. Initialises the app, exposes functions to `window` for HTML onclick handlers, sets up event listeners (keyboard shortcuts, drag & drop, input), starts clock. |
| `src/ui.js` | DOM manipulation — rendering messages, progress bar, feed scroll, tab switching, sidebar, chat history loading. |
| `src/chat.js` | Network layer — SSE streaming (`sendToAgent`), file attachment, send/stop logic, Code tab (sendToCodeAgent, tool chain UI). |
| `src/settings.js` | Settings panel, API banner, localStorage for dismissed state, pin button. |
| `src/utils.js` | Stateless helpers — `pad`, `nowStr`, `formatUptime`, `sleep`. Markdown setup (marked + hljs renderer), `renderAgentBody`, `copyCodeBlock`. |

## Backend (Railway — `icarus-production-5c67.up.railway.app`)

| File | Description |
|------|-------------|
| `server/index.js` | Express server. `POST /chat` streams SSE responses, handles native tool_calls + text-based fallback, planner, file uploads. |
| `server/openrouter.js` | OpenAI SDK client pointed at OpenRouter. |
| `server/planner.js` | Two-layer task planner — heuristic filter + LLM classifier. Returns step list for complex tasks. |
| `server/memory.js` | Long-term SQLite memory — stores messages, exposes `getMemoryContext` + `saveMessage`. |
| `server/storage.js` | Atomic JSON file read/write to `/data` (Railway persistent volume). Used for session history. |
| `server/cron.js` | Scheduled tasks (node-cron). |
| `server/tools/code.js` | Code execution tool. |
| `server/tools/github.js` | GitHub API tools — read/write/list files in `kmbytv/icarus` on `gh-pages` branch. |
| `server/tools/search.js` | Exa API — `webSearch` and `webFetch`. |
