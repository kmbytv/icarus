import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, '..', 'workspace');

await fs.mkdir(WORKSPACE, { recursive: true });

const TIMEOUT_MS = 15000;
const MAX_OUTPUT = 8000; // chars

function runProcess(cmd, args, cwd, input) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    if (input) proc.stdin.write(input);
    proc.stdin.end();

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ stdout, stderr: stderr + '\n[timeout: 15s exceeded]', exitCode: -1 });
    }, TIMEOUT_MS);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: -1 });
    });
  });
}

function truncate(s) {
  if (s.length <= MAX_OUTPUT) return s;
  return s.slice(0, MAX_OUTPUT) + `\n...[truncated, ${s.length} chars total]`;
}

// Detect language from filename or explicit lang param
function detectLang(filename, lang) {
  if (lang) return lang.toLowerCase();
  const ext = path.extname(filename).toLowerCase();
  return { '.js': 'js', '.mjs': 'js', '.ts': 'ts', '.py': 'python', '.sh': 'bash' }[ext] ?? 'js';
}

export async function runCode({ code, language = 'js', filename }) {
  if (!code) return { error: 'code is required' };

  const lang = detectLang(filename ?? '', language);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kai-'));

  try {
    let result;

    if (lang === 'python' || lang === 'py') {
      const file = path.join(tmpDir, 'main.py');
      await fs.writeFile(file, code, 'utf8');
      result = await runProcess('python3', [file], tmpDir);

    } else if (lang === 'bash' || lang === 'sh') {
      const file = path.join(tmpDir, 'run.sh');
      await fs.writeFile(file, code, 'utf8');
      await runProcess('chmod', ['+x', file], tmpDir);
      result = await runProcess('bash', [file], tmpDir);

    } else {
      // JavaScript / Node.js
      const file = path.join(tmpDir, 'main.mjs');
      await fs.writeFile(file, code, 'utf8');
      result = await runProcess('node', [file], tmpDir);
    }

    const output = truncate(result.stdout || result.stderr || '(no output)');
    const hasError = result.exitCode !== 0;

    return {
      output,
      stderr: truncate(result.stderr),
      exitCode: result.exitCode,
      success: !hasError,
      error: hasError ? truncate(result.stderr || 'Process exited with code ' + result.exitCode) : undefined,
    };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Write file to persistent workspace
export async function writeWorkspaceFile({ filename, content }) {
  if (!filename) return { error: 'filename is required' };
  const safe = path.basename(filename);
  const dest = path.join(WORKSPACE, safe);
  await fs.writeFile(dest, content ?? '', 'utf8');
  return { success: true, path: `workspace/${safe}` };
}

// Read file from workspace
export async function readWorkspaceFile({ filename }) {
  if (!filename) return { error: 'filename is required' };
  const safe = path.basename(filename);
  try {
    const content = await fs.readFile(path.join(WORKSPACE, safe), 'utf8');
    return { content };
  } catch {
    return { error: `File not found: ${safe}` };
  }
}

// List workspace files
export async function listWorkspaceFiles() {
  const files = await fs.readdir(WORKSPACE);
  return { files };
}
