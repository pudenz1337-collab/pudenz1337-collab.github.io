/**
 * FuelStrong — Cloudflare Worker
 *
 * Required Secrets (Cloudflare dashboard → Worker → Settings → Variables):
 *   ANTHROPIC_API_KEY  — your Anthropic API key
 *   GITHUB_TOKEN       — your GitHub personal access token (optional, for backup)
 *
 * Required KV Namespace binding:
 *   FUELSTRONG_KV      — bind a KV namespace called "fuelstrong-data"
 */

const GITHUB_REPO    = 'pudenz1337-collab/pudenz1337-collab.github.io';
const ALLOWED_ORIGIN = 'https://pudenz1337-collab.github.io';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Permanent Coaching Foundation ────────────────────────────────────────────
// This document is the foundation for every coaching response.
// It is written into KV as coach_context_enriched via POST /api/context/enrich,
// but is also baked here as a constant so coaching always has context even
// before that endpoint is called, and as a fallback if KV is empty.
// Update this when Hanna's situation changes (tirzepatide status, goals shift, etc.)
const HANNA_PERMANENT_CONTEXT = `
COACHING FOUNDATION — HANNA (read before every response)

WHO YOU ARE COACHING:
Hanna is a 50-year-old woman in active physical transformation. She has two nearly-grown kids and is approaching an empty-nester phase. She is investing in herself in a way she hasn't before — not for anyone else. She discovered she loves strength training and wants to see what her body is actually capable of.

She is not a beginner. She has 18 months of gym attendance behind her and has trained with real intention since November 2024. She uses Fitbod (Get Stronger / Hypertrophy setting), trains 3-4 days per week at Anytime Fitness, sessions are 40-45 minutes with free weights, cables, and machines. She knows how to work out. Do not explain basics.

WHERE SHE IS IN HER JOURNEY:
- Started tirzepatide in July 2025. Down 34 lbs. Would like to lose approximately 25 more.
- Goal shifted in November 2025 from weight loss to body recomposition: build visible muscle while losing fat.
- Real success = seeing her muscles in the mirror. Not a scale number. Arms, shoulders, definition.
- She has never been a bad eater — just a busy person who loses track of meals.

TIRZEPATIDE — CURRENT CONTEXT (not a permanent condition):
Tirzepatide is suppressing her appetite significantly. Her hunger cues cannot be trusted as a reliable signal that she has eaten enough. She does not undereat on purpose — she gets busy and the medication removes the natural reminder to eat. This is the single biggest practical risk: undereating while strength training accelerates muscle loss and undermines every hour she puts in at the gym. Eating slightly too much is far less harmful than consistently undereating.

When tirzepatide use ends — whether through tapering or stopping — hunger signals will return, possibly strongly. The habits we are building now around consistent protein and hitting calorie targets will be the foundation for maintaining results without medication. Coach with that transition in mind. Update this section when her tirzepatide status changes.

THE ONE BEHAVIORAL PATTERN THAT MATTERS MOST:
She tends to undereat — not through restriction, through forgetting. Any day under 1200 calories is a warning signal. Any period with three or more days under 1200 is a pattern that needs direct attention. Frame it as muscle protection: "You need to eat more to see the muscle you're building." Not discipline — investment in what she's working toward.

NUTRITION PICTURE:
- Protein has been more manageable. Calories are the consistent gap.
- Front-loading protein earlier in the day matters more at 50 than at 30.
- She does not have a complicated relationship with food. She needs practical reminders, not lectures.

SUCCESS DEFINITION:
Visible muscle. Not a weight target. Not a body fat percentage. The feeling of looking in the mirror and seeing what she's built. Arms. Shoulders. Definition. Evolt scans are the report card — specifically skeletal muscle mass trending up and body fat percentage trending down. The scale is almost meaningless for her actual goals and should be actively reframed when it comes up.

WHAT A GOOD WEEK LOOKS LIKE:
4 training sessions. Protein goal hit 5+ of 7 days. No more than 1 day under 1200 calories. Energy and mood stable or improving. These are the conditions that build toward visible muscle.

WHAT A CONCERNING WEEK LOOKS LIKE:
Multiple days under 1200 calories. Protein missing on training days. Training below 3 sessions for 2+ consecutive weeks. These patterns will show up in the next Evolt scan as muscle loss.

HOW TO COACH HER:
- Be direct. She is smart and busy. One clear priority beats five balanced suggestions.
- Be specific. "Protein was low your last 3 training days" is useful. "Make sure you're getting enough protein" is not.
- Be honest about the timeline. Visible muscle at 50 during recomposition is a 6-12 month project. Reinforce this when the scale is frustrating her.
- Connect everything to her actual goal: visible muscle. When she is doing the right things, say so. When she isn't, say so once, clearly, with a specific fix.
- Do not give generic fitness advice. She comes here for analysis of her specific data and situation.
- Respect that she is doing something hard and doing it consistently. Acknowledge that without being patronizing.
`;

// ─── Router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    try {
      if (path === '/api/health'           && method === 'GET')    return health();
      if (path === '/api/data'             && method === 'GET')    return getData(env);
      if (path === '/api/data'             && method === 'POST')   return saveData(request, env);
      if (path === '/api/parse'            && method === 'POST')   return parseFile(request, env);
      if (path === '/api/coach'            && method === 'POST')   return getCoaching(request, env);
      if (path === '/api/coach'            && method === 'GET')    return getKVKey(env, 'last_coaching');
      if (path === '/api/backup'           && method === 'POST')   return backupToGitHub(env);
      if (path === '/api/goals'            && method === 'POST')   return saveKVKey(request, env, 'goals');
      if (path === '/api/context'          && method === 'POST')   return saveKVKey(request, env, 'coach_context');
      if (path === '/api/context'          && method === 'GET')    return getKVKey(env, 'coach_context');
      if (path === '/api/context/enrich'   && method === 'POST')   return enrichContext(request, env);
      if (path === '/api/context/enrich'   && method === 'GET')    return getKVKey(env, 'coach_context_enriched');
      if (path === '/api/profile'          && method === 'GET')    return getProfile(env);
      if (path === '/api/profile'          && method === 'POST')   return saveProfile(request, env);
      // /api/live removed — writes go direct to /api/daily/:date
      if (path === '/api/food-library'     && method === 'GET')    return getKVKey(env, 'food_library');
      if (path === '/api/food-library'     && method === 'POST')   return saveKVKey(request, env, 'food_library');
      if (path === '/api/search-food'      && method === 'GET')    return searchFood(request, env);
      if (path === '/api/scan-label'       && method === 'POST')   return scanLabel(request, env);
      if (path === '/api/estimate'         && method === 'POST')   return estimateMacros(request, env);
      if (path === '/api/insights'         && method === 'GET')    return getInsights(env);
      if (path === '/api/insights'         && method === 'POST')   return generateInsights(env);
      if (path === '/api/intelligence'     && method === 'POST')   return getIntelligence(env);
      if (path === '/api/momentum'         && method === 'GET')    return getMomentum(env);
      if (path === '/api/scan-intervals'   && method === 'GET')    return getScanIntervals(env);
      if (path.startsWith('/api/daily/')   && method === 'GET')    return getDailyDay(env, path);
      if (path.startsWith('/api/daily/')   && method === 'PUT')    return putDailyDay(request, env, path);
      if (path.startsWith('/api/data/')    && method === 'DELETE') return deleteEntry(request, env, path);

      return reply({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return reply({ error: e.message }, 500);
    }
  }
};

