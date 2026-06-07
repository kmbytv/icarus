// Deterministic task classifier — zero latency, no LLM call needed.
// Returns: 'code' | 'reason' | 'chat'
// Note: \b doesn't work with Cyrillic in JS, so we use (?<![а-яёa-z]) lookarounds or simple includes.

// Must look like actual programming: verb + programming noun
const CODE_RU = /(?:напиш[иь]|создай|сделай)\s+(?:код|скрипт|функци[юя]|класс|бот|апи|парсер|модуль|компонент|программ[уы]|утилит[уы]|сервер|эндпоинт|автоматизаци[юя])/i;
const CODE_EN = /(?:write|create|build|make|implement|generate)\s+(?:a\s+)?(?:code|script|function|class|bot|api|parser|module|component|program|server|endpoint|tool|app|automation)/i;

// Standalone programming keywords (unambiguous even without verb)
const CODE_KWORDS_CYR = /реализуй|реализовать|отрефактори|рефакторинг|задеплой|задеплоить|скомпилируй|алгоритм|рекурси[яю]|dockerfile|вебхук/i;
const CODE_KWORDS_LAT = /\b(?:regex|webhook|middleware|cron.?job|sql.query|implement|refactor|debug\s+(?:this|the|my)|fix\s+(?:this\s+)?(?:code|bug|error|function)|add\s+(?:a\s+)?(?:feature|endpoint|function|route))\b/i;

// Reasoning signals
const REASON_RU = /(?:почему|зачем|объясни|проанализируй|сравни|в\s+чём\s+разница|плюсы\s+и\s+минусы|стоит\s+ли|как\s+лучше|что\s+думаешь|разбери|объяснить|проанализировать)/i;
const REASON_EN = /(?:why\s+|explain\s+|analyze\s+|compare\s+|difference\s+between|pros\s+and\s+cons|should\s+i\s+|how\s+does\s+|what\s+is\s+the\s+best|tradeoff|what\s+do\s+you\s+think)/i;

export function classifyTask(message) {
  const m = message.trim();

  if (CODE_RU.test(m) || CODE_EN.test(m) || CODE_KWORDS_CYR.test(m) || CODE_KWORDS_LAT.test(m)) return 'code';
  if (REASON_RU.test(m) || REASON_EN.test(m)) return 'reason';
  return 'chat';
}

// Layer 2: classify code intent — real project modification vs isolated sandbox
// Called only when classifyTask() returns 'code'.
// Returns: 'real_project' | 'sandbox'
const REAL_PROJECT_CYR = /себя|кай|kai|этот\s+(бот|проект|сайт|сервер|код|файл)|наш\s+(код|проект|сервер)|index\.js|index\.html|server\/|улучши|добавь\s+(?:в|к|в\s+наш|фичу|функционал)|исправь\s+(?:баг|ошибку)|задеплой|запушь/i;
const REAL_PROJECT_LAT = /\b(?:yourself|this\s+(?:bot|project|site|server|codebase|file)|our\s+(?:code|project|server)|index\.js|index\.html|server\/|improve\s+(?:yourself|the\s+bot)|add\s+(?:to|a\s+feature\s+to)|fix\s+(?:the\s+bug|the\s+error\s+in)|deploy|push\s+to|update\s+(?:the|our))\b/i;

export async function classifyCodeType(message, openrouterKey) {
  // Fast path: deterministic signals
  const m = message.trim();
  if (REAL_PROJECT_CYR.test(m) || REAL_PROJECT_LAT.test(m)) return 'real_project';

  // Sandbox signals: standalone algorithms, "write me a script that X" with no project context
  const SANDBOX_CYR = /напиш[иь]\s+скрипт|напиш[иь]\s+функци[юя]|алгоритм|отсорти|посчитай|вычисли/i;
  const SANDBOX_LAT = /\b(?:write\s+(?:a\s+)?(?:script|function|algorithm)|sort\s+(?:an?\s+)?array|calculate|compute|fibonacci|quicksort|binary\s+search)\b/i;
  if (SANDBOX_CYR.test(m) || SANDBOX_LAT.test(m)) return 'sandbox';

  // Ambiguous — ask LLM classifier (cheap, one-shot)
  if (!openrouterKey) return 'real_project'; // safe default without key
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
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
    const data = await res.json();
    const answer = (data.choices?.[0]?.message?.content ?? '').toLowerCase().trim();
    return answer.includes('sandbox') ? 'sandbox' : 'real_project';
  } catch {
    return 'real_project'; // safe default on failure
  }
}
