/**
 * FuelStrong v2 — Cloudflare Worker Backend
 * ==========================================
 * D1-backed. Replaces worker.js entirely.
 *
 * Required bindings in wrangler.toml:
 *   [[d1_databases]]
 *   binding = "FUELSTRONG_DB"
 *   database_name = "fuelstrong-v2"
 *   database_id = "<your-d1-database-id>"
 *
 * Required secrets (set via: wrangler secret put <NAME>):
 *   FUELSTRONG_KEY    — auth key for all API requests
 *   ANTHROPIC_API_KEY — for coaching + Evolt PDF parsing
 *
 * All requests: add header  X-FS-Key: <FUELSTRONG_KEY>
 *   or query param          ?key=<FUELSTRONG_KEY>
 */

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') return cors();

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // Auth — header or query param
    const key = request.headers.get('X-FS-Key') || url.searchParams.get('key');
    if (key !== (env.FUELSTRONG_KEY || 'fuelstrong-dev')) {
      return reply({ error: 'unauthorized' }, 401);
    }

    try {
      // ── TODAY ─────────────────────────────────────────────────────────────
      if (path === '/api/today'        && method === 'GET')  return await getToday(request, env, url);
      if (path === '/api/flags'        && method === 'PUT')  return await putFlags(request, env, url);

      // ── FOOD ──────────────────────────────────────────────────────────────
      if (path === '/api/food'         && method === 'POST') return await addFood(request, env);
      if (path.startsWith('/api/food/') && method === 'DELETE') return await deleteFood(request, env, path);

      // ── WATER ─────────────────────────────────────────────────────────────
      if (path === '/api/water'        && method === 'POST') return await addWater(request, env);

      // ── HEM ───────────────────────────────────────────────────────────────
      if (path === '/api/hem'          && method === 'POST') return await addHem(request, env);

      // ── FOOD LIBRARY ──────────────────────────────────────────────────────
      if (path === '/api/foods/smart'  && method === 'GET')  return await getSmartFoods(request, env, url);
      if (path === '/api/foods/search' && method === 'GET')  return await searchFoods(request, env, url);
      if (path === '/api/foods'        && method === 'POST') return await addFoodToLibrary(request, env);
      if (path === '/api/foods/pin'    && method === 'POST') return await pinFood(request, env);

      // ── GOALS ─────────────────────────────────────────────────────────────
      if (path === '/api/goals'        && method === 'GET')  return await getGoals(env);
      if (path === '/api/goals'        && method === 'POST') return await saveGoals(request, env);

      // ── PROFILE / TIRZEPATIDE ─────────────────────────────────────────────
      if (path === '/api/profile'      && method === 'GET')  return await getProfile(env);
      if (path === '/api/tirz'         && method === 'POST') return await logTirz(request, env);

      // ── COACHING ──────────────────────────────────────────────────────────
      if (path === '/api/coach'        && method === 'POST') return await getCoaching(request, env);
      if (path === '/api/coach/history'&& method === 'GET')  return await getCoachHistory(env, url);

      // ── BODY SCANS ────────────────────────────────────────────────────────
      if (path === '/api/scans'        && method === 'GET')  return await getScans(env);
      if (path === '/api/scan'         && method === 'POST') return await uploadScan(request, env);
      if (path === '/api/scan/check'   && method === 'POST') return await checkScanDuplicate(request, env);
      if (path.startsWith('/api/scan/') && method === 'DELETE') return await deleteScan(request, env, path);

      // ── WORKOUTS / PRs ────────────────────────────────────────────────────
      if (path === '/api/workouts'     && method === 'GET')  return await getWorkouts(env, url);
      if (path === '/api/workouts'     && method === 'POST') return await addWorkout(request, env);
      if (path === '/api/prs'          && method === 'GET')  return await getPRs(env, url);
      if (path.startsWith('/api/strength/') && method === 'GET') return await getStrengthProgress(env, path);

      // ── LOG HISTORY ───────────────────────────────────────────────────────
      if (path === '/api/log'          && method === 'GET')  return await getLog(env, url);
      if (path.startsWith('/api/log/') && method === 'GET')  return await getLogDay(env, path);

      // ── EVENTS / NOTES ────────────────────────────────────────────────────
      if (path === '/api/events'       && method === 'GET')  return await getEvents(env);
      if (path === '/api/events'       && method === 'POST') return await addEvent(request, env);

      // ── NSV ───────────────────────────────────────────────────────────────
      if (path === '/api/nsv'          && method === 'POST') return await addNSV(request, env);
      if (path === '/api/nsv'          && method === 'GET')  return await getNSVs(env);

      // ── MEASUREMENTS ──────────────────────────────────────────────────────
      if (path === '/api/measurements' && method === 'POST') return await addMeasurement(request, env);
      if (path === '/api/measurements' && method === 'GET')  return await getMeasurements(env);

      // ── FOOD AI ────────────────────────────────────────────────────────────
      if (path === '/api/estimate'       && method === 'POST') return await estimateMacros(request, env);
      if (path === '/api/scan-label'     && method === 'POST') return await scanNutritionLabel(request, env);

      // ── ANALYTICS ─────────────────────────────────────────────────────────
      if (path === '/api/momentum'       && method === 'GET')  return await getMomentum(env);
      if (path === '/api/scan-intervals' && method === 'GET')  return await getScanIntervals(env);

      // ── BULK IMPORT ────────────────────────────────────────────────────────
      if (path === '/api/workouts/bulk'  && method === 'POST') return await bulkImportWorkouts(request, env);

      return reply({ error: 'not found', path }, 404);

    } catch (err) {
      console.error(err);
      return reply({ error: err.message, stack: err.stack }, 500);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  TODAY
// ─────────────────────────────────────────────────────────────────────────────
async function getToday(request, env, url) {
  const date = url.searchParams.get('date') || todayStr();
  const db   = env.FUELSTRONG_DB;

  const [log, food, water, hem, workouts, goals, tirz] = await Promise.all([
    db.prepare('SELECT * FROM daily_logs WHERE date = ?').bind(date).first(),
    db.prepare('SELECT * FROM food_entries WHERE date = ? ORDER BY timestamp ASC').bind(date).all(),
    db.prepare('SELECT * FROM water_entries WHERE date = ? ORDER BY timestamp ASC').bind(date).all(),
    db.prepare('SELECT * FROM hem_entries WHERE date = ? ORDER BY timestamp ASC').bind(date).all(),
    db.prepare('SELECT * FROM workout_sessions WHERE session_date = ? ORDER BY id DESC').bind(date).all(),
    db.prepare('SELECT * FROM goals ORDER BY effective_date DESC LIMIT 1').first(),
    db.prepare('SELECT * FROM tirzepatide_log ORDER BY date DESC LIMIT 1').first(),
  ]);

  // Compute live totals from entries (source of truth)
  const foods     = food.results || [];
  const waters    = water.results || [];
  const hems      = hem.results || [];
  const sessions  = workouts.results || [];

  const totals = {
    calories: Math.round(foods.reduce((a, f) => a + (f.calories || 0), 0)),
    protein:  Math.round(foods.reduce((a, f) => a + (f.protein_g || 0), 0)),
    carbs:    Math.round(foods.reduce((a, f) => a + (f.carbs_g || 0), 0)),
    fat:      Math.round(foods.reduce((a, f) => a + (f.fat_g || 0), 0)),
    fiber:    Math.round(foods.reduce((a, f) => a + (f.fiber_g || 0), 0)),
    water:    Math.round(waters.reduce((a, w) => a + (w.oz || 0), 0)),
  };

  // Determine tirzepatide days since last injection
  let daysSinceInjection = null;
  if (tirz?.date) {
    const last = new Date(tirz.date);
    const now  = new Date(date);
    daysSinceInjection = Math.floor((now - last) / 86400000);
  }

  return reply({
    date,
    log: log || { date, training_day: 0, recovery_day: 0, injection_day: 0 },
    totals,
    foods,
    water: waters,
    hem:   hems,
    workouts: sessions,
    goals: goals || null,
    tirz:  tirz  || null,
    daysSinceInjection,
  });
}

async function putFlags(request, env, url) {
  const date = url.searchParams.get('date') || todayStr();
  const body = await request.json();

  await env.FUELSTRONG_DB.prepare(`
    INSERT INTO daily_logs (date, training_day, recovery_day, injection_day)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      training_day  = excluded.training_day,
      recovery_day  = excluded.recovery_day,
      injection_day = excluded.injection_day
  `).bind(
    date,
    body.trainingDay  ? 1 : 0,
    body.recoveryDay  ? 1 : 0,
    body.injectionDay ? 1 : 0
  ).run();

  // If injection day, log it in tirz log
  if (body.injectionDay) {
    const tirz = await env.FUELSTRONG_DB.prepare(
      'SELECT * FROM tirzepatide_log ORDER BY date DESC LIMIT 1'
    ).first();
    const dose = tirz?.dose_mg || null;

    await env.FUELSTRONG_DB.prepare(`
      INSERT INTO tirzepatide_log (date, event_type, dose_mg)
      VALUES (?, 'injection', ?)
      ON CONFLICT DO NOTHING
    `).bind(date, dose).run().catch(() => {});
  }

  return reply({ ok: true, date });
}

// ─────────────────────────────────────────────────────────────────────────────
//  FOOD
// ─────────────────────────────────────────────────────────────────────────────
async function addFood(request, env) {
  const body = await request.json();
  const date = body.date || todayStr();
  const ts   = body.timestamp || new Date().toISOString();

  if (!body.name) return reply({ error: 'name required' }, 400);

  const result = await env.FUELSTRONG_DB.prepare(`
    INSERT INTO food_entries (date, timestamp, name, display_name,
      calories, protein_g, carbs_g, fat_g, fiber_g, serving, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app')
  `).bind(
    date, ts,
    body.name,
    body.displayName || body.name,
    body.calories || 0,
    body.protein  || 0,
    body.carbs    || 0,
    body.fat      || 0,
    body.fiber    || 0,
    body.serving  || null
  ).run();

  const id = result.meta?.last_row_id;

  // Update daily_logs totals
  await recalcDailyTotals(env.FUELSTRONG_DB, date);

  // Increment use_count in food_library if this food exists there
  if (body.name) {
    await env.FUELSTRONG_DB.prepare(
      'UPDATE food_library SET use_count = use_count + 1, last_used = ? WHERE name = ?'
    ).bind(date, body.name).run().catch(() => {});
  }

  return reply({ ok: true, id, date });
}

async function deleteFood(request, env, path) {
  const id = parseInt(path.split('/').pop());
  if (!id) return reply({ error: 'invalid id' }, 400);

  const entry = await env.FUELSTRONG_DB.prepare(
    'SELECT date FROM food_entries WHERE id = ?'
  ).bind(id).first();

  if (!entry) return reply({ error: 'not found' }, 404);

  await env.FUELSTRONG_DB.prepare('DELETE FROM food_entries WHERE id = ?').bind(id).run();
  await recalcDailyTotals(env.FUELSTRONG_DB, entry.date);

  return reply({ ok: true, id });
}

// ─────────────────────────────────────────────────────────────────────────────
//  WATER
// ─────────────────────────────────────────────────────────────────────────────
async function addWater(request, env) {
  const body = await request.json();
  const date = body.date || todayStr();
  const ts   = body.timestamp || new Date().toISOString();
  const oz   = body.oz || 0;

  if (!oz) return reply({ error: 'oz required' }, 400);

  await env.FUELSTRONG_DB.prepare(
    'INSERT INTO water_entries (date, timestamp, oz) VALUES (?, ?, ?)'
  ).bind(date, ts, oz).run();

  await recalcDailyTotals(env.FUELSTRONG_DB, date);

  return reply({ ok: true, oz, date });
}

// ─────────────────────────────────────────────────────────────────────────────
//  HEM
// ─────────────────────────────────────────────────────────────────────────────
async function addHem(request, env) {
  const body = await request.json();
  const date = body.date || todayStr();
  const ts   = body.timestamp || new Date().toISOString();

  const hunger = clamp(body.hunger || body.h, 1, 5);
  const energy = clamp(body.energy || body.e, 1, 5);
  const mood   = clamp(body.mood   || body.m, 1, 5);

  await env.FUELSTRONG_DB.prepare(
    'INSERT INTO hem_entries (date, timestamp, hunger, energy, mood, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(date, ts, hunger, energy, mood, body.note || null).run();

  return reply({ ok: true, date });
}

// ─────────────────────────────────────────────────────────────────────────────
//  FOOD LIBRARY
// ─────────────────────────────────────────────────────────────────────────────
async function getSmartFoods(request, env, url) {
  const date = url.searchParams.get('date') || todayStr();
  const db   = env.FUELSTRONG_DB;

  // 1. Pinned foods
  const pinned = await db.prepare(
    'SELECT * FROM food_library WHERE is_pinned = 1 ORDER BY name ASC'
  ).all();

  // 2. Logged today (distinct names not already in pinned)
  const pinnedNames = new Set((pinned.results || []).map(f => f.name));
  const todayFoods  = await db.prepare(
    'SELECT DISTINCT name, display_name, calories, protein_g, carbs_g, fat_g, fiber_g, serving FROM food_entries WHERE date = ? ORDER BY timestamp DESC'
  ).bind(date).all();
  const todayList   = (todayFoods.results || []).filter(f => !pinnedNames.has(f.name));

  // 3. Recent 7 days (distinct names not in pinned or today)
  const since = daysAgo(7);
  const recentFoods = await db.prepare(
    'SELECT DISTINCT name, display_name, calories, protein_g, carbs_g, fat_g, fiber_g, serving FROM food_entries WHERE date >= ? AND date < ? ORDER BY timestamp DESC LIMIT 30'
  ).bind(since, date).all();
  const todayAndPinned = new Set([...pinnedNames, ...todayList.map(f => f.name)]);
  const recentList = (recentFoods.results || []).filter(f => !todayAndPinned.has(f.name));

  return reply({
    pinned:  pinned.results  || [],
    today:   todayList,
    recent:  recentList,
  });
}

async function searchFoods(request, env, url) {
  const q = url.searchParams.get('q') || '';
  if (!q) return reply({ results: [] });

  const results = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM food_library WHERE name LIKE ? ORDER BY use_count DESC, name ASC LIMIT 20'
  ).bind(`%${q}%`).all();

  return reply({ results: results.results || [] });
}

async function addFoodToLibrary(request, env) {
  const body = await request.json();
  if (!body.name) return reply({ error: 'name required' }, 400);

  const exists = await env.FUELSTRONG_DB.prepare(
    'SELECT id FROM food_library WHERE name = ?'
  ).bind(body.name).first();

  if (exists) {
    // Update existing
    await env.FUELSTRONG_DB.prepare(`
      UPDATE food_library SET
        calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?,
        serving = ?, display_name = ?
      WHERE name = ?
    `).bind(
      body.calories || 0, body.protein || 0, body.carbs || 0,
      body.fat || 0, body.fiber || 0,
      body.serving || null, body.displayName || null, body.name
    ).run();
    return reply({ ok: true, action: 'updated', id: exists.id });
  }

  const result = await env.FUELSTRONG_DB.prepare(`
    INSERT INTO food_library (name, display_name, calories, protein_g, carbs_g, fat_g, fiber_g, serving, is_custom)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    body.name, body.displayName || null,
    body.calories || 0, body.protein || 0, body.carbs || 0,
    body.fat || 0, body.fiber || 0, body.serving || null
  ).run();

  return reply({ ok: true, action: 'inserted', id: result.meta?.last_row_id });
}

async function pinFood(request, env) {
  const body = await request.json();
  if (!body.name) return reply({ error: 'name required' }, 400);

  const pinned = body.pinned !== false ? 1 : 0;

  await env.FUELSTRONG_DB.prepare(
    'UPDATE food_library SET is_pinned = ? WHERE name = ?'
  ).bind(pinned, body.name).run();

  return reply({ ok: true, name: body.name, pinned: !!pinned });
}

// ─────────────────────────────────────────────────────────────────────────────
//  GOALS
// ─────────────────────────────────────────────────────────────────────────────
async function getGoals(env) {
  const goals = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM goals ORDER BY effective_date DESC LIMIT 1'
  ).first();
  return reply(goals || {});
}

async function saveGoals(request, env) {
  const body = await request.json();
  const date = todayStr();

  await env.FUELSTRONG_DB.prepare(`
    INSERT INTO goals (effective_date, calories_low, calories_high, protein_g, water_oz, primary_goal, source, notes)
    VALUES (?, ?, ?, ?, ?, 'recomposition', ?, ?)
  `).bind(
    date,
    body.caloriesLow  || body.calories_low  || null,
    body.caloriesHigh || body.calories_high || null,
    body.protein      || body.protein_g     || null,
    body.water        || body.water_oz      || 80,
    body.source       || 'manual',
    body.notes        || null
  ).run();

  return reply({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
//  PROFILE / TIRZEPATIDE
// ─────────────────────────────────────────────────────────────────────────────
async function getProfile(env) {
  const [tirz, goals, latestScan, recentScans] = await Promise.all([
    env.FUELSTRONG_DB.prepare('SELECT * FROM tirzepatide_log ORDER BY date DESC LIMIT 5').all(),
    env.FUELSTRONG_DB.prepare('SELECT * FROM goals ORDER BY effective_date DESC LIMIT 1').first(),
    env.FUELSTRONG_DB.prepare('SELECT * FROM body_scans ORDER BY scan_date DESC LIMIT 1').first(),
    env.FUELSTRONG_DB.prepare('SELECT scan_date, weight_lbs, skeletal_muscle_mass, body_fat_pct, bmr, tee, rec_cal_low, rec_cal_high, rec_protein_low_g, rec_protein_high_g FROM body_scans ORDER BY scan_date DESC LIMIT 3').all(),
  ]);

  return reply({
    tirzepatide: tirz.results || [],
    goals:       goals || null,
    latestScan:  latestScan || null,
    recentScans: recentScans.results || [],
  });
}

async function logTirz(request, env) {
  const body = await request.json();
  const date = body.date || todayStr();

  if (!body.eventType) return reply({ error: 'eventType required' }, 400);

  await env.FUELSTRONG_DB.prepare(`
    INSERT INTO tirzepatide_log (date, event_type, dose_mg, injection_day_of_wk, note)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    date,
    body.eventType,
    body.dose    || null,
    body.dayOfWk !== undefined ? body.dayOfWk : null,
    body.note    || null
  ).run();

  return reply({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
//  COACHING
// ─────────────────────────────────────────────────────────────────────────────
async function getCoaching(request, env) {
  const body     = await request.json();
  const mode     = body.mode || 'checkin'; // checkin | ask | progress
  const userMsg  = body.message || '';
  const date     = body.date || todayStr();
  const db       = env.FUELSTRONG_DB;

  // Build context dataset from D1 — capped to avoid timeout
  const [goals, latestScan, tirz, recent14, recentWorkouts] = await Promise.all([
    db.prepare('SELECT * FROM goals ORDER BY effective_date DESC LIMIT 1').first(),
    db.prepare('SELECT * FROM body_scans ORDER BY scan_date DESC LIMIT 2').all(),
    db.prepare('SELECT * FROM tirzepatide_log ORDER BY date DESC LIMIT 1').first(),
    db.prepare(`
      SELECT dl.date, dl.calories, dl.protein_g, dl.water_oz,
             dl.training_day, dl.injection_day
      FROM daily_logs dl
      WHERE dl.date >= ? AND dl.date <= ?
      ORDER BY dl.date DESC
    `).bind(daysAgo(14), date).all(),
    db.prepare(`
      SELECT session_date, session_type, total_volume_lbs, total_sets
      FROM workout_sessions
      WHERE session_date >= ?
      ORDER BY session_date DESC LIMIT 10
    `).bind(daysAgo(28)).all(),
  ]);

  const scans    = latestScan.results || [];
  const scan     = scans[0] || null;
  const logDays  = recent14.results || [];
  const sessions = recentWorkouts.results || [];

  // Compute averages
  const daysWithFood = logDays.filter(d => (d.calories || 0) > 0);
  const avgProt7  = avg(logDays.slice(0,7).filter(d => d.protein_g > 0), 'protein_g');
  const avgCal7   = avg(logDays.slice(0,7).filter(d => d.calories > 0), 'calories');
  const lowCalDays = daysWithFood.filter(d => d.calories < 1200).length;
  const trainDays7 = logDays.slice(0,7).filter(d => d.training_day).length;

  // Derive targets from scan or goals
  const bodyWeight  = scan?.weight_lbs || null;
  const tee         = scan?.tee || null;
  const protTarget  = goals?.protein_g || (bodyWeight ? Math.round(bodyWeight * 0.85) : null);
  const calLow      = goals?.calories_low  || (tee ? Math.round(tee - 400) : null);
  const calHigh     = goals?.calories_high || (tee ? Math.round(tee - 200) : null);
  const waterTarget = goals?.water_oz || 80;

  // Tirzepatide context
  const daysSinceInj = tirz?.date
    ? Math.floor((new Date(date) - new Date(tirz.date)) / 86400000)
    : null;

  // Build trimmed system prompt
  const systemPrompt = `You are the FuelStrong Coach. You analyze real data and give specific, actionable advice.

ABOUT HANNA:
- 50yo woman, body recomposition goal: build visible muscle + lose fat
- Training at Anytime Fitness with Fitbod (strength/hypertrophy) since Nov 2024
- On tirzepatide — hunger cues suppressed, undereating is the #1 risk
- Any day under 1200 kcal = muscle loss territory, flag it directly
- Goal: visible muscle definition, especially arms/shoulders. Scale weight is irrelevant.

COACHING RULES:
- Be specific: "You need 47g more protein today" not "eat more protein"
- Reference her actual numbers, not generic advice
- Protein on training days is critical — name specific high-protein foods
- Never explain basic fitness concepts she already knows
- Keep response under 250 words for check-ins, 150 for quick asks

LIVE DATA:
${scan ? `Latest scan (${scan.scan_date}): ${scan.weight_lbs}lbs | ${scan.body_fat_pct}% BF | ${scan.skeletal_muscle_mass}lbs muscle | BMR ${scan.bmr} | TEE ${scan.tee}` : 'No Evolt scan data yet'}
${protTarget ? `Protein target: ${protTarget}g/day` : ''}
${calLow ? `Calorie target: ${calLow}–${calHigh} kcal/day` : ''}
Water target: ${waterTarget}oz/day
${tirz ? `Tirzepatide: ${tirz.dose_mg || '?'}mg${daysSinceInj !== null ? ` — ${daysSinceInj} days since last injection` : ''}` : ''}

LAST 7 DAYS:
${logDays.slice(0,7).map(d =>
  `${d.date}: ${d.calories || 0}kcal | ${d.protein_g || 0}g protein | ${d.water_oz || 0}oz water${d.training_day ? ' 💪' : ''}${d.injection_day ? ' 💉' : ''}${(d.calories || 0) > 0 && (d.calories || 0) < 1200 ? ' ⚠️LOW' : ''}`
).join('\n')}

PATTERNS:
Avg protein (7d): ${avgProt7 || '?'}g | Avg calories (7d): ${avgCal7 || '?'} kcal
Low-cal days (14d): ${lowCalDays} | Training days (7d): ${trainDays7}`;

  // Build user context
  const todayFoods = body.foods || [];
  const todayWater = body.water || 0;
  const todayWorkout = body.workout || null;

  let userContext = '';
  if (mode === 'checkin') {
    const todayProt = Math.round(todayFoods.reduce((a, f) => a + (f.protein_g || f.protein || 0), 0));
    const todayCal  = Math.round(todayFoods.reduce((a, f) => a + (f.calories || 0), 0));
    userContext = `TODAY (${date}): ${todayCal} kcal | ${todayProt}g protein | ${todayWater}oz water\n`;
    if (todayFoods.length) {
      userContext += `Foods: ${todayFoods.map(f => `${f.displayName || f.display_name || f.name}(${f.calories || 0}kcal,${f.protein_g || f.protein || 0}g P)`).join(', ')}\n`;
    }
    if (todayWorkout) {
      userContext += `Workout: ${todayWorkout.session_type || 'strength'}, ${todayWorkout.total_sets || '?'} sets, volume ${todayWorkout.total_volume_lbs || '?'}lbs\n`;
    }
    userContext += '\nGive me my daily check-in. What do I need to know and do right now?';
  } else if (mode === 'ask') {
    userContext = userMsg;
  } else if (mode === 'progress') {
    userContext = `Analyze my recent data and tell me what patterns you see across nutrition, training, and body composition. What's working? What needs to change before my next Evolt scan?\n\n${userMsg || ''}`;
  }

  // Call Anthropic API
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'X-API-Key':      env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 800,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userContext }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return reply({ error: 'Anthropic API error', detail: err }, 500);
  }

  const data = await response.json();
  const coachResponse = data.content?.[0]?.text || '';
  const tokensUsed    = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

  // Save to coaching_sessions
  await db.prepare(`
    INSERT INTO coaching_sessions (date, source_app, mode, user_message, coach_response, tokens_used, model)
    VALUES (?, 'fuelstrong_v2', ?, ?, ?, ?, 'claude-sonnet-4-20250514')
  `).bind(date, mode, userMsg || userContext.slice(0, 500), coachResponse, tokensUsed).run();

  return reply({ response: coachResponse, mode, date, tokensUsed });
}

async function getCoachHistory(env, url) {
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const results = await env.FUELSTRONG_DB.prepare(
    'SELECT id, date, mode, user_message, coach_response, tokens_used FROM coaching_sessions ORDER BY id DESC LIMIT ?'
  ).bind(limit).all();
  return reply({ sessions: results.results || [] });
}

// ─────────────────────────────────────────────────────────────────────────────
//  BODY SCANS (Evolt PDF upload with 35-field extraction + duplicate detection)
// ─────────────────────────────────────────────────────────────────────────────
async function getScans(env) {
  const scans = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM body_scans ORDER BY scan_date ASC'
  ).all();
  return reply({ scans: scans.results || [] });
}

async function checkScanDuplicate(request, env) {
  const body = await request.json();
  const date = body.scan_date || body.date;
  if (!date) return reply({ duplicate: false });

  const existing = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM body_scans WHERE scan_date = ?'
  ).bind(date).first();

  return reply({
    duplicate: !!existing,
    existing:  existing || null,
  });
}

