import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://kmbytv.github.io',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (curl, Postman, etc.)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// ── OpenRouter client ───────────────────────────────────────────
const client = new OpenAI({
  apiKey:  process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://kmbytv.github.io/icarus/',
    'X-Title':      'KAI Agent',
  },
});

// ── In-memory session history ───────────────────────────────────
// Map<sessionId, Message[]>  (resets on server restart)
const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
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

  // Build messages array
  const history = getHistory(sessionId);
  const messages = [];

  if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }

  messages.push(...history);
  messages.push({ role: 'user', content: message.trim() });

  // ── SSE headers ─────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const stream = await client.chat.completions.create({
      model:  'openrouter/auto',
      stream: true,
      messages,
    });

    let fullText = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullText += delta;
        send({ type: 'delta', text: delta });
      }
    }

    // Persist turn to history
    history.push({ role: 'user',      content: message.trim() });
    history.push({ role: 'assistant', content: fullText });

    // Keep last 40 messages to avoid runaway context
    if (history.length > 40) history.splice(0, history.length - 40);

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