// ─── Health ───────────────────────────────────────────────────────────────────
function health() {
  return reply({ status: 'ok', time: new Date().toISOString() });
}

// ─── Get all data ─────────────────────────────────────────────────────────────
async function getData(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV namespace not bound. Add FUELSTRONG_KV binding in Cloudflare Worker settings.' }, 500);
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

// ─── Save parsed data ─────────────────────────────────────────────────────────
async function saveData(request, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV namespace not bound.' }, 500);
  const { type, data } = await request.json();
  if (!['evolt','fitbod','fuelstrong'].includes(type)) return reply({ error: 'Invalid data type' }, 400);

  if (Array.isArray(data) && data.length === 0) {
    await env.FUELSTRONG_KV.put(type, '[]');
    return reply({ success: true, total: 0, added: 0, cleared: true });
  }

  const existing = JSON.parse(await env.FUELSTRONG_KV.get(type).catch(() => null) || '[]');
  const incoming = Array.isArray(data) ? data : [data];
  const merged   = [...existing];
  for (const entry of incoming) {
    const key = entry.id || entry.date;
    if (!merged.some(e => (e.id || e.date) === key)) merged.push({ ...entry, savedAt: new Date().toISOString() });
  }
  merged.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  await env.FUELSTRONG_KV.put(type, JSON.stringify(merged));
  return reply({ success: true, total: merged.length, added: incoming.length });
}

// ─── Delete entry ─────────────────────────────────────────────────────────────
async function deleteEntry(request, env, path) {
  const parts    = path.split('/').filter(Boolean);
  const type     = parts[2];
  const id       = parts[3];
  const existing = JSON.parse(await env.FUELSTRONG_KV.get(type) || '[]');
  const filtered = existing.filter(e => (e.id || e.date) !== decodeURIComponent(id));
  await env.FUELSTRONG_KV.put(type, JSON.stringify(filtered));
  return reply({ success: true, remaining: filtered.length });
}

// ─── Parse uploaded file ──────────────────────────────────────────────────────
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
      "sets": [{ "reps": number, "weight": number, "unit": "lbs" }],
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
      messages:   [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
        { type: 'text',  text: prompt }
      ]}]
    });

    const text   = resp.content?.[0]?.text || '{}';
    const match  = text.match(/\{[\s\S]*\}/);
    const parsed = safeJson(match?.[0]);
    if (parsed && !parsed.error) { parsed.id = uid('fitbod'); parsed.sourceFile = filename; }
    return reply(parsed || { error: 'parse_failed', raw: text.slice(0, 500) });
  }

  return reply({ error: 'unknown_file_type' }, 400);
}

// ─── Generic KV helpers ───────────────────────────────────────────────────────
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

// ─── Enrich context ───────────────────────────────────────────────────────────
// Write an updated permanent context document to KV.
// Called via POST /api/context/enrich with { context: "updated document text" }
// If no body provided, seeds KV with the baked-in HANNA_PERMANENT_CONTEXT constant.
async function enrichContext(request, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const body        = await request.json().catch(() => ({}));
  const contextText = body.context || HANNA_PERMANENT_CONTEXT;
  await env.FUELSTRONG_KV.put('coach_context_enriched', JSON.stringify({
    context:   contextText,
    updatedAt: new Date().toISOString(),
  }));
  return reply({ success: true, updatedAt: new Date().toISOString() });
}

// ─── Profile ──────────────────────────────────────────────────────────────────
async function getProfile(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const [goalsRaw, tirzRaw, customRaw, pinsRaw, libRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('profile_goals').catch(() => null),
    env.FUELSTRONG_KV.get('profile_tirz').catch(() => null),
    env.FUELSTRONG_KV.get('profile_custom_foods').catch(() => null),
    env.FUELSTRONG_KV.get('profile_food_pins').catch(() => null),
    env.FUELSTRONG_KV.get('food_library').catch(() => null),
  ]);
  return reply({
    goals:       goalsRaw ? JSON.parse(goalsRaw)  : null,
    tirz:        tirzRaw  ? JSON.parse(tirzRaw)   : null,
    customFoods: customRaw ? JSON.parse(customRaw) : null,
    foodPins:    pinsRaw  ? JSON.parse(pinsRaw)   : null,
    foodLibrary: libRaw   ? JSON.parse(libRaw)    : null,
  });
}

