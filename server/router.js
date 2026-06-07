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
