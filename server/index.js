import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import client from './openrouter.js';
import { executeTool } from './tools/code.js';
import { runCode } from './tools/runner.js';
import { githubReadFile, githubWriteFile, githubListFiles, githubCheckAccess } from './tools/github.js';
import { webSearch, webFetch } from './tools/search.js';
import { getWeather } from './tools/weather.js';
import { initiateConnection, getConnectionStatus, getComposioTools, executeComposioAction, isComposioTool } from './tools/composio.js';
import { runPlanner } from './planner.js';
import { runCodeAgent } from './code-agent.js';
import { classifyTask, classifyCodeType } from './router.js';
import { getMemoryContext, saveMessage } from './memory.js';
import { readJSON, writeJSON } from './storage.js';
import { initMCP, getMCPTools, callMCPTool, isMCPTool } from './mcp-client.js';
import { loadMemory, getMemoryPrompt, extractAndSaveFacts } from './tools/persistent-memory.js';
import { getCodebase } from './tools/codebase.js';
import './cron.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Default model ────────────────────────────────────────────────
const DEFAULT_MODEL = process.env.MODEL || 'deepseek/deepseek-v4-flash';

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
  allowedHeaders: ['Content-Type', 'x-composio-key'],
  optionsSuccessStatus: 204,
};

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: '20mb' }));

// ── System prompt ────────────────────────────────────────────────
const TOOLS_SYSTEM = `You are KAI — a personal AI agent built for Daniil. You are direct, sharp, and efficient. No filler phrases like "Great question!" or "Of course!". Get to the point.

## Language
Respond in the same language the user writes in. If Russian — respond in Russian. If English — in English. Mix is fine.

## Who you are
You are Daniil's personal agent. He is 17, lives in the Russian Far East, planning to move to Japan, learning Japanese and economics, runs freelance AI projects (Fiverr/Workzilla), building this agent (KAI) himself. His main stack: Node.js, Python, Telegram bots, n8n, Claude/Gemini APIs.

## Your own codebase — repo: kmbytv/icarus, branch: gh-pages
You CAN read and modify your own source code. Key files:
- server/index.js       — main Express server, tool dispatch, system prompt (THIS file)
- server/router.js      — classifies tasks: chat / reason / code
- server/code-agent.js  — two-step coding agent (architect + coder + run loop)
- server/planner.js     — task planner for non-chat routes
- server/memory.js      — in-memory context across turns
- server/mcp-client.js  — MCP protocol client
- server/tools/github.js    — GitHub read/write/list/check
- server/tools/runner.js    — real code execution (Node/Python/Bash in sandbox)
- server/tools/composio.js  — Composio OAuth integrations
- server/tools/search.js    — web search + fetch
- server/tools/weather.js   — weather API
- index.html            — frontend (all-in-one, no build step)
- mcp.config.json       — MCP server configs

## Self-modification protocol
When asked to improve or fix anything in the project:
1. get_codebase — call this FIRST, get full snapshot of all source files
2. Make precise targeted changes based on what you read
3. github_write_file — write the modified file(s) with descriptive commit message
4. Tell Daniil: "Done. Railway will redeploy in ~2 min."
NEVER write partial files — always include complete file content.
NEVER skip get_codebase — you need full context to avoid breaking other parts.

## Tools

get_codebase — full snapshot of all KAI source files in one call (use this first for any code task)

web_search — current events, news, prices, anything that could have changed
web_fetch   — read a specific URL in full (use after search)

github_read_file   — read a specific file (use when you need one file after get_codebase)
github_write_file  — write/update a file and commit (SHA is handled automatically)
github_list_files  — list files in a directory
github_check_access — verify GitHub token and write permissions (run first if write fails)

get_weather — current weather by city
code_run    — execute code in sandbox (Node.js, Python, Bash) — use for calculations and tests

## Memory
Context from past sessions is provided at the start. Use it naturally — don't announce it.

## Rules
- Never fabricate — search or admit you don't know
- Always read a file before writing it
- Be concise — no walls of text unless asked
- No validation or filler phrases`;

// ── Persistent session history ──────────────────────────────────
function getHistory(sessionId) {
  return readJSON(`session_${sessionId}.json`, []);
}

function saveHistory(sessionId, history) {
  if (history.length > 40) history = history.slice(-40);
  writeJSON(`session_${sessionId}.json`, history);
}

// ── Tool call parser ────────────────────────────────────────────
function parseToolCall(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{"tool')) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj.tool && typeof obj.tool === 'string') return { toolName: obj.tool, args: obj.args ?? {} };
  } catch { /* not valid JSON */ }
  return null;
}

