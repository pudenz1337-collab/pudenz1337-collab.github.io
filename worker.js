/**
 * FuelStrong Progress — Cloudflare Worker
 *
 * Required Secrets (set in Cloudflare dashboard → Worker → Settings → Variables):
 *   ANTHROPIC_API_KEY  — your Anthropic API key
 *   GITHUB_TOKEN       — your GitHub personal access token
 *
 * Required KV Namespace binding (Cloudflare dashboard → Worker → Settings → Bindings):
 *   FUELSTRONG_KV      — create a KV namespace called "fuelstrong-data" and bind it
 */

const GITHUB_REPO = 'pudenz1337-collab/pudenz1337-collab.github.io';
const ALLOWED_ORIGIN = 'https://pudenz1337-collab.github.io';

const CORS = {
  'Access-Control-Allow-Origin': '*', // tighten to ALLOWED_ORIGIN after testing
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Router ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url   = new URL(request.url);
    const path  = url.pathname;
    const method = request.method;

    try {
      if (path === '/api/health'  && method === 'GET')    return health();
      if (path === '/api/data'    && method === 'GET')    return getData(env);
      if (path === '/api/data'    && method === 'POST')   return saveData(request, env);
      if (path === '/api/parse'   && method === 'POST')   return parseFile(request, env);
      if (path === '/api/coach'   && method === 'POST')   return getCoaching(request, env);
      if (path === '/api/backup'  && method === 'POST')   return backupToGitHub(env);
      if (path === '/api/goals'   && method === 'POST')   return saveKVKey(request, env, 'goals');
      if (path === '/api/context' && method === 'POST')   return saveKVKey(request, env, 'coach_context');
      if (path === '/api/context' && method === 'GET')    return getKVKey(env, 'coach_context');
      if (path.startsWith('/api/data/') && method === 'DELETE') return deleteEntry(request, env, path);

      return reply({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return reply({ error: e.message }, 500);
    }
  }
};

// ─── Health ─────────────────────────────────────────────────────────────────────
function health() {
  return reply({ status: 'ok', time: new Date().toISOString() });
}

// ─── Get all data ───────────────────────────────────────────────────────────────
async function getData(env) {
  if (!env.FUELSTRONG_KV) {
    return reply({ error: 'KV namespace not bound. Add FUELSTRONG_KV binding in Cloudflare Worker settings.' }, 500);
  }
  const [evolt, fitbod, fuelstrong] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
  ]);
  return reply({
    evolt:      JSON.parse(evolt      || '[]'),
    fitbod:     JSON.parse(fitbod     || '[]'),
    fuelstrong: JSON.parse(fuelstrong || '[]'),
  });
}

// ─── Save parsed data ───────────────────────────────────────────────────────────
async function saveData(request, env) {
  if (!env.FUELSTRONG_KV) {
    return reply({ error: 'KV namespace not bound.' }, 500);
  }
  const { type, data } = await request.json();
  if (!['evolt','fitbod','fuelstrong'].includes(type)) {
    return reply({ error: 'Invalid data type' }, 400);
  }

  // Empty array = clear operation — overwrite KV, do not merge
  if (Array.isArray(data) && data.length === 0) {
    await env.FUELSTRONG_KV.put(type, '[]');
    return reply({ success: true, total: 0, added: 0, cleared: true });
  }

  const existing = JSON.parse(await env.FUELSTRONG_KV.get(type).catch(() => null) || '[]');
  const incoming = Array.isArray(data) ? data : [data];
  const merged   = [...existing];

  for (const entry of incoming) {
    const key = entry.id || entry.date;
    const dup = merged.some(e => (e.id || e.date) === key);
    if (!dup) merged.push({ ...entry, savedAt: new Date().toISOString() });
  }

  merged.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  await env.FUELSTRONG_KV.put(type, JSON.stringify(merged));

  return reply({ success: true, total: merged.length, added: incoming.length });
}

// ─── Delete entry ───────────────────────────────────────────────────────────────
async function deleteEntry(request, env, path) {
  // DELETE /api/data/{type}/{id}
  const parts  = path.split('/').filter(Boolean);
  const type   = parts[2];
  const id     = parts[3];
  const existing = JSON.parse(await env.FUELSTRONG_KV.get(type) || '[]');
  const filtered = existing.filter(e => (e.id || e.date) !== decodeURIComponent(id));
  await env.FUELSTRONG_KV.put(type, JSON.stringify(filtered));
  return reply({ success: true, remaining: filtered.length });
}

