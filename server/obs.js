import { readJSON, writeJSON } from './storage.js';

const MAX_EVENTS = 2000;

function load() {
  return readJSON('obs.json', []);
}

function persist(events) {
  const trimmed = events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events;
  writeJSON('obs.json', trimmed);
}

export function recordRequest({ sessionId, route, model, durationMs, tokens, tools, error }) {
  const events = load();
  events.push({
    ts:         Date.now(),
    sessionId,
    route:      route ?? 'unknown',
    model:      model ?? 'unknown',
    durationMs: durationMs ?? 0,
    tokens:     tokens ?? { prompt: 0, completion: 0 },
    tools:      tools ?? [],
    error:      error ?? null,
  });
  persist(events);
}

export function getStats(sinceDays = 7) {
  const since  = Date.now() - sinceDays * 86400000;
  const events = load().filter(e => e.ts >= since);

  if (!events.length) return { empty: true, sinceDays };

  // ── Tokens ──────────────────────────────────────────────────
  let totalPrompt = 0, totalCompletion = 0;
  for (const e of events) {
    totalPrompt     += e.tokens?.prompt     ?? 0;
    totalCompletion += e.tokens?.completion ?? 0;
  }

  // ── Routes ──────────────────────────────────────────────────
  const routeCounts = {};
  for (const e of events) routeCounts[e.route] = (routeCounts[e.route] ?? 0) + 1;

  // ── Tools ───────────────────────────────────────────────────
  const toolMap = {};
  for (const e of events) {
    for (const t of e.tools ?? []) {
      if (!toolMap[t.name]) toolMap[t.name] = { calls: 0, errors: 0, totalMs: 0 };
      toolMap[t.name].calls++;
      if (!t.ok) toolMap[t.name].errors++;
      toolMap[t.name].totalMs += t.durationMs ?? 0;
    }
  }
  const tools = Object.entries(toolMap)
    .map(([name, s]) => ({
      name,
      calls:     s.calls,
      errorRate: s.calls ? +(s.errors / s.calls * 100).toFixed(1) : 0,
      avgMs:     s.calls ? Math.round(s.totalMs / s.calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls);

  // ── Latency ─────────────────────────────────────────────────
  const durations = events.map(e => e.durationMs).filter(Boolean).sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;

  // ── Errors ──────────────────────────────────────────────────
  const errorCount = events.filter(e => e.error).length;

  // ── Daily breakdown ─────────────────────────────────────────
  const dayMap = {};
  for (const e of events) {
    const day = new Date(e.ts).toISOString().slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { requests: 0, tokens: 0 };
    dayMap[day].requests++;
    dayMap[day].tokens += (e.tokens?.prompt ?? 0) + (e.tokens?.completion ?? 0);
  }
  const daily = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, s]) => ({ day, ...s }));

  return {
    sinceDays,
    requests:    events.length,
    errorCount,
    errorRate:   events.length ? +(errorCount / events.length * 100).toFixed(1) : 0,
    tokens: {
      prompt:     totalPrompt,
      completion: totalCompletion,
      total:      totalPrompt + totalCompletion,
    },
    latency: { p50, p95 },
    routes:  routeCounts,
    tools,
    daily,
  };
}
