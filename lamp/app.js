import { LampEngine } from './engine.js';
import { Flame } from './flame.js';
import { LongWatch, formatWatchStats } from './long-watch.js';

const $ = (s, r = document) => r.querySelector(s);

const statusEl       = $('#status');
const addOilBtn      = $('#add-oil');
const lightBtn       = $('#light');
const extinguishBtn  = $('#extinguish');
const baseImg        = document.querySelector('.lamp-base');
const flameMount     = document.querySelector('.flame-mount');
const lampScene      = document.querySelector('.lamp-scene');

const gearBtn        = $('#settingsBtn');
const modal          = $('#modal');
const baseSel        = $('#base');
const colorSel       = $('#color');
const resetBtn       = $('#reset');
const lockNote       = $('#lock-note');
const fullscreenBtn  = $('#fullscreenBtn');
const bestStreakEl   = $('#best-streak');
const longWatchEl       = $('#long-watch');
const longWatchBurning  = $('#long-watch-burning');
const longWatchLongest  = $('#long-watch-longest');
const longWatchAverage  = $('#long-watch-average');
const unlitPrompt    = $('#unlit-prompt');
const extinguishConfirm = $('#extinguish-confirm');
const extinguishConfirmStreak = $('#extinguish-confirm-streak');
const keepBurningBtn = $('#keep-burning');
const confirmExtinguishBtn = $('#confirm-extinguish');
const resetConfirm = $('#reset-confirm');
const cancelResetBtn = $('#cancel-reset');
const confirmResetBtn = $('#confirm-reset');

const vesselChoices  = [...document.querySelectorAll('.vessel-choice')];
const flameChoices   = [...document.querySelectorAll('.flame-choice')];

const UI_KEY = 'pl.ui';
const DEF_UI = { baseId: 'base-01', colorId: 'amber' };
const VALID_BASE_IDS = new Set(['base-01', 'base-02', 'base-03', 'base-04']);
const VALID_COLOR_IDS = new Set(['amber', 'blue', 'green', 'purple']);
const CONFIRM_EXTINGUISH_AFTER_MS = 300_000;
let ui = { ...DEF_UI };
let lit = false;
let hasOil = false;
let oilPct = 0;
let uiTimer = null;
let wasLit = false;
let lastFocusedEl = null;
let latestSnap = null;
let longWatchRequestId = 0;
let pageFrozen = false;
let pageVisible = !document.hidden;
let activeBaseReady = false;
let activeBaseLoadId = 0;

const baseImages = [
  'base-01.png',
  'base-02.png',
  'base-03.png',
  'base-04.png',
];
let alternateBasesLoaded = false;

function preloadAlternateBases() {
  if (alternateBasesLoaded) return;
  alternateBasesLoaded = true;

  baseImages
    .filter(src => !src.includes(ui.baseId))
    .forEach(src => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    });
}

function isLoadedImage(img) {
  return !!img && img.complete && img.naturalWidth > 0;
}

function setBaseVisualReady(ready) {
  activeBaseReady = !!ready;
  document.body.classList.toggle('base-ready', activeBaseReady);

  if (flame) {
    flame.setLit(activeBaseReady && lit);
    flame.setPaused(!activeBaseReady || !isPageActive());
  }

  if (activeBaseReady) {
    updateLampEffectBoundary();
    if (lit) refreshVignettePosition();
    updateVisualActivity();
  }
}

function waitForActiveBaseImage() {
  const loadId = ++activeBaseLoadId;
  setBaseVisualReady(false);

  if (isLoadedImage(baseImg)) {
    setBaseVisualReady(true);
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const finish = () => {
      if (loadId !== activeBaseLoadId) return;
      baseImg.removeEventListener('load', finish);
      baseImg.removeEventListener('error', finish);
      setBaseVisualReady(isLoadedImage(baseImg));
      resolve();
    };

    baseImg.addEventListener('load', finish, { once: true });
    baseImg.addEventListener('error', finish, { once: true });
  });
}

