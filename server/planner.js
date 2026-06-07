import client from './openrouter.js';

const ACTION_VERBS = [
  'сделай','напиши','создай','реализуй','добавь','исправь','переделай','разработай',
  'построй','настрой','интегрируй','оптимизируй','рефактор',
  'make','create','build','write','implement','develop','fix','refactor','add',
  'integrate','optimize','redesign','setup','deploy',
];

const CODING_KEYWORDS = [
  'код','файл','функция','реализуй','напиши','создай','сделай','добавь','feature',
  'fix','write','create','implement','build','refactor',
  'code','function','file','class','module','component','endpoint','api',
];

export async function runPlanner(message) {
  try {
    const words = message.trim().split(/\s+/);
    if (words.length <= 3) return null;

    const lower = message.toLowerCase();
    const hasActionVerb = ACTION_VERBS.some(v => lower.includes(v));
    if (!hasActionVerb) return null;

    const completion = await client.chat.completions.create({
      model: 'deepseek/deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: `You are a task complexity classifier. Analyze the user message and decide if it needs a step-by-step execution plan.

Respond ONLY with valid JSON, no markdown, no explanation:
{"needs_plan": boolean, "steps": ["step 1", "step 2", ...]}

Rules:
- needs_plan: true only for multi-step tasks (implementing features, building something, complex refactoring)
- needs_plan: false for simple questions, single-action requests, lookups
- steps: max 5 items, each 5-8 words, action-oriented
- If needs_plan is false, steps can be empty array`,
        },
        { role: 'user', content: message },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;

    let parsed;
    try { parsed = JSON.parse(raw); } catch { return null; }

    if (!parsed.needs_plan || !Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;

    const steps = parsed.steps.slice(0, 5);
    const isCoding = CODING_KEYWORDS.some(k => lower.includes(k));
    if (isCoding) return { steps, model: 'deepseek/deepseek-v3.2', reasoning: true };
    return { steps };
  } catch {
    return null;
  }
}