async function uploadScan(request, env) {
  const body     = await request.json();
  const pdfBase64 = body.pdf;       // base64-encoded PDF
  const overwrite = body.overwrite || false;

  if (!pdfBase64) return reply({ error: 'pdf field required (base64)' }, 400);

  // Use Claude vision to extract all 35 fields from the Evolt PDF
  const prompt = `This is an Evolt 360 InBody body composition scan report. Extract EVERY number from this report.

Return ONLY a JSON object with these exact keys (use null if not found):
{
  "scan_date": "YYYY-MM-DD",
  "weight_lbs": number,
  "height_in": number,
  "age_at_scan": number,
  "lean_body_mass": number,
  "skeletal_muscle_mass": number,
  "body_fat_mass": number,
  "body_fat_pct": number,
  "protein_mass": number,
  "mineral_mass": number,
  "subcutaneous_fat": number,
  "subcutaneous_fat_pct": number,
  "visceral_fat_mass": number,
  "visceral_fat_pct": number,
  "visceral_fat_area": number,
  "visceral_fat_level": number,
  "total_body_water": number,
  "icf": number,
  "ecf": number,
  "bmr": number,
  "tee": number,
  "bio_age": number,
  "bwi_score": number,
  "abdominal_circ_in": number,
  "waist_hip_ratio": number,
  "seg_torso_lean": number,
  "seg_torso_fat": number,
  "seg_left_arm_lean": number,
  "seg_right_arm_lean": number,
  "seg_left_arm_fat": number,
  "seg_right_arm_fat": number,
  "seg_left_leg_lean": number,
  "seg_right_leg_lean": number,
  "seg_left_leg_fat": number,
  "seg_right_leg_fat": number,
  "rec_cal_low": number,
  "rec_cal_high": number,
  "rec_protein_low_g": number,
  "rec_protein_high_g": number,
  "rec_carbs_low_g": number,
  "rec_carbs_high_g": number,
  "rec_fat_low_g": number,
  "rec_fat_high_g": number
}

Notes:
- Weight should be in lbs. If shown in kg, multiply by 2.20462.
- Height should be in inches. If shown in cm, divide by 2.54.
- Muscle mass numbers should be in lbs.
- Visceral fat area is in cm².
- Return ONLY the JSON, no explanation.`;

  const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!anthropicResp.ok) {
    return reply({ error: 'PDF parsing failed', detail: await anthropicResp.text() }, 500);
  }

  const aiData  = await anthropicResp.json();
  const rawText = aiData.content?.[0]?.text || '';

  let scan;
  try {
    const clean = rawText.replace(/```json|```/g, '').trim();
    scan = JSON.parse(clean);
  } catch {
    return reply({ error: 'Could not parse AI response as JSON', raw: rawText }, 500);
  }

  if (!scan.scan_date) {
    return reply({ error: 'Could not extract scan date from PDF', raw: rawText }, 422);
  }

  // Duplicate detection — check before writing
  const existing = await env.FUELSTRONG_DB.prepare(
    'SELECT scan_date FROM body_scans WHERE scan_date = ?'
  ).bind(scan.scan_date).first();

  if (existing && !overwrite) {
    return reply({
      duplicate: true,
      scan_date: scan.scan_date,
      message: `A scan from ${scan.scan_date} already exists. Send with overwrite: true to replace it.`,
      extracted: scan,
    }, 409);
  }

  // Insert or replace
  const sql = overwrite
    ? `INSERT OR REPLACE INTO body_scans`
    : `INSERT INTO body_scans`;

  await env.FUELSTRONG_DB.prepare(`
    ${sql} (
      scan_date, weight_lbs, height_in, age_at_scan,
      lean_body_mass, skeletal_muscle_mass, body_fat_mass, body_fat_pct,
      protein_mass, mineral_mass, subcutaneous_fat, subcutaneous_fat_pct,
      visceral_fat_mass, visceral_fat_pct, visceral_fat_area, visceral_fat_level,
      total_body_water, icf, ecf, bmr, tee,
      bio_age, bwi_score,
      abdominal_circ_in, waist_hip_ratio,
      seg_torso_lean, seg_torso_fat,
      seg_left_arm_lean, seg_right_arm_lean,
      seg_left_arm_fat, seg_right_arm_fat,
      seg_left_leg_lean, seg_right_leg_lean,
      seg_left_leg_fat, seg_right_leg_fat,
      rec_cal_low, rec_cal_high,
      rec_protein_low_g, rec_protein_high_g,
      rec_carbs_low_g, rec_carbs_high_g,
      rec_fat_low_g, rec_fat_high_g
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )
  `).bind(
    scan.scan_date, scan.weight_lbs, scan.height_in, scan.age_at_scan,
    scan.lean_body_mass, scan.skeletal_muscle_mass, scan.body_fat_mass, scan.body_fat_pct,
    scan.protein_mass, scan.mineral_mass, scan.subcutaneous_fat, scan.subcutaneous_fat_pct,
    scan.visceral_fat_mass, scan.visceral_fat_pct, scan.visceral_fat_area, scan.visceral_fat_level,
    scan.total_body_water, scan.icf, scan.ecf, scan.bmr, scan.tee,
    scan.bio_age, scan.bwi_score,
    scan.abdominal_circ_in, scan.waist_hip_ratio,
    scan.seg_torso_lean, scan.seg_torso_fat,
    scan.seg_left_arm_lean, scan.seg_right_arm_lean,
    scan.seg_left_arm_fat, scan.seg_right_arm_fat,
    scan.seg_left_leg_lean, scan.seg_right_leg_lean,
    scan.seg_left_leg_fat, scan.seg_right_leg_fat,
    scan.rec_cal_low, scan.rec_cal_high,
    scan.rec_protein_low_g, scan.rec_protein_high_g,
    scan.rec_carbs_low_g, scan.rec_carbs_high_g,
    scan.rec_fat_low_g, scan.rec_fat_high_g
  ).run();

  // Build goals suggestion from scan recommendations
  const goalsSuggestion = (scan.rec_cal_low && scan.rec_protein_low_g) ? {
    caloriesLow:  scan.rec_cal_low,
    caloriesHigh: scan.rec_cal_high,
    protein:      scan.rec_protein_high_g, // use high end for recomp
    water:        80,
    source:       `evolt_${scan.scan_date}`,
    sourceScanDate: scan.scan_date,
    message: `Scan recommends ${scan.rec_cal_low}–${scan.rec_cal_high} kcal and ${scan.rec_protein_low_g}–${scan.rec_protein_high_g}g protein. Update your goals?`,
  } : null;

  return reply({
    ok: true,
    scan_date: scan.scan_date,
    inserted:  !overwrite,
    replaced:  !!overwrite,
    scan,
    goalsSuggestion,
  });
}