// ─── Parse uploaded file (image → Claude vision) ────────────────────────────────
async function parseFile(request, env) {
  const { imageBase64, mimeType, filename, fileType } = await request.json();

  // ── Fitbod screenshot ──
  if (fileType === 'fitbod') {
    const prompt = `Analyze this Fitbod workout app screenshot carefully. Extract every piece of workout data visible.

Return ONLY valid JSON (no markdown, no explanation):
{
  "date": "YYYY-MM-DD or null",
  "workoutName": "string or null",
  "exercises": [
    {
      "name": "Exercise Name",
      "muscleGroup": "Chest|Back|Legs|Shoulders|Arms|Core|Full Body",
      "sets": [
        { "reps": number, "weight": number, "unit": "lbs" }
      ],
      "totalVolume": number,
      "maxWeight": number,
      "notes": "string or null"
    }
  ],
  "totalVolume": number,
  "muscleGroupsWorked": ["array of muscle groups"],
  "duration": "string or null",
  "source": "fitbod_screenshot"
}

If this is NOT a Fitbod workout screenshot, return: { "error": "not_workout", "description": "what you see" }`;

    const resp = await callClaude(env, {
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    const text  = resp.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = safeJson(match?.[0]);
    if (parsed && !parsed.error) {
      parsed.id         = uid('fitbod');
      parsed.sourceFile = filename;
    }
    return reply(parsed || { error: 'parse_failed', raw: text.slice(0, 500) });
  }

  return reply({ error: 'unknown_file_type' }, 400);
}

// ─── Generic KV helpers ─────────────────────────────────────────────────────────
async function saveKVKey(request, env, key) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const body = await request.json().catch(() => ({}));
  await env.FUELSTRONG_KV.put(key, JSON.stringify(body));
  return reply({ success: true });
}
async function getKVKey(env, key) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const raw = await env.FUELSTRONG_KV.get(key).catch(() => null);
  return reply(raw ? JSON.parse(raw) : {});
}

