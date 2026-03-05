/**
 * FuelStrong — Cloudflare Worker
 *
 * Required Secrets (Cloudflare dashboard → Worker → Settings → Variables):
 *   ANTHROPIC_API_KEY  — Anthropic API key
 *   GITHUB_TOKEN       — GitHub personal access token (for backup)
 *
 * Required KV Namespace binding:
 *   FUELSTRONG_KV      — bind a KV namespace called "fuelstrong-data"
 *
 * KV Key Schema:
 *   daily:YYYY-MM-DD         → full day log object
 *   food-library             → { foods: [...], updatedAt }
 *   config:user              → { goals, tirz, lean_mass, bmr }
 *   evolt                    → [...] body comp scan history
 *   fitbod                   → [...] workout import history
 *   fuelstrong               → [...] completed day summaries (coaching context)
 *   coaching:history         → [...] last 30 coaching sessions
 *   insights:latest          → most recent insights engine output
 *   today_live               → in-progress day (fast access)
 *   last_coaching            → most recent coaching response
 *   coach_context            → persistent coach context notes
 *   profile_goals            → goals (legacy, kept for migration)
 *   profile_tirz             → tirz (legacy, kept for migration)
 */

const GITHUB_REPO   = 'pudenz1337-collab/pudenz1337-collab.github.io';
const ALLOWED_ORIGIN = 'https://pudenz1337-collab.github.io';
const OFF_SEARCH    = 'https://world.openfoodfacts.org/cgi/search.pl';
const OFF_PRODUCT   = 'https://world.openfoodfacts.org/api/v2/product/';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Router ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    try {
      // ── Health ──
      if (path === '/api/health' && method === 'GET') return health();

      // ── Legacy data endpoints (Progress app compat) ──
      if (path === '/api/data'  && method === 'GET')    return getData(env);
      if (path === '/api/data'  && method === 'POST')   return saveData(request, env);
      if (path.startsWith('/api/data/') && method === 'DELETE') return deleteEntry(request, env, path);

      // ── Daily log by date ──
      if (path.match(/^\/api\/daily\/\d{4}-\d{2}-\d{2}$/) && method === 'GET')
        return getDailyLog(path.split('/')[3], env);
      if (path.match(/^\/api\/daily\/\d{4}-\d{2}-\d{2}$/) && method === 'PUT')
        return saveDailyLog(path.split('/')[3], request, env);

      // ── Food library ──
      if (path === '/api/food-library' && method === 'GET')  return getFoodLibrary(env);
      if (path === '/api/food-library' && method === 'POST') return saveFoodLibrary(request, env);

      // ── Food search (Open Food Facts proxy) ──
      if (path === '/api/search-food' && method === 'GET') return searchFood(url, env);

      // ── Nutrition label scan (Claude vision, server-side) ──
      if (path === '/api/scan-label' && method === 'POST') return scanLabel(request, env);

      // ── File parse (Fitbod screenshot via Claude vision) ──
      if (path === '/api/parse' && method === 'POST') return parseFile(request, env);

      // ── Macro estimator ──
      if (path === '/api/estimate' && method === 'POST') return estimateMacros(request, env);

      // ── Coaching ──
      if (path === '/api/coach' && method === 'POST') return getCoaching(request, env);
      if (path === '/api/coach' && method === 'GET')  return getKVKey(env, 'last_coaching');

      // ── Insights engine ──
      if (path === '/api/insights' && method === 'POST') return runInsights(request, env);
      if (path === '/api/insights' && method === 'GET')  return getKVKey(env, 'insights:latest');

      // ── Live session ──
      if (path === '/api/live' && method === 'GET')  return getKVKey(env, 'today_live');
      if (path === '/api/live' && method === 'POST') return saveKVKey(request, env, 'today_live');

      // ── Profile ──
      if (path === '/api/profile' && method === 'GET')  return getProfile(env);
      if (path === '/api/profile' && method === 'POST') return saveProfile(request, env);

      // ── Config ──
      if (path === '/api/config' && method === 'GET')  return getKVKey(env, 'config:user');
      if (path === '/api/config' && method === 'POST') return saveKVKey(request, env, 'config:user');

      // ── Goals / context (legacy keys kept) ──
      if (path === '/api/goals'   && method === 'POST') return saveKVKey(request, env, 'goals');
      if (path === '/api/context' && method === 'GET')  return getKVKey(env, 'coach_context');
      if (path === '/api/context' && method === 'POST') return saveKVKey(request, env, 'coach_context');

      // ── GitHub backup ──
      if (path === '/api/backup' && method === 'POST') return backupToGitHub(env);

      return reply({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return reply({ error: e.message }, 500);
    }
  }
};