async function deleteScan(request, env, path) {
  const date = path.split('/').pop();
  await env.FUELSTRONG_DB.prepare('DELETE FROM body_scans WHERE scan_date = ?').bind(date).run();
  return reply({ ok: true, deleted: date });
}

// ─────────────────────────────────────────────────────────────────────────────
//  WORKOUTS / PRs
// ─────────────────────────────────────────────────────────────────────────────
async function getWorkouts(env, url) {
  const since = url.searchParams.get('since') || daysAgo(90);
  const limit = parseInt(url.searchParams.get('limit') || '50');

  const sessions = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM workout_sessions WHERE session_date >= ? ORDER BY session_date DESC LIMIT ?'
  ).bind(since, limit).all();

  return reply({ sessions: sessions.results || [] });
}

async function addWorkout(request, env) {
  const body = await request.json();
  const date = body.date || todayStr();

  const result = await env.FUELSTRONG_DB.prepare(`
    INSERT INTO workout_sessions (
      session_date, session_type, duration_mins, total_sets,
      total_volume_lbs, muscle_groups, fasted, rpe, session_feel, source, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?)
  `).bind(
    date,
    body.sessionType || 'strength',
    body.duration    || null,
    body.totalSets   || null,
    body.totalVolume || null,
    body.muscleGroups || null,
    body.fasted ? 1 : 0,
    body.rpe     || null,
    body.feel    || null,
    body.notes   || null
  ).run();

  const sessionId = result.meta?.last_row_id;

  // Insert sets if provided
  if (body.sets && Array.isArray(body.sets)) {
    let setNum = 0;
    for (const s of body.sets) {
      setNum++;
      const weightLbs = s.weightKg ? Math.round(s.weightKg * 2.20462 * 10) / 10 : (s.weightLbs || 0);
      const e1rm = weightLbs && s.reps
        ? Math.round(weightLbs * (1 + s.reps / 30))
        : null;

      await env.FUELSTRONG_DB.prepare(`
        INSERT INTO workout_sets (session_id, session_date, exercise, set_number, reps, weight_lbs, is_warmup, estimated_1rm, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'app')
      `).bind(sessionId, date, s.exercise, setNum, s.reps || null, weightLbs || null, s.warmup ? 1 : 0, e1rm).run();

      // Auto-update personal records
      if (e1rm && !s.warmup) {
        await updatePR(env.FUELSTRONG_DB, s.exercise, e1rm, weightLbs, s.reps, date);
      }
    }
  }

  // Flag the day as a training day
  await env.FUELSTRONG_DB.prepare(`
    INSERT INTO daily_logs (date, training_day) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET training_day = 1
  `).bind(date).run();

  return reply({ ok: true, sessionId });
}