async function saveProfile(request, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const body = await request.json().catch(() => ({}));
  const ops  = [];
  if (body.goals       !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_goals',        JSON.stringify(body.goals)));
  if (body.tirz        !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_tirz',         JSON.stringify(body.tirz)));
  if (body.customFoods !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_custom_foods', JSON.stringify(body.customFoods)));
  if (body.foodPins    !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_food_pins',    JSON.stringify(body.foodPins)));
  await Promise.all(ops);
  return reply({ success: true });
}

// ─── AI Coaching ──────────────────────────────────────────────────────────────
async function getCoaching(request, env) {
  const body      = await request.json().catch(() => ({}));
  body.history    = body.history  || [];
  body.foodLog    = body.foodLog  || [];
  body.workouts   = body.workouts || [];
  body.hem        = body.hem      || [];
  const question  = body.question || '';

  if (!env.FUELSTRONG_KV)    return reply({ error: 'KV namespace not bound. Check Worker bindings in Cloudflare dashboard — variable must be named FUELSTRONG_KV.' }, 500);
  if (!env.ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY secret not set in Worker environment variables.' }, 500);

  // Load everything in parallel — enriched context document comes first
  const [evoltRaw, fitbodRaw, fuelstrongRaw, goalsRaw, contextRaw, enrichedRaw, profGoalsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
    env.FUELSTRONG_KV.get('goals').catch(() => null),
    env.FUELSTRONG_KV.get('coach_context').catch(() => null),
    env.FUELSTRONG_KV.get('coach_context_enriched').catch(() => null),
    env.FUELSTRONG_KV.get('profile_goals').catch(() => null),
  ]);

  const evolt      = JSON.parse(evoltRaw      || '[]');
  const fitbod     = JSON.parse(fitbodRaw     || '[]');
  const fuelstrong = JSON.parse(fuelstrongRaw || '[]');
  const goals      = profGoalsRaw ? JSON.parse(profGoalsRaw) : (goalsRaw ? JSON.parse(goalsRaw) : (body.goals || {}));
  const mode       = body.mode || 'dashboard';

  // Permanent context: KV-stored enriched version, falling back to baked-in constant
  const enrichedObj    = enrichedRaw ? JSON.parse(enrichedRaw) : null;
  const permanentCtx   = enrichedObj?.context || HANNA_PERMANENT_CONTEXT;
  const savedCtx       = contextRaw ? JSON.parse(contextRaw) : {};
  const additionalNotes = savedCtx.context || body.context || '';

  const supplements  = body.supplements  || '';
  const tirzepatide  = body.tirzepatide  || {};
  const measurements = body.measurements || [];
  const sessionLogs  = body.sessionLogs  || [];
  const woSummary    = body.workoutSummary || null;

  // ── Tirzepatide block ──
  let tirzBlock = '';
  if (tirzepatide?.dose || tirzepatide?.day !== undefined) {
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const injDay   = tirzepatide.day !== '' ? parseInt(tirzepatide.day) : null;
    const todayDow = new Date().getDay();
    const daysAgo  = injDay !== null ? ((todayDow - injDay) + 7) % 7 : null;
    tirzBlock = `\nTirzepatide: ${tirzepatide.dose ? tirzepatide.dose+'mg' : ''}${injDay !== null ? ', injected '+dayNames[injDay] : ''}${tirzepatide.weeks ? ' ('+tirzepatide.weeks+' weeks on dose)' : ''}${daysAgo !== null ? ' — '+daysAgo+' days since last injection' : ''}`;
  }

  const suppBlock    = supplements ? `\nSupplement stack: ${supplements}` : '';
  const measBlock    = measurements.length ? `\nMeasurements: ${measurements.map(m => `${m.date}: waist=${m.waist}"${m.hips?' hips='+m.hips+'"':''}${m.arm?' arm='+m.arm+'"':''}`).join(' | ')}` : '';
  const sessionBlock = sessionLogs.length  ? `\nSession logs: ${sessionLogs.map(s => `${s.date}: feel=${s.feel||'?'}/5, RPE=${s.rpe||'?'}/10${s.note?' ('+s.note+')':''}`).join(' | ')}` : '';
  const goalsBlock   = goals && Object.keys(goals).length ? `\nLogged goals: protein ${goals.protein||150}g/day | calories ${goals.cal||1800}/day | water ${goals.water||80}oz/day` : '';

  // ── Evolt lines ──
  const evoltLines = evolt.map(s =>
    `${s.date}: Weight=${s.weight}lbs | BF%=${s.bodyFatPct}% | SkeletalMuscle=${s.skeletalMuscleMass}lbs | LBM=${s.leanBodyMass}lbs | VisceralFat=${s.visceralFatMass}lbs | BMR=${s.bmr}kcal`
  ).join('\n');

  const evoltDelta = evolt.length >= 2 ? (() => {
    const f = evolt[0], l = evolt[evolt.length-1];
    return `Change ${f.date}→${l.date}: Weight ${f.weight}→${l.weight}lbs (${(l.weight-f.weight).toFixed(1)}), BF% ${f.bodyFatPct}→${l.bodyFatPct}% (${(l.bodyFatPct-f.bodyFatPct).toFixed(1)}%), Muscle ${f.skeletalMuscleMass}→${l.skeletalMuscleMass}lbs (${(l.skeletalMuscleMass-f.skeletalMuscleMass).toFixed(1)})`;
  })() : 'Only one scan available.';

  const nutritionLines = fuelstrong.length
    ? fuelstrong.slice(-14).map(n => `${n.date}: Protein=${n.protein}g | Cal=${n.calories}kcal | Water=${n.water}oz${n.flags?.trainingDay?' 💪':''}${n.flags?.injectionDay?' 💉':''}`).join('\n')
    : 'No nutrition data logged yet.';

  const woLines = woSummary
    ? `Total workouts: ${woSummary.totalWorkouts}\nAvg per week: ${woSummary.avgWorkoutsPerWeek}\nCompound/Isolation: ${woSummary.compoundPct}% compound\nTop PRs: ${woSummary.topPRs}`
    : fitbod.slice(-20).map(w => `${w.date}: ${w.workoutName||'Workout'} | ${(w.muscleGroupsWorked||[]).join(', ')} | ${w.totalVolume}lbs`).join('\n') || 'No workout data.';

  // ── Scan interval summary for coaching context ──
  // These are the personal cause-effect data points that make coaching specific
  let scanIntervalContext = '';
  if (evolt.length >= 2) {
    const lines = [];
    for (let i = 1; i < evolt.length; i++) {
      const prev = evolt[i-1], curr = evolt[i];
      const days = Math.round((new Date(curr.date) - new Date(prev.date)) / 86400000);
      const iNutrition = fuelstrong.filter(d => d.date > prev.date && d.date <= curr.date && (d.protein>0||d.calories>0));
      const avgP = iNutrition.length ? Math.round(iNutrition.reduce((a,d)=>a+(d.protein||0),0)/iNutrition.length) : null;
      const avgC = iNutrition.length ? Math.round(iNutrition.reduce((a,d)=>a+(d.calories||0),0)/iNutrition.length) : null;
      const iWo  = fitbod.filter(w => w.date > prev.date && w.date <= curr.date);
      const freq = days > 0 ? (iWo.length / (days/7)).toFixed(1) : null;
      const mChg = (curr.skeletalMuscleMass!=null&&prev.skeletalMuscleMass!=null) ? (curr.skeletalMuscleMass-prev.skeletalMuscleMass).toFixed(1) : '?';
      const fChg = (curr.bodyFatPct!=null&&prev.bodyFatPct!=null) ? (curr.bodyFatPct-prev.bodyFatPct).toFixed(1) : '?';
      lines.push(`Interval ${i} (${prev.date}→${curr.date}, ${days}d): Muscle ${mChg>0?'+':''}${mChg}lbs, BF% ${fChg>0?'+':''}${fChg}% | Avg protein ${avgP!==null?avgP+'g':'not logged'}, avg cal ${avgC!==null?avgC:'not logged'} | Training ${freq!==null?freq+'/wk':'not logged'}`);
    }
    scanIntervalContext = `\n\nSCAN INTERVAL ANALYSIS — your personal cause-effect record:\n${lines.join('\n')}`;
  }

  // ── Base system prompt: permanent context document is the foundation ──
  const baseSystem = `${permanentCtx}

EVIDENCE-BASED COACHING RULES:
1. PROTEIN: 0.7-1.0g per lb of bodyweight supports muscle retention during a deficit. Higher end (~1g/lb) when in caloric deficit and training hard.
2. MUSCLE BUILDING AT 50: Women over 50 build muscle more slowly — 0.25-0.5 lbs of actual muscle per month is realistic and excellent. Do not set unrealistic expectations.
3. SCALE WEIGHT is NOT a good metric for body recomposition. Reframe toward skeletal muscle mass and fat mass from Evolt scans.
4. TIRZEPATIDE + MUSCLE: GLP-1 agonists reduce appetite — useful for fat loss, but can lead to muscle loss if protein and calories are too low. Priority: hit protein goal even when not hungry.
5. DEFICIT DEPTH: 300-500 kcal/day deficit is optimal for fat loss while preserving muscle. More aggressive = faster muscle loss, slower recovery, worse workouts.
6. PROGRESSIVE OVERLOAD is the driver of muscle retention and growth — weights going up over time matters.
7. SCAN INTERVALS are the most valuable data. Connect each interval's nutrition and training behavior to its body composition outcome.
8. AVOID MYTHS: No "muscle turns to fat," "toning vs building," "cardio burns muscle," "detoxes." Use specific mechanisms.
${goalsBlock}${tirzBlock}${suppBlock}${measBlock}${sessionBlock}${additionalNotes ? '\nAdditional coach notes: '+additionalNotes : ''}`;

  // ── Mode-specific prompt ──
  let userMsg, systemAddition = '';

  if (mode === 'dashboard') {
    const workoutDetail  = body.workoutDetail || null;
    const weeklyBreakdown = workoutDetail?.weekLines?.length
      ? `\nPer-week muscle breakdown (last 8 weeks):\n${workoutDetail.weekLines.join('\n')}\nAll-time muscle frequency: ${workoutDetail.muscleRanking}`
      : '';

    systemAddition = `
You are the Performance & Pattern Coach inside FuelStrong Progress. Your job is to connect the dots across Fitbod workouts, Evolt body composition scans, and FuelStrong nutrition data — not just summarize each in isolation. If scan interval data is present, use it to make coaching specific: what did behavior look like during each interval, and what did the scan show at the end?

RESPONSE STRUCTURE — use these exact emoji headers in this order:

**🧠 Big Picture** (1–2 sentences)
Honest overall trajectory. Direct and specific.

**📊 Pattern Findings** (4–6 bullets citing actual numbers)
Tie cause to effect explicitly. Use scan interval data where available to connect behavior to outcome.
• If intervals exist: "Between scans [date]→[date], you trained X/week and averaged Xg protein — muscle changed [result]"
• Connect patterns: "High protein weeks + consistent training → [outcome]; low calorie periods → [other outcome]"

**💪 Workout-Focused Coaching** (3–5 specific actions)
Lead with training. Nutrition and recovery framed as support.
• Which muscle groups need more work (cite Fitbod data)
• Whether to push volume or maintain
• Specific nutrition adjustment for training days
• One GLP-1 note if relevant

**🎯 Why This Matters** (1–2 sentences)
Link these tweaks to what the next Evolt scan should show.

**📅 Check Back When**
One sentence: after next Evolt scan, or after X weeks.

TONE: Direct, specific, coach-like. Numbers over reassurance. Start directly — no preamble.`;

    userMsg = `Generate my coaching dashboard.\n\nEvolt Scans:\n${evoltLines}\nOverall change: ${evoltDelta}${scanIntervalContext}\n\nWorkout Analytics:\n${woLines}${weeklyBreakdown}\n\nNutrition (last 14 days):\n${nutritionLines}`;

  } else if (mode === 'fuelstrong_daily' || mode === 'checkin') {
    const foodLog    = body.foodLog  || [];
    const workouts   = body.workouts || [];
    const hemEntries = body.hem      || body.hemLog || [];
    const waterLog   = body.waterLog || [];
    const currentTime = body.currentTime || new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const tzOffset    = body.timezoneOffset ?? 0;  // minutes behind UTC (e.g. CST = 360)
    const msgHistory  = body.history || [];

    const todayProtein = Math.round(foodLog.reduce((a,i) => a+(i.protein||0), 0));
    const todayCal     = Math.round(foodLog.reduce((a,i) => a+(i.calories||0), 0));
    const todayWater   = Math.round(waterLog.reduce((a,w) => a+(w.oz||0), 0));
    const proteinGoal  = goals.protein || 150;
    const calGoal      = goals.cal     || 1800;
    const waterGoal    = goals.water   || 80;

    const fmtISO = iso => {
      if (!iso) return '';
      try {
        // Cloudflare Workers run UTC — apply client timezone offset manually
        const d = new Date(new Date(iso).getTime() - (tzOffset * 60000));
        const h = d.getUTCHours(), m = d.getUTCMinutes();
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12  = h % 12 || 12;
        return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
      } catch { return ''; }
    };

    const hemTimeline = hemEntries.length
      ? [...hemEntries].sort((a,b) => (a.timestamp||'').localeCompare(b.timestamp||''))
          .map(e => {
            const hL = e.h===1?'H1(not hungry)':e.h===2?'H2(moderate)':e.h===3?'H3(very hungry)':'';
            const eL = e.e===1?'E1(low)':e.e===2?'E2(moderate)':e.e===3?'E3(high)':'';
            const mL = e.m===1?'M1(low)':e.m===2?'M2(ok)':e.m===3?'M3(good)':'';
            return `${fmtISO(e.timestamp)}: ${[hL,eL,mL].filter(Boolean).join(' ')}${e.note?' — '+e.note:''}`;
          }).join(' | ')
      : 'No H-E-M logged yet';

    const sortedFood = [...foodLog].sort((a,b) => (a.timestamp||'').localeCompare(b.timestamp||''));
    let mealLines = [];
    if (sortedFood.length) {
      const groups = {}, groupOrder = [];
      sortedFood.forEach(item => {
        const hour   = item.timestamp ? ((new Date(item.timestamp).getUTCHours() - Math.round((tzOffset||0)/60) + 24) % 24) : 12;
        const period = hour<9?'Morning (before 9am)':hour<12?'Late Morning (9–12pm)':hour<14?'Midday (12–2pm)':hour<17?'Afternoon (2–5pm)':hour<20?'Evening (5–8pm)':'Night (after 8pm)';
        if (!groups[period]) { groups[period] = { items:[], firstTime: fmtISO(item.timestamp) }; groupOrder.push(period); }
        groups[period].items.push(item);
      });
      mealLines = groupOrder.map(p => {
        const g  = groups[p];
        const pp = Math.round(g.items.reduce((a,i) => a+(i.protein||0), 0));
        const pc = Math.round(g.items.reduce((a,i) => a+(i.calories||0), 0));
        return `${p} [${g.firstTime}]: ${pp}g protein, ${pc}kcal — ${g.items.map(i => `${i.displayName||i.name}(${i.protein||0}g P)`).join(', ')}`;
      });
    }

    let woBlock = '';
    if (workouts.length) {
      woBlock = workouts.map((w,i) => {
        const dur = w.durationMinutes ? `${w.durationMinutes} min` : null;
        const rpe = w.rpe ? `RPE ${w.rpe}` : null;
        return `${workouts.length>1?'Workout '+(i+1):'Workout'}: ${[fmtISO(w.startTime),dur,rpe].filter(Boolean).join(' ')}${w.notes?' — '+w.notes:''}`;
      }).join('\n');
    } else {
      woBlock = 'No workout logged today';
    }

    const latestHEM = hemEntries.length
      ? (() => { const e=[...hemEntries].sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||'')).pop(); return `H${e.h||'?'} E${e.e||'?'} M${e.m||'?'}${e.note?' ('+e.note+')':''}`; })()
      : 'none';

    const recentDays = fuelstrong.slice(-14);
    const avgP   = recentDays.length ? Math.round(recentDays.reduce((a,d) => a+d.protein,0)/recentDays.length) : null;
    const avgCal = recentDays.length ? Math.round(recentDays.reduce((a,d) => a+(d.calories||0),0)/recentDays.length) : null;

    systemAddition = `
You are coaching Hanna in real-time throughout the day. Keep it conversational — like a coach texting her.

RESPONSE FORMAT:
1. **Status** (1-2 sentences): Where she is in the day and how she's tracking.
2. **Snapshot** (3-4 bullets): Protein vs goal, water vs goal, workout status, one scan trend note if relevant.
3. **What This Means** (2-3 sentences): Connect numbers to muscle-building and fat-loss in plain language.
4. **Next Steps** (2-4 actions for the next 2-4 hours): Use actual logged foods and times. Time of day only — never breakfast/lunch/dinner.
5. **Check Back When**: One sentence.

SHORT and direct. Coach texting style.`;

    const systemData = `
TODAY'S DATA (${currentTime}):
Protein: ${todayProtein}g / ${proteinGoal}g goal
Calories: ${todayCal} / ${calGoal} kcal goal
Water: ${todayWater}oz / ${waterGoal}oz goal
${woBlock}

MEALS LOGGED:
${mealLines.length ? mealLines.join('\n') : 'No food logged yet'}

H-E-M TIMELINE (H=Hunger, E=Energy, M=Mood, 1-3 scale):
${hemTimeline}

TIRZEPATIDE: ${tirzepatide.dose||'unknown'}mg | Days since injection: ${tirzepatide.daysPostInjection !== null ? tirzepatide.daysPostInjection : 'unknown'}

14-DAY AVERAGES: Protein ${avgP||'no data'}g/day | Calories ${avgCal||'no data'}/day

EVOLT TREND:
${evoltLines || 'No scans uploaded yet'}`;

    if (msgHistory.length === 0) {
      userMsg = `${systemData}\n\nGive me my coaching check-in.`;
    } else {
      userMsg = `[Update at ${currentTime}]
Protein: ${todayProtein}g / ${proteinGoal}g | Water: ${todayWater}oz
${woBlock}
Latest HEM: ${latestHEM}
Food: ${mealLines.join('; ') || 'none yet'}

${body.question || 'Update my coaching based on current data.'}`;
    }

  } else if (mode === 'ask') {
    systemAddition = '\nAnswer the specific question directly and specifically. Use actual numbers from the data. 3-5 sentences. Coach texting style.';
    const todayCtx = body.todayContext || '';
    userMsg = `${todayCtx ? 'TODAY: '+todayCtx+'\n\n' : ''}Evolt Scans:\n${evoltLines}\nDelta: ${evoltDelta}${scanIntervalContext}\n\nWorkout Analytics:\n${woLines}\n\nNutrition:\n${nutritionLines}\n\nQuestion: ${question}`;

  } else if (mode === 'body') {
    systemAddition = '\nFocus: Deep dive into body composition trends. Use scan interval analysis to explain which behaviors drove each outcome. End with: "Your Top 3 Body Composition Priorities."';
    userMsg = `Analyze my body composition.\n\nEvolt Scans:\n${evoltLines}\nOverall delta: ${evoltDelta}${scanIntervalContext}\n\nNutrition (last 14 days):\n${nutritionLines}`;

  } else if (mode === 'weekly') {
    const recentWeek  = fuelstrong.slice(-7);
    const weekProtein = recentWeek.length
      ? recentWeek.map(d => `${d.date}: ${d.protein}g protein, ${d.calories||'?'}kcal${d.flags?.trainingDay?' 💪':''}${d.flags?.injectionDay?' 💉':''}`).join('\n')
      : 'No logged days this week';
    const avgWeekP   = recentWeek.length ? Math.round(recentWeek.reduce((a,d) => a+d.protein,0)/recentWeek.length) : null;
    const avgWeekCal = recentWeek.length ? Math.round(recentWeek.reduce((a,d) => a+(d.calories||0),0)/recentWeek.length) : null;
    const workoutDays = recentWeek.filter(d => d.flags?.trainingDay).length;

    systemAddition = `
You are giving Hanna her weekly performance review. Concise, direct, data-driven. No fluff.

OUTPUT FORMAT:
### What Worked This Week
2-3 specific wins with numbers.
### What Limited Progress
2-3 specific gaps with data.
### Adjustments for Next Week
3 concrete numbered actions. Specific — name foods, times, targets.
### Trend Check
One sentence on body composition trajectory if she keeps this pattern.

Under 300 words. Coach data review style.`;

    userMsg = `Weekly review — ${new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}.

DAILY LOG (last 7 days):
${weekProtein}

WEEKLY AVERAGES: Protein ${avgWeekP||'no data'}g/day | Calories ${avgWeekCal||'no data'}/day
Training days: ${workoutDays}/7
Tirzepatide: ${tirzepatide.dose||'unknown'}mg | Days since injection: ${tirzepatide.daysPostInjection !== null ? tirzepatide.daysPostInjection : 'unknown'}

BODY COMPOSITION:
${evoltLines || 'No scans'}
Overall delta: ${evoltDelta}${scanIntervalContext}

NUTRITION TREND (14 days):
${nutritionLines}

Generate my weekly review.`;

  } else if (mode === 'training') {
    systemAddition = '\nFocus: Deep analysis of training quality for muscle building. Rep ranges, exercise selection, consistency, progressive overload. Connect training patterns to scan outcomes using interval analysis. End with: "Your Top 3 Training Adjustments."';
    userMsg = `Analyze my training in depth.\n\nWorkout Analytics:\n${woLines}\n\nBody comp impact:\n${evoltDelta}${scanIntervalContext}\n\nMuscle trend:\n${evolt.slice(-6).map(s=>`${s.date}: ${s.skeletalMuscleMass}lbs muscle`).join(', ')}`;

  } else {
    systemAddition = '\nFull synthesis: Connect ALL three data sources. Use scan interval analysis. What story do the numbers tell together? Where is she winning? Most important thing to fix? End with: "Your Top 3 Priorities Right Now."';
    userMsg = `Full coaching analysis.\n\nEvolt Scans:\n${evoltLines}\nOverall change: ${evoltDelta}${scanIntervalContext}\n\nWorkout Analytics:\n${woLines}\n\nNutrition (last 14 days):\n${nutritionLines}`;
  }

  let messagesArr;
  if ((mode === 'fuelstrong_daily' || mode === 'checkin') && body.history && body.history.length > 0) {
    messagesArr = [...body.history, { role: 'user', content: userMsg }];
  } else {
    messagesArr = [{ role: 'user', content: userMsg }];
  }

  const resp = await callClaude(env, {
    model:      'claude-sonnet-4-6',
    max_tokens: (mode === 'dashboard' || mode === 'weekly') ? 1600 : 1200,
    system:     baseSystem + systemAddition,
    messages:   messagesArr,
  });

  const coaching = resp.content?.[0]?.text || 'Could not generate coaching.';
  await env.FUELSTRONG_KV.put('last_coaching', JSON.stringify({
    text: coaching, mode, question: question || null, generatedAt: new Date().toISOString()
  }));
  return reply({ coaching, generatedAt: new Date().toISOString() });
}

// ─── Momentum Signal ──────────────────────────────────────────────────────────
// GET /api/momentum — pure computation, no Claude call, fast
// Returns { state: 'Building'|'Holding'|'Drifting', headline, priority, metrics }
async function getMomentum(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);

  const [fsRaw, evoltRaw, goalsRaw, profGoalsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('goals').catch(() => null),
    env.FUELSTRONG_KV.get('profile_goals').catch(() => null),
  ]);

  const fuelstrong  = JSON.parse(fsRaw    || '[]');
  const evolt       = JSON.parse(evoltRaw || '[]');
  const goals       = profGoalsRaw ? JSON.parse(profGoalsRaw) : (goalsRaw ? JSON.parse(goalsRaw) : {});
  const proteinGoal = goals.protein || 150;

  // Only use days with actual logged data
  const last14 = fuelstrong.slice(-14).filter(d => (d.calories||0) > 0 || (d.protein||0) > 0);

  if (last14.length < 3) {
    return reply({
      state:        'Building',
      headline:     'Getting started — keep logging to unlock pattern analysis',
      priority:     'Log your first full week of food to see your momentum',
      insufficient: true,
      metrics:      { loggedDays: last14.length },
    });
  }

  const avgProtein     = last14.reduce((a,d) => a+(d.protein||0), 0) / last14.length;
  const avgCal         = last14.reduce((a,d) => a+(d.calories||0), 0) / last14.length;
  const lowCalDays     = last14.filter(d => (d.calories||0) > 0 && (d.calories||0) < 1200).length;
  const trainingDays   = last14.filter(d => d.flags?.trainingDay || (d.workouts||0) > 0).length;
  const weeklyTraining = parseFloat((trainingDays / (last14.length / 7)).toFixed(1));

  // Last scan direction
  const latestScan = evolt.length ? evolt[evolt.length-1] : null;
  const prevScan   = evolt.length > 1 ? evolt[evolt.length-2] : null;
  const muscleUp   = (latestScan && prevScan && latestScan.skeletalMuscleMass != null && prevScan.skeletalMuscleMass != null)
    ? latestScan.skeletalMuscleMass > prevScan.skeletalMuscleMass : null;
  const fatDown    = (latestScan && prevScan && latestScan.bodyFatPct != null && prevScan.bodyFatPct != null)
    ? latestScan.bodyFatPct < prevScan.bodyFatPct : null;

  // Composite score: protein 40%, calories 35%, training 25%
  const proteinScore = avgProtein / proteinGoal;
  const calScore     = avgCal >= 1500 ? 1 : avgCal >= 1300 ? 0.75 : avgCal >= 1200 ? 0.5 : 0.2;
  const trainScore   = weeklyTraining >= 3.5 ? 1 : weeklyTraining >= 2.5 ? 0.7 : weeklyTraining >= 1.5 ? 0.4 : 0.15;
  const composite    = (proteinScore * 0.4) + (calScore * 0.35) + (trainScore * 0.25);

  let state, headline, priority;

  if (composite >= 0.78 && lowCalDays <= 2) {
    state    = 'Building';
    headline = proteinScore >= 0.9
      ? `Protein strong at ${Math.round(avgProtein)}g avg, training consistent — muscle-building conditions are right`
      : `Good momentum — protein at ${Math.round(avgProtein)}g avg, tighten it on training days`;
    priority = weeklyTraining < 3.5
      ? `Push for one more training session this week`
      : `Hold this pattern through your next Evolt scan`;

  } else if (composite >= 0.52 || lowCalDays <= 3) {
    state = 'Holding';
    if (lowCalDays > 2) {
      headline = `${lowCalDays} days under 1,200 calories in the last ${last14.length} logged days — muscle is protected but not actively building`;
      priority = `Add a protein-dense snack on your next low-appetite day — Greek yogurt, cottage cheese, or a shake`;
    } else if (proteinScore < 0.8) {
      headline = `Calories adequate but protein averaging ${Math.round(avgProtein)}g — ${Math.round(proteinGoal - avgProtein)}g below target`;
      priority = `Front-load protein: aim for 50g before noon on training days`;
    } else {
      headline = `Training at ${weeklyTraining}/week — one more session would shift this from Holding to Building`;
      priority = `Schedule your next workout right now`;
    }

  } else {
    state = 'Drifting';
    if (lowCalDays > 4) {
      headline = `${lowCalDays} of ${last14.length} logged days under 1,200 calories — this is actively working against the muscle you're building in the gym`;
      priority = `Today: add 300+ calories before your next workout, even if you're not hungry`;
    } else if (proteinScore < 0.6) {
      headline = `Protein averaging ${Math.round(avgProtein)}g — significantly below the ${proteinGoal}g needed to protect muscle during fat loss`;
      priority = `Today: log your first protein source before 9am`;
    } else {
      headline = `Training at ${weeklyTraining}/week over the last ${last14.length} days — consistency is the gap right now`;
      priority = `Schedule your next 3 workouts in your calendar today`;
    }
  }

  return reply({
    state,
    headline,
    priority,
    metrics: {
      avgProtein:    Math.round(avgProtein),
      proteinGoal,
      proteinPct:    Math.round(proteinScore * 100),
      avgCal:        Math.round(avgCal),
      lowCalDays,
      trainingDays,
      weeklyTraining,
      loggedDays:    last14.length,
    },
    scanDirection: muscleUp !== null ? { muscleUp, fatDown } : null,
    computedAt:    new Date().toISOString(),
  });
}

