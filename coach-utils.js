/**
 * coach-utils.js — FuelStrong Shared Coaching Utilities
 *
 * Loaded by both index.html (Tracker) and progress.html (Progress).
 * Provides shared request locking, history normalization,
 * message deduplication, and thread rendering.
 *
 * Each app still owns its own payload builder because the available
 * data differs (Tracker has live food/HEM/workout; Progress has Evolt/Fitbod).
 * These utilities handle everything that must be identical between apps.
 */

'use strict';

// ─── Request lock ─────────────────────────────────────────────────────────────
// A single shared flag. Both apps import this module, so within one page
// context there is exactly one coachLock object.
const coachLock = {
  _busy: false,
  acquire() {
    if (this._busy) {
      console.log('[CoachUtils] Lock acquisition failed — already busy');
      return false;
    }
    this._busy = true;
    console.log('[CoachUtils] Lock acquired');
    return true;
  },
  release() {
    this._busy = false;
    console.log('[CoachUtils] Lock released');
  },
  get busy() { return this._busy; },
};

// ─── Spinner control ──────────────────────────────────────────────────────────
/**
 * Show or hide a spinner element by ID.
 * Never throws — if the element doesn't exist, silently skips.
 */
function setSpinner(elementId, visible) {
  const el = document.getElementById(elementId);
  if (el) {
    el.style.display = visible ? 'block' : 'none';
    console.log(`[CoachUtils] Spinner #${elementId} → ${visible ? 'visible' : 'hidden'}`);
  }
}

// ─── History normalization ────────────────────────────────────────────────────
/**
 * Convert a stored thread array to the format the Worker expects.
 *   stored role 'coach' → 'assistant'
 *   stored role 'user'  → 'user'
 *   strips 'time' sentinel entries
 * Returns the last `limit` messages (default 16).
 */
function normalizeCoachHistory(thread, limit = 16) {
  return thread
    .filter(m => m.role !== 'time')
    .map(m => ({
      role:    m.role === 'coach' ? 'assistant' : 'user',
      content: m.content,
    }))
    .slice(-limit);
}

// ─── Duplicate response guard ─────────────────────────────────────────────────
/**
 * Returns true if `text` is identical to the last coach/assistant message
 * in `thread`. Use this before appending a new coach reply.
 */
function isDuplicateCoachMessage(thread, text) {
  const lastCoach = [...thread].reverse().find(m => m.role === 'coach' || m.role === 'assistant');
  if (lastCoach && lastCoach.content === text) {
    console.log('[CoachUtils] Duplicate coach message suppressed');
    return true;
  }
  return false;
}

// ─── Thread rendering helpers ─────────────────────────────────────────────────
/**
 * Append a single message to the visible thread DOM and to the in-memory array.
 * Does NOT persist to localStorage — the caller handles that.
 *
 * @param {HTMLElement} threadEl   - The container element
 * @param {string}      role       - 'coach' | 'user'
 * @param {string}      text       - Message content
 * @param {string}      time       - Formatted time string
 * @param {Function}    mdToHtml   - App-local markdown renderer
 * @param {Function}    escHtml    - App-local HTML escaper
 */
function renderCoachMessage(threadEl, role, text, time, mdToHtml, escHtml) {
  if (!threadEl) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  if (role === 'user') {
    div.innerHTML = `<div class="chat-bubble-user">${escHtml(text)}</div>`;
  } else {
    div.innerHTML = `<div class="chat-time">${time}</div><div class="chat-bubble-coach">${mdToHtml(text)}</div>`;
  }
  threadEl.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Re-render up to `maxVisible` most recent messages from `thread` into `threadEl`.
 * Shows a "↑ N earlier messages" hint if the thread is longer.
 * Clears existing DOM content first.
 */
function renderThreadWindow(threadEl, thread, maxVisible, mdToHtml, escHtml) {
  if (!threadEl) return;
  // Remove all children except elements with an id (e.g. thread-empty, coach-empty)
  Array.from(threadEl.children).forEach(c => { if (!c.id) c.remove(); });

  const hidden  = Math.max(0, thread.length - maxVisible);
  const visible = thread.slice(-maxVisible);

  if (hidden > 0) {
    const hint = document.createElement('div');
    hint.style.cssText = 'text-align:center;font-size:11px;color:var(--muted);padding:6px 0 2px';
    hint.textContent = `↑ ${hidden} earlier message${hidden > 1 ? 's' : ''} (cleared from view)`;
    threadEl.appendChild(hint);
  }

  visible.forEach(msg => {
    renderCoachMessage(threadEl, msg.role, msg.content, msg.time || '', mdToHtml, escHtml);
  });
}

// ─── Weekly coaching gate ─────────────────────────────────────────────────────
/**
 * Returns the ISO date string of the most recent Friday on or before `now`.
 * Used as the de-duplication key for weekly coaching sessions.
 */
function thisWeekFridayISO(now = new Date()) {
  const dow = now.getDay(); // 0=Sun … 5=Fri … 6=Sat
  const daysSinceFriday = (dow + 7 - 5) % 7; // 0 if today is Fri
  const friday = new Date(now);
  friday.setDate(now.getDate() - daysSinceFriday);
  return friday.toISOString().split('T')[0];
}

/**
 * Returns true if a weekly coaching session should fire:
 *   - Today is Friday after 8pm, Saturday, or Sunday
 *   - The weekly key stored in localStorage doesn't match this week's Friday
 *
 * Call this at coach-tab open time. If it returns true, fire the weekly mode
 * and call markWeeklyDone() to prevent repeat runs.
 *
 * @param {string} storageKey - e.g. 'fs3-weekly-date'
 */
function shouldRunWeeklyCoaching(storageKey) {
  const now = new Date();
  const dow  = now.getDay();
  const hour = now.getHours();

  const eligible =
    (dow === 5 && hour >= 20) || // Friday after 8pm
    dow === 6 ||                  // Saturday
    dow === 0;                    // Sunday

  if (!eligible) return false;

  const fridayISO  = thisWeekFridayISO(now);
  const lastWeekly = localStorage.getItem(storageKey);
  return lastWeekly !== fridayISO;
}

/**
 * Store this week's Friday ISO as the "already ran" marker.
 */
function markWeeklyDone(storageKey) {
  const fridayISO = thisWeekFridayISO();
  localStorage.setItem(storageKey, fridayISO);
  console.log(`[CoachUtils] Weekly coaching marked done for week of ${fridayISO}`);
}

// ─── Exports (script-tag compatible — attached to window) ────────────────────
window.CoachUtils = {
  coachLock,
  setSpinner,
  normalizeCoachHistory,
  isDuplicateCoachMessage,
  renderCoachMessage,
  renderThreadWindow,
  thisWeekFridayISO,
  shouldRunWeeklyCoaching,
  markWeeklyDone,
};
