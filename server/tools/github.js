import { Octokit } from '@octokit/rest';

const OWNER  = 'kmbytv';
const REPO   = 'icarus';
const BRANCH = 'gh-pages';

function octokit() {
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

const MAX_FILE_BYTES = 40_000;

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
    console.error('[github] read_file error:', err.message);
    return { error: err.message };
  }
}

export async function githubWriteFile(path, content, message) {
  console.log('[github] write_file:', path);
  try {
    const kit = octokit();
    let sha;
    try {
      const { data } = await kit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
      sha = data.sha;
    } catch { /* file doesn't exist yet */ }

    const { data } = await kit.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO, path, branch: BRANCH,
      message: message || `update ${path}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    });
    console.log('[github] write_file ok:', path);
    return { commit_url: data.commit.html_url };
  } catch (err) {
    console.error('[github] write_file error:', err.message);
    return { error: err.message };
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
    return data.map(({ name, path, type }) => ({ name, path, type }));
  } catch (err) {
    console.error('[github] list_files error:', err.message);
    return { error: err.message };
  }
}