// ─── Scan Interval Analysis ───────────────────────────────────────────────────
// GET /api/scan-intervals — pure computation, personal cause-effect library
async function getScanIntervals(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);

  const [evoltRaw, fitbodRaw, fsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
  ]);

  const evolt      = JSON.parse(evoltRaw  || '[]').sort((a,b) => new Date(a.date)-new Date(b.date));
  const fitbod     = JSON.parse(fitbodRaw || '[]');
  const fuelstrong = JSON.parse(fsRaw     || '[]');

  if (evolt.length < 2) {
    return reply({
      intervals:   [],
      totalScans:  evolt.length,
      message: evolt.length === 0
        ? 'No scans yet — upload your Evolt PDFs in the Upload tab'
        : 'Upload your next Evolt scan to unlock interval analysis — this will show you exactly what worked and what didn\'t',
    });
  }

  const intervals = [];
  for (let i = 1; i < evolt.length; i++) {
    const prev = evolt[i-1], curr = evolt[i];
    const days = Math.round((new Date(curr.date) - new Date(prev.date)) / 86400000);

    const iNutrition = fuelstrong.filter(d => d.date > prev.date && d.date <= curr.date && ((d.protein||0)>0||(d.calories||0)>0));
    const avgProtein  = iNutrition.length ? Math.round(iNutrition.reduce((a,d) => a+(d.protein||0),0)/iNutrition.length) : null;
    const avgCal      = iNutrition.length ? Math.round(iNutrition.reduce((a,d) => a+(d.calories||0),0)/iNutrition.length) : null;
    const lowCalDays  = iNutrition.filter(d => (d.calories||0) < 1200).length;

    const iWorkouts = fitbod.filter(w => w.date > prev.date && w.date <= curr.date);
    const weeklyFreq = days > 0 ? parseFloat((iWorkouts.length / (days/7)).toFixed(1)) : null;
    const mgCounts   = {};
    iWorkouts.forEach(w => { (w.muscleGroupsWorked||[]).forEach(mg => { mgCounts[mg] = (mgCounts[mg]||0)+1; }); });
    const topGroups  = Object.entries(mgCounts).sort((a,b) => b[1]-a[1]).slice(0,4).map(e => `${e[0]}(${e[1]}×)`);

    const muscleChange = (curr.skeletalMuscleMass!=null&&prev.skeletalMuscleMass!=null) ? parseFloat((curr.skeletalMuscleMass-prev.skeletalMuscleMass).toFixed(1)) : null;
    const fatChange    = (curr.bodyFatPct!=null&&prev.bodyFatPct!=null)                 ? parseFloat((curr.bodyFatPct-prev.bodyFatPct).toFixed(1))                 : null;
    const weightChange = (curr.weight!=null&&prev.weight!=null)                         ? parseFloat((curr.weight-prev.weight).toFixed(1))                         : null;

    // Plain-language outcome classification
    let outcome = 'unknown', outcomeLabel = 'Unknown';
    if (muscleChange !== null && fatChange !== null) {
      if      (muscleChange > 0.2 && fatChange < -0.3) { outcome = 'recomp';       outcomeLabel = 'Recomp ✦';   }
      else if (muscleChange > 0.1)                      { outcome = 'building';     outcomeLabel = 'Building 💪'; }
      else if (fatChange < -0.3)                        { outcome = 'cutting';      outcomeLabel = 'Fat loss 📉'; }
      else if (muscleChange >= -0.3)                    { outcome = 'maintaining';  outcomeLabel = 'Holding 🔒'; }
      else                                              { outcome = 'muscle_loss';  outcomeLabel = 'Muscle loss ⚠️'; }
    }

    intervals.push({
      interval:    i,
      startDate:   prev.date,
      endDate:     curr.date,
      days,
      outcome,
      outcomeLabel,
      bodyComp: { muscleChange, fatChange, weightChange, muscleStart: prev.skeletalMuscleMass, muscleEnd: curr.skeletalMuscleMass, fatStart: prev.bodyFatPct, fatEnd: curr.bodyFatPct },
      nutrition: { avgProtein, avgCal, loggedDays: iNutrition.length, lowCalDays, coveragePct: days > 0 ? Math.round(iNutrition.length/days*100) : null },
      training:  { totalWorkouts: iWorkouts.length, weeklyFreq, topMuscleGroups: topGroups },
    });
  }

  return reply({ intervals, totalScans: evolt.length, computedAt: new Date().toISOString() });
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
      const check = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${file.path}`, { headers: githubHeaders(env) });
      if (check.ok) sha = (await check.json()).sha;
      const body = { message: `data: update ${file.path} ${new Date().toISOString().split('T')[0]}`, content: b64encode(file.content), ...(sha && { sha }) };
      const res  = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${file.path}`, { method: 'PUT', headers: githubHeaders(env), body: JSON.stringify(body) });
      results.push({ file: file.path, ok: res.ok, status: res.status });
    } catch (e) { results.push({ file: file.path, ok: false, error: e.message }); }
  }
  return reply({ backed_up: results });
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
    messages:   [{ role: 'user', content: `Estimate nutrition for one standard serving of: "${name}". Return ONLY: {"cal":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"serving":"description","confidence":"high|medium|low"}` }]
  });
  const raw   = resp.content?.[0]?.text || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return reply({ error: 'Could not parse' }, 500);
  try { return reply({ estimate: JSON.parse(match[0]) }); } catch { return reply({ error: 'Invalid JSON' }, 500); }
}