// ── POST /chat ──────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, sessionId = 'default', systemPrompt, file, model } = req.body;

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
  const ping = () => res.write(': ping\n\n');

  // Keep-alive: send SSE comments every 20s so Railway doesn't kill the connection
  const heartbeat = setInterval(ping, 20000);
  res.on('close', () => clearInterval(heartbeat));

  try {
    console.log('[chat] incoming:', sessionId, JSON.stringify(message).slice(0, 80));
    const history = getHistory(sessionId);

    // ── Build system prompt ──────────────────────────────────────
    const memoryContext = getMemoryContext();
    const persistentMemory = getMemoryPrompt();

    const sysContent = [
      memoryContext ? `## Контекст из памяти\n${memoryContext}\n` : '',
      persistentMemory,
      TOOLS_SYSTEM,
      systemPrompt?.trim() ? `\nAdditional instructions:\n${systemPrompt.trim()}` : '',
    ].join('');

    let userContent;
    let modelOverride = null;

    if (file && file.dataUrl && file.mimeType) {
      const isImage = file.mimeType.startsWith('image/');
      const isText  = file.mimeType.startsWith('text/') || /\.(js|ts|py|json|md|css|html|sh|yaml|yml|toml|env)$/i.test(file.name || '');

      if (isImage) {
        modelOverride = 'google/gemini-2.5-flash';
        userContent = [
          { type: 'text', text: message.trim() },
          { type: 'image_url', image_url: { url: file.dataUrl } },
        ];
        console.log('[chat] image attached, switching to gemini');
      } else if (isText) {
        const base64 = file.dataUrl.split(',')[1] ?? '';
        const decoded = Buffer.from(base64, 'base64').toString('utf8').slice(0, 20000);
        userContent = `${message.trim()}\n\n\`\`\`${file.name ?? 'file'}\n${decoded}\n\`\`\``;
        console.log('[chat] text file attached:', file.name, decoded.length, 'chars');
      } else {
        userContent = message.trim();
        console.log('[chat] unsupported file type, ignoring:', file.mimeType);
      }
    } else {
      userContent = message.trim();
    }

    // Determine model: frontend request -> env -> hardcoded fallback
    const activeModel = modelOverride ?? model ?? DEFAULT_MODEL;
    console.log('[chat] using model:', activeModel);

    const messages = [
      { role: 'system', content: sysContent },
      ...history,
      { role: 'user', content: userContent },
    ];

    // ── Route to specialized agent if needed ────────────────────
    const route = classifyTask(message.trim());
    console.log('[chat] route:', route);
    send({ type: 'agent', agent: route });

    if (route === 'code' && !modelOverride) {
      // Layer 2: distinguish isolated sandbox vs real project modification
      const codeType = await classifyCodeType(message.trim(), process.env.OPENROUTER_API_KEY);
      console.log('[chat] code type:', codeType);
      send({ type: 'agent', agent: codeType === 'sandbox' ? 'code' : 'chat' });

      if (codeType === 'sandbox') {
        // Isolated: architect → generate → run in sandbox
        await runCodeAgent(message.trim(), send);
        history.push({ role: 'user',      content: message.trim() });
        history.push({ role: 'assistant', content: '[code agent]' });
        saveHistory(sessionId, history);
        saveMessage(sessionId, 'user',      message.trim());
        saveMessage(sessionId, 'assistant', '[code agent]');
        extractAndSaveFacts(sessionId, message.trim(), '[code agent]', process.env.OPENROUTER_API_KEY)
          .catch(e => console.error('[memory] background save failed:', e.message));
        send({ type: 'done' });
        return res.end();
      }
      // real_project — fall through to main agent loop with full tool access
    }

    // For reasoning tasks use deepseek-v4-pro with thinking enabled
    const reasonModel  = 'deepseek/deepseek-v4-pro';
    const finalModel   = (route === 'reason' && !modelOverride) ? reasonModel : activeModel;
    const useThinking  = route === 'reason' && !modelOverride;
    console.log('[chat] using model:', finalModel, useThinking ? '(thinking)' : '');

    let fullAssistantText = '';
    let toolRoundCount = 0;

    if (route !== 'chat') {
      const plan = await runPlanner(message.trim());
      if (plan) send({ type: 'plan', steps: plan.steps });
    }

    while (true) {
      console.log('[chat] calling OpenRouter...');
      const streamParams = {
        model: finalModel,
        stream: true,
        messages,
      };
      if (useThinking) streamParams.reasoning = { enabled: true };

      const stream = await client.chat.completions.create({
        ...streamParams,
        tools: [
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: 'Поиск актуальной информации в интернете через Exa',
              parameters: {
                type: 'object',
                properties: {
                  query:      { type: 'string', description: 'Поисковый запрос' },
                  numResults: { type: 'number', description: 'Количество результатов, по умолчанию 5' },
                },
                required: ['query'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'web_fetch',
              description: 'Получить полное содержимое страницы по URL',
              parameters: {
                type: 'object',
                properties: {
                  url: { type: 'string', description: 'URL страницы' },
                },
                required: ['url'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'get_codebase',
              description: 'Возвращает полный снапшот исходного кода KAI (все server/* файлы + JS из index.html). Вызывай ПЕРВЫМ для любой задачи по модификации проекта.',
              parameters: { type: 'object', properties: {} },
            },
          },
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
              description: 'Возвращает список файлов в директории репо kmbytv/icarus (ветка gh-pages)',
              parameters: {
                type: 'object',
                properties: { dir_path: { type: 'string', description: 'Путь к папке, например server или .' } },
                required: ['dir_path'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'github_check_access',
              description: 'Проверяет GitHub токен и права на запись. Запускай если github_write_file вернул ошибку.',
              parameters: { type: 'object', properties: {} },
            },
          },
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Получить текущую погоду в городе. Возвращает температуру, ощущается как, влажность, давление, ветер, описание',
              parameters: {
                type: 'object',
                properties: {
                  city:  { type: 'string', description: 'Название города (на английском или русском)' },
                  units: { type: 'string', description: 'Единицы измерения: metric (Цельсий) или imperial (Фаренгейт)', enum: ['metric', 'imperial'] },
                },
                required: ['city'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'code_run',
              description: 'Выполнить код в реальном окружении (Node.js или Python). Возвращает stdout/stderr. Используй когда нужно запустить, проверить или вычислить что-то.',
              parameters: {
                type: 'object',
                properties: {
                  code:     { type: 'string', description: 'Код для выполнения' },
                  language: { type: 'string', enum: ['js', 'python', 'bash'], description: 'Язык: js, python, или bash' },
                },
                required: ['code'],
              },
            },
          },
          ...getMCPTools(),
          ...(req.body.composioKey ? await getComposioTools(req.body.composioKey) : []),
        ],
      });

      let turnText     = '';
      let nativeTools  = [];

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const textDelta = choice.delta?.content ?? '';
        if (textDelta) {
          turnText += textDelta;
          send({ type: 'delta', text: textDelta });
        }

        for (const tc of choice.delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          if (!nativeTools[idx]) nativeTools[idx] = { id: '', name: '', argsBuf: '' };
          if (tc.id)                    nativeTools[idx].id       += tc.id;
          if (tc.function?.name)        nativeTools[idx].name     += tc.function.name;
          if (tc.function?.arguments)   nativeTools[idx].argsBuf  += tc.function.arguments;
        }
      }

      console.log('[chat] stream done, text len:', turnText.length, 'native tools:', nativeTools.length);
      fullAssistantText += turnText;

      let toolCall = null;

      if (nativeTools.length > 0) {
        const tc = nativeTools[0];
        try {
          const args = JSON.parse(tc.argsBuf || '{}');
          toolCall = { toolName: tc.name, args };
          console.log('[chat] native tool call:', tc.name, JSON.stringify(args).slice(0, 120));
          send({ type: 'tool_call', tool: tc.name, args });
        } catch (e) {
          console.error('[chat] failed to parse native tool args:', tc.argsBuf);
        }
      }

      if (!toolCall) {
        toolCall = turnText.split('\n').map(parseToolCall).find(Boolean) ?? null;
      }

      if (!toolCall) break;

      let result;
      try {
        switch (toolCall.toolName) {
          case 'web_search':        result = await webSearch(toolCall.args.query, { numResults: toolCall.args.numResults }); break;
          case 'web_fetch':         result = await webFetch(toolCall.args.url);                                              break;
          case 'get_codebase':        result = { snapshot: getCodebase() };                                                          break;
          case 'github_read_file':    result = await githubReadFile(toolCall.args.path);                                             break;
          case 'github_write_file':   result = await githubWriteFile(toolCall.args.path, toolCall.args.content, toolCall.args.message); break;
          case 'github_list_files':   result = await githubListFiles(toolCall.args.dir_path);                                          break;
          case 'github_check_access': result = await githubCheckAccess();                                                              break;
          case 'get_weather':       result = await getWeather(toolCall.args.city, toolCall.args.units);                      break;
          case 'code_run':          result = await runCode(toolCall.args);                                                    break;
          default:
            if (isComposioTool(toolCall.toolName)) {
              const actionName = toolCall.toolName.replace('composio__', '');
              result = await executeComposioAction(actionName, toolCall.args, req.body.composioKey);
            } else if (isMCPTool(toolCall.toolName)) {
              result = await callMCPTool(toolCall.toolName, toolCall.args);
            } else {
              result = await executeTool(toolCall.toolName, toolCall.args);
            }
            break;
        }
      } catch (toolErr) {
        console.error('[tool dispatch error]', toolCall.toolName, toolErr?.message ?? toolErr);
        result = { error: toolErr?.message ?? 'Tool execution failed' };
      }
      const resultLine = JSON.stringify({ tool_result: result });

      send({ type: 'tool_result', tool: toolCall.toolName, result });

      if (nativeTools.length > 0) {
        const tc = nativeTools[0];
        messages.push({
          role: 'assistant',
          content: turnText || null,
          tool_calls: [{ id: tc.id || 'call_0', type: 'function', function: { name: tc.name, arguments: tc.argsBuf } }],
        });
        messages.push({ role: 'tool', tool_call_id: tc.id || 'call_0', content: JSON.stringify(result) });
      } else {
        messages.push({ role: 'assistant', content: turnText });
        messages.push({ role: 'user',      content: resultLine });
      }
      fullAssistantText += '\n' + resultLine;

      toolRoundCount++;
      if (toolRoundCount >= 6) break;
    }

    // Save only the model's text (strip tool result JSON from history)
    const textOnlyAssistant = fullAssistantText
      .split('\n')
      .filter(l => !l.startsWith('{"tool_result"'))
      .join('\n')
      .trim();

    history.push({ role: 'user',      content: message.trim() });
    history.push({ role: 'assistant', content: textOnlyAssistant || fullAssistantText });
    saveHistory(sessionId, history);

    saveMessage(sessionId, 'user',      message.trim());
    saveMessage(sessionId, 'assistant', fullAssistantText);

    // Fire-and-forget: extract and persist facts from this conversation turn
    extractAndSaveFacts(sessionId, message.trim(), textOnlyAssistant, process.env.OPENROUTER_API_KEY)
      .catch(e => console.error('[memory] background save failed:', e.message));

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error('[/chat error]', err?.message ?? err);
    send({ type: 'error', message: err?.message ?? 'Unknown error' });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

// ── POST /code — two-step coding agent ──────────────────────────
app.post('/code', async (req, res) => {
  const { task } = req.body;
  if (!task || typeof task !== 'string' || !task.trim()) {
    return res.status(400).json({ error: 'task is required' });
  }
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(': ping\n\n'), 20000);
  res.on('close', () => clearInterval(hb));
  try {
    await runCodeAgent(task.trim(), send);
  } finally {
    clearInterval(hb);
    res.end();
  }
});

// ── DELETE /session/:id — clear history ─────────────────────────
app.delete('/session/:id', (req, res) => {
  writeJSON(`session_${req.params.id}.json`, []);
  res.json({ ok: true });
});

// ── Composio OAuth ───────────────────────────────────────────────
app.post('/composio/connect', async (req, res) => {
  const { app, composioKey } = req.body;
  if (!app || !composioKey) return res.status(400).json({ error: 'app and composioKey required' });
  try {
    const data = await initiateConnection(app, composioKey);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/composio/status', async (req, res) => {
  const composioKey = req.headers['x-composio-key'];
  const app = req.query.app || null;
  if (!composioKey) return res.status(400).json({ error: 'x-composio-key header required' });
  try {
    const data = await getConnectionStatus(composioKey, app);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /integrations — save token + hot-reload MCP server ─────
app.post('/integrations', async (req, res) => {
  const { name, token } = req.body;
  if (!name || !token) return res.status(400).json({ ok: false, error: 'name and token required' });

  // Store token in process.env so mcp-client picks it up on reconnect
  const envMap = {
    'notion':           'NOTION_TOKEN',
    'todoist':          'TODOIST_API_TOKEN',
    'google-calendar':  'GOOGLE_REFRESH_TOKEN',
  };
  const envKey = envMap[name];
  if (!envKey) return res.status(400).json({ ok: false, error: `Unknown integration: ${name}` });

  process.env[envKey] = token;
  console.log(`[integrations] token set for ${name}, reloading MCP...`);

  try {
    await initMCP();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Health check ────────────────────────────────────────────────
const BOOT_COMMIT = process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev';
app.get('/health', (_req, res) => res.json({ status: 'ok', commit: BOOT_COMMIT }));

initMCP().then(async () => {
  await loadMemory();
  app.listen(PORT, () => {
    console.log(`KAI backend listening on :${PORT}`);
    console.log(`[startup] GITHUB_TOKEN: ${process.env.GITHUB_TOKEN ? 'SET (' + process.env.GITHUB_TOKEN.slice(0,6) + '...)' : 'NOT SET — github_write_file will fail'}`);
    console.log(`[startup] OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? 'SET' : 'NOT SET'}`);
  });
});