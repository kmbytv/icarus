import { Octokit } from '@octokit/rest';

const OWNER  = 'kmbytv';
const REPO   = 'icarus';
const BRANCH = 'gh-pages';
const PATH   = 'server/data/memory.json';
const MAX_FACTS = 200;

let _octokit = null;
function octokit() {
  if (!_octokit) _octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  return _octokit;
}

// In-memory cache
let _cache = { facts: [], sha: null };
let _writing = false; // simple lock to prevent SHA conflicts on concurrent writes

export async function loadMemory() {
  try {
    const { data } = await octokit().repos.getContent({ owner: OWNER, repo: REPO, path: PATH, ref: BRANCH });
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const parsed = JSON.parse(content);
    _cache = { facts: parsed.facts ?? [], sha: data.sha };
    console.log(`[memory] loaded ${_cache.facts.length} facts from GitHub, sha: ${data.sha?.slice(0, 8)}`);
  } catch (err) {
    const status = err.status ?? err.response?.status;
    if (status === 404) {
      console.log('[memory] memory.json not found, starting fresh');
      _cache = { facts: [], sha: null };
    } else {
      console.error('[memory] loadMemory error:', err.message);
    }
  }
}

export function getMemoryPrompt() {
  if (!_cache.facts.length) return '';
  const recent = _cache.facts.slice(-30).reverse();
  return `## Persistent Memory\n${recent.map(f => `- ${f}`).join('\n')}\n`;
}

export async function extractAndSaveFacts(sessionId, userMsg, assistantMsg, openrouterKey) {
  if (!openrouterKey) return;
  try {
    const prompt = `Extract 0-3 key facts from this conversation. Each fact is one short sentence. Output JSON array only: ["fact1", "fact2"]. If nothing worth remembering, output [].

User: ${userMsg.slice(0, 500)}
Assistant: ${assistantMsg.slice(0, 500)}`;

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
      }),
    });

    if (!resp.ok) {
      console.error('[memory] extract API error:', resp.status);
      return;
    }

    const json = await resp.json();
    const raw = json.choices?.[0]?.message?.content?.trim() ?? '[]';

    let facts;
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      facts = JSON.parse(cleaned);
      if (!Array.isArray(facts)) facts = [];
    } catch {
      console.error('[memory] failed to parse facts JSON:', raw);
      return;
    }

    facts = facts.filter(f => typeof f === 'string' && f.trim()).slice(0, 3);
    if (!facts.length) return;

    // Append to cache
    _cache.facts.push(...facts);
    if (_cache.facts.length > MAX_FACTS) {
      _cache.facts = _cache.facts.slice(-MAX_FACTS);
    }

    // Write back to GitHub
    if (!process.env.GITHUB_TOKEN) {
      console.log('[memory] GITHUB_TOKEN not set, skipping write');
      return;
    }
    if (_writing) {
      console.log('[memory] write in progress, skipping to avoid SHA conflict');
      return;
    }
    _writing = true;

    const fileContent = JSON.stringify({ facts: _cache.facts, updated_at: new Date().toISOString() }, null, 2);
    const encoded = Buffer.from(fileContent, 'utf8').toString('base64');

    const params = {
      owner: OWNER, repo: REPO, path: PATH, branch: BRANCH,
      message: `memory: add ${facts.length} fact(s)`,
      content: encoded,
      ...(  _cache.sha ? { sha: _cache.sha } : {}),
    };

    const { data } = await octokit().repos.createOrUpdateFileContents(params);
    _cache.sha = data.content?.sha ?? _cache.sha;
    console.log(`[memory] saved ${facts.length} fact(s), commit: ${data.commit?.sha?.slice(0, 8)}`);
  } catch (err) {
    console.error('[memory] extractAndSaveFacts error:', err.message);
  } finally {
    _writing = false;
  }
}