// ─── Insights GET ─────────────────────────────────────────────────────────────
async function getInsights(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const raw = await env.FUELSTRONG_KV.get('insights_cache').catch(() => null);
  if (!raw) return reply({ insights: [], generatedAt: null });
  return reply(JSON.parse(raw));
}

// ─── Insights POST ────────────────────────────────────────────────────────────
async function generateInsights(env) {
  if (!env.FUELSTRONG_KV)     return reply({ error: 'KV not bound' }, 500);
  if (!env.ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500);

  const [evoltRaw, fitbodRaw, fsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
  ]);

  const evolt      = JSON.parse(evoltRaw  || '[]');
  const fitbod     = JSON.parse(fitbodRaw || '[]');
  const fuelstrong = JSON.parse(fsRaw     || '[]');

  const hasData = evolt.length > 0 || fitbod.length > 0 || fuelstrong.length > 0;
  if (!hasData) return reply({ insights: [], generatedAt: new Date().toISOString(), insufficient_data: true, dataPoints: { evolt: 0, workouts: 0, nutrition: 0 } });

  const scanLines      = evolt.slice(-5).map(s => `${s.date}: weight=${s.weight}lbs bodyFat=${s.bodyFatPct}% muscle=${s.skeletalMuscleMass}lbs BMR=${s.bmr}kcal`).join('\n');
  const last4w         = fitbod.filter(s => (Date.now()-new Date(s.date+'T12:00:00'))/86400000 <= 28);
  const woFreq         = (last4w.length / 4).toFixed(1);
  const last14         = fuelstrong.slice(-14);
  const avgProtein     = last14.length ? Math.round(last14.reduce((a,d) => a+(d.protein||0),0)/last14.length) : null;
  const avgCal         = last14.length ? Math.round(last14.reduce((a,d) => a+(d.calories||0),0)/last14.length) : null;
  const nutLines       = last14.map(d => `${d.date}: ${d.protein}g protein | ${d.calories}kcal${d.flags?.trainingDay?' 💪':''}${d.flags?.injectionDay?' 💉':''}`).join('\n');

  const prompt = `You are analyzing fitness data for Hanna: 50-year-old woman on tirzepatide, body recomposition goal (build visible muscle + lose fat). Return ONLY valid JSON with no other text.

BODY COMPOSITION (Evolt scans):
${scanLines || 'No scans available'}

TRAINING (Fitbod): ${last4w.length} workouts in last 4 weeks (${woFreq}/week avg)

NUTRITION (last 14 days):
${nutLines || 'No data'}
Average: ${avgProtein !== null ? avgProtein+'g protein' : 'unknown'}, ${avgCal !== null ? avgCal+'kcal' : 'unknown'}

Return ONLY:
{"insights":[{"type":"muscle_gain_pattern|protein_pattern|hydration_pattern|energy_pattern|fat_loss_pattern|workout_consistency|recovery_pattern|tirzepatide_pattern","confidence":"high|medium|low","observation":"one specific sentence citing actual numbers","recommendation":"one concrete action"}]}

Rules: 3-5 insights max. Cite specific numbers. No generic advice. If data is insufficient, skip the insight entirely.`;

  let resp;
  try { resp = await callClaude(env, { model: 'claude-sonnet-4-6', max_tokens: 800, system: 'Return only valid JSON with no other text or markdown.', messages: [{ role: 'user', content: prompt }] }); }
  catch (e) { return reply({ error: 'Claude API error: ' + e.message }, 502); }

  const raw = resp.content?.[0]?.text || '{}';
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim()); }
  catch { return reply({ error: 'Insights parse error', raw }, 500); }

  const result = { insights: parsed.insights || [], generatedAt: new Date().toISOString(), dataPoints: { evolt: evolt.length, workouts: fitbod.length, nutrition: fuelstrong.length } };
  await env.FUELSTRONG_KV.put('insights_cache', JSON.stringify(result));
  return reply(result);
}

