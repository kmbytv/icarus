import client from './openrouter.js';
import { runCode, writeWorkspaceFile } from './tools/runner.js';

const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 32000;

const ARCHITECT_SYSTEM = `You are a senior software architect. Analyze the coding task and produce a precise implementation plan.
Output ONLY valid JSON, no markdown, no explanation:
{"plan": ["step 1", "step 2", ...], "risks": ["risk 1", ...], "files_to_modify": ["file1", ...], "language": "js|python|bash"}

Rules:
- plan: max 6 concise action steps
- risks: 1-3 potential issues (empty array if none)
- files_to_modify: list of files that will need changes
- language: primary language for the task`;

const CODER_SYSTEM = `You are an expert programmer. Output ONLY raw code — no markdown fences, no explanation.
The code must be complete and runnable as-is.`;

const FIXER_SYSTEM = `You are an expert debugger. You receive code that failed with an error.
Output ONLY the fixed raw code — no markdown, no explanation. The code must be complete and runnable.`;

const MAX_ITERATIONS = 3;

async function runArchitect(task) {
  const completion = await client.chat.completions.create({
    model: 'deepseek/deepseek-v4-pro',
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: ARCHITECT_SYSTEM },
      { role: 'user',   content: task },
    ],
    reasoning: { enabled: true },
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { return { plan: [raw], risks: [], files_to_modify: [], language: 'js' }; }
}

async function generateCode(task, plan, previousCode = null, error = null) {
  const planText = Array.isArray(plan.plan)
    ? plan.plan.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : String(plan.plan ?? '');

  let userMsg;
  if (previousCode && error) {
    userMsg = `Task: ${task}\n\nPlan:\n${planText}\n\nPrevious code:\n${previousCode}\n\nError:\n${error}\n\nFix the error and return the corrected complete code.`;
  } else {
    userMsg = `Task: ${task}\n\nPlan:\n${planText}\n\nWrite the complete implementation.`;
  }

  let code = '';
  const stream = await client.chat.completions.create({
    model: 'anthropic/claude-sonnet-4-6',
    stream: true,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: previousCode ? FIXER_SYSTEM : CODER_SYSTEM },
      { role: 'user',   content: userMsg },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    code += delta;
  }

  // Strip markdown fences if model added them
  return code
    .replace(/^```[\w]*\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
}

export async function runCodeAgent(task, send) {
  try {
    send({ type: 'status', text: 'Planning…' });
    const plan = await runArchitect(task);
    send({ type: 'plan', content: plan });

    const lang = plan.language ?? 'js';
    let code = null;
    let lastError = null;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const isRetry = i > 0;
      send({ type: 'status', text: isRetry ? `Fixing error (attempt ${i + 1})…` : 'Generating code…' });

      code = await generateCode(task, plan, isRetry ? code : null, isRetry ? lastError : null);
      send({ type: 'code_delta', text: code });

      send({ type: 'status', text: 'Running…' });
      const result = await runCode({ code, language: lang });

      if (result.success) {
        // Save to workspace
        const filename = (plan.files_to_modify?.[0] ?? `output.${lang === 'python' ? 'py' : lang === 'bash' ? 'sh' : 'mjs'}`);
        await writeWorkspaceFile({ filename, content: code });

        send({ type: 'run_result', output: result.output, success: true });
        send({ type: 'done' });
        return;
      }

      lastError = result.error || result.stderr || 'Unknown error';
      send({ type: 'run_result', output: lastError, success: false });

      if (i === MAX_ITERATIONS - 1) {
        send({ type: 'status', text: `Failed after ${MAX_ITERATIONS} attempts` });
      }
    }

    send({ type: 'done' });
  } catch (err) {
    console.error('[code-agent] error:', err?.message ?? err);
    send({ type: 'error', message: err?.message ?? 'Code agent failed' });
  }
}