// ─── Health ────────────────────────────────────────────────────────────────────
function health() {
  return reply({ status: 'ok', time: new Date().toISOString() });
}

// ─── Daily Log ─────────────────────────────────────────────────────────────────
async function getDailyLog(date, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const raw = await env.FUELSTRONG_KV.get(`daily:${date}`).catch(() => null);
  if (!raw) return reply({ date, exists: false, foodLog: [], waterLog: [], hem: [], workouts: [], flags: {} });
  return reply({ ...JSON.parse(raw), exists: true });
}

async function saveDailyLog(date, request, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const body = await request.json();
  const existing = await env.FUELSTRONG_KV.get(`daily:${date}`).catch(() => null);
  const prev = existing ? JSON.parse(existing) : {};
  const merged = { ...prev, ...body, date, updatedAt: new Date().toISOString() };
  await env.FUELSTRONG_KV.put(`daily:${date}`, JSON.stringify(merged));

  // Also update the legacy fuelstrong array for coaching context
  if (merged.status === 'complete') {
    await updateFuelstrongSummary(date, merged, env);
  }

  return reply({ success: true, date });
}

async function updateFuelstrongSummary(date, dayLog, env) {
  try {
    const raw      = await env.FUELSTRONG_KV.get('fuelstrong').catch(() => null);
    const existing = JSON.parse(raw || '[]');
    const totals   = calcDayTotals(dayLog);
    const summary  = {
      date,
      protein:  totals.protein,
      calories: totals.calories,
      water:    totals.water,
      fiber:    totals.fiber,
      flags:    dayLog.flags || {},
      hem:      dayLog.hem   || {},
      hemLog:   (dayLog.hem  || []).slice(-20),
      savedAt:  new Date().toISOString(),
    };
    const idx = existing.findIndex(d => d.date === date);
    if (idx >= 0) existing[idx] = summary; else existing.push(summary);
    existing.sort((a, b) => new Date(a.date) - new Date(b.date));
    await env.FUELSTRONG_KV.put('fuelstrong', JSON.stringify(existing));
  } catch (e) { console.warn('Summary update failed:', e.message); }
}

function calcDayTotals(dayLog) {
  const food = dayLog.foodLog || [];
  return {
    protein:  Math.round(food.reduce((a, i) => a + (i.protein || 0), 0)),
    calories: Math.round(food.reduce((a, i) => a + (i.calories || 0), 0)),
    water:    Math.round((dayLog.waterLog || []).reduce((a, w) => a + (w.oz || 0), 0)),
    fiber:    Math.round(food.reduce((a, i) => a + (i.fiber || 0), 0) * 10) / 10,
  };
}

// ─── Food Library ──────────────────────────────────────────────────────────────
async function getFoodLibrary(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);

  // Check for unified library first
  const libRaw = await env.FUELSTRONG_KV.get('food-library').catch(() => null);
  if (libRaw) return reply(JSON.parse(libRaw));

  // Migration: merge legacy profile_custom_foods + profile_food_pins
  const [customRaw, pinsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('profile_custom_foods').catch(() => null),
    env.FUELSTRONG_KV.get('profile_food_pins').catch(() => null),
  ]);
  const customFoods = customRaw ? JSON.parse(customRaw) : [];
  const pins        = pinsRaw  ? JSON.parse(pinsRaw)   : [];

  // Migrate: stamp useCount and pinned onto each food
  const migrated = customFoods.map(f => ({
    ...f,
    pinned:   pins.includes(f.id) || !!f.pinned,
    useCount: f.useCount || 0,
    addedAt:  f.addedAt  || new Date().toISOString(),
  }));

  const library = { foods: migrated, updatedAt: new Date().toISOString() };
  await env.FUELSTRONG_KV.put('food-library', JSON.stringify(library));
  return reply(library);
}