// ─── Performance Intelligence ─────────────────────────────────────────────────
async function getIntelligence(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);

  const [fsRaw, evoltRaw, goalsRaw, profGoalsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('goals').catch(() => null),
    env.FUELSTRONG_KV.get('profile_goals').catch(() => null),
  ]);

  const fuelstrong   = JSON.parse(fsRaw    || '[]');
  const evolt        = JSON.parse(evoltRaw || '[]');
  const goals        = profGoalsRaw ? JSON.parse(profGoalsRaw) : (goalsRaw ? JSON.parse(goalsRaw) : {});
  const proteinGoal  = goals.protein || 150;
  const last14       = fuelstrong.slice(-14);
  const proteinAdherence = last14.length ? Math.round(last14.filter(d => (d.protein||0) >= proteinGoal).length / last14.length * 100) : null;
  const last28       = fuelstrong.filter(d => (Date.now() - new Date(d.date+'T12:00:00')) / 86400000 <= 28);
  const trainingDays = last28.filter(d => d.flags?.trainingDay || (d.workouts||0) > 0).length;
  const trainingFrequency = last28.length >= 7 ? parseFloat((trainingDays / (last28.length/7)).toFixed(1)) : null;
  const latestScan   = evolt.length ? evolt[evolt.length-1] : null;
  const prevScan     = evolt.length > 1 ? evolt[evolt.length-2] : null;
  const muscleTrend  = (latestScan?.skeletalMuscleMass != null && prevScan?.skeletalMuscleMass != null) ? parseFloat((latestScan.skeletalMuscleMass - prevScan.skeletalMuscleMass).toFixed(2)) : null;
  const fatTrend     = (latestScan?.bodyFatPct != null && prevScan?.bodyFatPct != null)                 ? parseFloat((latestScan.bodyFatPct - prevScan.bodyFatPct).toFixed(2))                 : null;

  return reply({ proteinAdherence, trainingFrequency, muscleTrend, fatTrend, basedOn: { nutritionDays: last14.length, evoltScans: evolt.length, latestScan: latestScan?.date || null, prevScan: prevScan?.date || null } });
}

