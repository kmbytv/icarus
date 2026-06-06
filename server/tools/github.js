import { Octokit } from '@octokit/rest';

const OWNER  = 'kmbytv';
const REPO   = 'icarus';
const BRANCH = 'gh-pages';

function octokit() {
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

export async function githubReadFile(path) {
  try {
    const { data } = await octokit().repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    if (data.type !== 'file') return { error: `${path} is not a file` };
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return { content, sha: data.sha };
  } catch (err) {
    return { error: err.message };
  }
}

export async function githubWriteFile(path, content, message) {
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
    return { commit_url: data.commit.html_url };
  } catch (err) {
    return { error: err.message };
  }
}

export async function githubListFiles(dirPath) {
  try {
    const { data } = await octokit().repos.getContent({
      owner: OWNER, repo: REPO, path: dirPath || '.', ref: BRANCH,
    });
    if (!Array.isArray(data)) return { error: `${dirPath} is not a directory` };
    return data.map(({ name, path, type }) => ({ name, path, type }));
  } catch (err) {
    return { error: err.message };
  }
}