// ─── AI Coaching ────────────────────────────────────────────────────────────────
async function getCoaching(request, env) {
  const body = await request.json().catch(() => ({}));
  const question = body.question || '';

  if (!env.FUELSTRONG_KV) {
    return reply({ error: 'KV namespace not bound. Check Worker bindings in Cloudflare dashboard — variable must be named FUELSTRONG_KV.' }, 500);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return reply({ error: 'ANTHROPIC_API_KEY secret not set in Worker environment variables.' }, 500);
  }

  const [evoltRaw, fitbodRaw, fuelstrongRaw, goalsRaw, contextRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
    env.FUELSTRONG_KV.get('goals').catch(() => null),
    env.FUELSTRONG_KV.get('coach_context').catch(() => null),
  ]);

  const evolt      = JSON.parse(evoltRaw      || '[]');
  const fitbod     = JSON.parse(fitbodRaw     || '[]');
  const fuelstrong = JSON.parse(fuelstrongRaw || '[]');
  const goals      = goalsRaw ? JSON.parse(goalsRaw) : (body.goals || {});
  const savedCtx   = contextRaw ? JSON.parse(contextRaw) : {};
  const context    = savedCtx.context || body.context || '';
  const woSummary  = body.workoutSummary || null;
  const mode       = body.mode || 'full';

  // ── Format Evolt data ──
  const evoltLines = evolt.map(s =>
    `${s.date}: Weight=${s.weight}lbs | BF%=${s.bodyFatPct}% | SkeletalMuscle=${s.skeletalMuscleMass}lbs | ` +
    `LBM=${s.leanBodyMass}lbs | VisceralFatMass=${s.visceralFatMass}lbs | VisceralFatArea=${s.visceralFatArea}cm² | ` +
    `BWI=${s.bwiScore} | BMR=${s.bmr}kcal`
  ).join('\n');

  const evoltDelta = evolt.length >= 2 ? (() => {
    const f = evolt[0], l = evolt[evolt.length-1];
    return `Change ${f.date}→${l.date}: Weight ${f.weight}→${l.weight}lbs (${(l.weight-f.weight).toFixed(1)}), ` +
      `BF% ${f.bodyFatPct}→${l.bodyFatPct}% (${(l.bodyFatPct-f.bodyFatPct).toFixed(1)}%), ` +
      `Muscle ${f.skeletalMuscleMass}→${l.skeletalMuscleMass}lbs (${(l.skeletalMuscleMass-f.skeletalMuscleMass).toFixed(1)}), ` +
      `VisceralFatMass ${f.visceralFatMass}→${l.visceralFatMass}lbs, BWI ${f.bwiScore}→${l.bwiScore}`;
  })() : 'Only one scan available.';

  const nutritionLines = fuelstrong.length > 0
    ? fuelstrong.slice(-14).map(n => `${n.date}: Protein=${n.protein}g | Cal=${n.calories}kcal | Water=${n.water}oz`).join('\n')
    : 'No nutrition data.';

  // ── Format workout analytics ──
  const woLines = woSummary ? `
Total workouts: ${woSummary.totalWorkouts}
Avg per week: ${woSummary.avgWorkoutsPerWeek}
Recent weeks: ${woSummary.recentWeeks}
Compound vs Isolation: ${woSummary.compoundPct}% compound / ${woSummary.isolationPct}% isolation
Muscle balance (volume): ${woSummary.muscleBalance}
Rep zone breakdown: ${woSummary.repZones}
Top PRs: ${woSummary.topPRs}
Recovery status: ${woSummary.recoveryStatus}` : fitbod.slice(-20).map(w =>
    `${w.date}: ${w.workoutName||'Workout'} | ${(w.muscleGroupsWorked||[]).join(', ')} | ${w.totalVolume}lbs | ${(w.exercises||[]).map(e=>`${e.name}(${e.maxWeight}lbs max)`).join(', ')}`
  ).join('\n') || 'No workout data.';

  // ── Goals context block ──
  const goalsBlock = goals && Object.keys(goals).length ? `
User's stated fitness goals:
- Primary goal: ${goals.primary || 'not set'}
- Training focus: ${goals.training || 'not set'} (${goals.training === 'hypertrophy' ? '6-12 rep range' : goals.training === 'strength' ? '1-5 rep range' : goals.training === 'endurance' ? '13+ reps' : 'mixed'})
- Target training frequency: ${goals.freq || 'not set'}x/week
- Medication: ${goals.med || 'not specified'}
- Priority muscle groups: ${(goals.muscles||[]).join(', ') || 'not set'}` : '';

  const contextBlock = context ? `\nCoach context notes from user:\n${context}` : '';

  // ── Base system prompt ──
  const baseSystem = `You are a direct, data-driven fitness coach specializing in body recomposition — building visible muscle while losing fat. You coach a 50-year-old woman (Hanna) who:
- Is 5'5", likely on tirzepatide (GLP-1) which suppresses appetite and affects muscle metabolism
- Uses Evolt 360 BIA body composition scans, Fitbod for workouts, and FuelStrong for nutrition
- GOAL: Build visible muscle while uncovering it through fat loss — the "body recomp" approach
${goalsBlock}${contextBlock}

Your coaching rules:
1. LEAD with what IS working — always cite actual data numbers
2. The scale is the WORST metric here — reframe toward body composition changes
3. Be specific and actionable — give exact numbers and concrete behaviors
4. Tirzepatide context: it suppresses appetite (hitting protein goals harder), can reduce lean mass if calories too low, requires strategic protein timing
5. Connect training data to body comp results — this is the key insight most coaches miss
6. Be honest about timelines — visible muscle takes 6-12+ months`;

  // ── Mode-specific prompt ──
  let userMsg, systemAddition = '';

  if (mode === 'body') {
    systemAddition = '\nFocus: Deep analysis of body composition trends only. What do the Evolt numbers actually mean? What is the trajectory? What specific nutrition and training behaviors are driving the changes? End with: "Your Top 3 Body Composition Priorities."';
    userMsg = `Analyze my body composition data in depth. What does my trajectory actually look like? What's concerning, what's promising, and what should I specifically change?\n\nEvolt Scans (chronological):\n${evoltLines}\n\nOverall delta: ${evoltDelta}\n\nNutrition (last 14 days):\n${nutritionLines}`;

  } else if (mode === 'training') {
    systemAddition = '\nFocus: Deep analysis of training quality and effectiveness for muscle building. Analyze rep ranges, exercise selection (compound vs isolation), consistency, recovery, and progressive overload. Are they training optimally for visible muscle? What exercises should they prioritize or drop? End with: "Your Top 3 Training Adjustments."';
    userMsg = `Analyze my training data in depth. Am I training optimally for building visible muscle? Are my exercise choices, rep ranges, and consistency right for my goals?\n\nWorkout Analytics:\n${woLines}\n\nBody Composition Impact:\n${evoltDelta}\n\nFor context — my Evolt scans show my muscle trend:\n${evolt.slice(-6).map(s=>`${s.date}: ${s.skeletalMuscleMass}lbs muscle`).join(', ')}`;

  } else if (mode === 'ask') {
    systemAddition = '\nAnswer the specific question using the data provided. Be direct and specific.';
    userMsg = `My data:\n\nEvolt Scans:\n${evoltLines}\nDelta: ${evoltDelta}\n\nWorkout Analytics:\n${woLines}\n\nNutrition:\n${nutritionLines}\n\nMy question: ${question}`;

  } else {
    // full
    systemAddition = '\nFull synthesis: Connect ALL three data sources. What story do the numbers tell together? Where is she winning? What is the most important thing to fix? End with: "Your Top 3 Priorities Right Now."';
    userMsg = `Full coaching analysis — connect everything together.\n\nEvolt Scans:\n${evoltLines}\nOverall change: ${evoltDelta}\n\nWorkout Analytics:\n${woLines}\n\nNutrition (last 14 days):\n${nutritionLines}`;
  }

  const resp = await callClaude(env, {
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    system: baseSystem + systemAddition,
    messages: [{ role: 'user', content: userMsg }]
  });

  const coaching = resp.content?.[0]?.text || 'Could not generate coaching.';

  await env.FUELSTRONG_KV.put('last_coaching', JSON.stringify({
    text: coaching, mode, question: question || null,
    generatedAt: new Date().toISOString()
  }));

  return reply({ coaching, generatedAt: new Date().toISOString() });
}

