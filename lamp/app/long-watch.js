const REPORT_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_INTERVAL_MS = 15 * 1000;
const STATS_TIMEOUT_MS = 8 * 1000;
const REPORT_RETRY_DELAYS_MS = [0, 2 * 1000, 5 * 1000, 15 * 1000];
const REPORT_SETTLE_BEFORE_READ_MS = 2500;
const API_BASE = 'https://long-watch.jrwittber.workers.dev/lamp';

const LAMP_ID_KEY = 'pl.longwatch.id';

function fallbackUuid() {
  const bytes = new Uint8Array(16);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join('')
  ].join('-');
}

function finiteNonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatDuration(ms) {
  const totalMinutes = Math.floor(finiteNonNegative(ms) / 60_000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (totalHours > 0) return `${totalHours}h`;
  return `${totalMinutes}m`;
}

export function formatWatchStats(stats, currentStreakMs) {
  const burning = Math.round(finiteNonNegative(stats?.burning));

  return {
    title: 'The Long Watch',
    burning: `${burning} ${burning === 1 ? 'lamp burns' : 'lamps burn'} tonight.`,
    longest: formatDuration(stats?.longestCurrentVigilMs),
    average: formatDuration(stats?.averageCurrentVigilMs),
    yours: formatDuration(currentStreakMs)
  };
}

export class LongWatch {
  constructor() {
    this.lampId = null;
    this.stats = null;
    this.lastFetchAt = 0;
    this.lastFetchSucceeded = false;
    this.lastReportAt = 0;
    this.lastReportedLitState = null;
    this.retryLitState = null;

    this.previousSnap = null;
    this.pendingStatsFetch = null;
    this.pendingStatsController = null;
    this.controllers = new Set();
    this.reportControllers = new Set();
    this.reportRetryWaits = new Map();
    this.pendingReport = null;
    this.reportGeneration = 0;
    this.destroyed = false;
    this.paused = false;

    this.getOrCreateLampId();
  }

  getOrCreateLampId() {
    if (this.lampId) return this.lampId;

    try {
      const saved = localStorage.getItem(LAMP_ID_KEY)?.trim();
      if (saved) {
        this.lampId = saved;
        return this.lampId;
      }
    } catch {}

    try {
      this.lampId = globalThis.crypto?.randomUUID?.() || fallbackUuid();
    } catch {
      this.lampId = fallbackUuid();
    }

    try {
      localStorage.setItem(LAMP_ID_KEY, this.lampId);
    } catch {}

    return this.lampId;
  }

  updateFromSnap(snap) {
    if (this.destroyed || this.paused || !snap || typeof snap !== 'object') return;

    const now = Date.now();
    const isLit = snap.isLit === true;
    const currentStreakMs = finiteNonNegative(snap.currentStreakMs);
    const previous = this.previousSnap;

    const litChanged = previous !== null && previous.isLit !== isLit;
    const initialLitReport = previous === null && isLit;
    const litStateNeedsReport = (
      (initialLitReport || litChanged) && this.lastReportedLitState !== isLit
    ) || this.retryLitState === isLit;
    const oilAdded = snap.oilAdded === true || (
      previous !== null &&
      finiteNonNegative(snap.oilMsRemaining) > previous.oilMsRemaining
    );
    const streakReset = previous !== null && currentStreakMs < previous.currentStreakMs;
    const periodicReport = isLit && now - this.lastReportAt >= REPORT_INTERVAL_MS;

    this.previousSnap = {
      isLit,
      currentStreakMs,
      oilMsRemaining: finiteNonNegative(snap.oilMsRemaining)
    };

    if (litStateNeedsReport || oilAdded || streakReset || periodicReport) {
      this.lastReportAt = now;
      this.lastReportedLitState = isLit;
      this.retryLitState = null;
      this.pendingReport = this._report(isLit, currentStreakMs, snap.oilMsRemaining);
    }
  }

  async _report(isLit, currentStreakMs, oilMsRemaining) {
    if (this.destroyed || this.paused) return false;

    const generation = ++this.reportGeneration;
    const body = JSON.stringify({
      id: this.getOrCreateLampId(),
      isLit,
      currentStreakMs: isLit ? Math.floor(currentStreakMs) : 0,
      oilMsRemaining: isLit ? Math.floor(finiteNonNegative(oilMsRemaining)) : 0
    });

    for (const delayMs of REPORT_RETRY_DELAYS_MS) {
      if (delayMs > 0) {
        await this._waitForReportRetry(delayMs, generation);
      }
      if (this.destroyed || this.paused || generation !== this.reportGeneration) {
        return false;
      }

      const controller = new AbortController();
      this.controllers.add(controller);
      this.reportControllers.add(controller);

      try {
        const response = await fetch(`${API_BASE}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal
        });
        if (!response.ok) throw new Error('Report was not accepted');
        if (generation === this.reportGeneration) this.lastFetchAt = 0;
        return true;
      } catch {
        if (this.destroyed || this.paused || generation !== this.reportGeneration) {
          return false;
        }
      } finally {
        this.controllers.delete(controller);
        this.reportControllers.delete(controller);
      }
    }

    if (generation === this.reportGeneration && this.lastReportedLitState === isLit) {
      this.lastReportedLitState = null;
      this.lastReportAt = 0;
      this.retryLitState = isLit;
    }
    return false;
  }

  _waitForReportRetry(delayMs, generation) {
    return new Promise(resolve => {
      const handle = setTimeout(() => {
        this.reportRetryWaits.delete(handle);
        resolve();
      }, delayMs);
      this.reportRetryWaits.set(handle, { resolve, generation });
    });
  }

  async settleLatestReport(maxWaitMs = REPORT_SETTLE_BEFORE_READ_MS) {
    const report = this.pendingReport;
    if (!report || maxWaitMs <= 0) return;

    let timeoutId;
    try {
      await Promise.race([
        report.catch(() => false),
        new Promise(resolve => {
          timeoutId = setTimeout(resolve, maxWaitMs);
        })
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchStats({ maxAgeMs = FETCH_INTERVAL_MS } = {}) {
    if (this.destroyed || this.paused) return this.getCachedStats();
    if (this.pendingStatsFetch) return this.pendingStatsFetch;

    const now = Date.now();
    if (now - this.lastFetchAt < Math.max(0, maxAgeMs)) {
      return this.lastFetchSucceeded ? this.getCachedStats() : null;
    }

    this.lastFetchAt = now;
    this.lastFetchSucceeded = false;
    const controller = new AbortController();
    this.controllers.add(controller);
    this.pendingStatsController = controller;
    const timeoutId = setTimeout(() => controller.abort(), STATS_TIMEOUT_MS);

    const request = (async () => {
      try {
        const response = await fetch(`${API_BASE}/watch`, { signal: controller.signal });
        if (!response.ok) throw new Error('Stats request was not accepted');

        const data = await response.json();
        const values = [
          data?.burning,
          data?.longestCurrentVigilMs,
          data?.averageCurrentVigilMs
        ];
        if (!values.every(Number.isFinite)) {
          throw new Error('Stats response was invalid');
        }

        this.stats = {
          burning: Math.round(finiteNonNegative(data?.burning)),
          longestCurrentVigilMs: Math.round(finiteNonNegative(data?.longestCurrentVigilMs)),
          averageCurrentVigilMs: Math.round(finiteNonNegative(data?.averageCurrentVigilMs))
        };
        this.lastFetchSucceeded = true;
        return this.getCachedStats();
      } catch {
        this.lastFetchAt = 0;
        return null;
      } finally {
        clearTimeout(timeoutId);
        this.controllers.delete(controller);
        if (this.pendingStatsController === controller) {
          this.pendingStatsController = null;
          this.pendingStatsFetch = null;
        }
      }
    })();
    this.pendingStatsFetch = request;

    return request;
  }

  getCachedStats() {
    return this.stats ? { ...this.stats } : null;
  }

  setPaused(paused) {
    const nextPaused = !!paused;
    if (nextPaused === this.paused) return;
    this.paused = nextPaused;
    if (!this.paused) return;

    const reportWasAborted = this.reportControllers.size > 0 || this.reportRetryWaits.size > 0;
    const statsWereAborted = this.pendingStatsController !== null;

    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.reportControllers.clear();
    for (const [handle, wait] of this.reportRetryWaits) {
      clearTimeout(handle);
      wait.resolve();
    }
    this.reportRetryWaits.clear();
    this.pendingStatsController = null;
    this.pendingStatsFetch = null;

    if (reportWasAborted) {
      this.reportGeneration++;
      this.lastReportedLitState = null;
      this.lastReportAt = 0;
      this.retryLitState = this.previousSnap?.isLit ?? null;
    }

    if (statsWereAborted) {
      this.lastFetchAt = 0;
      this.lastFetchSucceeded = false;
    }
  }

  destroy() {
    this.destroyed = true;
    this.reportGeneration++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.reportControllers.clear();
    for (const [handle, wait] of this.reportRetryWaits) {
      clearTimeout(handle);
      wait.resolve();
    }
    this.reportRetryWaits.clear();
    this.pendingStatsController = null;
    this.pendingStatsFetch = null;
    this.previousSnap = null;
  }
}
