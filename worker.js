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

  const [evoltRaw, fitbodRaw, fuelstrongRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
  ]);

  const evolt      = JSON.parse(evoltRaw      || '[]');
  const fitbod     = JSON.parse(fitbodRaw     || '[]');
  const fuelstrong = JSON.parse(fuelstrongRaw || '[]');

  const evoltLines = evolt.map(s =>
    `${s.date}: Weight=${s.weight}lbs | BF%=${s.bodyFatPct}% | SkeletalMuscle=${s.skeletalMuscleMass}lbs | ` +
    `LBM=${s.leanBodyMass}lbs | VisceralFatMass=${s.visceralFatMass}lbs | VisceralFatArea=${s.visceralFatArea}cm² | ` +
    `BWI=${s.bwiScore} | BMR=${s.bmr}kcal | AbdCirc=${s.abdominalCirc}in | W:H=${s.waistHipRatio}`
  ).join('\n');

  const fitbodLines = fitbod.slice(-30).map(w =>
    `${w.date}: ${w.workoutName || 'Workout'} | Muscles: ${(w.muscleGroupsWorked || []).join(', ')} | ` +
    `Volume: ${w.totalVolume}lbs | Exercises: ${(w.exercises || []).map(e => `${e.name}(${e.maxWeight}lbs)`).join(', ')}`
  ).join('\n');

  const nutritionLines = fuelstrong.length > 0
    ? fuelstrong.slice(-14).map(n =>
        `${n.date}: Protein=${n.protein}g | Cal=${n.calories}kcal | Water=${n.water}oz`
      ).join('\n')
    : 'No nutrition data uploaded yet.';

  const system = `You are a direct, data-driven fitness coach specializing in body recomposition — building muscle while losing fat. You coach a 50-year-old woman (Hanna) who:
- Is 5'5", takes tirzepatide (GLP-1) which suppresses appetite
- Has been seriously focused on protein and muscle building for only 2-3 months
- Uses Evolt 360 BIA scans, Fitbod app, and FuelStrong nutrition tracker
- GOAL: Build visible muscle while uncovering it through fat loss

Your coaching philosophy:
1. LEAD with what IS working — always cite actual numbers
2. The scale is the WORST metric for this person — consistently reframe toward body composition metrics
3. Be specific and actionable — no vague advice, give exact numbers and behaviors to target
4. Acknowledge the timeline honestly — muscle building takes 6-12+ months to become visually apparent
5. Connect the dots between training data, nutrition, and body composition changes
6. Short response: 3-4 focused paragraphs + a clear "Your Top 3 Priorities Right Now" section`;

  const userMsg = question
    ? `My data:\n\nEvolt Scans:\n${evoltLines}\n\nWorkouts:\n${fitbodLines}\n\nNutrition:\n${nutritionLines}\n\nMy question: ${question}`
    : `Give me a full coaching analysis. What do my numbers actually mean, what's working, and what should I focus on?\n\nEvolt Scans:\n${evoltLines}\n\nWorkouts:\n${fitbodLines}\n\nNutrition:\n${nutritionLines}`;

  const resp    = await callClaude(env, {
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: userMsg }]
  });

  const coaching = resp.content?.[0]?.text || 'Could not generate coaching.';

  await env.FUELSTRONG_KV.put('last_coaching', JSON.stringify({
    text: coaching,
    question: question || null,
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
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
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
