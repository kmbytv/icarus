import { Octokit } from '@octokit/rest';

const OWNER  = 'kmbytv';
const REPO   = 'icarus';
const BRANCH = 'gh-pages';

let _octokit = null;
function octokit() {
  if (!_octokit) _octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  return _octokit;
}

const MAX_FILE_BYTES = 40_000;

function fmtErr(err) {
  const status = err.status ?? err.response?.status;
  if (status === 401) return 'GitHub auth failed — GITHUB_TOKEN is missing or invalid';
  if (status === 403) return 'GitHub forbidden — token has no write permission to this repo';
  if (status === 404) return `GitHub 404 — file or branch not found (branch: ${BRANCH})`;
  if (status === 422) return `GitHub 422 — SHA conflict, try reading the file first`;
  return err.message ?? String(err);
}

export async function githubReadFile(path) {
  console.log('[github] read_file:', path);
  try {
    const { data } = await octokit().repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    if (data.type !== 'file') return { error: `${path} is not a file` };
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    if (content.length > MAX_FILE_BYTES) {
      console.log('[github] read_file truncated:', path, content.length, 'bytes');
      return {
        content: content.slice(0, MAX_FILE_BYTES),
        sha: data.sha,
        truncated: true,
        total_bytes: content.length,
        note: `File truncated to ${MAX_FILE_BYTES} bytes. Full file is ${content.length} bytes.`,
      };
    }
    console.log('[github] read_file ok:', path, content.length, 'bytes');
    return { content, sha: data.sha };
  } catch (err) {
    const msg = fmtErr(err);
    console.error('[github] read_file error:', msg);
    return { error: msg };
  }
}

export async function githubWriteFile(path, content, message) {
  console.log('[github] write_file:', path);
  if (!process.env.GITHUB_TOKEN) {
    console.error('[github] write_file: GITHUB_TOKEN not set');
    return { error: 'GITHUB_TOKEN is not configured — cannot write to GitHub' };
  }
  try {
    const kit = octokit();
    let sha;
    try {
      const { data } = await kit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
      sha = data.sha;
      console.log('[github] write_file got sha for existing file:', sha?.slice(0, 8));
    } catch (e) {
      if ((e.status ?? e.response?.status) === 404) {
        console.log('[github] write_file: new file (no sha needed)');
      } else {
        throw e;
      }
    }

    const { data } = await kit.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO, path, branch: BRANCH,
      message: message || `update ${path}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    });
    console.log('[github] write_file ok:', path, data.commit?.sha?.slice(0, 8));
    return { success: true, commit_sha: data.commit?.sha, commit_url: data.commit?.html_url };
  } catch (err) {
    const msg = fmtErr(err);
    console.error('[github] write_file error:', msg);
    return { error: msg };
  }
}

export async function githubListFiles(dirPath) {
  console.log('[github] list_files:', dirPath);
  try {
    const { data } = await octokit().repos.getContent({
      owner: OWNER, repo: REPO, path: dirPath || '.', ref: BRANCH,
    });
    if (!Array.isArray(data)) return { error: `${dirPath} is not a directory` };
    console.log('[github] list_files ok:', dirPath, data.length, 'items');
    return data.map(({ name, path, type, size }) => ({ name, path, type, size }));
  } catch (err) {
    const msg = fmtErr(err);
    console.error('[github] list_files error:', msg);
    return { error: msg };
  }
}

// Quick health check — verifies token and write access
export async function githubCheckAccess() {
  if (!process.env.GITHUB_TOKEN) return { ok: false, error: 'GITHUB_TOKEN not set' };
  try {
    const { data } = await octokit().repos.get({ owner: OWNER, repo: REPO });
    const canWrite = data.permissions?.push ?? false;
    return {
      ok: true,
      repo: `${OWNER}/${REPO}`,
      branch: BRANCH,
      can_write: canWrite,
      private: data.private,
    };
  } catch (err) {
    return { ok: false, error: fmtErr(err) };
  }
}
