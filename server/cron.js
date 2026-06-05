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
          content: 'You are a memory distillation agent. Extract only the most important facts, preferences, goals, and context about the user from these conversation logs. Be concise. Output plain text, no headers, no bullet points. Max 500 words.',
        },
        { role: 'user', content: transcript },
      ],
    });

    const distilled = completion.choices[0]?.message?.content?.trim();
    if (distilled) {
      updateMemoryCore(distilled);
      console.log('[cron] memory updated:', Date.now());
    }
  } catch (err) {
    console.error('[cron] error:', err?.message ?? err);
  }
});

console.log('[cron] memory distillation scheduled (every 3 days at 03:00)');