const BASE_BACKGROUNDS = {
  'base-01': 'dust',
  'base-02': 'monolith',
  'base-03': 'dust',
  'base-04': 'ash'
};

function applyBackgroundForBase(baseId) {
  const bgId = BASE_BACKGROUNDS[baseId] || 'ash';
  if (lampScene) lampScene.dataset.bg = bgId;
}

const FLAME_TINGE = {
  amber:  { hex: '#ff8b3d', rgb: '255 139 61' },
  blue:   { hex: '#2f7dff', rgb: '47 125 255' },
  green:  { hex: '#2dac5d', rgb: '45 172 93' },
  purple: { hex: '#7a55ff', rgb: '122 85 255' }
};

['gesturestart', 'gesturechange', 'gestureend'].forEach(evt => {
  document.addEventListener(evt, e => e.preventDefault());
});

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const vignettePositionTimers = new Set();

function isPageActive() {
  return pageVisible && !pageFrozen;
}

function setVignetteStrength(v) {
  const clamped = Math.max(0.88, Math.min(1.025, v));
  document.documentElement.style.setProperty('--vig-strength', clamped.toFixed(3));
}

function handleFlameIntensity(intensity) {
  if (!activeBaseReady || !lit || reducedMotionQuery.matches || !isPageActive()) return;
  const lightResponse = 1.015 - (intensity - 0.58) * 0.16;
  setVignetteStrength(lightResponse);
}

function startFlicker() {
  if (!activeBaseReady || reducedMotionQuery.matches || !isPageActive()) {
    stopFlicker();
  }
}

function stopFlicker() {
  setVignetteStrength(1);
}

function loadUI() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;

    ui = {
      baseId: VALID_BASE_IDS.has(saved.baseId) ? saved.baseId : DEF_UI.baseId,
      colorId: VALID_COLOR_IDS.has(saved.colorId) ? saved.colorId : DEF_UI.colorId
    };
  } catch {}
}

function saveUI() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {}
}

function fmtBestStreak(ms) {
  const totalMinutes = Math.floor((ms || 0) / 60000);

  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days <= 0) return `${totalHours}h`;
  if (hours === 0) return `${days}d`;

  return `${days}d ${hours}h`;
}

function fmtRemaining(ms) {
  if (ms == null || ms <= 0) return '';
  const ONE_H = 3600000;

  if (ms < ONE_H) {
    const mins = Math.ceil(ms / 60000);
    return `${mins}m left`;
  }

  const hrs = Math.ceil(ms / ONE_H);
  return `${hrs}h left`;
}

function fmtStreakHours(ms) {
  const totalHours = Math.floor((ms || 0) / 3600000);

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days <= 0) return `${hours}h vigil`;
  if (hours === 0) return `${days}d vigil`;

  return `${days}d ${hours}h vigil`;
}

function buildStatusText(snap) {
  if (snap.isLit) {
    const remaining = fmtRemaining(snap.timeToTendMs);
    const streak    = fmtStreakHours(snap.currentStreakMs);
    return [remaining, streak].filter(Boolean).join('  •  ');
  }

  return snap.hasOil ? 'Light the flame' : 'The lamp is empty';
}

function updateVignetteTint(colorId) {
  const tint = FLAME_TINGE[colorId] || FLAME_TINGE.amber;
  document.documentElement.style.setProperty('--vig-color', tint.hex);
  document.documentElement.style.setProperty('--vig-rgb', tint.rgb);
}

function updateLampEffectBoundary() {
  if (!baseImg) return window.innerHeight;

  const baseRect = baseImg.getBoundingClientRect();
  const boundary = Math.max(0, baseRect.bottom);
  const root = document.documentElement;

  root.style.setProperty('--lamp-effect-bottom', `${boundary}px`);

  if (flameMount) {
    const flameRect = flameMount.getBoundingClientRect();
    const overflowBottom = Math.max(0, flameRect.bottom - baseRect.bottom);
    flameMount.style.setProperty('--lamp-flame-overflow-bottom', `${overflowBottom}px`);
  }

  return boundary;
}

