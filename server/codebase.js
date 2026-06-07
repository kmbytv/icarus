import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve('..')
const OUT = resolve('./CODEBASE.md')
const EXT = ['.js', '.html', '.py', '.json', '.css', '.md', '.env']
const SKIP = ['node_modules', '.git', 'data', 'workspace', 'CODEBASE.md']

function walk(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue
    const p = resolve(dir, name)
    if (statSync(p).isDirectory()) { files.push(...walk(p)); continue }
    if (EXT.some(e => name.endsWith(e))) files.push(p)
  }
  return files
}

const files = walk(ROOT)
const lines = ['# KAI Codebase\n']

for (const f of files.sort()) {
  const rel = f.replace(ROOT, '').replace(/^\//, '')
  lines.push(`## ${rel}\n`)
  try {
    const content = readFileSync(f, 'utf8')
    const ext = rel.split('.').pop()
    const map = { js: 'js', html: 'html', py: 'python', json: 'json', css: 'css', md: 'markdown', env: 'env' }
    lines.push('```' + (map[ext] || '') + '\n' + content + '\n```\n')
  } catch {}
}

writeFileSync(OUT, lines.join('\n'))
console.log(`Written ${files.length} files to CODEBASE.md`)