
export class LampEngine {
  constructor({ key = 'pl', onChange = () => {} } = {}) {
    this.key = key;
    this.onChange = onChange;

    this.FULL_TANK_MS = 86_400_000;
    this.ADD_BLOCK_MS = 21_600_000;

    const def = {
      isLit: false,
      currentStreakMs: 0,
      bestStreakMs: 0,
      oilMsRemaining: 0,
      lastTickAt: null
    };

    this.state = def;

    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        let saved = null;
        try { saved = JSON.parse(raw); } catch {}

        const isPlainObject = saved && typeof saved === 'object' && !Array.isArray(saved);
        const safeNumber = (value, fallback = 0) =>
          Number.isFinite(value) && value >= 0 ? value : fallback;

        if (isPlainObject) {
          const oilMsRemaining = Math.min(
            safeNumber(saved.oilMsRemaining),
            this.FULL_TANK_MS
          );
          const isLit = saved.isLit === true && oilMsRemaining > 0;
          const now = Date.now();
          const lastTickAt = isLit &&
            Number.isFinite(saved.lastTickAt) &&
            saved.lastTickAt > 0 &&
            saved.lastTickAt <= now
              ? saved.lastTickAt
              : isLit ? now : null;

          this.state = {
            isLit,
            currentStreakMs: isLit ? safeNumber(saved.currentStreakMs) : 0,
            bestStreakMs: safeNumber(saved.bestStreakMs),
            oilMsRemaining,
            lastTickAt
          };
        }

        localStorage.setItem(this.key, JSON.stringify(this.state));
      }
    } catch {}

    this._tickId = null;
    this._paused = false;
  }

  persist() {
    try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch {}
  }

  _hasOil() {
    return (this.state.oilMsRemaining || 0) > 0;
  }

  _oilPct() {
    return Math.min(100, Math.round(((this.state.oilMsRemaining || 0) / this.FULL_TANK_MS) * 100));
  }

  _clampOil() {
    this.state.oilMsRemaining = Math.max(0, Math.min(this.state.oilMsRemaining || 0, this.FULL_TANK_MS));
  }

  _saveBestStreak() {
    if ((this.state.currentStreakMs || 0) > (this.state.bestStreakMs || 0)) {
      this.state.bestStreakMs = this.state.currentStreakMs;
    }
  }

  _reconcileBurn() {
    if (!this.state.isLit) return;

    const now = Date.now();
    const last = this.state.lastTickAt || now;
    const elapsed = Math.max(0, now - last);
    const oilLeft = this.state.oilMsRemaining || 0;
    const burn = Math.min(elapsed, oilLeft);

    this.state.oilMsRemaining = Math.max(0, oilLeft - burn);
    this.state.currentStreakMs = (this.state.currentStreakMs || 0) + burn;
    this.state.lastTickAt = now;

    if (this.state.oilMsRemaining <= 0) {
      this.state.oilMsRemaining = 0;
      this._saveBestStreak();
      this.state.isLit = false;
      this.state.currentStreakMs = 0;
      this.state.lastTickAt = null;
      this.stop();
    }

    this.persist();
  }

  addOil(amountMs = this.ADD_BLOCK_MS) {
    this._reconcileBurn();

    this.state.oilMsRemaining = (this.state.oilMsRemaining || 0) + Math.max(0, amountMs | 0);
    this._clampOil();

    this.persist();
    this.emit({ oilAdded: true });

    if (this.state.isLit) this.start();
  }

  light() {
    this._reconcileBurn();

    if (this.state.isLit) return;
    if (!this._hasOil()) return;

    const now = Date.now();

    this.state.isLit = true;
    this.state.currentStreakMs = 0;
    this.state.lastTickAt = now;

    this.persist();
    this.emit();
    this.start();
  }

  extinguish(reason = 'manual') {
    if (!this.state.isLit) return;

    this._reconcileBurn();
    this._saveBestStreak();

    const now = Date.now();

    this.state.isLit = false;
    this.state.currentStreakMs = 0;
    this.state.lastTickAt = null;

    this.persist();
    this.emit({ diedAt: now, reason });
    this.stop();
  }

  migrateFromExpiry(oilExpiresAtLike) {
    const now = Date.now();
    const ms = Math.max(0, (oilExpiresAtLike || 0) - now);

    this.state.oilMsRemaining = ms;
    this._clampOil();

    this.persist();
    this.emit({ migrated: true });
  }

  reset() {
    this.state = {
      isLit: false,
      currentStreakMs: 0,
      bestStreakMs: 0,
      oilMsRemaining: 0,
      lastTickAt: null
    };

    this.persist();
    this.emit();
    this.stop();
  }

  start() {
    if (!this.state.isLit || this._paused) return;
    if (this._tickId) return;

    const schedule = () => {
      this._tickId = setTimeout(step, this._nextTickDelay());
    };

    const step = () => {
      this._tickId = null;
      if (!this.state.isLit) {
        this.stop();
        return;
      }

      this._reconcileBurn();
      this.emit({ reconcile: false });

      if (!this.state.isLit) return;

      schedule();
    };

    schedule();
  }

  _nextTickDelay() {
    const minute = 60_000;
    const oilRemaining = Math.max(0, this.state.oilMsRemaining || 0);
    const streak = Math.max(0, this.state.currentStreakMs || 0);
    const untilOilMinute = oilRemaining % minute || minute;
    const untilStreakMinute = minute - (streak % minute || 0);

    return Math.max(250, Math.min(
      minute,
      oilRemaining || minute,
      untilOilMinute,
      untilStreakMinute
    ));
  }

  setPaused(paused) {
    const nextPaused = !!paused;
    if (nextPaused === this._paused) return;

    this._paused = nextPaused;

    if (this._paused) {
      this._reconcileBurn();
      this.stop();
      return;
    }

    if (this.state.isLit) {
      this._reconcileBurn();
      this.emit({ reconcile: false });
      this.start();
    }
  }

  stop() {
    if (this._tickId) clearTimeout(this._tickId);
    this._tickId = null;
  }

  get timeToTendMs() {
    if (!this.state.isLit) return null;
    return Math.max(0, this.state.oilMsRemaining || 0);
  }

  emit(extra = {}) {
    const { reconcile = true, ...event } = extra;

    if (reconcile) this._reconcileBurn();

    const snap = {
      ...this.state,
      hasOil: this._hasOil(),
      oilPct: this._oilPct(),
      currentStreakMs: this.state.currentStreakMs || 0,
      timeToTendMs: this.timeToTendMs,
      ...event
    };

    this.onChange(snap);
    return snap;
  }
}

export const fmtHm = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

export const tendBy = (msLeft) => {
  if (msLeft == null) return '';
  const t = new Date(Date.now() + msLeft);
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
