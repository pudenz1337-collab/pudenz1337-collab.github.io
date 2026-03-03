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
      if (path === '/api/coach'   && method === 'GET')    return getKVKey(env, 'last_coaching');
      if (path === '/api/backup'  && method === 'POST')   return backupToGitHub(env);
      if (path === '/api/goals'   && method === 'POST')   return saveKVKey(request, env, 'goals');
      if (path === '/api/context' && method === 'POST')   return saveKVKey(request, env, 'coach_context');
      if (path === '/api/context' && method === 'GET')    return getKVKey(env, 'coach_context');
      if (path === '/api/profile'  && method === 'GET')    return getProfile(env);
      if (path === '/api/profile'  && method === 'POST')   return saveProfile(request, env);
      if (path === '/api/live'     && method === 'GET')    return getKVKey(env, 'today_live');
      if (path === '/api/live'     && method === 'POST')   return saveKVKey(request, env, 'today_live');
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
      model: 'claude-opus-4-6',
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

// ─── Profile (goals, tirz, custom foods, pins) ─────────────────────────────────
async function getProfile(env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const [goalsRaw, tirzRaw, customRaw, pinsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('profile_goals').catch(() => null),
    env.FUELSTRONG_KV.get('profile_tirz').catch(() => null),
    env.FUELSTRONG_KV.get('profile_custom_foods').catch(() => null),
    env.FUELSTRONG_KV.get('profile_food_pins').catch(() => null),
  ]);
  return reply({
    goals:       goalsRaw ? JSON.parse(goalsRaw) : null,
    tirz:        tirzRaw  ? JSON.parse(tirzRaw)  : null,
    customFoods: customRaw ? JSON.parse(customRaw) : null,
    foodPins:    pinsRaw  ? JSON.parse(pinsRaw)  : null,
  });
}

