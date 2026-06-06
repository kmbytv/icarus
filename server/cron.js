import cron from 'node-cron';
import client from './openrouter.js';
import { getRecentSessions, updateMemoryCore } from './memory.js';

cron.schedule('0 3 */3 * *', async () => {
  try {
    const messages = getRecentSessions(3);
    if (messages.length < 10) {
      console.log('[cron] skipped: not enough messages', messages.length);
      return;
    }

    const transcript = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    const completion = await client.chat.completions.create({
      model: 'deepseek/deepseek-chat-v3-0324:free',
      messages: [
        {
          role: 'system',
          content: `Ты — система памяти AI агента KAI. Проанализируй диалоги и извлеки структурированные знания.

Верни ТОЛЬКО валидный JSON без markdown, без пояснений, без \`\`\`json\`\`\` блоков:

{
  "summary": "2-3 предложения — общий контекст пользователя",
  "facts": [
    "конкретный факт о пользователе или его жизни"
  ],
  "preferences": [
    "предпочтение, привычка, стиль общения"
  ],
  "ongoing_tasks": [
    "незавершённая задача или активный проект"
  ],
  "recent_topics": [
    "тема которую обсуждали в последнее время"
  ]
}

Каждый массив — максимум 5 элементов. Только то что реально важно.`,
        },
        { role: 'user', content: transcript },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return;

    let structured;
    try {
      structured = JSON.parse(raw);
    } catch (parseErr) {
      console.error('[cron] JSON parse failed, saving raw:', parseErr.message);
      structured = { raw };
    }

    updateMemoryCore(structured);
    console.log('[cron] memory updated:', Date.now());
  } catch (err) {
    console.error('[cron] error:', err?.message ?? err);
  }
});

console.log('[cron] memory distillation scheduled (every 3 days at 03:00)');