function updateVignettePosition() {
  if (!flameMount || !lampScene) return;

  const flameRect = flameMount.getBoundingClientRect();
  const sceneRect = lampScene.getBoundingClientRect();
  updateLampEffectBoundary();

  const cx = flameRect.left + flameRect.width / 2;
  const cy = flameRect.top + flameRect.height * 0.3;

  const radius = sceneRect.height * 0.82;
  const inner = sceneRect.height * 0.36;
  const mid = sceneRect.height * 0.54;

  const root = document.documentElement;

  root.style.setProperty('--vig-x', `${cx}px`);
  root.style.setProperty('--vig-y', `${cy}px`);
  root.style.setProperty('--vig-radius', `${radius}px`);
  root.style.setProperty('--vig-inner', `${inner}px`);
  root.style.setProperty('--vig-mid', `${mid}px`);
}

function refreshVignettePosition() {
  if (!activeBaseReady || !lit || !isPageActive()) return;

  clearVignettePositionTimers();

  updateVignettePosition();

  const frameWork = { type: 'frame', handle: null };
  frameWork.handle = requestAnimationFrame(() => {
    vignettePositionTimers.delete(frameWork);
    if (isPageActive()) updateVignettePosition();
  });
  vignettePositionTimers.add(frameWork);

  [100, 300, 700].forEach(delay => {
    const timerWork = { type: 'timer', handle: null };
    timerWork.handle = setTimeout(() => {
      vignettePositionTimers.delete(timerWork);
      if (isPageActive()) updateVignettePosition();
    }, delay);
    vignettePositionTimers.add(timerWork);
  });
}

function clearVignettePositionTimers() {
  for (const work of vignettePositionTimers) {
    if (work.type === 'frame') cancelAnimationFrame(work.handle);
    else clearTimeout(work.handle);
  }
  vignettePositionTimers.clear();
}

let flame = null;
const longWatch = new LongWatch();

const engine = new LampEngine({
  key: 'pl',
  onChange: (snap) => {
    latestSnap = snap;
    lit = snap.isLit;
    hasOil = !!snap.hasOil;
    oilPct = snap.oilPct ?? 0;

    const becameLit = snap.isLit && !wasLit;
    const becameUnlit = !snap.isLit && wasLit;

    document.body.classList.toggle('lit', snap.isLit);

    if (!snap.isLit) {
      document.body.classList.remove('ui-hidden');
    }

    if (flame && snap.isLit !== wasLit) {
      flame.setLit(activeBaseReady && snap.isLit);
    }

    if (becameLit && activeBaseReady) {
      refreshVignettePosition();
      startFlicker();
    } else if (becameUnlit) {
      stopFlicker();
    }

    statusEl.textContent = buildStatusText(snap);

    if (bestStreakEl) {
      const visibleBest = Math.max(
        snap.bestStreakMs || 0,
        snap.currentStreakMs || 0
      );

      bestStreakEl.textContent = fmtBestStreak(visibleBest);
    }

    addOilBtn.disabled     = oilPct >= 100;
    addOilBtn.textContent  = oilPct >= 100 ? 'Full' : 'Add oil';

    lightBtn.disabled      = !(hasOil && !lit);
    extinguishBtn.disabled = !lit;

    setSettingsLock(lit);
    wasLit = snap.isLit;
    longWatch.updateFromSnap(snap);
  }
});

function setSettingsLock(isLit) {
  const locked = !!isLit;

  baseSel.disabled = locked;
  colorSel.disabled = locked;

  lockNote.style.display = locked ? 'block' : 'none';
  updateChoiceState();
}

