import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import client from './openrouter.js';
import { executeTool } from './tools/code.js';
import { githubReadFile, githubWriteFile, githubListFiles } from './tools/github.js';
import { getMemoryContext, saveMessage } from './memory.js';
import './cron.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://kmbytv.github.io',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:8080',
];

const corsOptions = {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 204,
};

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());

// ── System prompt with tool descriptions ────────────────────────
const TOOLS_SYSTEM = `You are KAI, a personal AI agent. You have access to tools you can invoke at any point in your response.

To call a tool, output a JSON block on its own line in this exact format:
{"tool":"<tool_name>","args":{...}}

After the tool call you will receive a result block:
{"tool_result":{...}}

Then continue your response naturally.

Available tools:

1. code_execute — Run JavaScript code in a sandboxed Node.js vm.
   Args: { "language": "javascript", "code": "<code string>" }
   Returns: { "output": "..." } or { "error": "..." }

2. code_write — Write a file to the workspace.
   Args: { "filename": "example.js", "content": "<file content>" }
   Returns: { "success": true, "path": "workspace/example.js" }

3. code_read — Read a file from the workspace.
   Args: { "filename": "example.js" }
   Returns: { "content": "..." } or { "error": "..." }

4. github_read_file — Read a file from the GitHub repo kmbytv/icarus (branch gh-pages).
   Args: { "path": "index.html" }
   Returns: { "content": "...", "sha": "..." } or { "error": "..." }

5. github_write_file — Create or update a file in the GitHub repo and commit it.
   Args: { "path": "server/index.js", "content": "<full file content>", "message": "commit message" }
   Returns: { "commit_url": "..." } or { "error": "..." }

6. github_list_files — List files and folders in a directory of the repo.
   Args: { "dir_path": "server" }
   Returns: array of { name, path, type } or { "error": "..." }

Rules:
- Only call one tool per JSON block.
- Always wait for the tool result before continuing.
- If a tool returns an error, explain it to the user and suggest a fix.
- Never fabricate tool results — only use what is returned.
- When modifying repo files with github_write_file, always read the file first with github_read_file.`;

// ── In-memory session history ───────────────────────────────────
const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

// ── Tool call parser ────────────────────────────────────────────
// Returns { toolName, args } if the line is a tool call, else null
function parseToolCall(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{"tool"')) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj.tool && typeof obj.tool === 'string') return { toolName: obj.tool, args: obj.args ?? {} };
  } catch { /* not valid JSON */ }
  return null;
}

// ── POST /chat ──────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, sessionId = 'default', systemPrompt } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  // ── SSE headers ─────────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const history = getHistory(sessionId);

    // Build system prompt: memory context + tools description + optional user-supplied prompt
    const memoryContext = getMemoryContext();
    const sysContent = [
      memoryContext ? `## Контекст из памяти\n${memoryContext}\n` : '',
      TOOLS_SYSTEM,
      systemPrompt?.trim() ? `\nAdditional instructions:\n${systemPrompt.trim()}` : '',
    ].join('');

    // Build message list for this turn
    const messages = [
      { role: 'system', content: sysContent },
      ...history,
      { role: 'user', content: message.trim() },
    ];

    let fullAssistantText = '';

    // Tool loop — runs until the model stops emitting tool calls
    while (true) {
      const stream = await client.chat.completions.create({
        model:  'deepseek/deepseek-chat-v3-0324:free',
        stream: true,
        messages,
        tools: [
          { type: 'openrouter:web_search' },
          { type: 'openrouter:web_fetch' },
          {
            type: 'function',
            function: {
              name: 'github_read_file',
              description: 'Читает файл из GitHub репо kmbytv/icarus',
              parameters: {
                type: 'object',
                properties: { path: { type: 'string', description: 'Путь к файлу, например index.html или server/index.js' } },
                required: ['path'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'github_write_file',
              description: 'Записывает или обновляет файл в GitHub репо kmbytv/icarus и делает коммит',
              parameters: {
                type: 'object',
                properties: {
                  path:    { type: 'string' },
                  content: { type: 'string', description: 'Полное содержимое файла' },
                  message: { type: 'string', description: 'Сообщение коммита' },
                },
                required: ['path', 'content', 'message'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'github_list_files',
              description: 'Возвращает список файлов в директории репо',
              parameters: {
                type: 'object',
                properties: { dir_path: { type: 'string', description: 'Путь к папке, например server или .' } },
                required: ['dir_path'],
              },
            },
          },
        ],
      });

      let turnText = '';
      let lineBuf  = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (!delta) continue;

        turnText += delta;
        lineBuf  += delta;

        // Stream delta to client regardless — tool call lines will be
        // re-processed below, but we want the user to see thinking text.
        send({ type: 'delta', text: delta });

        // Check completed lines for tool calls
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop(); // last element may be incomplete
        for (const line of lines) {
          const call = parseToolCall(line);
          if (call) {
            // Notify client a tool is being invoked
            send({ type: 'tool_call', tool: call.toolName, args: call.args });
          }
        }
      }

      fullAssistantText += turnText;

      // ── Scan completed turn for tool calls ──────────────────
      const toolCall = turnText.split('\n').map(parseToolCall).find(Boolean);

      if (!toolCall) {
        // No tool call → done
        break;
      }

      // Execute tool, feed result back as a new user message, loop
      let result;
      try {
        switch (toolCall.toolName) {
          case 'github_read_file':  result = await githubReadFile(toolCall.args.path);                                                break;
          case 'github_write_file': result = await githubWriteFile(toolCall.args.path, toolCall.args.content, toolCall.args.message); break;
          case 'github_list_files': result = await githubListFiles(toolCall.args.dir_path);                                           break;
          default:                  result = await executeTool(toolCall.toolName, toolCall.args);
        }
      } catch (toolErr) {
        console.error('[tool dispatch error]', toolCall.toolName, toolErr?.message ?? toolErr);
        result = { error: toolErr?.message ?? 'Tool execution failed' };
      }
      const resultLine = JSON.stringify({ tool_result: result });

      send({ type: 'tool_result', tool: toolCall.toolName, result });

      // Append this assistant turn + tool result to messages for next loop
      messages.push({ role: 'assistant', content: turnText });
      messages.push({ role: 'user',      content: resultLine });
      fullAssistantText += '\n' + resultLine;

      // Safety: max 6 tool rounds to prevent infinite loops
      const toolRounds = messages.filter(m => m.role === 'user' && m.content.startsWith('{"tool_result"')).length;
      if (toolRounds >= 6) break;
    }

    // Persist the full conversation turn to history
    history.push({ role: 'user',      content: message.trim() });
    history.push({ role: 'assistant', content: fullAssistantText });
    if (history.length > 40) history.splice(0, history.length - 40);

    // Persist to long-term SQLite memory
    saveMessage(sessionId, 'user',      message.trim());
    saveMessage(sessionId, 'assistant', fullAssistantText);

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error('[/chat error]', err?.message ?? err);
    send({ type: 'error', message: err?.message ?? 'Unknown error' });
    res.end();
  }
});

// ── DELETE /session/:id — clear history ─────────────────────────
app.delete('/session/:id', (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

// ── Health check ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`KAI backend listening on :${PORT}`));