// ─── GitHub Backup ──────────────────────────────────────────────────────────────
async function backupToGitHub(env) {
  const [e, f, fs] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt'),
    env.FUELSTRONG_KV.get('fitbod'),
    env.FUELSTRONG_KV.get('fuelstrong'),
  ]);

  const files = [
    { path: 'data/evolt.json',      content: e  || '[]' },
    { path: 'data/fitbod.json',     content: f  || '[]' },
    { path: 'data/fuelstrong.json', content: fs || '[]' },
  ];

  const results = [];
  for (const file of files) {
    try {
      let sha;
      const check = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${file.path}`,
        { headers: githubHeaders(env) }
      );
      if (check.ok) sha = (await check.json()).sha;

      const body = {
        message: `data: update ${file.path} ${new Date().toISOString().split('T')[0]}`,
        content: b64encode(file.content),
        ...(sha && { sha }),
      };

      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${file.path}`,
        { method: 'PUT', headers: githubHeaders(env), body: JSON.stringify(body) }
      );
      results.push({ file: file.path, ok: res.ok, status: res.status });
    } catch (e) {
      results.push({ file: file.path, ok: false, error: e.message });
    }
  }

  return reply({ backed_up: results });
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
async function callClaude(env, body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const STATUS_MESSAGES = {
      401: 'Invalid Anthropic API key — check ANTHROPIC_API_KEY in Worker secrets.',
      402: 'Anthropic account out of credits — add credits at console.anthropic.com/billing.',
      429: 'Anthropic rate limit hit — wait a moment and try again.',
      529: 'Anthropic API quota exceeded or account paused — check console.anthropic.com/billing.',
      500: 'Anthropic API internal error — try again in a moment.',
    };
    const msg = STATUS_MESSAGES[res.status] || `Anthropic API error ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

function githubHeaders(env) {
  return {
    'Authorization': `token ${env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'FuelStrong-App/1.0',
  };
}

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function uid(prefix = '') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function b64encode(str) {
  // Cloudflare Workers compatible base64 encode
  return btoa(unescape(encodeURIComponent(str)));
}
