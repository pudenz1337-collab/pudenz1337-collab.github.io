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
      if (path === '/api/notes'        && method === 'POST') return await addCoachNote(request, env, url);
      if (path === '/api/notes'        && method === 'GET')  return await getCoachNotes(env, url);

      // ── FOOD ──────────────────────────────────────────────────────────────
      if (path === '/api/food'         && method === 'POST') return await addFood(request, env);
      if (path.startsWith('/api/food/') && method === 'DELETE') return await deleteFood(request, env, path);
      if (path.startsWith('/api/food/') && method === 'PUT')    return await updateFoodEntry(request, env, path);

      // ── WATER ─────────────────────────────────────────────────────────────
      if (path === '/api/water'        && method === 'POST') return await addWater(request, env);

      // ── HEM ───────────────────────────────────────────────────────────────
      if (path === '/api/hem'          && method === 'POST') return await addHem(request, env);

      // ── FOOD LIBRARY ──────────────────────────────────────────────────────
      if (path === '/api/foods/smart'  && method === 'GET')  return await getSmartFoods(request, env, url);
      if (path === '/api/foods/search' && method === 'GET')  return await searchFoods(request, env, url);
      if (path === '/api/foods'        && method === 'POST') return await addFoodToLibrary(request, env);
      if (path === '/api/foods/pin'    && method === 'POST') return await pinFood(request, env);
      if (path === '/api/foods/all'    && method === 'GET')  return await getAllFoodsLibrary(env, url);
      if (path === '/api/foods'        && method === 'PUT')  return await updateFoodInLibrary(request, env);
      if (path === '/api/foods'        && method === 'DELETE') return await deleteFoodFromLibrary(request, env);

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
      if (path === '/api/scan/import'  && method === 'POST') return await importParsedScan(request, env);
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
      if (path === '/api/insights'       && method === 'GET')  return await getInsights(env);
      if (path === '/api/insights'       && method === 'POST') return await generateInsights(env);

      // ── BULK IMPORT ────────────────────────────────────────────────────────
      if (path === '/api/workouts/bulk'  && method === 'POST') return await bulkImportWorkouts(request, env);
      if (path === '/api/workouts/full'  && method === 'GET')  return await getWorkoutsFull(env, url);

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

  // Increment use_count in food_library
  if (body.foodLibraryId) {
    await env.FUELSTRONG_DB.prepare(
      'UPDATE food_library SET use_count = use_count + 1, last_used = ? WHERE id = ?'
    ).bind(date, body.foodLibraryId).run().catch(() => {});
  } else if (body.name) {
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

async function updateFoodEntry(request, env, path) {
  const id   = parseInt(path.split('/').pop());
  if (!id) return reply({ error: 'invalid id' }, 400);
  const body = await request.json();

  const entry = await env.FUELSTRONG_DB.prepare(
    'SELECT date FROM food_entries WHERE id = ?'
  ).bind(id).first();
  if (!entry) return reply({ error: 'not found' }, 404);

  await env.FUELSTRONG_DB.prepare(`
    UPDATE food_entries SET
      calories   = ?,
      protein_g  = ?,
      carbs_g    = ?,
      fat_g      = ?,
      fiber_g    = ?,
      serving    = COALESCE(?, serving)
    WHERE id = ?
  `).bind(
    body.calories ?? null,
    body.protein  ?? null,
    body.carbs    ?? null,
    body.fat      ?? null,
    body.fiber    ?? null,
    body.serving  || null,
    id
  ).run();

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

  // 1. Pinned foods — full library rows (includes integer id)
  const pinned = await db.prepare(
    'SELECT * FROM food_library WHERE is_pinned = 1 ORDER BY use_count DESC, name ASC'
  ).all();

  // 2. Logged today — join food_library to get integer id and latest macros
  const pinnedIds = new Set((pinned.results || []).map(f => f.id));
  const todayFoods = await db.prepare(`
    SELECT fl.id, fl.name, fl.display_name, fl.calories, fl.protein_g,
           fl.carbs_g, fl.fat_g, fl.fiber_g, fl.serving, fl.use_count, fl.is_pinned
    FROM food_entries fe
    JOIN food_library fl ON fl.name = fe.name
    WHERE fe.date = ?
    GROUP BY fl.id
    ORDER BY MAX(fe.timestamp) DESC
  `).bind(date).all();
  const todayList = (todayFoods.results || []).filter(f => !pinnedIds.has(f.id));

  // 3. Recent 7 days — join food_library to get integer id
  const since = daysAgo(7);
  const recentFoods = await db.prepare(`
    SELECT fl.id, fl.name, fl.display_name, fl.calories, fl.protein_g,
           fl.carbs_g, fl.fat_g, fl.fiber_g, fl.serving, fl.use_count, fl.is_pinned
    FROM food_entries fe
    JOIN food_library fl ON fl.name = fe.name
    WHERE fe.date >= ? AND fe.date < ?
    GROUP BY fl.id
    ORDER BY MAX(fe.timestamp) DESC
    LIMIT 30
  `).bind(since, date).all();
  const usedIds = new Set([...pinnedIds, ...todayList.map(f => f.id)]);
  const recentList = (recentFoods.results || []).filter(f => !usedIds.has(f.id));

  // 4. Recently added to library but never logged — so new foods always appear
  const allUsedIds = new Set([...usedIds, ...recentList.map(f => f.id)]);
  const newFoods = await db.prepare(`
    SELECT * FROM food_library
    WHERE use_count = 0 AND is_pinned = 0
    ORDER BY id DESC
    LIMIT 20
  `).all();
  const newList = (newFoods.results || []).filter(f => !allUsedIds.has(f.id));

  return reply({
    pinned:  pinned.results || [],
    today:   todayList,
    recent:  [...recentList, ...newList],
  });
}

async function searchFoods(request, env, url) {
  const q = url.searchParams.get('q') || '';
  if (!q) return reply({ results: [] });

  const results = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM food_library WHERE name LIKE ? ORDER BY use_count DESC, name ASC LIMIT 20'
  ).bind(`%${q}%`).all();

  // Rename to 'products' for OFF-compatible shape expected by client
  return reply({ results: results.results || [], products: results.results || [] });
}