function getFocusableInDialog(dialog) {
  return [...dialog.querySelectorAll(
    'button:not([disabled]), select:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.offsetParent !== null || el === document.activeElement);
}

function focusFirstModalControl() {
  const controls = getFocusableInDialog(modal);
  const preferred = controls.find(el => el.classList.contains('vessel-choice')) ||
                    controls.find(el => el.classList.contains('flame-choice')) ||
                    controls.find(el => el.id === 'reset') ||
                    controls[0];
  if (preferred) preferred.focus({ preventScroll: true });
}

function trapDialogFocus(e, dialog) {
  if (e.key !== 'Tab') return;

  const controls = getFocusableInDialog(dialog);
  if (!controls.length) {
    e.preventDefault();
    return;
  }

  const first = controls[0];
  const last = controls[controls.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function renderLongWatch(stats, { loading = false } = {}) {
  const personalBestMs = Math.max(
    latestSnap?.bestStreakMs || 0,
    latestSnap?.currentStreakMs || 0
  );

  longWatchEl.hidden = false;

  if (loading) {
    longWatchBurning.textContent = 'Listening for other lamps…';
    longWatchLongest.textContent = '—';
    longWatchAverage.textContent = '—';
    return;
  }

  if (!stats) {
    longWatchBurning.textContent = 'The wider watch is unavailable.';
    longWatchLongest.textContent = '—';
    longWatchAverage.textContent = '—';
    return;
  }

  if ((stats?.burning || 0) === 0) {
    longWatchBurning.textContent = 'Other lamps are quiet.';
    longWatchLongest.textContent = '—';
    longWatchAverage.textContent = '—';
    return;
  }

  const formatted = formatWatchStats(stats, personalBestMs);
  longWatchBurning.textContent = formatted.burning;
  longWatchLongest.textContent = formatted.longest;
  longWatchAverage.textContent = formatted.average;
}

async function refreshLongWatchStats() {
  const requestId = ++longWatchRequestId;
  const cachedStats = longWatch.getCachedStats();
  renderLongWatch(cachedStats, { loading: !cachedStats });

  try {
    await longWatch.settleLatestReport();
    const stats = await longWatch.fetchStats();
    if (requestId === longWatchRequestId) renderLongWatch(stats || cachedStats);
  } catch {
    if (requestId === longWatchRequestId) renderLongWatch(cachedStats);
  }
}

function openModal() {
  lastFocusedEl = document.activeElement;
  document.body.classList.remove('ui-hidden');
  modal.classList.remove('hidden');
  preloadAlternateBases();

  updateVisualActivity();

  requestAnimationFrame(focusFirstModalControl);
  refreshLongWatchStats();
}

function closeModal({ restoreFocus = true } = {}) {
  if (modal.classList.contains('hidden')) return;

  modal.classList.add('hidden');

  if (restoreFocus && lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
    lastFocusedEl.focus({ preventScroll: true });
  }

  lastFocusedEl = null;

  updateVisualActivity();

  showUI();
}

function handleModalKeydown(e) {
  if (!resetConfirm.classList.contains('hidden')) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeResetConfirm();
      return;
    }

    trapDialogFocus(e, resetConfirm);
    return;
  }

  if (!extinguishConfirm.classList.contains('hidden')) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeExtinguishConfirm();
      return;
    }

    trapDialogFocus(e, extinguishConfirm);
    return;
  }

  if (modal.classList.contains('hidden')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal();
    return;
  }

  trapDialogFocus(e, modal);
}

function openResetConfirm() {
  document.body.classList.remove('ui-hidden');
  resetConfirm.classList.remove('hidden');
  requestAnimationFrame(() => cancelResetBtn.focus({ preventScroll: true }));
}

function closeResetConfirm({ restoreFocus = true } = {}) {
  if (resetConfirm.classList.contains('hidden')) return;

  resetConfirm.classList.add('hidden');
  if (restoreFocus) resetBtn.focus({ preventScroll: true });
}

