import vm from 'vm';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE  = path.resolve(__dirname, '..', 'workspace');

// Ensure workspace exists
await fs.mkdir(WORKSPACE, { recursive: true });

// Sandbox globals available to executed code
function makeSandbox() {
  const logs = [];
  const console_ = {
    log:   (...a) => logs.push(a.map(String).join(' ')),
    error: (...a) => logs.push('[err] ' + a.map(String).join(' ')),
    warn:  (...a) => logs.push('[warn] ' + a.map(String).join(' ')),
  };
  return { logs, sandbox: { console: console_, Math, JSON, parseInt, parseFloat, isNaN, isFinite, Number, String, Boolean, Array, Object, Date } };
}

async function code_execute({ language = 'javascript', code }) {
  if (!code || typeof code !== 'string') return { error: 'code is required' };

  if (language !== 'javascript' && language !== 'js') {
    return { error: `language "${language}" is not supported. Only javascript is supported.` };
  }

  const { logs, sandbox } = makeSandbox();
  try {
    const result = vm.runInNewContext(code, sandbox, { timeout: 5000 });
    const output = [
      ...logs,
      result !== undefined ? String(result) : '',
    ].filter(Boolean).join('\n') || '(no output)';
    return { output };
  } catch (err) {
    return { error: err.message };
  }
}

async function code_write({ filename, content }) {
  if (!filename || typeof filename !== 'string') return { error: 'filename is required' };
  // Prevent path traversal
  const safe = path.basename(filename);
  const dest  = path.join(WORKSPACE, safe);
  try {
    await fs.writeFile(dest, content ?? '', 'utf8');
    return { success: true, path: `workspace/${safe}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function code_read({ filename }) {
  if (!filename || typeof filename !== 'string') return { error: 'filename is required' };
  const safe = path.basename(filename);
  const src   = path.join(WORKSPACE, safe);
  try {
    const content = await fs.readFile(src, 'utf8');
    return { content };
  } catch (err) {
    return { error: err.message };
  }
}

export async function executeTool(toolName, args = {}) {
  switch (toolName) {
    case 'code_execute': return code_execute(args);
    case 'code_write':   return code_write(args);
    case 'code_read':    return code_read(args);
    default:             return { error: `Unknown tool: "${toolName}"` };
  }
}