async function getAllFoodsLibrary(env, url) {
  const q = url.searchParams.get('q') || '';
  const query = q
    ? 'SELECT * FROM food_library WHERE name LIKE ? ORDER BY use_count DESC, name ASC LIMIT 100'
    : 'SELECT * FROM food_library ORDER BY use_count DESC, name ASC LIMIT 200';
  const results = q
    ? await env.FUELSTRONG_DB.prepare(query).bind(`%${q}%`).all()
    : await env.FUELSTRONG_DB.prepare(query).all();
  return reply({ foods: results.results || [] });
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
  const body   = await request.json();
  const pinned = body.pinned !== false ? 1 : 0;

  if (body.id && Number.isInteger(body.id)) {
    // Preferred: use integer id
    await env.FUELSTRONG_DB.prepare(
      'UPDATE food_library SET is_pinned = ? WHERE id = ?'
    ).bind(pinned, body.id).run();
    return reply({ ok: true, id: body.id, pinned: !!pinned });
  }
  if (body.name) {
    // Fallback: name-based (backward compat)
    await env.FUELSTRONG_DB.prepare(
      'UPDATE food_library SET is_pinned = ? WHERE name = ?'
    ).bind(pinned, body.name).run();
    return reply({ ok: true, name: body.name, pinned: !!pinned });
  }
  return reply({ error: 'id or name required' }, 400);
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

  // Build context dataset from D1
  const [goals, allScans, tirz, recent30, recentWorkouts, muscleGroups, hemRows, noteRows] = await Promise.all([
    db.prepare('SELECT * FROM goals ORDER BY effective_date DESC LIMIT 1').first(),
    db.prepare('SELECT scan_date, weight_lbs, body_fat_pct, skeletal_muscle_mass, lean_body_mass, bmr, tee, rec_protein_high_g, rec_cal_low, rec_cal_high FROM body_scans ORDER BY scan_date ASC').all(),
    db.prepare('SELECT * FROM tirzepatide_log ORDER BY date DESC LIMIT 1').first(),
    db.prepare(`
      SELECT dl.date, dl.calories, dl.protein_g, dl.water_oz,
             dl.training_day, dl.injection_day, dl.notes
      FROM daily_logs dl
      WHERE dl.date >= ? AND dl.date <= ?
      ORDER BY dl.date DESC
    `).bind(daysAgo(30), date).all(),
    db.prepare(`
      SELECT session_date, session_type, total_volume_lbs, total_sets, muscle_groups
      FROM workout_sessions
      WHERE session_date >= ?
      ORDER BY session_date DESC LIMIT 20
    `).bind(daysAgo(56)).all(),
    db.prepare(`
      SELECT muscle_groups, COUNT(*) as sessions
      FROM workout_sessions
      WHERE session_date >= ? AND muscle_groups IS NOT NULL
      GROUP BY muscle_groups ORDER BY sessions DESC LIMIT 8
    `).bind(daysAgo(28)).all(),
    db.prepare(`
      SELECT date, hunger, energy, mood, note, timestamp
      FROM hem_entries
      WHERE date >= ?
      ORDER BY timestamp ASC
    `).bind(daysAgo(14)).all(),
    db.prepare(`
      SELECT date, notes
      FROM daily_logs
      WHERE date >= ? AND notes IS NOT NULL
      ORDER BY date ASC
    `).bind(daysAgo(3)).all(),
  ]);

  const scans    = allScans.results   || [];
  const scan     = scans.length ? scans[scans.length - 1] : null;       // latest
  const prevScan = scans.length > 1  ? scans[scans.length - 2] : null;  // prior
  const logDays  = recent30.results  || [];
  const sessions = recentWorkouts.results || [];
  const mgData   = muscleGroups.results   || [];
  const hemData  = hemRows.results  || [];
  const noteData = noteRows.results || [];

  // ── Build coach notes thread (last 3 days, highest priority context) ────────
  const coachNotesBlock = noteData.length ? noteData.map(r => {
    let notes = [];
    try { notes = JSON.parse(r.notes); } catch { notes = []; }
    if (!notes.length) return null;
    const noteLines = notes.map(n => {
      const t = n.ts ? new Date(n.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
      return `  ${t}: ${n.text}`;
    }).join('\n');
    return `${r.date}:\n${noteLines}`;
  }).filter(Boolean).join('\n') : null;

  // Also include today's notes from the request body (most recent, may not be in D1 yet)
  const clientNotes = body.coachNotes || [];
  const clientNotesBlock = clientNotes.length
    ? clientNotes.map(n => {
        const t = n.ts ? new Date(n.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
        return `  ${t}: ${n.text}`;
      }).join('\n')
    : null;

  const allNotesBlock = [
    clientNotesBlock ? `${date} (today):\n${clientNotesBlock}` : null,
    coachNotesBlock,
  ].filter(Boolean).join('\n');

  // ── HEM summary (last 14 days) ────────────────────────────────────────────
  const hemByDay = {};
  hemData.forEach(h => {
    if (!hemByDay[h.date]) hemByDay[h.date] = [];
    hemByDay[h.date].push(h);
  });
  const hemSummary = Object.entries(hemByDay).slice(-7).map(([d, entries]) => {
    const hLabels = { 1: 'H:not hungry', 2: 'H:moderate', 3: 'H:very hungry' };
    const eLabels = { 1: 'E:low', 2: 'E:moderate', 3: 'E:high' };
    const mLabels = { 1: 'M:low', 2: 'M:ok', 3: 'M:good' };
    const parts = entries.map(h => [hLabels[h.hunger], eLabels[h.energy], mLabels[h.mood]].filter(Boolean).join(' '));
    const noteStr = entries.filter(h => h.note).map(h => h.note).join('; ');
    return `${d}: ${parts.join(' | ')}${noteStr ? ' — ' + noteStr : ''}`;
  }).join('\n');

  // ── Injection cycle nutrition pattern ────────────────────────────────────
  // Group logged days by days-since-injection using tirz day-of-week
  const tirzDayOfWk = tirz?.injection_day_of_wk ?? (body.tirzepatide?.day !== undefined ? parseInt(body.tirzepatide.day) : null);
  const injCycleStats = {};
  if (tirzDayOfWk !== null) {
    logDays.filter(d => (d.calories || 0) > 0).forEach(d => {
      const dow = new Date(d.date + 'T12:00:00').getDay();
      const daysSinceInj = ((dow - tirzDayOfWk) + 7) % 7;
      if (!injCycleStats[daysSinceInj]) injCycleStats[daysSinceInj] = { cals: [], protein: [] };
      injCycleStats[daysSinceInj].cals.push(d.calories || 0);
      injCycleStats[daysSinceInj].protein.push(d.protein_g || 0);
    });
  }
  const injCycleBlock = Object.keys(injCycleStats).length
    ? 'Avg by days-post-injection:\n' + Object.entries(injCycleStats)
        .sort((a, b) => a[0] - b[0])
        .map(([day, s]) => {
          const avgCal  = Math.round(s.cals.reduce((a,b) => a+b,0) / s.cals.length);
          const avgProt = Math.round(s.protein.reduce((a,b) => a+b,0) / s.protein.length);
          return `  Day ${day}: avg ${avgCal} kcal · ${avgProt}g protein (n=${s.cals.length})`;
        }).join('\n')
    : null;

  // ── Scan trend ────────────────────────────────────────────────────────────
  const scanTrend = (scan && prevScan) ? {
    muscleDelta: scan.skeletal_muscle_mass && prevScan.skeletal_muscle_mass
      ? +(scan.skeletal_muscle_mass - prevScan.skeletal_muscle_mass).toFixed(1) : null,
    fatDelta: scan.body_fat_pct && prevScan.body_fat_pct
      ? +(scan.body_fat_pct - prevScan.body_fat_pct).toFixed(1) : null,
    weightDelta: scan.weight_lbs && prevScan.weight_lbs
      ? +(scan.weight_lbs - prevScan.weight_lbs).toFixed(1) : null,
    daysBetween: Math.round((new Date(scan.scan_date) - new Date(prevScan.scan_date)) / 86400000),
  } : null;

  // ── Nutrition averages ─────────────────────────────────────────────────────
  const loggedDays   = logDays.filter(d => (d.calories || 0) > 0);
  const last7logged  = loggedDays.slice(0, 7);
  const last14logged = loggedDays.slice(0, 14);
  const daysWithFood = loggedDays; // alias
  const avgProt7     = avg(last7logged.filter(d => d.protein_g > 0), 'protein_g');
  const avgCal7      = avg(last7logged.filter(d => d.calories > 0), 'calories');
  const avgProt14    = avg(last14logged.filter(d => d.protein_g > 0), 'protein_g');
  const trainDays7   = logDays.slice(0, 7).filter(d => d.training_day).length;
  const trainDays28  = sessions.filter(s => {
    const d = new Date(s.session_date);
    return (new Date(date) - d) / 86400000 <= 28;
  }).length;

  // ── Workout patterns ──────────────────────────────────────────────────────
  const last4wSessions = sessions.filter(s => (new Date(date) - new Date(s.session_date)) / 86400000 <= 28);
  const totalVolume28  = last4wSessions.reduce((a, s) => a + (s.total_volume_lbs || 0), 0);
  const mgSummary = mgData.map(m => `${m.muscle_groups || 'Other'} (${m.sessions}x)`).join(', ');

  // Derive targets from scan or goals
  const bodyWeight  = scan?.weight_lbs || null;
  const tee         = scan?.tee || null;
  const protTarget  = goals?.protein_g || (bodyWeight ? Math.round(bodyWeight * 0.85) : null);
  const calLow      = goals?.calories_low  || (tee ? Math.round(tee - 400) : null);
  const calHigh     = goals?.calories_high || (tee ? Math.round(tee - 200) : null);
  const waterTarget = goals?.water_oz || 80;

  // Tirzepatide context — prefer client-sent daysPostInjection (based on settings day-of-week)
  // Fall back to D1 log date only if client didn't send it
  const clientTirz      = body.tirzepatide || {};
  const daysSinceInj    = clientTirz.daysPostInjection !== null && clientTirz.daysPostInjection !== undefined
    ? clientTirz.daysPostInjection
    : (tirz?.date ? Math.floor((new Date(date) - new Date(tirz.date)) / 86400000) : null);
  const tirzDose        = clientTirz.dose || tirz?.dose_mg || '?';
  // Today's injection flag comes from client (most accurate — user just set it)
  const todayIsInjDay   = body.flags?.injectionDay || false;

  // Low-calorie threshold: 200 below the lower goal bound, never less than 1100
  const lowCalThreshold = calLow ? Math.max(calLow - 200, 1100) : 1200;
  const lowCalDays      = daysWithFood.filter(d => d.calories < lowCalThreshold).length;

  // ── Scan history summary ──────────────────────────────────────────────────
  const scanHistorySummary = scans.length
    ? scans.slice(-4).map(s =>
        `${s.scan_date}: ${s.weight_lbs}lbs | ${s.body_fat_pct}% BF | ${s.skeletal_muscle_mass}lbs muscle${s.tee ? ' | TEE ' + s.tee : ''}`
      ).join('\n')
    : 'No scans yet';

  const scanDeltaStr = scanTrend
    ? `Change since ${prevScan.scan_date}→${scan.scan_date} (${scanTrend.daysBetween}d): ` +
      (scanTrend.muscleDelta !== null ? `muscle ${scanTrend.muscleDelta > 0 ? '+' : ''}${scanTrend.muscleDelta}lbs ` : '') +
      (scanTrend.fatDelta !== null    ? `BF% ${scanTrend.fatDelta > 0 ? '+' : ''}${scanTrend.fatDelta}% `          : '') +
      (scanTrend.weightDelta !== null ? `weight ${scanTrend.weightDelta > 0 ? '+' : ''}${scanTrend.weightDelta}lbs` : '')
    : scans.length === 1 ? `Only 1 scan available (${scan.scan_date}) — trends will show after next Evolt` : 'No scan data';

  // Build trimmed system prompt
  const systemPrompt = `You are the FuelStrong Coach. You analyze real data across ALL time periods and give specific, actionable advice.

ABOUT HANNA:
- 50yo woman, body recomposition goal: build visible muscle + lose fat simultaneously
- Training at Anytime Fitness with Fitbod (Get Stronger/hypertrophy), 4-5x/week, 40-45 min sessions since Nov 2024
- On tirzepatide — hunger cues suppressed, undereating is the #1 risk
- Calorie goal: ${calLow || 1500}–${calHigh || 1800} kcal. Below ${lowCalThreshold} kcal = flag as too low.
- Goal: visible muscle definition especially arms/shoulders. Scale weight is irrelevant — muscle up, fat down is success.

COACHING RULES:
- Be specific with numbers: "You need 47g more protein today" not "eat more protein"
- Reference her actual scan deltas, training patterns, and nutrition trends — not generic advice
- Protein on training days is critical — name specific high-protein foods she can actually eat
- Never explain basic fitness concepts she already knows
- Keep response under 250 words for check-ins, 150 for quick asks
- Only flag injection day impact if daysSinceInjection is 0 or 1
- Reason in WEEKLY terms, not just daily: if weekly avg protein and calories are on target, a single low day is not a crisis — acknowledge it but don't catastrophize. Only escalate if the weekly average itself is below target.
- NOTES FOR COACH are the highest priority context. If a note explains or contradicts the structured data, treat the note as authoritative. Always acknowledge notes directly — if Hanna took the time to write it, it matters and should shape your response.
- Use HEM (hunger/energy/mood) patterns to explain nutrition behavior — low energy + low calories + injection day = predictable suppression pattern, not a willpower issue
- Think forward 24-48 hours: if injection day is tomorrow, advise pre-loading today${allNotesBlock ? `

⭐ NOTES FOR COACH (highest priority — read before anything else):
${allNotesBlock}` : ''}

BODY COMPOSITION HISTORY (Evolt 360 scans):
${scanHistorySummary}
${scanDeltaStr}
${scan ? `Current targets from scan: protein ${scan.rec_protein_high_g || protTarget}g | ${scan.rec_cal_low || calLow}–${scan.rec_cal_high || calHigh} kcal` : ''}

TRAINING PATTERNS (last 28 days — ${trainDays28} sessions, ${Math.round(totalVolume28).toLocaleString()}lbs total volume):
${last4wSessions.slice(0,8).map(s => `${s.session_date}: ${s.total_volume_lbs || 0}lbs volume, ${s.total_sets || '?'} sets${s.muscle_groups ? ' [' + s.muscle_groups + ']' : ''}`).join('\n') || 'No sessions'}
Muscle group distribution (28d): ${mgSummary || 'no data'}

NUTRITION TARGETS:
Protein: ${protTarget || '?'}g/day | Calories: ${calLow || '?'}–${calHigh || '?'} kcal/day | Water: ${waterTarget}oz/day
Tirzepatide: ${tirzDose}mg — ${daysSinceInj !== null ? `${daysSinceInj} days since last injection` : 'schedule unknown'}${todayIsInjDay ? ' — TODAY is injection day' : ''}

NUTRITION HISTORY (last 14 logged days — ${loggedDays.length} days with food):
${logDays.slice(0,14).map(d => {
  const isLow = (d.calories || 0) > 0 && (d.calories || 0) < lowCalThreshold;
  return `${d.date}: ${d.calories || 0}kcal | ${d.protein_g || 0}g protein | ${d.water_oz || 0}oz water${d.training_day ? ' 💪' : ''}${d.injection_day ? ' 💉' : ''}${isLow ? ' ⚠️LOW' : ''}`;
}).join('\n')}

PATTERNS:
${weeklyAvgDays >= 3 ? `CLIENT 7-DAY ROLLING AVG (${weeklyAvgDays} logged days): ${weeklyAvgProtein}g protein | ${weeklyAvgCalories} kcal` : ''}
D1 Avg protein (7d): ${avgProt7 || '?'}g | (14d): ${avgProt14 || '?'}g
D1 Avg calories (7d): ${avgCal7 || '?'} kcal | Low-cal days (30d): ${lowCalDays}
Training: ${trainDays7}/wk (last 7d) | ${(trainDays28/4).toFixed(1)}/wk avg (last 28d)
${hemSummary ? '\nHEM LOG (hunger/energy/mood — last 7 days):\n' + hemSummary : ''}
${injCycleBlock ? '\nINJECTION CYCLE NUTRITION PATTERN:\n' + injCycleBlock : ''}`;

  // Weekly averages from client (pre-computed from /api/log)
  const clientWeeklyAvg = body.weeklyAvg || {};
  const weeklyAvgProtein  = clientWeeklyAvg.protein  || null;
  const weeklyAvgCalories = clientWeeklyAvg.calories || null;
  const weeklyAvgDays     = clientWeeklyAvg.days     || 0;

  // Build user context — accept both v1 field names (foods/water/workout) and v2 (foodLog/waterLog/workouts)
  const todayFoods   = body.foods   || body.foodLog  || [];
  const waterRaw     = body.water   ?? body.waterLog ?? 0;
  const todayWater   = Array.isArray(waterRaw)
    ? Math.round(waterRaw.reduce((a, w) => a + (w.oz || 0), 0))
    : (waterRaw || 0);
  const workoutsArr  = body.workouts || [];
  const todayWorkout = body.workout  || (workoutsArr.length ? workoutsArr[workoutsArr.length - 1] : null);

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
  } else if (mode === 'weekly') {
    const t = getTotals ? getTotals() : {};
    userContext = `Give me a weekly summary and coaching. What went well this week? What's the one thing I should focus on next week?\n\n${userMsg || ''}`;
  } else if (mode === 'dashboard') {
    // Payload from progress_v2.html — carries pre-built summaries
    const ws  = body.workoutSummary  || {};
    const tt  = body.trainingTrends  || {};
    const bd  = body.latestBodyData  || null;
    const ctx = body.context         || '';

    const bodySummary = bd
      ? `Body (${bd.date}): ${bd.weight}lbs | ${bd.bodyFatPct}% BF | ${bd.skeletalMuscleMass}lbs muscle${bd.muscleChange !== null ? ` | muscle Δ ${bd.muscleChange > 0 ? '+' : ''}${bd.muscleChange}lbs vs prev scan` : ''}${bd.fatChange !== null ? ` | fat Δ ${bd.fatChange > 0 ? '+' : ''}${bd.fatChange}%` : ''}`
      : 'No Evolt scan data yet';

    userContext = [
      ctx ? `CONTEXT: ${ctx}` : '',
      `BODY COMPOSITION:
${bodySummary}`,
      `TRAINING SUMMARY:
Total sessions: ${ws.totalWorkouts || 0} | Last 4 weeks: ${ws.last4weeks || 0} | Avg/week: ${ws.avgWorkoutsPerWeek || 0} | Compound %: ${ws.compoundPct || 0}%`,
      ws.topPRs ? `Top PRs: ${ws.topPRs}` : '',
      tt.weeklyVolume  ? `Weekly volume (8wk): ${tt.weeklyVolume}` : '',
      tt.muscleGroupDist ? `Muscle group dist (30d): ${tt.muscleGroupDist}` : '',
      body.question
        ? `\nQuestion: ${body.question}`
        : '\nAnalyze my training and body composition data. What patterns do you see? What should I focus on before my next Evolt scan?',
    ].filter(Boolean).join('\n');
  }

  // Safety fallback — if mode is unrecognized, userContext may be empty
  if (!userContext.trim()) {
    userContext = 'Give me a quick check-in based on my recent data.';
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
        : "Upload your next Evolt scan to unlock interval analysis — this will show you exactly what worked and what didn't",
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workouts/full  — all sessions with exercises + sets (Fitbod shape)
// ─────────────────────────────────────────────────────────────────────────────
async function getWorkoutsFull(env, url) {
  const since = url.searchParams.get('since') || '2020-01-01';
  const limit = parseInt(url.searchParams.get('limit') || '500');

  const sessions = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM workout_sessions WHERE session_date >= ? ORDER BY session_date ASC LIMIT ?'
  ).bind(since, limit).all();

  if (!sessions.results || !sessions.results.length) {
    return reply({ sessions: [] });
  }

  // Fetch all sets for these sessions in one query
  const ids = sessions.results.map(s => s.id);
  // D1 doesn't support IN (?) with arrays natively — batch by chunks
  let allSets = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk  = ids.slice(i, i + 50);
    const marks  = chunk.map(() => '?').join(',');
    const result = await env.FUELSTRONG_DB.prepare(
      `SELECT * FROM workout_sets WHERE session_id IN (${marks}) ORDER BY session_id, set_number ASC`
    ).bind(...chunk).all();
    if (result.results) allSets = allSets.concat(result.results);
  }

  // Group sets by session_id → exercise_name
  const setsBySession = {};
  for (const set of allSets) {
    if (!setsBySession[set.session_id]) setsBySession[set.session_id] = {};
    const exMap = setsBySession[set.session_id];
    if (!exMap[set.exercise_name]) {
      exMap[set.exercise_name] = {
        name:        set.exercise_name,
        muscleGroup: set.muscle_group || 'Other',
        sets:        [],
      };
    }
    exMap[set.exercise_name].sets.push({
      weight: set.weight_lbs || 0,
      reps:   set.reps       || 0,
      e1rm:   set.e1rm_lbs  || null,
    });
  }

  // Build Fitbod-shaped response
  const result = sessions.results.map(s => ({
    id:          s.id,
    date:        s.session_date,
    durationMins: s.duration_mins,
    totalVolume: s.total_volume_lbs,
    rpe:         s.rpe,
    notes:       s.notes,
    source:      s.source,
    exercises:   Object.values(setsBySession[s.id] || {}),
  }));

  return reply({ sessions: result });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/insights  — generate (or return recent) AI insights from D1 data
// POST /api/insights — force regenerate
// ─────────────────────────────────────────────────────────────────────────────
async function getInsights(env) {
  try {
    return await generateInsights(env);
  } catch (e) {
    console.error('[insights]', e);
    return reply({ error: 'insights_error', detail: e.message, insights: [] }, 500);
  }
}

async function generateInsights(env) {
  // Pull 30 days of nutrition logs
  const since30 = daysAgo(30);
  const logs = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM daily_logs WHERE date >= ? ORDER BY date ASC'
  ).bind(since30).all();

  const foodRows = await env.FUELSTRONG_DB.prepare(
    `SELECT date as log_date, SUM(calories) as cal, SUM(protein_g) as protein, COUNT(*) as entries
     FROM food_entries WHERE date >= ? GROUP BY date ORDER BY date ASC`
  ).bind(since30).all();

  // Body scans — all
  const scans = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM body_scans ORDER BY scan_date ASC'
  ).all();

  // Workouts last 30 days
  const workouts = await env.FUELSTRONG_DB.prepare(
    'SELECT session_date, total_volume_lbs, rpe, duration_mins FROM workout_sessions WHERE session_date >= ? ORDER BY session_date ASC'
  ).bind(since30).all();

  // Goals
  const goalsRow = await env.FUELSTRONG_DB.prepare(
    'SELECT * FROM goals ORDER BY effective_date DESC LIMIT 1'
  ).first();

  const nutritionSummary = (foodRows.results || []).map(r =>
    `${r.log_date}: ${Math.round(r.cal||0)} kcal, ${Math.round(r.protein||0)}g protein, ${r.entries} entries`
  ).join('\n');

  const scanSummary = (scans.results || []).map(s =>
    `${s.scan_date}: ${s.weight_lbs}lbs, ${s.body_fat_pct}% BF, ${s.skeletal_muscle_mass}lbs muscle, BMR ${s.bmr}`
  ).join('\n');

  const workoutSummary = (workouts.results || []).map(w =>
    `${w.session_date}: ${Math.round(w.total_volume_lbs||0)}lbs volume, RPE ${w.rpe||'—'}, ${w.duration_mins||'—'}min`
  ).join('\n');

  const nutritionDays = (foodRows.results || []).length;
  const scanCount     = (scans.results || []).length;
  const workoutCount  = (workouts.results || []).length;

  if (nutritionDays < 3 && scanCount < 1) {
    return reply({
      insufficient_data: true,
      insights: [],
      message: 'Need at least 3 days of logged data to generate insights.',
      dataPoints: { nutrition: nutritionDays, evolt: scanCount, workouts: workoutCount },
    });
  }

  const prompt = `You are a performance coach analyzing a 50-year-old woman's body recomposition data. She is on tirzepatide (GLP-1), trains at Anytime Fitness with Fitbod 4-5x/week, and gets monthly Evolt 360 body composition scans.

Goals: protein ${goalsRow?.protein_g || 150}g/day, calories ${goalsRow?.calories_high || 1800}/day.

NUTRITION (last 30 days — ${nutritionDays} logged days):
${nutritionSummary || 'No data'}

BODY COMPOSITION SCANS:
${scanSummary || 'No scans yet'}

WORKOUTS (last 30 days — ${workoutCount} sessions):
${workoutSummary || 'No data'}

Generate 3-5 specific, actionable insights based on the ACTUAL data above. Focus on patterns, trends, and concrete next steps.

Return ONLY a JSON array. Each insight object must have:
- "type": one of: muscle_gain_pattern, protein_pattern, hydration_pattern, energy_pattern, fat_loss_pattern, workout_consistency, recovery_pattern, tirzepatide_pattern
- "observation": one specific sentence describing what the data shows (max 15 words)
- "recommendation": one specific actionable step (max 15 words)
- "confidence": "high", "medium", or "low"

Return ONLY the JSON array, no markdown, no extra text.`;

  const aiData = await claudeCall(env, {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
  });
  const aiRes = aiData.content?.[0]?.text || '[]';
  let insights = [];
  try {
    const clean = aiRes.replace(/```json|```/g, '').trim();
    insights = JSON.parse(clean);
    if (!Array.isArray(insights)) insights = [];
  } catch (e) {
    insights = [{ type: 'default', observation: 'Unable to parse insight data', recommendation: 'Try again later', confidence: 'low' }];
  }

  return reply({
    insights,
    generatedAt: new Date().toISOString(),
    dataPoints: { nutrition: nutritionDays, evolt: scanCount, workouts: workoutCount },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scan/import  — insert pre-parsed scan data (from regex parser)
// Accepts the v1 parsed field names and maps to D1 columns
// ─────────────────────────────────────────────────────────────────────────────
async function importParsedScan(request, env) {
  const body     = await request.json();
  const overwrite = body.overwrite || false;

  // Accept either v1 camelCase or v2 snake_case field names
  const date = body.date || body.scan_date;
  if (!date) return reply({ error: 'date field required' }, 400);

  // Duplicate check
  const existing = await env.FUELSTRONG_DB.prepare(
    'SELECT scan_date FROM body_scans WHERE scan_date = ?'
  ).bind(date).first();

  if (existing && !overwrite) {
    return reply({
      duplicate: true,
      scan_date: date,
      message: `Scan from ${date} already exists. Send overwrite:true to replace.`,
    });  // 200 so client can check duplicate:true without throwing
  }

  const sql = overwrite ? 'INSERT OR REPLACE INTO body_scans' : 'INSERT INTO body_scans';

  await env.FUELSTRONG_DB.prepare(`
    ${sql} (
      scan_date, weight_lbs, skeletal_muscle_mass, lean_body_mass,
      body_fat_mass, body_fat_pct,
      visceral_fat_area, visceral_fat_level,
      bmr, tee, bio_age, bwi_score,
      rec_cal_low, rec_cal_high, rec_protein_low_g, rec_protein_high_g
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    date,
    body.weight          || body.weight_lbs          || null,
    body.skeletalMuscleMass || body.skeletal_muscle_mass || null,
    body.leanBodyMass    || body.lean_body_mass       || null,
    body.bodyFatMass     || body.body_fat_mass        || null,
    body.bodyFatPct      || body.bodyFatPercent       || body.body_fat_pct || null,
    body.visceralFatArea || body.visceral_fat_area    || null,
    body.visceralFatLevel|| body.visceral_fat_level   || null,
    body.bmr             || null,
    body.tee             || null,
    body.bioAge          || body.bio_age              || null,
    body.bwiScore        || body.bwi_score            || null,
    body.recCalLow       || body.rec_cal_low          || null,
    body.recCalHigh      || body.rec_cal_high         || null,
    body.recProteinLow   || body.rec_protein_low_g    || null,
    body.recProteinHigh  || body.rec_protein_high_g   || null
  ).run();

  return reply({ ok: true, scan_date: date, inserted: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/foods  — update food_library entry by name
// ─────────────────────────────────────────────────────────────────────────────
async function updateFoodInLibrary(request, env) {
  const body = await request.json();
  if (!body.id && !body.name) return reply({ error: 'id or name required' }, 400);

  // Build WHERE clause — prefer integer id
  const where  = body.id ? 'WHERE id = ?' : 'WHERE name = ?';
  const whereV = body.id ? body.id : body.name;

  // If name is changing, check for conflicts
  if (body.newName && body.newName !== body.name) {
    const conflict = await env.FUELSTRONG_DB.prepare(
      'SELECT id FROM food_library WHERE name = ? AND id != ?'
    ).bind(body.newName, body.id || 0).first();
    if (conflict) return reply({ error: 'A food with that name already exists' }, 409);
  }

  await env.FUELSTRONG_DB.prepare(`
    UPDATE food_library SET
      name         = COALESCE(?, name),
      display_name = COALESCE(?, display_name),
      calories     = ?,
      protein_g    = ?,
      carbs_g      = ?,
      fat_g        = ?,
      fiber_g      = ?,
      serving      = ?
    ${where}
  `).bind(
    body.newName     || null,
    body.displayName || null,
    body.calories ?? 0,
    body.protein  ?? 0,
    body.carbs    ?? 0,
    body.fat      ?? 0,
    body.fiber    ?? 0,
    body.serving  || null,
    whereV
  ).run();

  return reply({ ok: true, id: body.id, name: body.newName || body.name });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/foods  — remove food_library entry by name
// ─────────────────────────────────────────────────────────────────────────────
async function deleteFoodFromLibrary(request, env) {
  const body = await request.json();

  if (body.id && Number.isInteger(body.id)) {
    await env.FUELSTRONG_DB.prepare('DELETE FROM food_library WHERE id = ?').bind(body.id).run();
    return reply({ ok: true, deleted: body.id });
  }
  if (body.name) {
    await env.FUELSTRONG_DB.prepare('DELETE FROM food_library WHERE name = ?').bind(body.name).run();
    return reply({ ok: true, deleted: body.name });
  }
  return reply({ error: 'id or name required' }, 400);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notes  — append a coach note to the day's thread
// GET  /api/notes  — fetch notes for date range (for coaching context)
// Notes stored as JSON array in daily_logs.notes column
// ─────────────────────────────────────────────────────────────────────────────
async function addCoachNote(request, env, url) {
  const date = url.searchParams.get('date') || todayStr();
  const body = await request.json();
  const text = (body.text || '').trim();
  if (!text) return reply({ error: 'text required' }, 400);

  const ts   = body.timestamp || new Date().toISOString();
  const note = { ts, text };

  // Load existing notes for this date
  const row = await env.FUELSTRONG_DB.prepare(
    'SELECT notes FROM daily_logs WHERE date = ?'
  ).bind(date).first();

  let notes = [];
  if (row?.notes) {
    try { notes = JSON.parse(row.notes); } catch { notes = []; }
  }
  notes.push(note);

  // Upsert into daily_logs
  await env.FUELSTRONG_DB.prepare(`
    INSERT INTO daily_logs (date, notes)
    VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET notes = excluded.notes
  `).bind(date, JSON.stringify(notes)).run();

  return reply({ ok: true, date, notes });
}

async function getCoachNotes(env, url) {
  const since = url.searchParams.get('since') || daysAgo(3);
  const until = url.searchParams.get('until') || todayStr();

  const rows = await env.FUELSTRONG_DB.prepare(
    'SELECT date, notes FROM daily_logs WHERE date >= ? AND date <= ? AND notes IS NOT NULL ORDER BY date ASC'
  ).bind(since, until).all();

  const threads = (rows.results || []).map(r => {
    let notes = [];
    try { notes = JSON.parse(r.notes); } catch { notes = []; }
    return { date: r.date, notes };
  }).filter(t => t.notes.length > 0);

  return reply({ threads });
}