function openExtinguishConfirm() {
  document.body.classList.remove('ui-hidden');
  extinguishConfirmStreak.textContent = fmtStreakHours(latestSnap?.currentStreakMs);
  extinguishConfirm.classList.remove('hidden');

  updateVisualActivity();

  requestAnimationFrame(() => keepBurningBtn.focus({ preventScroll: true }));
}

function closeExtinguishConfirm({ restoreFocus = true } = {}) {
  if (extinguishConfirm.classList.contains('hidden')) return;

  extinguishConfirm.classList.add('hidden');

  if (restoreFocus) extinguishBtn.focus({ preventScroll: true });
  updateVisualActivity();

  showUI();
}

function updateChoiceState() {
  vesselChoices.forEach(btn => {
    const selected = btn.dataset.base === ui.baseId;
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    btn.disabled = lit;
  });

  flameChoices.forEach(btn => {
    const selected = btn.dataset.color === ui.colorId;
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    btn.disabled = lit;
  });
}

function showUI() {
  document.body.classList.remove('ui-hidden');

  if (uiTimer) clearTimeout(uiTimer);

  if (!lit || !isPageActive()) return;
  if (!modal.classList.contains('hidden')) return;
  if (!extinguishConfirm.classList.contains('hidden')) return;

  uiTimer = setTimeout(() => {
    uiTimer = null;
    const focused = document.activeElement;
    if (focused?.matches(':focus-visible') && focused.closest('.ui-layer')) return;

    document.body.classList.add('ui-hidden');
  }, 5000);
}

function bindUIFade() {
  ['mousemove', 'mousedown', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, showUI, { passive: true });
  });

  document.addEventListener('focusin', showUI);
  document.addEventListener('focusout', showUI);
}

function wire() {
  addOilBtn.addEventListener('click', () => {
    engine.addOil();
  });

  fullscreenBtn.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request was not completed.', err);
    }
  });
  document.addEventListener('fullscreenchange', updateFullscreenLabel);

  lightBtn.addEventListener('click', () => engine.light());
  extinguishBtn.addEventListener('click', () => {
    if ((latestSnap?.currentStreakMs || 0) < CONFIRM_EXTINGUISH_AFTER_MS) {
      engine.extinguish('manual');
      return;
    }

    openExtinguishConfirm();
  });

  keepBurningBtn.addEventListener('click', () => closeExtinguishConfirm());
  confirmExtinguishBtn.addEventListener('click', () => {
    closeExtinguishConfirm({ restoreFocus: false });
    engine.extinguish('manual');
  });
  extinguishConfirm.addEventListener('click', (e) => {
    if (e.target === extinguishConfirm) closeExtinguishConfirm();
  });

  gearBtn.addEventListener('click', openModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', handleModalKeydown);

  vesselChoices.forEach(btn => {
    btn.addEventListener('click', () => {
      if (lit) return;

      ui.baseId = btn.dataset.base;
      baseSel.value = ui.baseId;
      setBaseVisualReady(false);
      baseImg.src = `./${ui.baseId}.png`;

      applyBackgroundForBase(ui.baseId);
      if (flame) flame.setBase(ui.baseId);

      saveUI();
      updateChoiceState();
      waitForActiveBaseImage();
    });
  });

  flameChoices.forEach(btn => {
    btn.addEventListener('click', () => {
      if (lit) return;

      ui.colorId = btn.dataset.color;
      colorSel.value = ui.colorId;

      if (flame) flame.setColor(ui.colorId);
      updateVignetteTint(ui.colorId);

      saveUI();
      updateChoiceState();
    });
  });

  resetBtn.addEventListener('click', openResetConfirm);
  cancelResetBtn.addEventListener('click', () => closeResetConfirm());
  resetConfirm.addEventListener('click', (e) => {
    if (e.target === resetConfirm) closeResetConfirm();
  });
  confirmResetBtn.addEventListener('click', () => {
    closeResetConfirm({ restoreFocus: false });
    ui = { ...DEF_UI };
    saveUI();

    baseSel.value = ui.baseId;
    colorSel.value = ui.colorId;
    setBaseVisualReady(false);
    baseImg.src = `./${ui.baseId}.png`;

    applyBackgroundForBase(ui.baseId);

    if (flame) {
      flame.setBase(ui.baseId);
      flame.setColor(ui.colorId);
      flame.setLit(false);
    }

    updateVignetteTint(ui.colorId);
    engine.reset();
    updateChoiceState();
    waitForActiveBaseImage();
  });
}

