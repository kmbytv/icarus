import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const ROOT = resolve(__dirname, '..')
const OUT = resolve(__dirname, '..', 'CODEBASE.md')
const EXT = ['.js', '.html', '.py', '.json', '.css', '.md', '.env.example']
const SKIP = ['node_modules', '.git', 'data', 'workspace', 'CODEBASE.md']

function walk(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue
    const p = resolve(dir, name)
    try {
      if (statSync(p).isDirectory()) { files.push(...walk(p)); continue }
      if (EXT.some(e => name.endsWith(e))) files.push(p)
    } catch { /* ignore */ }
  }
  return files
}

const files = walk(ROOT)
const lines = ['# KAI Codebase\n']

for (const f of files.sort()) {
  let rel = f.replace(ROOT, '').replace(/^\//, '')
  if (!rel.startsWith('server/') && !rel.startsWith('index.html') && !rel.startsWith('settings.html')) continue
  lines.push(`## ${rel}\n`)
  try {
    const content = readFileSync(f, 'utf8')
    const ext = rel.split('.').pop()
    const lang = { js: 'js', html: 'html', py: 'python', json: 'json', css: 'css', md: 'markdown', example: 'env' }[ext] || ''
    lines.push('```' + lang + '\n' + content + '\n```\n')
  } catch {}
}

writeFileSync(OUT, lines.join('\n'))
console.log(`✅ Written ${files.length} files to CODEBASE.md`)