async function getPRs(env, url) {
  const exercise = url.searchParams.get('exercise');
  let query = 'SELECT * FROM personal_records';
  const params = [];

  if (exercise) {
    query += ' WHERE exercise LIKE ?';
    params.push(`%${exercise}%`);
  }
  query += ' ORDER BY best_e1rm DESC';

  const results = await env.FUELSTRONG_DB.prepare(query).bind(...params).all();
  return reply({ prs: results.results || [] });
}

async function getStrengthProgress(env, path) {
  const exercise = decodeURIComponent(path.replace('/api/strength/', ''));

  const sets = await env.FUELSTRONG_DB.prepare(`
    SELECT session_date, exercise, MAX(estimated_1rm) as peak_e1rm,
           MAX(weight_lbs) as peak_weight, reps
    FROM workout_sets
    WHERE exercise = ? AND is_warmup = 0 AND estimated_1rm IS NOT NULL
    GROUP BY session_date
    ORDER BY session_date ASC
  `).bind(exercise).all();

  const pr = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM personal_records WHERE exercise = ?'
  ).bind(exercise).first();

  return reply({
    exercise,
    pr: pr || null,
    history: sets.results || [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOG HISTORY
// ─────────────────────────────────────────────────────────────────────────────
async function getLog(env, url) {
  const since = url.searchParams.get('since') || daysAgo(30);
  const until = url.searchParams.get('until') || todayStr();
  const limit = parseInt(url.searchParams.get('limit') || '60');

  const logs = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT ?'
  ).bind(since, until, limit).all();

  return reply({ logs: logs.results || [], since, until });
}

async function getLogDay(env, path) {
  const date = path.split('/').pop();
  const db   = env.FUELSTRONG_DB;

  const [log, food, water, hem, workouts] = await Promise.all([
    db.prepare('SELECT * FROM daily_logs WHERE date = ?').bind(date).first(),
    db.prepare('SELECT * FROM food_entries WHERE date = ? ORDER BY timestamp ASC').bind(date).all(),
    db.prepare('SELECT * FROM water_entries WHERE date = ? ORDER BY timestamp ASC').bind(date).all(),
    db.prepare('SELECT * FROM hem_entries WHERE date = ? ORDER BY timestamp ASC').bind(date).all(),
    db.prepare('SELECT ws.*, wt.exercise, wt.reps, wt.weight_lbs, wt.estimated_1rm FROM workout_sessions ws LEFT JOIN workout_sets wt ON ws.id = wt.session_id WHERE ws.session_date = ? ORDER BY ws.id, wt.set_number').bind(date).all(),
  ]);

  return reply({
    date,
    log:      log || null,
    foods:    food.results || [],
    water:    water.results || [],
    hem:      hem.results || [],
    workouts: workouts.results || [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  EVENTS / NSV / MEASUREMENTS
// ─────────────────────────────────────────────────────────────────────────────
async function addEvent(request, env) {
  const body = await request.json();
  await env.FUELSTRONG_DB.prepare(`
    INSERT INTO events (date, category, subcategory, title, description, end_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    body.date || todayStr(),
    body.category    || 'life',
    body.subcategory || null,
    body.title       || '',
    body.description || null,
    body.endDate     || null
  ).run();
  return reply({ ok: true });
}

async function getEvents(env) {
  const results = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM events ORDER BY date DESC LIMIT 50'
  ).all();
  return reply({ events: results.results || [] });
}

async function addNSV(request, env) {
  const body = await request.json();
  await env.FUELSTRONG_DB.prepare(`
    INSERT INTO non_scale_victories (date, description, category)
    VALUES (?, ?, ?)
  `).bind(body.date || todayStr(), body.description || '', body.category || 'general').run();
  return reply({ ok: true });
}

async function getNSVs(env) {
  const results = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM non_scale_victories ORDER BY date DESC LIMIT 50'
  ).all();
  return reply({ nsvs: results.results || [] });
}

async function addMeasurement(request, env) {
  const body = await request.json();
  await env.FUELSTRONG_DB.prepare(`
    INSERT INTO measurements (date, waist_in, hips_in, left_arm_in, right_arm_in, left_thigh_in, right_thigh_in, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.date || todayStr(),
    body.waist || null, body.hips || null,
    body.leftArm || null, body.rightArm || null,
    body.leftThigh || null, body.rightThigh || null,
    body.notes || null
  ).run();
  return reply({ ok: true });
}

async function getMeasurements(env) {
  const results = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM measurements ORDER BY date DESC'
  ).all();
  return reply({ measurements: results.results || [] });
}

// ─────────────────────────────────────────────────────────────────────────────
//  FOOD AI — MACRO ESTIMATOR + LABEL SCANNER
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/estimate — given a food name, Claude Haiku returns macro estimate
async function estimateMacros(request, env) {
  if (!env.ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  if (!name) return reply({ error: 'name required' }, 400);

  const res = await claudeCall(env, {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system:     'You are a nutrition database. Return ONLY valid JSON with no other text, preamble, or markdown.',
    messages:   [{ role: 'user', content: `Estimate nutrition for one standard serving of: "${name}". Return ONLY: {"cal":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"serving":"description","confidence":"high|medium|low"}` }],
  });

  const raw   = res.content?.[0]?.text || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return reply({ error: 'Could not parse AI response' }, 500);
  try {
    return reply({ estimate: JSON.parse(match[0]) });
  } catch {
    return reply({ error: 'Invalid JSON from AI' }, 500);
  }
}

// POST /api/scan-label — nutrition label photo → macro extraction
// Body: { imageBase64: string, mimeType: string }
async function scanNutritionLabel(request, env) {
  if (!env.ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  const body = await request.json().catch(() => ({}));
  const { imageBase64, mimeType = 'image/jpeg' } = body;
  if (!imageBase64) return reply({ error: 'imageBase64 required' }, 400);

  try {
    const res = await claudeCall(env, {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role:    'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text',  text: 'Extract nutrition facts from this food label image. Respond ONLY with JSON: {"name":"product name or empty string","calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"serving":"serving size string","confidence":"high|medium|low"}. All numbers are per serving. If a value is not visible use 0.' },
        ],
      }],
    });

    const text    = res.content?.[0]?.text || '{}';
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const food    = JSON.parse(cleaned);
    return reply({ food });
  } catch (e) {
    return reply({ error: e.message }, 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANALYTICS — MOMENTUM SIGNAL (pure D1 computation, no Claude call)
// ─────────────────────────────────────────────────────────────────────────────

async function getMomentum(env) {
  const db = env.FUELSTRONG_DB;

  const [goals, latestScans, recent14, workouts28] = await Promise.all([
    db.prepare('SELECT * FROM goals ORDER BY effective_date DESC LIMIT 1').first(),
    db.prepare('SELECT * FROM body_scans ORDER BY scan_date DESC LIMIT 2').all(),
    db.prepare(
      'SELECT date, calories, protein_g, water_oz, training_day, injection_day FROM daily_logs WHERE date >= ? ORDER BY date DESC'
    ).bind(daysAgo(14)).all(),
    db.prepare(
      'SELECT session_date, muscle_groups FROM workout_sessions WHERE session_date >= ? ORDER BY session_date DESC'
    ).bind(daysAgo(28)).all(),
  ]);

  const logDays  = recent14.results  || [];
  const sessions = workouts28.results || [];
  const scans    = (latestScans.results || []).sort((a, b) => new Date(b.scan_date) - new Date(a.scan_date));
  const latestScan = scans[0] || null;
  const prevScan   = scans[1] || null;

  const daysWithCal  = logDays.filter(d => (d.calories  || 0) > 0);
  const daysWithProt = logDays.filter(d => (d.protein_g || 0) > 0);

  if (logDays.length < 3) {
    return reply({
      state:        'Building',
      headline:     'Getting started — keep logging to unlock pattern analysis',
      priority:     'Log your first full week of food to unlock momentum tracking',
      insufficient: true,
      metrics:      { loggedDays: logDays.length },
    });
  }

  // Compute averages
  const avgProtein = daysWithProt.length
    ? Math.round(daysWithProt.reduce((a, d) => a + (d.protein_g || 0), 0) / daysWithProt.length)
    : 0;
  const avgCal = daysWithCal.length
    ? Math.round(daysWithCal.reduce((a, d) => a + (d.calories || 0), 0) / daysWithCal.length)
    : 0;
  const lowCalDays     = daysWithCal.filter(d => d.calories < 1200).length;
  const weeklyTraining = parseFloat((sessions.length / 4).toFixed(1)); // 28d ÷ 4 weeks

  // Scan direction
  const muscleUp = (latestScan?.skeletal_muscle_mass != null && prevScan?.skeletal_muscle_mass != null)
    ? latestScan.skeletal_muscle_mass > prevScan.skeletal_muscle_mass : null;
  const fatDown  = (latestScan?.body_fat_pct != null && prevScan?.body_fat_pct != null)
    ? latestScan.body_fat_pct < prevScan.body_fat_pct : null;

  // Goals/targets
  const proteinGoal = goals?.protein_g || (latestScan?.weight_lbs ? Math.round(latestScan.weight_lbs * 0.85) : null);
  const calLow      = goals?.calories_low  || (latestScan?.tee ? Math.round(latestScan.tee - 400) : null);
  const calHigh     = goals?.calories_high || (latestScan?.tee ? Math.round(latestScan.tee - 200) : null);
  const calTarget   = calLow;

  // Composite score: protein 40% · calories 35% · training 25%
  const proteinScore = proteinGoal ? Math.min(1, avgProtein / proteinGoal) : 0.5;
  const calScore     = calTarget
    ? (avgCal >= calTarget * 0.95 ? 1 : avgCal >= calTarget * 0.80 ? 0.75 : avgCal >= 1200 ? 0.5 : 0.2)
    : (avgCal >= 1500 ? 1 : avgCal >= 1300 ? 0.75 : avgCal >= 1200 ? 0.5 : 0.2);
  const trainTarget  = 3; // minimum health floor
  const trainScore   = weeklyTraining >= trainTarget ? 1
    : weeklyTraining >= trainTarget * 0.75 ? 0.75
    : weeklyTraining >= trainTarget * 0.5  ? 0.4 : 0.15;
  const composite    = (proteinScore * 0.4) + (calScore * 0.35) + (trainScore * 0.25);

  let state, headline, priority;

  if (composite >= 0.78 && lowCalDays <= 2) {
    state    = 'Building';
    headline = proteinScore >= 0.9
      ? `Protein strong at ${avgProtein}g avg, training at ${weeklyTraining}/wk — muscle-building conditions are right`
      : `Good momentum — protein at ${avgProtein}g avg, tighten it on training days`;
    priority = weeklyTraining < trainTarget
      ? `Push for one more training session this week`
      : `Hold this pattern through your next Evolt scan`;

  } else if (composite >= 0.52 || lowCalDays <= 3) {
    state = 'Holding';
    if (lowCalDays > 2) {
      headline = `${lowCalDays} days under 1,200 cal in the last ${logDays.length} days — muscle is protected but not actively building`;
      priority = `Add a protein-dense snack on your next low-appetite day — Greek yogurt, cottage cheese, or a shake`;
    } else if (proteinScore < 0.8) {
      const pGap = proteinGoal ? Math.round(proteinGoal - avgProtein) : null;
      headline = `Calories adequate but protein averaging ${avgProtein}g${pGap ? ` — ${pGap}g below target` : ''}`;
      priority = `Front-load protein: aim for ${proteinGoal ? Math.round(proteinGoal * 0.35) : 50}g before noon on training days`;
    } else {
      headline = `Training at ${weeklyTraining}/wk — ${(trainTarget - weeklyTraining).toFixed(1)} more sessions/week would shift this to Building`;
      priority = `Schedule your next workout right now`;
    }
  } else {
    state = 'Drifting';
    if (lowCalDays > 4) {
      headline = `${lowCalDays} of ${logDays.length} days under 1,200 cal — this is actively working against the muscle you're building in the gym`;
      priority = `Today: add 300+ calories before your next workout, even if you're not hungry`;
    } else if (proteinScore < 0.6) {
      headline = `Protein averaging ${avgProtein}g — significantly below the ${proteinGoal || 'target'}g needed to protect muscle during fat loss`;
      priority = `Today: log your first protein source before 9am`;
    } else {
      headline = `Training at ${weeklyTraining}/wk — consistency is the gap right now`;
      priority = `Schedule your next 3 workouts in your calendar today`;
    }
  }

  return reply({
    state,
    headline,
    priority,
    metrics: {
      avgProtein,
      proteinGoal,
      proteinPct:    proteinGoal ? Math.round(proteinScore * 100) : null,
      avgCal,
      calTarget,
      lowCalDays,
      weeklyTraining,
      loggedDays:    logDays.length,
    },
    scanDirection: muscleUp !== null ? { muscleUp, fatDown } : null,
    computedAt:    new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANALYTICS — SCAN INTERVALS (pure D1 computation — cause-effect library)
// ─────────────────────────────────────────────────────────────────────────────

async function getScanIntervals(env) {
  const db = env.FUELSTRONG_DB;

  const scansResult = await db.prepare(
    'SELECT * FROM body_scans ORDER BY scan_date ASC'
  ).all();
  const scans = scansResult.results || [];

  if (scans.length < 2) {
    return reply({
      intervals:  [],
      totalScans: scans.length,
      message: scans.length === 0
        ? 'No scans yet — upload your Evolt PDFs in the Upload tab'
        : 'Upload your next Evolt scan to unlock interval analysis — this will show you exactly what worked and what didn't',
    });
  }

  const intervals = [];

  for (let i = 1; i < scans.length; i++) {
    const prev = scans[i - 1];
    const curr = scans[i];
    const days = Math.round((new Date(curr.scan_date) - new Date(prev.scan_date)) / 86400000);

    // Nutrition between scans from daily_logs
    const nutResult = await db.prepare(
      'SELECT calories, protein_g FROM daily_logs WHERE date > ? AND date <= ? AND (calories > 0 OR protein_g > 0)'
    ).bind(prev.scan_date, curr.scan_date).all();
    const nutDays = nutResult.results || [];

    const avgProtein = nutDays.length
      ? Math.round(nutDays.reduce((a, d) => a + (d.protein_g || 0), 0) / nutDays.length) : null;
    const avgCal = nutDays.length
      ? Math.round(nutDays.reduce((a, d) => a + (d.calories || 0), 0) / nutDays.length) : null;
    const lowCalDays = nutDays.filter(d => (d.calories || 0) < 1200).length;

    // Training between scans
    const woResult = await db.prepare(
      'SELECT ws.session_date, ws.muscle_groups FROM workout_sessions ws WHERE ws.session_date > ? AND ws.session_date <= ?'
    ).bind(prev.scan_date, curr.scan_date).all();
    const wos = woResult.results || [];

    const weeklyFreq = days > 0
      ? parseFloat((wos.length / (days / 7)).toFixed(1)) : null;

    // Top muscle groups from session metadata
    const mgCounts = {};
    wos.forEach(w => {
      if (w.muscle_groups) {
        w.muscle_groups.split(',').forEach(mg => {
          const t = mg.trim();
          if (t) mgCounts[t] = (mgCounts[t] || 0) + 1;
        });
      }
    });
    const topGroups = Object.entries(mgCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(e => `${e[0]}(${e[1]}×)`);

    // Body comp deltas — use consistent field names from D1 schema
    const muscleChange = (curr.skeletal_muscle_mass != null && prev.skeletal_muscle_mass != null)
      ? parseFloat((curr.skeletal_muscle_mass - prev.skeletal_muscle_mass).toFixed(1)) : null;
    const fatChange = (curr.body_fat_pct != null && prev.body_fat_pct != null)
      ? parseFloat((curr.body_fat_pct - prev.body_fat_pct).toFixed(1)) : null;
    const weightChange = (curr.weight_lbs != null && prev.weight_lbs != null)
      ? parseFloat((curr.weight_lbs - prev.weight_lbs).toFixed(1)) : null;

    // Outcome classification
    let outcome = 'unknown', outcomeLabel = 'Unknown';
    if (muscleChange !== null && fatChange !== null) {
      if      (muscleChange > 0.2  && fatChange < -0.3) { outcome = 'recomp';      outcomeLabel = 'Recomp ✦';       }
      else if (muscleChange > 0.1)                       { outcome = 'building';    outcomeLabel = 'Building 💪';    }
      else if (fatChange < -0.3)                         { outcome = 'cutting';     outcomeLabel = 'Fat loss 📉';    }
      else if (muscleChange >= -0.3)                     { outcome = 'maintaining'; outcomeLabel = 'Holding 🔒';    }
      else                                               { outcome = 'muscle_loss'; outcomeLabel = 'Muscle loss ⚠️'; }
    }

    intervals.push({
      interval:    i,
      startDate:   prev.scan_date,
      endDate:     curr.scan_date,
      days,
      outcome,
      outcomeLabel,
      bodyComp: {
        muscleChange, fatChange, weightChange,
        muscleStart: prev.skeletal_muscle_mass, muscleEnd: curr.skeletal_muscle_mass,
        fatStart:    prev.body_fat_pct,         fatEnd:    curr.body_fat_pct,
      },
      nutrition: {
        avgProtein, avgCal,
        loggedDays:   nutDays.length,
        lowCalDays,
        coveragePct:  days > 0 ? Math.round(nutDays.length / days * 100) : null,
      },
      training: {
        totalWorkouts: wos.length,
        weeklyFreq,
        topMuscleGroups: topGroups,
      },
    });
  }

  return reply({
    intervals,
    totalScans:  scans.length,
    computedAt:  new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  BULK WORKOUT IMPORT — accepts parsed Fitbod sessions from progress.html
// ─────────────────────────────────────────────────────────────────────────────
//
//  POST /api/workouts/bulk
//  Body: {
//    sessions: [ { date, exercises: [{name, muscleGroup, sets:[{reps,weight,unit}]}],
//                  muscleGroupsWorked:[], totalVolume, source } ],
//    overwrite: false   // if true, delete existing sessions on each date first
//  }
//
async function bulkImportWorkouts(request, env) {
  const body     = await request.json();
  const sessions = body.sessions || [];
  const overwrite = body.overwrite || false;

  if (!Array.isArray(sessions) || !sessions.length) {
    return reply({ error: 'sessions array required' }, 400);
  }

  const db = env.FUELSTRONG_DB;
  let inserted = 0, skipped = 0, errors = 0;

  for (const sess of sessions) {
    const date = sess.date;
    if (!date) { errors++; continue; }

    try {
      // Check for existing session on this date
      const existing = await db.prepare(
        'SELECT id FROM workout_sessions WHERE session_date = ? AND source = ?'
      ).bind(date, 'fitbod').first();

      if (existing && !overwrite) { skipped++; continue; }

      // Delete existing if overwriting
      if (existing && overwrite) {
        await db.prepare('DELETE FROM workout_sets WHERE session_id = ?').bind(existing.id).run();
        await db.prepare('DELETE FROM workout_sessions WHERE id = ?').bind(existing.id).run();
      }

      // Compute session-level stats
      const exercises  = sess.exercises || [];
      const totalSets  = exercises.reduce((a, e) => a + (e.sets || []).length, 0);
      const totalVolume = Math.round(
        exercises.reduce((a, e) =>
          a + (e.sets || []).reduce((b, s) => b + ((s.weight || 0) * (s.reps || 0)), 0), 0)
      );
      const muscleGroups = (sess.muscleGroupsWorked || []).join(', ');

      // Insert session
      const result = await db.prepare(`
        INSERT INTO workout_sessions
          (session_date, session_type, total_sets, total_volume_lbs, muscle_groups, source, notes)
        VALUES (?, 'strength', ?, ?, ?, 'fitbod', ?)
      `).bind(date, totalSets, totalVolume || null, muscleGroups || null, sess.source || null).run();

      const sessionId = result.meta?.last_row_id;
      let setNumber   = 0;

      // Insert sets and update PRs
      for (const ex of exercises) {
        for (const s of (ex.sets || [])) {
          setNumber++;
          // Convert kg → lbs if needed
          let weightLbs = s.weight || 0;
          if (s.unit === 'kg') weightLbs = Math.round(weightLbs * 2.20462 * 10) / 10;

          // e1RM rounded to whole lb
          const e1rm = weightLbs && s.reps
            ? Math.round(weightLbs * (1 + s.reps / 30))
            : null;

          await db.prepare(`
            INSERT INTO workout_sets
              (session_id, session_date, exercise, set_number, reps, weight_lbs, estimated_1rm, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'fitbod')
          `).bind(sessionId, date, ex.name, setNumber, s.reps || null, weightLbs || null, e1rm).run();

          // Update PRs (skip warmups — Fitbod CSV doesn't flag warmups)
          if (e1rm) {
            await updatePR(db, ex.name, e1rm, weightLbs, s.reps, date);
          }
        }
      }

      // Flag as training day
      await db.prepare(`
        INSERT INTO daily_logs (date, training_day) VALUES (?, 1)
        ON CONFLICT(date) DO UPDATE SET training_day = 1
      `).bind(date).run();

      inserted++;
    } catch (e) {
      console.error(`bulk import error for ${date}:`, e.message);
      errors++;
    }
  }

  return reply({
    ok:       true,
    inserted,
    skipped,
    errors,
    total:    sessions.length,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Recalculate daily_logs totals from actual entry rows
async function recalcDailyTotals(db, date) {
  const food  = await db.prepare('SELECT * FROM food_entries WHERE date = ?').bind(date).all();
  const water = await db.prepare('SELECT SUM(oz) as total FROM water_entries WHERE date = ?').bind(date).first();

  const foods = food.results || [];
  const cal   = Math.round(foods.reduce((a, f) => a + (f.calories || 0), 0));
  const prot  = Math.round(foods.reduce((a, f) => a + (f.protein_g || 0), 0));
  const carb  = Math.round(foods.reduce((a, f) => a + (f.carbs_g || 0), 0));
  const fat   = Math.round(foods.reduce((a, f) => a + (f.fat_g || 0), 0));
  const fiber = Math.round(foods.reduce((a, f) => a + (f.fiber_g || 0), 0));
  const waterOz = Math.round(water?.total || 0);

  await db.prepare(`
    INSERT INTO daily_logs (date, calories, protein_g, carbs_g, fat_g, fiber_g, water_oz, meals_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      calories    = excluded.calories,
      protein_g   = excluded.protein_g,
      carbs_g     = excluded.carbs_g,
      fat_g       = excluded.fat_g,
      fiber_g     = excluded.fiber_g,
      water_oz    = excluded.water_oz,
      meals_count = excluded.meals_count
  `).bind(date, cal, prot, carb, fat, fiber, waterOz, foods.length).run();
}

// Auto-update personal records when a new set is logged
async function updatePR(db, exercise, e1rm, weightLbs, reps, date) {
  const existing = await db.prepare(
    'SELECT * FROM personal_records WHERE exercise = ?'
  ).bind(exercise).first();

  if (!existing) {
    await db.prepare(`
      INSERT INTO personal_records (exercise, best_e1rm, best_weight_lbs, best_reps, achieved_date)
      VALUES (?, ?, ?, ?, ?)
    `).bind(exercise, e1rm, weightLbs, reps, date).run();
  } else if (e1rm > existing.best_e1rm) {
    await db.prepare(`
      UPDATE personal_records SET
        previous_e1rm   = best_e1rm,
        previous_date   = achieved_date,
        best_e1rm       = ?,
        best_weight_lbs = ?,
        best_reps       = ?,
        achieved_date   = ?
      WHERE exercise = ?
    `).bind(e1rm, weightLbs, reps, date, exercise).run();
  }
}

// Shared Anthropic API call helper
async function claudeCall(env, body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'X-API-Key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const msgs = {
      401: 'Invalid Anthropic API key — check ANTHROPIC_API_KEY secret',
      402: 'Anthropic account out of credits',
      429: 'Rate limited — wait a moment and retry',
      529: 'Quota exceeded — check console.anthropic.com/billing',
    };
    throw new Error(msgs[res.status] || `Anthropic API error ${res.status}`);
  }
  return res.json();
}

function reply(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function cors() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-FS-Key',
    },
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function clamp(val, min, max) {
  if (val === null || val === undefined) return null;
  return Math.min(max, Math.max(min, Number(val)));
}

function avg(arr, key) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, d) => a + (d[key] || 0), 0) / arr.length);
}