function updateFullscreenLabel() {
  const label = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  fullscreenBtn.setAttribute('aria-label', label);
  fullscreenBtn.title = label;
}

function handleReducedMotionChange() {
  if (reducedMotionQuery.matches) {
    stopFlicker();
  } else if (activeBaseReady && lit && isPageActive()) {
    startFlicker();
  }
}

function hasOpenDialog() {
  return !modal.classList.contains('hidden') ||
    !resetConfirm.classList.contains('hidden') ||
    !extinguishConfirm.classList.contains('hidden');
}

function updateVisualActivity() {
  const visualsPaused = !activeBaseReady || !isPageActive() || hasOpenDialog();
  if (flame) flame.setPaused(visualsPaused);

  if (visualsPaused || !lit) {
    stopFlicker();
  } else {
    startFlicker();
  }
}

function syncPageActivity() {
  const active = isPageActive();
  document.body.classList.toggle('app-inactive', !active);

  longWatch.setPaused(!active);
  engine.setPaused(!active);

  if (!active) {
    longWatchRequestId++;
    if (uiTimer) clearTimeout(uiTimer);
    uiTimer = null;
    clearVignettePositionTimers();
    updateVisualActivity();
    return;
  }

  updateVisualActivity();
  refreshVignettePosition();
  if (latestSnap) longWatch.updateFromSnap(latestSnap);
  if (!modal.classList.contains('hidden')) refreshLongWatchStats();
  showUI();
}

function bindPageLifecycle() {
  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    syncPageActivity();
  });

  window.addEventListener('pagehide', () => {
    pageFrozen = true;
    syncPageActivity();
  });

  window.addEventListener('pageshow', () => {
    pageFrozen = false;
    pageVisible = !document.hidden;
    syncPageActivity();
  });

  document.addEventListener('freeze', () => {
    pageFrozen = true;
    syncPageActivity();
  });

  document.addEventListener('resume', () => {
    pageFrozen = false;
    pageVisible = !document.hidden;
    syncPageActivity();
  });
}

function init() {
  loadUI();

  baseSel.value = ui.baseId;
  colorSel.value = ui.colorId;
  updateChoiceState();

  setBaseVisualReady(false);
  baseImg.src = `./${ui.baseId}.png`;
  applyBackgroundForBase(ui.baseId);
  waitForActiveBaseImage();

  updateVignetteTint(ui.colorId);

  flame = new Flame(flameMount, {
    colorId: ui.colorId,
    baseId: ui.baseId,
    onIntensity: handleFlameIntensity
  });
  flame.setPaused(!activeBaseReady || !isPageActive());

  wire();

  const reposition = () => {
    updateLampEffectBoundary();
    if (lit) refreshVignettePosition();
  };

  baseImg.addEventListener('load', reposition);
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);
  window.addEventListener('orientationchange', reposition);
  document.addEventListener('fullscreenchange', reposition);
  bindPageLifecycle();
  syncPageActivity();

  const snap = engine.emit();

  if (!snap.isLit) {
    unlitPrompt.hidden = false;
  }

  if (snap.isLit) {
    engine.start();
  }

  setSettingsLock(snap.isLit);

  bindUIFade();
  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
  } else {
    reducedMotionQuery.addListener(handleReducedMotionChange);
  }
  updateFullscreenLabel();
  showUI();
  syncPageActivity();
}

init();