async function saveFoodLibrary(request, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const body = await request.json();
  const library = { ...body, updatedAt: new Date().toISOString() };
  await env.FUELSTRONG_KV.put('food-library', JSON.stringify(library));
  return reply({ success: true, count: (body.foods || []).length });
}

// ─── Food Search (Open Food Facts proxy) ──────────────────────────────────────
async function searchFood(url, env) {
  const q = url.searchParams.get('q') || '';
  if (!q) return reply({ products: [] });

  const params = new URLSearchParams({
    search_terms:   q,
    search_simple:  1,
    action:         'process',
    json:           1,
    page_size:      10,
    fields:         'id,product_name,brands,nutriments,serving_size,image_small_url',
  });

  try {
    const r = await fetch(`${OFF_SEARCH}?${params}`, {
      headers: { 'User-Agent': 'FuelStrong/2.0 (fitness tracker)' }
    });
    const d = await r.json();
    const products = (d.products || [])
      .filter(p => p.product_name && p.nutriments)
      .map(p => normalizeOFFProduct(p));
    return reply({ products });
  } catch (e) {
    return reply({ error: e.message, products: [] }, 500);
  }
}

function normalizeOFFProduct(p) {
  const n = p.nutriments || {};
  return {
    id:       'off_' + (p.id || p._id || Date.now()),
    name:     p.product_name || 'Unknown',
    brand:    p.brands || '',
    source:   'openfoodfacts',
    calories: Math.round(n['energy-kcal_serving'] || n['energy-kcal_100g'] || 0),
    protein:  Math.round((n.proteins_serving  || n.proteins_100g  || 0) * 10) / 10,
    carbs:    Math.round((n.carbohydrates_serving || n.carbohydrates_100g || 0) * 10) / 10,
    fat:      Math.round((n.fat_serving       || n.fat_100g       || 0) * 10) / 10,
    fiber:    Math.round((n.fiber_serving     || n.fiber_100g     || 0) * 10) / 10,
    serving:  p.serving_size || 'per serving',
    image:    p.image_small_url || null,
    pinned:   false,
    useCount: 0,
  };
}

// ─── Nutrition Label Scan ──────────────────────────────────────────────────────
async function scanLabel(request, env) {
  if (!env.ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  const { imageBase64, mimeType } = await request.json();
  if (!imageBase64) return reply({ error: 'No image data' }, 400);

  const resp = await callClaude(env, {
    model:      'claude-sonnet-4-20250514',
    max_tokens: 500,
    system:     'You are a nutrition label reader. Extract the nutrition facts and return ONLY valid JSON. No markdown, no explanation, no preamble.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
        { type: 'text',  text: 'Read the nutrition facts label in this image. Extract per-serving values. Return ONLY this JSON: {"name":"product name or description","calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"serving":"serving size description","confidence":"high|medium|low"}' }
      ]
    }]
  });

  const raw   = resp.content?.[0]?.text || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return reply({ error: 'Could not parse label' }, 500);

  try {
    return reply({ food: JSON.parse(match[0]) });
  } catch (e) {
    return reply({ error: 'Invalid JSON from vision' }, 500);
  }
}