// ─── Daily day GET ────────────────────────────────────────────────────────────
async function getDailyDay(env, path) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const dateStr = path.replace('/api/daily/','').split('?')[0];
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return reply({ error: 'Invalid date format' }, 400);
  const raw = await env.FUELSTRONG_KV.get(`day_${dateStr}`).catch(() => null);
  if (raw) return reply({ ...JSON.parse(raw), exists: true });
  // Fallback: check today_live for devices still on old code
  // Don't check date — just use today_live if it has matching date field
  const live = await env.FUELSTRONG_KV.get('today_live').catch(() => null);
  if (live) {
    const liveData = JSON.parse(live);
    if (liveData.date === dateStr) return reply({ ...liveData, exists: true });
  }
  return reply({ exists: false });
}

// ─── Daily day PUT ────────────────────────────────────────────────────────────
async function putDailyDay(request, env, path) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const dateStr = path.replace('/api/daily/','').split('?')[0];
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return reply({ error: 'Invalid date format' }, 400);
  const body = await request.json().catch(() => null);
  if (!body) return reply({ error: 'Invalid JSON body' }, 400);

  await env.FUELSTRONG_KV.put(`day_${dateStr}`, JSON.stringify({ ...body, date: dateStr, savedAt: new Date().toISOString() }));

  // Mirror into fuelstrong array for coaching and history
  const existing = JSON.parse(await env.FUELSTRONG_KV.get('fuelstrong').catch(() => null) || '[]');
  const idx      = existing.findIndex(d => d.date === dateStr);
  const summary  = {
    date:     dateStr,
    protein:  Math.round((body.foodLog  || []).reduce((a,i) => a+(i.protein||0), 0)),
    calories: Math.round((body.foodLog  || []).reduce((a,i) => a+(i.calories||0), 0)),
    water:    Math.round((body.waterLog || []).reduce((a,w) => a+(w.oz||0), 0)),
    workouts: (body.workouts || []).length,
    flags:    body.flags || {},
    savedAt:  new Date().toISOString(),
  };
  if (idx >= 0) existing[idx] = summary; else existing.push(summary);
  existing.sort((a,b) => new Date(a.date)-new Date(b.date));
  await env.FUELSTRONG_KV.put('fuelstrong', JSON.stringify(existing));
  return reply({ success: true });
}

