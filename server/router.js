// Deterministic task classifier — zero latency, no LLM call needed.
// Returns: 'code' | 'reason' | 'chat'

const CODE_RU = /\b(напиш[иь]|создай|сделай|реализуй|написать|создать|сделать|реализовать|скрипт|функци[юя]|класс|модуль|компонент|парс[еи]р|бот|апи|api)\b/i;
const CODE_EN = /\b(write|create|implement|build|generate|make|code|script|function|class|module|component|parser|bot|endpoint|refactor|debug)\b/i;

const REASON_RU = /\b(почему|зачем|объясни|объяснить|проанализируй|проанализировать|сравни|сравнить|разница|разбери|разберись|плюсы|минусы|стоит ли|как лучше)\b/i;
const REASON_EN = /\b(why|explain|analyze|compare|difference|pros|cons|should i|how does|what is the best|tradeoff)\b/i;

export function classifyTask(message) {
  const m = message.trim();

  if (CODE_RU.test(m) || CODE_EN.test(m)) return 'code';
  if (REASON_RU.test(m) || REASON_EN.test(m)) return 'reason';
  return 'chat';
}
