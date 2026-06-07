import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT      = resolve(__dirname, '../..');

// Files to always include (relative to ROOT)
const INCLUDE_DIRS  = ['server'];
const INCLUDE_FILES = ['index.html'];
const SKIP_FILES    = ['package-lock.json', 'CODEBASE.md'];
const SKIP_DIRS     = ['node_modules', '.git', 'data', 'workspace', '.claude'];
const EXTS          = ['.js', '.json', '.html', '.md'];

// index.html is large — include only the <script> portion
const HTML_SCRIPT_RE = /<script>([\s\S]*?)<\/script>\s*$/;

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.includes(name) || SKIP_FILES.includes(name)) continue;
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) { files.push(...walk(p)); continue; }
    if (EXTS.some(e => name.endsWith(e))) files.push(p);
  }
  return files;
}

function buildSnapshot() {
  const parts = ['# KAI codebase snapshot\n'];
  const seen  = new Set();

  const addFile = (absPath) => {
    if (seen.has(absPath)) return;
    seen.add(absPath);
    const rel = relative(ROOT, absPath);
    let content;
    try { content = readFileSync(absPath, 'utf8'); } catch { return; }

    // For index.html only include the JS block to save tokens
    if (rel === 'index.html') {
      const m = content.match(HTML_SCRIPT_RE);
      content = m ? `// <script> block only\n${m[1].trim()}` : content.slice(0, 8000) + '\n...[truncated]';
    }
    const ext = rel.split('.').pop();
    const lang = { js: 'js', json: 'json', html: 'html', md: '' }[ext] ?? '';
    parts.push(`## ${rel}\n\`\`\`${lang}\n${content}\n\`\`\`\n`);
  };

  // Server files first
  for (const dir of INCLUDE_DIRS) {
    for (const f of walk(resolve(ROOT, dir)).sort()) addFile(f);
  }
  // Then root-level includes
  for (const f of INCLUDE_FILES) addFile(resolve(ROOT, f));

  return parts.join('\n');
}

let _cached = null;
let _cachedAt = 0;
const CACHE_TTL = 60_000; // 1 min — refresh after deploys

export function getCodebase() {
  const now = Date.now();
  if (!_cached || now - _cachedAt > CACHE_TTL) {
    _cached  = buildSnapshot();
    _cachedAt = now;
    const kb = (_cached.length / 1024).toFixed(1);
    console.log(`[codebase] snapshot built: ${kb} KB`);
  }
  return _cached;
}