// ─── Food Library Sync ────────────────────────────────────────────────────────
// getKVKey/saveKVKey with key 'food_library' handle GET/POST via router above.

// ─── Search Food (Open Food Facts proxy) ─────────────────────────────────────
async function searchFood(request, env) {
  const url = new URL(request.url);
  const q   = url.searchParams.get('q') || '';
  if (!q.trim()) return reply({ products: [] });
  try {
    const offUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=product_name,brands,nutriments,serving_size,code`;
    const res    = await fetch(offUrl, { headers: { 'User-Agent': 'FuelStrong/1.0' } });
    const data   = await res.json();
    const products = (data.products || [])
      .filter(p => p.product_name && p.nutriments)
      .map(p => ({
        id:       'off_' + (p.code || Math.random().toString(36).slice(2)),
        name:     [p.product_name, p.brands].filter(Boolean).join(' — ').trim(),
        calories: Math.round(p.nutriments['energy-kcal_100g'] || p.nutriments['energy-kcal'] || 0),
        protein:  Math.round((p.nutriments.proteins_100g || 0) * 10) / 10,
        carbs:    Math.round((p.nutriments.carbohydrates_100g || 0) * 10) / 10,
        fat:      Math.round((p.nutriments.fat_100g || 0) * 10) / 10,
        fiber:    Math.round((p.nutriments.fiber_100g || 0) * 10) / 10,
        serving:  p.serving_size || '100g',
        source:   'off',
      }))
      .filter(p => p.calories > 0 || p.protein > 0);
    return reply({ products });
  } catch (e) {
    return reply({ products: [], error: e.message });
  }
}

// ─── Scan Label (AI nutrition extraction from photo) ──────────────────────────
async function scanLabel(request, env) {
  if (!env.ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  const body = await request.json().catch(() => ({}));
  const { imageBase64, mimeType = 'image/jpeg' } = body;
  if (!imageBase64) return reply({ error: 'imageBase64 required' }, 400);
  try {
    const res = await callClaude(env, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text',  text: 'Extract nutrition facts from this food label image. Respond ONLY with JSON: {"name":"product name or empty string","calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"serving":"serving size string","confidence":"high|medium|low"}. All numbers are per serving. If a value is not visible use 0.' }
        ]
      }]
    });
    const text    = res.content?.[0]?.text || '{}';
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const food    = JSON.parse(cleaned);
    return reply({ food });
  } catch (e) {
    return reply({ error: e.message }, 500);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function callClaude(env, body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const msgs = { 400:'Bad request — likely invalid model name. Valid: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5-20251001.', 401:'Invalid Anthropic API key — check ANTHROPIC_API_KEY in Worker secrets.', 402:'Anthropic account out of credits — add credits at console.anthropic.com/billing.', 429:'Rate limit hit — wait a moment and try again.', 529:'Quota exceeded — check console.anthropic.com/billing.', 500:'Anthropic internal error — try again.' };
    throw new Error(msgs[res.status] || `Anthropic API error ${res.status}`);
  }
  return res.json();
}

function githubHeaders(env) { return { 'Authorization': `token ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'FuelStrong-App/1.0' }; }
function reply(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
function safeJson(str) { try { return JSON.parse(str); } catch { return null; } }
function uid(prefix = '') { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,9)}`; }
function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
