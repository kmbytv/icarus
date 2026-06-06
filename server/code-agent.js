import client from './openrouter.js';

const PLANNER_SYSTEM = `You are a senior software architect. Analyze the coding task and produce a precise implementation plan.
Output ONLY valid JSON, no markdown, no explanation:
{"plan": ["step 1", "step 2", ...], "risks": ["risk 1", ...], "files_to_modify": ["file1", ...]}

Rules:
- plan: max 6 concise action steps
- risks: 1-3 potential issues to watch for (empty array if none)
- files_to_modify: list of files that will need changes (empty array if unknown)`;

const CODER_SYSTEM = `You are an expert programmer. You receive a coding task and a detailed implementation plan.
Follow the plan exactly. Output only clean, production-ready code with brief inline comments.
Do not include explanations outside the code — use comments inside the code for any notes.`;

// Step 1: call deepseek-v3.2 with reasoning to produce a structured plan
async function runArchitect(task) {
  console.log('[code-agent] architect step starting');
  const completion = await client.chat.completions.create({
    model: 'deepseek/deepseek-r1',
    messages: [
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user',   content: task },
    ],
    reasoning: { enabled: true },
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  console.log('[code-agent] architect raw:', raw.slice(0, 200));

  // Strip markdown fences if model wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: return raw as unstructured plan
    return { plan: [raw], risks: [], files_to_modify: [] };
  }
}

// Step 2: stream code from claude-sonnet-4-6 given the plan
async function streamCoder(task, plan, onDelta) {
  console.log('[code-agent] coder step starting');
  const planText = Array.isArray(plan.plan)
    ? plan.plan.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : String(plan.plan ?? '');

  const filesToModify = Array.isArray(plan.files_to_modify) && plan.files_to_modify.length
    ? `\nFiles to modify: ${plan.files_to_modify.join(', ')}`
    : '';

  const userContent = `Task: ${task}\n\nImplementation plan:\n${planText}${filesToModify}\n\nNow implement the task following the plan exactly.`;

  const stream = await client.chat.completions.create({
    model: 'anthropic/claude-sonnet-4-6',
    stream: true,
    messages: [
      { role: 'system', content: CODER_SYSTEM },
      { role: 'user',   content: userContent },
    ],
  });

  let fullCode = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (delta) {
      fullCode += delta;
      onDelta(delta);
    }
  }
  console.log('[code-agent] coder done, chars:', fullCode.length);
  return fullCode;
}

// Main pipeline — streams SSE events to the response
export async function runCodeAgent(task, send) {
  try {
    // Step 1: architect
    send({ type: 'status', text: 'Planning…' });
    const plan = await runArchitect(task);
    send({ type: 'plan', content: plan });

    // Step 2: coder (streaming)
    send({ type: 'status', text: 'Generating code…' });
    await streamCoder(task, plan, delta => send({ type: 'code_delta', text: delta }));

    send({ type: 'done' });
  } catch (err) {
    console.error('[code-agent] error:', err?.message ?? err);
    send({ type: 'error', message: err?.message ?? 'Code agent failed' });
  }
}
