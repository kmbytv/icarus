import client from './openrouter.js';

const PLANNER_SYSTEM = `You are a senior software architect. Analyze the coding task and produce a precise implementation plan.
Output ONLY valid JSON, no markdown, no explanation:
{"plan": ["step 1", "step 2", ...], "risks": ["risk 1", ...], "files_to_modify": ["file1", ...]}

Rules:
- plan: max 6 concise action steps
- risks: 1-3 potential issues (empty array if none)
- files_to_modify: list of files that will need changes (empty array if unknown)`;

const CODER_SYSTEM = `You are an expert programmer. You receive a coding task and a detailed implementation plan.
Follow the plan exactly. Output only clean, production-ready code with brief inline comments.
Do not include explanations outside the code.`;

async function runArchitect(task) {
  const completion = await client.chat.completions.create({
    model: 'deepseek/deepseek-v3.2',
    messages: [
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user',   content: task },
    ],
    reasoning: { enabled: true },
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { return { plan: [raw], risks: [], files_to_modify: [] }; }
}

async function streamCoder(task, plan, onDelta) {
  const planText = Array.isArray(plan.plan)
    ? plan.plan.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : String(plan.plan ?? '');
  const stream = await client.chat.completions.create({
    model: 'anthropic/claude-sonnet-4-6',
    stream: true,
    messages: [
      { role: 'system', content: CODER_SYSTEM },
      { role: 'user',   content: `Task: ${task}\n\nPlan:\n${planText}\n\nImplement the task.` },
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (delta) onDelta(delta);
  }
}

export async function runCodeAgent(task, send) {
  try {
    send({ type: 'status', text: 'Planning…' });
    const plan = await runArchitect(task);
    send({ type: 'plan', content: plan });
    send({ type: 'status', text: 'Generating code…' });
    await streamCoder(task, plan, delta => send({ type: 'code_delta', text: delta }));
    send({ type: 'done' });
  } catch (err) {
    console.error('[code-agent] error:', err?.message ?? err);
    send({ type: 'error', message: err?.message ?? 'Code agent failed' });
  }
}
