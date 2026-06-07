// Task classifier: 'code' | 'reason' | 'chat'
// Layer 1 fast-path uses deterministic regex for obvious cases.
// Ambiguous requests fall through to a cheap LLM one-shot call.
//
// Layer 2 (classifyCodeType): 'real_project' | 'sandbox'
// Same hybrid pattern — regex fast path, LLM for ambiguous.

// ── Layer 1 fast-path signals ─────────────────────────────────────

// Unambiguous CODE signals: imperative verb + programming noun
const CODE_STRONG_RU = /(?:напиш[иь]|создай|сделай|реализуй|реализовать|отрефактори|задеплой|запушь)\s+(?:код|скрипт|функци[юя]|класс|бот|апи|парсер|модуль|компонент|программ[уы]|утилит[уы]|сервер|эндпоинт|автоматизаци[юя])/i;
const CODE_STRONG_EN = /(?:write|create|build|implement|generate|refactor)\s+(?:a\s+)?(?:code|script|function|class|bot|api|parser|module|component|program|server|endpoint|app|automation)/i;
const CODE_KWORDS    = /\b(?:regex|webhook|middleware|dockerfile|cron.?job|quicksort|fibonacci|binary.search)\b|рекурси[яю]|алгоритм\s+\w|dockerfile|вебхук/i;

// Unambiguous REASON signals
const REASON_STRONG_RU = /(?:почему|зачем|объясни|проанализируй|сравни|в\s+чём\s+разница|плюсы\s+и\s+минусы|стоит\s+ли|разбери)\b/i;
const REASON_STRONG_EN = /\b(?:why\s+|explain\s+|analyze\s+|compare\s+|difference\s+between|pros\s+and\s+cons|tradeoff)/i;

// Unambiguous CHAT signals (greetings, meta-questions, personal)
const CHAT_STRONG = /^(?:привет|хай|здарова|йоу|hi|hey|hello|sup)\b|что умеешь|что ты умеешь|кто ты|what can you|who are you/i;

async function llmClassify(message, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash',
        max_tokens: 5,
        messages: [{
          role: 'user',
          content: `Classify this user request into exactly one category:
- "code" — user wants you to write, generate, fix, or run code/scripts
- "reason" — user wants analysis, explanation, comparison, or advice (no code output needed)
- "chat" — casual conversation, greeting, simple factual question

Reply with exactly one word: code, reason, or chat.

Request: "${message.slice(0, 400)}"`,
        }],
      }),
    });
    const data   = await res.json();
    const answer = (data.choices?.[0]?.message?.content ?? '').toLowerCase().trim();
    if (answer.includes('code'))   return 'code';
    if (answer.includes('reason')) return 'reason';
    if (answer.includes('chat'))   return 'chat';
    return null;
  } catch {
    return null;
  }
}

export async function classifyTask(message, apiKey) {
  const m = message.trim();

  // Fast path — unambiguous signals
  if (CHAT_STRONG.test(m))                                                       return 'chat';
  if (CODE_STRONG_RU.test(m) || CODE_STRONG_EN.test(m) || CODE_KWORDS.test(m))  return 'code';
  if (REASON_STRONG_RU.test(m) || REASON_STRONG_EN.test(m))                     return 'reason';

  // Ambiguous — ask LLM (cheap one-shot, max_tokens=5)
  const llmResult = await llmClassify(m, apiKey);
  return llmResult ?? 'chat'; // safe default
}

// ── Layer 2: real project vs isolated sandbox ─────────────────────

const REAL_PROJECT_CYR = /себя|кай|kai|этот\s+(бот|проект|сайт|сервер|код|файл)|наш\s+(код|проект|сервер)|index\.js|index\.html|server\/|улучши|добавь\s+(?:в|к|в\s+наш|фичу|функционал)|исправь\s+(?:баг|ошибку)|задеплой|запушь/i;
const REAL_PROJECT_LAT = /\b(?:yourself|this\s+(?:bot|project|site|server|codebase|file)|our\s+(?:code|project|server)|index\.js|index\.html|server\/|improve\s+(?:yourself|the\s+bot)|add\s+(?:to|a\s+feature\s+to)|fix\s+(?:the\s+bug|the\s+error\s+in)|deploy|push\s+to|update\s+(?:the|our))\b/i;
const SANDBOX_CYR      = /напиш[иь]\s+скрипт|напиш[иь]\s+функци[юя]|алгоритм|отсорти|посчитай|вычисли/i;
const SANDBOX_LAT      = /\b(?:write\s+(?:a\s+)?(?:script|function|algorithm)|sort\s+(?:an?\s+)?array|calculate|compute|fibonacci|quicksort|binary\s+search)\b/i;

export async function classifyCodeType(message, apiKey) {
  const m = message.trim();

  if (REAL_PROJECT_CYR.test(m) || REAL_PROJECT_LAT.test(m)) return 'real_project';
  if (SANDBOX_CYR.test(m) || SANDBOX_LAT.test(m))           return 'sandbox';

  if (!apiKey) return 'real_project';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash',
        max_tokens: 5,
        messages: [{
          role: 'user',
          content: `Does this request ask to modify an existing project/codebase, or to write a standalone script/algorithm?
Reply with exactly one word: "project" or "sandbox".
Request: "${m.slice(0, 300)}"`,
        }],
      }),
    });
    const data   = await res.json();
    const answer = (data.choices?.[0]?.message?.content ?? '').toLowerCase().trim();
    return answer.includes('sandbox') ? 'sandbox' : 'real_project';
  } catch {
    return 'real_project';
  }
}