async function saveProfile(request, env) {
  if (!env.FUELSTRONG_KV) return reply({ error: 'KV not bound' }, 500);
  const body = await request.json().catch(() => ({}));
  const ops = [];
  if (body.goals       !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_goals',       JSON.stringify(body.goals)));
  if (body.tirz        !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_tirz',        JSON.stringify(body.tirz)));
  if (body.customFoods !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_custom_foods', JSON.stringify(body.customFoods)));
  if (body.foodPins    !== undefined) ops.push(env.FUELSTRONG_KV.put('profile_food_pins',    JSON.stringify(body.foodPins)));
  await Promise.all(ops);
  return reply({ success: true });
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

  const [evoltRaw, fitbodRaw, fuelstrongRaw, goalsRaw, contextRaw, liveRaw, profGoalsRaw] = await Promise.all([
    env.FUELSTRONG_KV.get('evolt').catch(() => null),
    env.FUELSTRONG_KV.get('fitbod').catch(() => null),
    env.FUELSTRONG_KV.get('fuelstrong').catch(() => null),
    env.FUELSTRONG_KV.get('goals').catch(() => null),
    env.FUELSTRONG_KV.get('coach_context').catch(() => null),
    env.FUELSTRONG_KV.get('today_live').catch(() => null),
    env.FUELSTRONG_KV.get('profile_goals').catch(() => null),
  ]);

  const evolt      = JSON.parse(evoltRaw      || '[]');
  const fitbod     = JSON.parse(fitbodRaw     || '[]');
  const fuelstrong = JSON.parse(fuelstrongRaw || '[]');
  // profile_goals takes precedence over legacy goals key
  const goals      = profGoalsRaw ? JSON.parse(profGoalsRaw) : (goalsRaw ? JSON.parse(goalsRaw) : (body.goals || {}));
  const savedCtx   = contextRaw ? JSON.parse(contextRaw) : {};
  // today_live from KV — supplement/override with client-sent data
  const liveKV     = liveRaw ? JSON.parse(liveRaw) : {};
  const context    = savedCtx.context || body.context || '';
  const woSummary  = body.workoutSummary || null;
  const mode       = body.mode || 'dashboard';

  // New context fields from Phase 1 rebuild
  const supplements  = body.supplements  || '';
  const tirzepatide  = body.tirzepatide  || {};
  const measurements = body.measurements || [];
  const sessionLogs  = body.sessionLogs  || [];

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

  // ── Supplement/tirzepatide/measurement context ──
  const suppBlock = supplements ? `\nSupplement stack: ${supplements}` : '';

  let tirzBlock = '';
  if (tirzepatide?.dose || tirzepatide?.day !== undefined) {
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const injDay = tirzepatide.day !== '' ? parseInt(tirzepatide.day) : null;
    const todayDow = new Date().getDay();
    const daysAgo = injDay !== null ? ((todayDow - injDay) + 7) % 7 : null;
    tirzBlock = `\nTirzepatide: ${tirzepatide.dose ? tirzepatide.dose+'mg' : ''}${injDay!==null?' injected '+dayNames[injDay]:''}${tirzepatide.weeks?' ('+tirzepatide.weeks+' weeks on current dose)':''}${daysAgo!==null?' — '+daysAgo+' days since last injection':''}`;
  }

  const measBlock = measurements.length
    ? `\nRecent body measurements (inches): ${measurements.map(m =>
        `${m.date}: waist=${m.waist}"${m.hips?' hips='+m.hips+'"':''}${m.arm?' arm='+m.arm+'"':''}`
      ).join(' | ')}`
    : '';

  const sessionBlock = sessionLogs.length
    ? `\nRecent session logs: ${sessionLogs.map(s =>
        `${s.date}: feel=${s.feel||'?'}/5, RPE=${s.rpe||'?'}/10${s.note?' ('+s.note+')':''}`
      ).join(' | ')}`
    : '';

  // ── Base system prompt ──
  const baseSystem = `You are a direct, evidence-based fitness coach specializing in body recomposition — building visible muscle while simultaneously reducing body fat. You coach Hanna, a 50-year-old woman who:

PROFILE:
- 5'5", peri/post-menopausal (affects muscle building rate and fat distribution)
- On tirzepatide (GLP-1/GIP agonist) — suppresses appetite significantly, can make hitting protein targets challenging
- Takes creatine daily — NOTE: creatine causes 2-4 lb water retention in muscle tissue, which inflates BIA body fat % readings and inflates lean mass on scans. This is NOT actual muscle gain, it is intracellular water.
- Uses Evolt 360 BIA scanner — BIA accuracy depends on hydration. Results fluctuate 2-4% based on time of day, hydration, recent eating. Compare TRENDS not individual scans.
- Uses Fitbod (progressive overload workouts), FuelStrong (nutrition tracking)
- GOAL: Preserve and build skeletal muscle while losing fat mass — "body recomp"
${goalsBlock}${contextBlock}${tirzBlock}${suppBlock}${measBlock}${sessionBlock}

EVIDENCE-BASED COACHING RULES (no myths, no broscience):
1. PROTEIN: 0.7-1.0g per lb of bodyweight is evidence-supported for muscle retention during a deficit. Higher end (~1g/lb) when in caloric deficit and training hard.
2. MUSCLE BUILDING REALITY: Women over 50 build muscle more slowly. 0.25-0.5 lbs of ACTUAL muscle per month is realistic and excellent. Do not set unrealistic expectations.
3. SCALE WEIGHT is NOT a good metric for body recomp — reframe toward skeletal muscle mass % and fat mass lbs from scans, plus measurements
4. TIRZEPATIDE + MUSCLE: GLP-1 agonists reduce appetite — this is useful for fat loss but can lead to inadequate protein intake and muscle loss if not managed. Priority: hit protein goal even when not hungry.
5. CREATINE + BIA SCANS: When interpreting Evolt data, note that creatine causes water retention in muscle that inflates lean mass readings by 2-4 lbs and can temporarily show higher body fat % due to increased total mass. This is beneficial (fuller muscles, better performance) not negative.
6. DEFICIT DEPTH: 300-500 kcal/day deficit is optimal for fat loss while preserving muscle. More aggressive = faster muscle loss, slower recovery, worse workouts.
7. TRAINING SPECIFICITY: Progressive overload is the driver of muscle retention/growth — weight going up over time matters. Track this trend, not just whether she trained.
8. AVOID MYTHS: Do not recommend "muscle turns to fat," "toning vs building," "cardio burns muscle," "eat less move more is all that matters," or "detoxes/cleanses." Use specific mechanisms.
9. Format responses with clear emoji-headed sections: 🧠 Overall Analysis, 💪 Training, 🥗 Nutrition, 🎯 Top 3 Priorities`;

  // ── Mode-specific prompt ──
  let userMsg, systemAddition = '';

  if (mode === 'dashboard') {
    // Include per-week muscle group breakdown from client
    const workoutDetail = body.workoutDetail || null;
    const weeklyBreakdown = workoutDetail?.weekLines?.length
      ? `\nPer-week muscle breakdown (last 8 weeks):\n${workoutDetail.weekLines.join('\n')}\nAll-time muscle frequency: ${workoutDetail.muscleRanking}`
      : '';

    systemAddition = `
You are the Performance & Pattern Coach inside FuelStrong Progress. Your job is to connect the dots across Fitbod workouts, Evolt body composition scans, and FuelStrong nutrition data — not just summarize each in isolation. Every key finding must tie at least two data sources together.

RESPONSE STRUCTURE — use these exact emoji headers in this order:

**🧠 Big Picture** (1–2 sentences)
Honest overall trajectory. Direct and specific. Example: "You're in solid recomposition — muscle is holding while fat trends down, but leg volume is the consistent gap week over week."

**📊 Pattern Findings** (4–6 bullets citing actual numbers)
Tie cause to effect explicitly across data sources:
• Between scans [date] → [date], you trained [X]×/week — skeletal muscle changed [result]
• Training days averaged [X]g protein vs rest days [Y]g — [what that means for muscle]
• [Muscle group] sees [X] sessions/week vs [other group] [Y] — [over/undertrained conclusion]
• BMR changed [X]→[Y] kcal — signal of [muscle health / intake / deficit depth]
• Weeks with [pattern] lined up with [outcome]; lower weeks → [other outcome]
Connect them explicitly: "High volume + near-target protein → [result]. Low volume + low protein → [result]."

**💪 Workout-Focused Coaching** (3–5 specific actions)
Lead with training. Nutrition and recovery framed as support only:
• Which muscle groups need more work and why (cite actual volume data from Fitbod)
• Whether to push volume or deload (cite streak length, fatigue signals, consistency trend)
• Pre/post-workout nutrition adjustment based on patterns you see across the data
• Frequency or load tweak based on the cross-dataset trend
• GLP-1 specific adjustments if relevant (injection day timing, low-appetite protein strategies)
Keep actions small and implementable. Not a full program rewrite.

**🎯 Why This Matters** (1–2 sentences)
Link these tweaks explicitly to what the next Evolt scan should show.

**📅 Check Back When**
One sentence: after next Evolt scan, or after X weeks of this adjustment.

TONE: Direct, coach-like, encouraging but not vague. Specific numbers over reassurance. Cause-and-effect over theory. Bullets not paragraphs. Start directly with Big Picture — no preamble, no date stamps, no dividers.`;

    userMsg = `Generate my coaching dashboard.\n\nEvolt Scans (chronological):\n${evoltLines}\nOverall change: ${evoltDelta}\n\nWorkout Analytics:\n${woLines}${weeklyBreakdown}\n\nNutrition (last 14 days from FuelStrong):\n${nutritionLines}`;

  } else if (mode === 'fuelstrong_daily') {
    // Merge KV live data with client-sent data (client wins for freshness)
    const hemEntries   = body.hemLog     || liveKV.hemLog     || [];
    const mealLog      = body.mealLog    || liveKV.mealLog    || {};
    const todayProtein = body.protein    ?? liveKV.protein    ?? 0;
    const todayCal     = body.calories   ?? liveKV.calories   ?? 0;
    const todayWater   = body.water      ?? liveKV.water      ?? 0;
    const currentTime  = body.currentTime || new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const todayPlan    = body.dayPlan    || liveKV.dayPlan    || 'not set';
    const wo           = body.workoutTime || liveKV.workoutTime || null;
    const woStart      = body.workoutStart || liveKV.workoutStart || null;
    const woEnd        = body.workoutEnd   || liveKV.workoutEnd   || null;
    const woDuration   = body.workoutDuration || liveKV.workoutDuration || null;
    const woStatus     = body.workoutStatus   || liveKV.workoutStatus   || 'planned';
    const msgHistory   = body.history || []; // conversation history for multi-turn

    // Build H-E-M timeline
    const hemTimeline = hemEntries.length
      ? hemEntries.map(e => {
          const hLabel = e.h === 1 ? 'H1(not hungry)' : e.h === 2 ? 'H2(moderate)' : e.h === 3 ? 'H3(very hungry)' : '';
          const eLabel = e.e === 1 ? 'E1(low)' : e.e === 2 ? 'E2(moderate)' : e.e === 3 ? 'E3(high)' : '';
          const mLabel = e.m === 1 ? 'M1(low)' : e.m === 2 ? 'M2(ok)' : e.m === 3 ? 'M3(good)' : '';
          return `${e.time}: ${[hLabel,eLabel,mLabel].filter(Boolean).join(' ')}${e.note?' — '+e.note:''}`;
        }).join(' | ')
      : 'No H-E-M logged yet';

    // Build full meal log with times and protein
    const mealOrder = ['Breakfast','Morning Snack','Lunch','Afternoon Snack','Dinner','Evening Snack'];
    const mealLines = mealOrder.flatMap(meal => {
      const items = mealLog[meal] || [];
      if (!items.length) return [];
      const mealP = Math.round(items.reduce((a,i)=>a+i.protein,0));
      const mealC = items.reduce((a,i)=>a+i.cal,0);
      const firstTime = items[0]?.time || '';
      return [`${meal}${firstTime?' ('+firstTime+')':''}: ${mealP}g protein, ${mealC}kcal — ${items.map(i=>(i.displayName||i.name)+'('+i.protein+'g P)').join(', ')}`];
    });
    const mealSummary = mealLines.length ? mealLines.join('\n') : 'No meals logged yet';

    // Workout status block
    let woBlock = '';
    if (woStatus === 'complete' && woStart && woEnd) {
      woBlock = `Workout: COMPLETE — started ${new Date(woStart).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}, ended ${new Date(woEnd).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}, duration ${woDuration} min`;
    } else if (woStatus === 'active' && woStart) {
      const elapsed = Math.round((Date.now() - woStart) / 60000);
      woBlock = `Workout: IN PROGRESS — started ${new Date(woStart).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}, ${elapsed} min so far`;
    } else if (wo) {
      woBlock = `Workout: PLANNED for ${wo}`;
    } else {
      woBlock = 'No workout scheduled today';
    }

    // Historical averages
    const recentDays = fuelstrong.slice(-14);
    const avgP   = recentDays.length ? Math.round(recentDays.reduce((a,d)=>a+d.protein,0)/recentDays.length) : null;
    const avgCal = recentDays.length ? Math.round(recentDays.reduce((a,d)=>a+(d.calories||0),0)/recentDays.length) : null;
    const proteinGoal = goals.protein || 150;
    const calGoal     = goals.cal     || 1800;
    const waterGoal   = goals.water   || 80;

    systemAddition = `
You are coaching Hanna in real-time throughout the day using the check-in format below. Keep it conversational — like a coach texting her.

RESPONSE FORMAT (follow exactly every time):
1. **Status** (1-2 sentences): Where she is in the day and how she's tracking.
2. **Snapshot** (3-4 bullets): Current protein vs goal, water vs goal, workout status, one body comp trend note if relevant.
3. **What This Means** (2-3 sentences): Connect the numbers to her muscle-building and fat-loss goals in plain language.
4. **Next Steps** (2-4 specific actions for the next 2-4 hours): Use her actual logged foods. Name specific items she has available.
5. **Check Back When**: One sentence telling her when to update you (after workout, after dinner, etc.)

Keep responses SHORT and direct. No long paragraphs. Coach texting style.
If she asks a follow-up question, answer it directly, then give updated next steps.`;

    const systemData = `
TODAY'S DATA (${currentTime}):
Protein: ${todayProtein}g / ${proteinGoal}g goal
Calories: ${todayCal} / ${calGoal} kcal goal
Water: ${todayWater}oz / ${waterGoal}oz goal
Plan: ${todayPlan}
${woBlock}

MEALS LOGGED:
${mealSummary}

H-E-M TIMELINE (H=Hunger, E=Energy, M=Mood all scale 1-3):
${hemTimeline}

TIRZEPATIDE:
Dose: ${tirzepatide.dose||'unknown'}mg | Days since injection: ${tirzepatide.daysPostInjection !== null ? tirzepatide.daysPostInjection : 'unknown'}

14-DAY AVERAGES: Protein ${avgP||'no data'}g/day | Calories ${avgCal||'no data'}/day

EVOLT TREND:
${evoltLines}`;

    // Build message history for conversational coaching
    const messages = [...msgHistory];
    if (messages.length === 0) {
      // First message — inject all data as context
      userMsg = `${systemData}

Give me my coaching check-in.`;
    } else {
      // Follow-up — add fresh data header + new question
      const lastUserMsg = body.question || 'Update my coaching based on current data.';
      userMsg = `[Data update at ${currentTime}]
Protein: ${todayProtein}g / ${proteinGoal}g | Water: ${todayWater}oz | ${woBlock}
Latest HEM: ${hemEntries.length ? hemEntries[hemEntries.length-1] : 'none'}
Meals: ${mealLines.join('; ') || 'none yet'}

${lastUserMsg}`;
    }

  } else if (mode === 'ask') {
    systemAddition = '\nAnswer the specific question directly and specifically. Use actual numbers from the data. Keep it to 3-5 sentences. Coach texting style.';
    // Include today context if provided
    const todayCtx = body.todayContext || '';
    userMsg = `${todayCtx ? 'TODAY: '+todayCtx+'\n\n' : ''}Evolt Scans:\n${evoltLines}\nDelta: ${evoltDelta}\n\nWorkout Analytics:\n${woLines}\n\nNutrition:\n${nutritionLines}\n\nQuestion: ${question}`;

  } else if (mode === 'body') {
    systemAddition = '\nFocus: Deep dive into body composition trends only. What do the Evolt numbers mean? What is the trajectory? What specific behaviors are driving changes? End with: "Your Top 3 Body Composition Priorities."';
    userMsg = `Analyze my body composition data in depth.\n\nEvolt Scans:\n${evoltLines}\nOverall delta: ${evoltDelta}\n\nNutrition (last 14 days):\n${nutritionLines}`;

  } else if (mode === 'training') {
    systemAddition = '\nFocus: Deep analysis of training quality for muscle building. Analyze rep ranges, exercise selection, consistency, recovery, progressive overload. End with: "Your Top 3 Training Adjustments."';
    userMsg = `Analyze my training data in depth.\n\nWorkout Analytics:\n${woLines}\n\nBody Composition Impact:\n${evoltDelta}\n\nMuscle trend:\n${evolt.slice(-6).map(s=>`${s.date}: ${s.skeletalMuscleMass}lbs muscle`).join(', ')}`;

  } else {
    // full (legacy)
    systemAddition = '\nFull synthesis: Connect ALL three data sources. What story do the numbers tell together? Where is she winning? What is the most important thing to fix? End with: "Your Top 3 Priorities Right Now."';
    userMsg = `Full coaching analysis.\n\nEvolt Scans:\n${evoltLines}\nOverall change: ${evoltDelta}\n\nWorkout Analytics:\n${woLines}\n\nNutrition (last 14 days):\n${nutritionLines}`;
  }

  // Build messages array — support conversation history for daily coaching
  let messagesArr;
  if (mode === 'fuelstrong_daily' && body.history && body.history.length > 0) {
    messagesArr = [...body.history, { role: 'user', content: userMsg }];
  } else {
    messagesArr = [{ role: 'user', content: userMsg }];
  }

  const resp = await callClaude(env, {
    model: 'claude-sonnet-4-6',
    max_tokens: mode === 'dashboard' ? 1600 : 1200,
    system: baseSystem + systemAddition,
    messages: messagesArr
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
      400: 'Bad request to Anthropic — likely an invalid model name. Valid models: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5-20251001.',
      401: 'Invalid Anthropic API key — check ANTHROPIC_API_KEY in Worker secrets. Make sure you set the secret (not just a variable) in the Cloudflare dashboard.',
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