// ─── File Parse (Fitbod screenshot) ───────────────────────────────────────────
async function parseFile(request, env) {
  const { imageBase64, mimeType, filename, fileType } = await request.json();

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
      model:      'claude-opus-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
          { type: 'text',  text: prompt }
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

// ─── Macro Estimator ──────────────────────────────────────────────────────────
async function estimateMacros(request, env) {
  const body = await request.json();
  const name = (body.name || '').trim();
  if (!name) return reply({ error: 'Food name required' }, 400);

  const resp = await callClaude(env, {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system:     'You are a nutrition database. Return ONLY valid JSON with no other text, preamble, or markdown.',
    messages: [{ role: 'user', content: `Estimate nutrition for one standard serving of: "${name}". Return ONLY this JSON: {"calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"serving":"description","confidence":"high|medium|low"}` }]
  });

  const raw   = resp.content?.[0]?.text || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return reply({ error: 'Could not parse' }, 500);
  try { return reply({ estimate: JSON.parse(match[0]) }); }
  catch (e) { return reply({ error: 'Invalid JSON' }, 500); }
}

// ─── Insights Engine ──────────────────────────────────────────────────────────
async function runInsights(request, env) {
  if (!env.ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  if (!env.FUELSTRONG_KV)     return reply({ error: 'KV not bound' }, 500);

  const [evoltRaw, fuelstrongRaw, fitbodRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
  ]);

  const evolt      = JSON.parse(evoltRaw      || '[]');
  const fuelstrong = JSON.parse(fuelstrongRaw || '[]');
  const fitbod     = JSON.parse(fitbodRaw     || '[]');

  if (!evolt.length && !fuelstrong.length) {
    return reply({ insights: [], generatedAt: new Date().toISOString(), insufficient_data: true });
  }

  // Build compact data summary for insights analysis
  const evoltLines = evolt.map(s =>
    `${s.date}: weight=${s.weight}lbs BF%=${s.bodyFatPct}% muscle=${s.skeletalMuscleMass}lbs BMR=${s.bmr}kcal`
  ).join('\n');

  const nutritionLines = fuelstrong.slice(-30).map(n =>
    `${n.date}: P=${n.protein}g cal=${n.calories} water=${n.water}oz flags=${JSON.stringify(n.flags||{})} ` +
    `hemEnergy=${n.hemLog?.slice(-1)[0]?.e||'?'} hemMood=${n.hemLog?.slice(-1)[0]?.m||'?'}`
  ).join('\n');

  const workoutLines = fitbod.slice(-20).map(w =>
    `${w.date}: ${(w.muscleGroupsWorked||[]).join(',')} vol=${w.totalVolume}lbs`
  ).join('\n');

  const prompt = `You are an analytical engine for a fitness tracking system. Analyze the patterns across this person's data and identify the 5 most actionable insights.

EVOLT BODY COMPOSITION SCANS (chronological):
${evoltLines || 'No scan data'}

NUTRITION + BEHAVIORAL DATA (last 30 days):
${nutritionLines || 'No nutrition data'}

WORKOUT DATA (last 20 sessions):
${workoutLines || 'No workout data'}

Find patterns that cross data sources. Examples of good insights:
- Correlation between protein intake and muscle mass changes between scans
- Relationship between injection day flags and energy/nutrition on surrounding days
- Workout consistency vs body composition outcomes
- Hydration patterns and energy scores
- Calorie deficit depth vs muscle retention

Return ONLY valid JSON array with exactly 5 insights (fewer if insufficient data):
[
  {
    "type": "pattern_type",
    "priority": 1,
    "observation": "Specific observation with numbers",
    "recommendation": "One specific actionable recommendation",
    "data_sources": ["evolt", "nutrition"],
    "confidence": "high|medium|low"
  }
]

Priority 1 = most actionable right now. Base everything on actual numbers, not generalizations.`;

  const resp = await callClaude(env, {
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw   = resp.content?.[0]?.text || '[]';
  const match = raw.match(/\[[\s\S]*\]/);
  const insights = safeJson(match?.[0]) || [];

  const result = {
    insights,
    generatedAt:  new Date().toISOString(),
    dataPoints: { evolt: evolt.length, nutrition: fuelstrong.length, workouts: fitbod.length }
  };

  await env.FUELSTRONG_KV.put('insights:latest', JSON.stringify(result));
  return reply(result);
}

// ─── AI Coaching ──────────────────────────────────────────────────────────────
async function getCoaching(request, env) {
  const body = await request.json().catch(() => ({}));

  if (!env.FUELSTRONG_KV)     return reply({ error: 'KV namespace not bound' }, 500);
  if (!env.ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500);

  // Load all context in parallel
  const [evoltRaw, fitbodRaw, fuelstrongRaw, profGoalsRaw, contextRaw, liveRaw, insightsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
    env.FUELSTRONG_KV.get('profile_goals').catch(() => null),
    env.FUELSTRONG_KV.get('coach_context').catch(() => null),
    env.FUELSTRONG_KV.get('today_live').catch(() => null),
    env.FUELSTRONG_KV.get('insights:latest').catch(() => null),
  ]);

  const evolt      = JSON.parse(evoltRaw      || '[]');
  const fitbod     = JSON.parse(fitbodRaw     || '[]');
  const fuelstrong = JSON.parse(fuelstrongRaw || '[]');
  const goals      = profGoalsRaw ? JSON.parse(profGoalsRaw) : (body.goals || {});
  const savedCtx   = contextRaw  ? JSON.parse(contextRaw)   : {};
  const liveKV     = liveRaw     ? JSON.parse(liveRaw)      : {};
  const insightsData = insightsRaw ? JSON.parse(insightsRaw) : null;

  const context  = savedCtx.context || body.context || '';
  const mode     = body.mode || 'checkin';
  const question = body.question || '';

  // ── Format Evolt data ──
  const evoltLines = evolt.map(s =>
    `${s.date}: Weight=${s.weight}lbs | BF%=${s.bodyFatPct}% | Muscle=${s.skeletalMuscleMass}lbs | ` +
    `LBM=${s.leanBodyMass}lbs | VisceralFat=${s.visceralFatMass}lbs | BMR=${s.bmr}kcal`
  ).join('\n');

  const evoltDelta = evolt.length >= 2 ? (() => {
    const f = evolt[0], l = evolt[evolt.length - 1];
    return `Change ${f.date}→${l.date}: Weight ${f.weight}→${l.weight}lbs (${(l.weight-f.weight).toFixed(1)}), ` +
      `BF% ${f.bodyFatPct}→${l.bodyFatPct}% (${(l.bodyFatPct-f.bodyFatPct).toFixed(1)}%), ` +
      `Muscle ${f.skeletalMuscleMass}→${l.skeletalMuscleMass}lbs (${(l.skeletalMuscleMass-f.skeletalMuscleMass).toFixed(1)})`;
  })() : 'Only one scan available.';

  const recentNutrition = fuelstrong.slice(-14).map(n =>
    `${n.date}: P=${n.protein}g cal=${n.calories} water=${n.water}oz ${JSON.stringify(n.flags||{})}`
  ).join('\n') || 'No nutrition history.';

  const recentWorkouts = fitbod.slice(-10).map(w =>
    `${w.date}: ${w.workoutName||'Workout'} | ${(w.muscleGroupsWorked||[]).join(', ')} | ${w.totalVolume}lbs`
  ).join('\n') || 'No workout data.';

  // ── Top insights (pre-compressed patterns) ──
  const topInsights = insightsData?.insights?.slice(0, 5).map((ins, i) =>
    `${i+1}. [${ins.type}] ${ins.observation} → ${ins.recommendation}`
  ).join('\n') || 'No pattern insights yet — need more data.';

  // ── Today's live data ──
  const foodLog   = body.foodLog   || liveKV.foodLog   || [];
  const waterLog  = body.waterLog  || liveKV.waterLog  || [];
  const hem       = body.hem       || liveKV.hem       || [];
  const workouts  = body.workouts  || liveKV.workouts  || [];
  const flags     = body.flags     || liveKV.flags     || {};

  const todayProtein  = Math.round(foodLog.reduce((a, i) => a + (i.protein || 0), 0));
  const todayCalories = Math.round(foodLog.reduce((a, i) => a + (i.calories || 0), 0));
  const todayWater    = Math.round(waterLog.reduce((a, w) => a + (w.oz || 0), 0));

  const proteinGoal = goals.protein || 150;
  const calGoal     = goals.cal     || 1800;
  const waterGoal   = goals.water   || 80;
  const currentTime = body.currentTime || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // ── Tirzepatide context ──
  const tirz = body.tirzepatide || {};
  const tirzDayNum = tirz.day !== '' && tirz.day !== undefined ? parseInt(tirz.day) : null;
  const todayDow   = new Date().getDay();
  const daysPostInj = tirzDayNum !== null ? ((todayDow - tirzDayNum) + 7) % 7 : null;
  const dayNames    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  // ── Build food timeline ──
  const foodTimeline = foodLog.length
    ? [...foodLog].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
        .map(i => {
          const t = i.timestamp ? new Date(i.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '?';
          return `${t}: ${i.name} — ${i.protein}g P, ${i.calories} kcal`;
        }).join('\n')
    : 'Nothing logged yet.';

  // ── HEM timeline ──
  const hemTimeline = hem.length
    ? hem.slice(-6).map(e => {
        const t = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : e.time || '?';
        const hLabel = e.h === 1 ? 'H1(not hungry)' : e.h === 2 ? 'H2(moderate)' : e.h === 3 ? 'H3(very hungry)' : '';
        const eLabel = e.e === 1 ? 'E1(low)' : e.e === 2 ? 'E2(moderate)' : e.e === 3 ? 'E3(high)' : '';
        const mLabel = e.m === 1 ? 'M1(low)' : e.m === 2 ? 'M2(ok)' : e.m === 3 ? 'M3(good)' : '';
        return `${t}: ${[hLabel, eLabel, mLabel].filter(Boolean).join(' ')}${e.note ? ' — ' + e.note : ''}`;
      }).join('\n')
    : 'No H-E-M logged yet.';

  // ── Workout today ──
  const workoutBlock = workouts.length
    ? workouts.map(w => {
        const start = w.startTime ? new Date(w.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '?';
        const end   = w.endTime   ? new Date(w.endTime).toLocaleTimeString('en-US',   { hour: 'numeric', minute: '2-digit' }) : '?';
        return `${start}–${end} (${w.durationMinutes||'?'} min)${w.rpe ? ' RPE ' + w.rpe + '/10' : ''}${w.notes ? ' — ' + w.notes : ''}`;
      }).join('\n')
    : `No workout logged. Plan: ${flags.trainingDay ? 'Training Day' : flags.recoveryDay ? 'Recovery Day' : 'not set'}`;

  // ── Goals/context block ──
  const goalsBlock = goals && Object.keys(goals).length ? `
Protein goal: ${proteinGoal}g/day
Calorie goal: ${calGoal} kcal/day
Water goal: ${waterGoal}oz/day
Primary goal: ${goals.primary || 'body recomposition'}
Training focus: ${goals.training || 'hypertrophy'}` : '';

  const contextBlock = context ? `\nCoach context: ${context}` : '';

  // ── Tirzepatide block ──
  const tirzBlock = tirzDayNum !== null
    ? `\nTirzepatide: ${tirz.dose || '?'}mg injected ${dayNames[tirzDayNum]} — ${daysPostInj} days ago`
    : '';

  // ── Day flags ──
  const flagsBlock = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/([A-Z])/g, ' $1').trim())
    .join(', ');

  // ─── BASE SYSTEM PROMPT ────────────────────────────────────────────────────
  const baseSystem = `You are a direct, evidence-based fitness coach specializing in body recomposition. You coach Hanna, a 50-year-old woman who:

PROFILE:
- 5'5", peri/post-menopausal (affects muscle-building rate and fat distribution)
- On tirzepatide (GLP-1/GIP agonist) — suppresses appetite significantly, can make hitting protein targets challenging
- Takes creatine daily — causes 2-4 lb water retention in muscle tissue, which inflates BIA body fat % readings. This is NOT actual fat gain.
- Uses Evolt 360 BIA scanner — BIA accuracy depends on hydration. Compare TRENDS not individual scans.
- Uses Fitbod (progressive overload workouts), FuelStrong (this app, nutrition + behavior tracking)
- GOAL: Preserve and build skeletal muscle while losing fat mass — body recomposition${goalsBlock}${contextBlock}${tirzBlock}

EVIDENCE-BASED RULES (no myths, no broscience):
1. PROTEIN: 0.7–1.0g per lb of bodyweight for muscle retention during deficit. Higher end (~1g/lb) when training hard.
2. MUSCLE BUILDING: Women over 50 build muscle slowly. 0.25–0.5 lbs/month is realistic and excellent.
3. TIRZEPATIDE + MUSCLE: GLP-1 suppresses appetite — useful for fat loss but risks inadequate protein intake and muscle loss. Priority: hit protein even when not hungry.
4. CREATINE + BIA: Creatine causes water retention that inflates lean mass by 2–4 lbs. Beneficial, not negative.
5. DEFICIT DEPTH: 300–500 kcal/day deficit optimal. More aggressive = faster muscle loss.
6. PROGRESSIVE OVERLOAD: Weight going up over time is the primary driver of muscle retention/growth.
7. AVOID: "muscle turns to fat," "toning vs building," generic "eat less move more," detoxes, spot reduction.

HISTORICAL PATTERN INSIGHTS (derived from her full data history):
${topInsights}

TONE: Direct, coach-like, conversational. Specific numbers over reassurance. Connect today's data to her goals. Short paragraphs, not bullet-heavy unless listing action items. Sound like a knowledgeable friend, not a report generator.`;

  // ─── MODE-SPECIFIC PROMPTS ─────────────────────────────────────────────────
  let systemAddition = '';
  let userMsg        = '';
  const msgHistory   = body.history || [];

  const todayDataBlock = `
TODAY (${currentTime}) — ${flagsBlock || 'no plan set'}:
Protein: ${todayProtein}g / ${proteinGoal}g goal
Calories: ${todayCalories} / ${calGoal} kcal
Water: ${todayWater}oz / ${waterGoal}oz
Tirzepatide: ${daysPostInj !== null ? daysPostInj + ' days post-injection' : 'timing unknown'}

FOOD TIMELINE:
${foodTimeline}

H-E-M (Hunger/Energy/Mood 1–3):
${hemTimeline}

WORKOUT:
${workoutBlock}`;

  if (mode === 'checkin') {
    // Auto-detects time of day and responds appropriately
    const hour = new Date().getHours();
    const timeContext = hour < 11 ? 'MORNING CHECK-IN' : hour < 15 ? 'MIDDAY CHECK-IN' : 'EVENING CHECK-IN';

    systemAddition = `
You are doing a ${timeContext}. Read the current data and give Hanna a brief, useful coaching response.

${hour < 11
  ? 'Morning: Set the tone for the day. Lead with what matters most to set up for success. Specific protein timing recommendation based on what\'s logged so far and when she needs to train.'
  : hour < 15
  ? 'Midday: Reality check. How is she tracking? What does she need to do in the next 4 hours? Be specific about remaining protein needs.'
  : 'Evening: Assess the day. What went well? What one thing matters most before end of day? Keep it short — she\'s tired.'}

Keep it to 3–5 short paragraphs max. Conversational. No headers. No bullet lists unless listing specific foods/actions.
End with ONE specific next action, not a list.`;

    userMsg = `${todayDataBlock}

RECENT HISTORY (last 14 days):
${recentNutrition}

EVOLT TREND:
${evoltLines}

Give me my ${timeContext.toLowerCase()}.`;

  } else if (mode === 'ask') {
    systemAddition = `
Answer the specific question directly and specifically. Use actual numbers from the data. 
Keep it to 3–5 sentences. Conversational, not clinical. If the question is about today, prioritize today's data. 
If it's about trends, use the historical data and pattern insights.`;

    userMsg = `${todayDataBlock}

HISTORICAL:
${recentNutrition}

EVOLT:
${evoltLines}
${evoltDelta}

WORKOUTS (recent):
${recentWorkouts}

Question: ${question}`;

  } else if (mode === 'post_workout') {
    systemAddition = `
Post-workout coaching. Workout is complete. Focus entirely on recovery nutrition.
Be specific: name actual foods she has logged or likely has available based on her history.
Keep it short — 2–3 paragraphs. The most important thing is getting protein in the next 30–60 minutes.`;

    userMsg = `${todayDataBlock}

Workout just finished. Give me post-workout guidance.`;

  } else if (mode === 'dashboard') {
    // Progress app coaching — big picture synthesis
    const woSummary  = body.workoutSummary || null;
    const woLines    = woSummary
      ? `Total workouts: ${woSummary.totalWorkouts} | Avg/week: ${woSummary.avgWorkoutsPerWeek} | ` +
        `Compound: ${woSummary.compoundPct}% | Top PRs: ${woSummary.topPRs}`
      : recentWorkouts;

    systemAddition = `
You are the Performance & Pattern Coach in FuelStrong Progress. Connect the dots across ALL data sources. Every finding must tie at least two data sources together.

Structure (use these headers exactly):
**🧠 Big Picture** — 1–2 sentences. Honest overall trajectory with specific numbers.
**📊 What the Data Shows** — 3–5 bullets connecting cause and effect across sources. Must cite actual numbers.
**💪 Training Focus** — 2–3 specific adjustments. Lead with training, frame nutrition as support.
**🎯 Before Your Next Scan** — 2–3 concrete things to do before the next Evolt scan and what they should produce.

Tone: Direct. Specific. Encouraging but not vague. No preamble.`;

    userMsg = `EVOLT SCANS:
${evoltLines}
Overall change: ${evoltDelta}

WORKOUT ANALYTICS:
${woLines}

NUTRITION (last 14 days):
${recentNutrition}

Generate my coaching dashboard.`;

  } else {
    // Fallback — general
    systemAddition = '\nAnswer helpfully based on all available data.';
    userMsg = `${todayDataBlock}\n\n${question || 'Give me a coaching update.'}`;
  }

  // Build messages array with conversation history
  let messagesArr;
  if (msgHistory.length > 0) {
    messagesArr = [...msgHistory, { role: 'user', content: userMsg }];
  } else {
    messagesArr = [{ role: 'user', content: userMsg }];
  }

  const resp = await callClaude(env, {
    model:      'claude-sonnet-4-20250514',
    max_tokens: mode === 'dashboard' ? 1400 : 900,
    system:     baseSystem + systemAddition,
    messages:   messagesArr,
  });

  const coaching = resp.content?.[0]?.text || 'Could not generate coaching.';

  // Persist last coaching response
  await env.FUELSTRONG_KV.put('last_coaching', JSON.stringify({
    text: coaching, mode, question: question || null,
    generatedAt: new Date().toISOString()
  }));

  // Append to coaching history (keep last 30 sessions)
  try {
    const histRaw = await env.FUELSTRONG_KV.get('coaching:history').catch(() => null);
    const hist    = JSON.parse(histRaw || '[]');
    hist.push({ mode, coaching, generatedAt: new Date().toISOString(), todayProtein, todayCalories });
    if (hist.length > 30) hist.splice(0, hist.length - 30);
    await env.FUELSTRONG_KV.put('coaching:history', JSON.stringify(hist));
  } catch (e) { console.warn('History save failed:', e.message); }

  return reply({ coaching, generatedAt: new Date().toISOString() });
}

// ─── Legacy Data Endpoints ─────────────────────────────────────────────────────
async function getData(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
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

async function saveData(request, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const { type, data } = await request.json();
  if (!['evolt', 'fitbod', 'fuelstrong'].includes(type)) return reply({ error: 'Invalid data type' }, 400);

  if (Array.isArray(data) && data.length === 0) {
    await env.FUELSTRONG_KV.put(type, '[]');
    return reply({ success: true, total: 0, cleared: true });
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

async function deleteEntry(request, env, path) {
  const parts    = path.split('/').filter(Boolean);
  const type     = parts[2];
  const id       = parts[3];
  const existing = JSON.parse(await env.FUELSTRONG_KV.get(type) || '[]');
  const filtered = existing.filter(e => (e.id || e.date) !== decodeURIComponent(id));
  await env.FUELSTRONG_KV.put(type, JSON.stringify(filtered));
  return reply({ success: true, remaining: filtered.length });
}

// ─── Profile ──────────────────────────────────────────────────────────────────
async function getProfile(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const [goalsRaw, tirzRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('profile_goals').catch(() => null),
    env.FUELSTRONG_KV.get('profile_tirz').catch(() => null),
  ]);
  return reply({
    goals: goalsRaw ? JSON.parse(goalsRaw) : null,
    tirz:  tirzRaw  ? JSON.parse(tirzRaw)  : null,
  });
}

async function saveProfile(request, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const body = await request.json().catch(() => ({}));
  const ops  = [];
  if (body.goals !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_goals', JSON.stringify(body.goals)));
  if (body.tirz  !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_tirz',  JSON.stringify(body.tirz)));
  await Promise.all(ops);
  return reply({ success: true });
}

// ─── Generic KV Helpers ────────────────────────────────────────────────────────
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

// ─── GitHub Backup ────────────────────────────────────────────────────────────
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
        content:  b64encode(file.content),
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

// ─── Claude API Helper ────────────────────────────────────────────────────────
async function callClaude(env, body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const STATUS = {
      400: 'Bad request to Anthropic — check model name.',
      401: 'Invalid ANTHROPIC_API_KEY — check Worker secrets.',
      402: 'Anthropic account out of credits.',
      429: 'Anthropic rate limit — wait and retry.',
      529: 'Anthropic quota exceeded — check billing.',
      500: 'Anthropic internal error — try again.',
    };
    throw new Error(STATUS[res.status] || `Anthropic API error ${res.status}`);
  }
  return res.json();
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function githubHeaders(env) {
  return {
    'Authorization': `token ${env.GITHUB_TOKEN}`,
    'Content-Type':  'application/json',
    'User-Agent':    'FuelStrong/2.0',
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
  return btoa(unescape(encodeURIComponent(str)));
}
