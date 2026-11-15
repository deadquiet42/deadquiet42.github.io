const τ = Math.PI * 2;
const deg2rad = d => d * Math.PI / 180;
const rad2deg = r => r * 180 / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrapRad = r => ((r % τ) + τ) % τ;
const wrapSym = r => ((r + Math.PI) % τ + τ) % τ - Math.PI;
const westernPulseDuration = 4;

const AppLifecycle = (() => {
  let visible = !document.hidden;
  let frozen = false;
  let active = visible;
  const listeners = new Set();

  function sync() {
    const next = visible && !frozen;
    document.body.classList.toggle("app-inactive", !next);
    if (next === active) return;
    active = next;
    for (const listener of listeners) listener(active);
  }

  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    sync();
  });
  window.addEventListener("pagehide", () => {
    frozen = true;
    sync();
  });
  window.addEventListener("pageshow", () => {
    frozen = false;
    visible = !document.hidden;
    sync();
  });
  document.addEventListener("freeze", () => {
    frozen = true;
    sync();
  });
  document.addEventListener("resume", () => {
    frozen = false;
    visible = !document.hidden;
    sync();
  });

  sync();
  return {
    isActive: () => active,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
})();

const SafeStorage = {
  warn(operation, key) { try { console.warn(`Soluna storage ${operation} failed for key "${key}"`); } catch {} },
  get(key) { try { return localStorage.getItem(key); } catch { this.warn("read", key); return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { this.warn("write", key); } }
};

const Prefs = (() => {
  const key = "soluna_prefs_v5";
  const defaults = { lat: null, lon: null, source: "fallback" };
  function load() {
    try {
      const saved = JSON.parse(SafeStorage.get(key) || "{}");
      const prefs = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
      const validLat = Number.isFinite(prefs.lat) && prefs.lat >= -90 && prefs.lat <= 90;
      const validLon = Number.isFinite(prefs.lon) && prefs.lon >= -Math.PI && prefs.lon <= Math.PI;
      const validGps = prefs.source === "gps" && validLat && validLon;
      return {
        ...prefs,
        lat: validGps ? prefs.lat : defaults.lat,
        lon: validGps ? prefs.lon : defaults.lon,
        source: validGps ? "gps" : defaults.source
      };
    } catch {
      return { ...defaults };
    }
  }
  function save(p) { SafeStorage.set(key, JSON.stringify(p)); }
  return { load, save };
})();

function jdFromUTC(date) {
  let Y = date.getUTCFullYear();
  let M = date.getUTCMonth() + 1;
  const seconds = date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;
  const D = date.getUTCDate() + (date.getUTCHours() + (date.getUTCMinutes() + seconds / 60) / 60) / 24;
  if (M <= 2) { Y -= 1; M += 12; }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + D + B - 1524.5;
}
function deltaTSeconds(y) {
  if (y < 1900) { const u = (y - 1820) / 100; return -20 + 32 * u * u; }
  if (y < 1920) {
    const t = y - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y < 1941) {
    const t = y - 1920;
    return 21.20 + 0.84493 * t - 0.0761 * t * t + 0.0020936 * t ** 3;
  }
  if (y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547;
  }
  if (y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718;
  }
  if (y < 2005) {
    const t = y - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3
      + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (y < 2050) { const u = y - 2000; return 62.92 + 0.32217 * u + 0.005589 * u * u; }
  if (y < 2150) {
    const u = (y - 1820) / 100;
    return -20 + 32 * u * u - 0.5628 * (2150 - y);
  }
  const u = (y - 1820) / 100; return -20 + 32 * u * u;
}
// UTC is kept within 0.9 s of UT1, so Delta T (TT - UT1) is the useful
// dependency-free approximation to TT - UTC here.
function ttFromUTC(JDutc, yearFraction) { return JDutc + deltaTSeconds(yearFraction) / 86400; }
function centuriesFromJ2000(JDtt) { return (JDtt - 2451545.0) / 36525; }

function sunApparent(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M  = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const Mr = deg2rad(M);
  const C  = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
           + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
           + 0.000289 * Math.sin(3 * Mr);
  const trueLong = L0 + C;
  const Omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(deg2rad(Omega));
  const eps0_arcsec = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
  const eps = eps0_arcsec / 3600 + 0.00256 * Math.cos(deg2rad(Omega));
  const lam = deg2rad(lambda);
  const epsr = deg2rad(eps);
  const alpha = wrapRad(Math.atan2(Math.cos(epsr) * Math.sin(lam), Math.cos(lam)));
  const delta = Math.asin(Math.sin(epsr) * Math.sin(lam));
  return { alpha, delta, epsilon: epsr, lambda: lam };
}
function moonApparent(T, epsilon) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T * T * T / 538841 - T * T * T * T / 65194000;
  const D  = 297.8501921 + 445267.1114034  * T - 0.0018819 * T * T + T * T * T / 545868 - T * T * T * T / 113065000;
  const M  = 357.5291092 + 35999.0502909   * T - 0.0001536 * T * T + T * T * T / 24490000;
  const Mp = 134.9633964 + 477198.8675055  * T + 0.0087414 * T * T + T * T * T / 69699  - T * T * T * T / 14712000;
  const F  =  93.2720950 + 483202.0175233  * T - 0.0036539 * T * T - T * T * T / 3526000 + T * T * T * T / 863310000;

  const d = deg2rad((D % 360 + 360) % 360);
  const m = deg2rad((M % 360 + 360) % 360);
  const mp= deg2rad((Mp% 360 + 360) % 360);
  const f = deg2rad((F % 360 + 360) % 360);
  const Lpr= deg2rad((Lp% 360 + 360) % 360);

  let lambda = Lpr
    + deg2rad( 6.289) * Math.sin(mp)
    + deg2rad( 1.274) * Math.sin(2*d - mp)
    + deg2rad( 0.658) * Math.sin(2*d)
    + deg2rad( 0.214) * Math.sin(2*mp)
    - deg2rad( 0.186) * Math.sin(m)
    - deg2rad( 0.114) * Math.sin(2*f)
    + deg2rad( 0.059) * Math.sin(2*d - 2*mp)
    + deg2rad( 0.057) * Math.sin(2*d - m - mp)
    + deg2rad( 0.053) * Math.sin(2*d + mp)
    + deg2rad( 0.046) * Math.sin(2*d - m)
    + deg2rad( 0.041) * Math.sin(m - mp)
    + deg2rad( 0.035) * Math.sin(d)
    - deg2rad( 0.030) * Math.sin(m + mp);

  let beta =
      deg2rad( 5.128) * Math.sin(f)
    + deg2rad( 0.280) * Math.sin(mp + f)
    + deg2rad( 0.277) * Math.sin(mp - f)
    + deg2rad( 0.173) * Math.sin(2*d - f)
    + deg2rad( 0.055) * Math.sin(2*d + f)
    + deg2rad( 0.046) * Math.sin(2*d - mp + f)
    + deg2rad( 0.033) * Math.sin(2*d - mp - f)
    + deg2rad( 0.017) * Math.sin(2*mp + f);

  const eps = epsilon;
  const sinlam = Math.sin(lambda), coslam = Math.cos(lambda);
  const sinbet = Math.sin(beta),   cosbet = Math.cos(beta);

  const x = cosbet * coslam;
  const y = cosbet * sinlam * Math.cos(eps) - sinbet * Math.sin(eps);
  const z = cosbet * sinlam * Math.sin(eps) + sinbet * Math.cos(eps);

  const alpha = wrapRad(Math.atan2(y, x));
  const delta = Math.asin(z);

  return { alpha, delta, lambda };
}

function phaseAndIllum(sun, moon) {
  const cospsi = Math.sin(sun.delta) * Math.sin(moon.delta)
               + Math.cos(sun.delta) * Math.cos(moon.delta) * Math.cos(wrapSym(moon.alpha - sun.alpha));
  const psi = Math.acos(clamp(cospsi, -1, 1));
  const illum = (1 - Math.cos(psi)) / 2;
  const phase = wrapRad(moon.lambda - sun.lambda);
  const waxing = phase < Math.PI;
  return { psi, phase, illum, waxing };
}
function phaseName(phase) {
  const primaryWindow = deg2rad(6);
  const quarterWindow = deg2rad(0.5);
  const near = (target, window) => (
    Math.abs(wrapSym(phase - target)) <= window + Number.EPSILON * 8
  );
  if (near(0, primaryWindow)) return "New";
  if (near(Math.PI / 2, quarterWindow)) return "First quarter";
  if (near(Math.PI, primaryWindow)) return "Full";
  if (near(3 * Math.PI / 2, quarterWindow)) return "Last quarter";
  if (phase < Math.PI / 2) return "Waxing crescent";
  if (phase < Math.PI) return "Waxing gibbous";
  if (phase < 3 * Math.PI / 2) return "Waning gibbous";
  return "Waning crescent";
}

function gmstDegrees(JDutc, T) {
  return (280.46061837
    + 360.98564736629 * (JDutc - 2451545.0)
    + 0.000387933 * T * T
    - (T * T * T) / 38710000);
}
function gastRadians(JDutc, T) {
  const omega = deg2rad(125.04 - 1934.136 * T);
  const eps = deg2rad(23.439291 - 0.0130042 * T);
  const equationOfEquinoxes = -0.00478 * Math.sin(omega) * Math.cos(eps);
  return wrapRad(deg2rad(gmstDegrees(JDutc, T) + equationOfEquinoxes));
}
function localSolarNoonUTC(guessDateUTC, lonRadians) {
  const stepMinutes = 30;
  function alphaAt(dateUTC) {
    const JD = jdFromUTC(dateUTC);
    const yfrac = dateUTC.getUTCFullYear() + (dateUTC.getUTCMonth() + 1 - 0.5) / 12;
    const JDtt = ttFromUTC(JD, yfrac);
    const T = centuriesFromJ2000(JDtt);
    return sunApparent(T).alpha;
  }
  function hourAngle(dateUTC) {
    const JD = jdFromUTC(dateUTC);
    const yfrac = dateUTC.getUTCFullYear() + (dateUTC.getUTCMonth() + 1 - 0.5) / 12;
    const JDtt = ttFromUTC(JD, yfrac);
    const T = centuriesFromJ2000(JDtt);
    const gast = gastRadians(JD, T);
    const alpha = sunApparent(T).alpha;
    return wrapSym(gast + lonRadians - alpha);
  }
  const t0 = new Date(guessDateUTC);
  const H = hourAngle(t0);
  const tPlus = new Date(t0.getTime() + stepMinutes * 60000);
  const tMinus = new Date(t0.getTime() - stepMinutes * 60000);
  const adot = wrapSym(alphaAt(tPlus) - alphaAt(tMinus)) / (2 * stepMinutes * 60);
  const omegaSid = 1.00273790935 * τ / 86400;
  const dt = -H / (omegaSid - adot);
  const t1 = new Date(t0.getTime() + dt * 1000);
  const H1 = hourAngle(t1);
  if (Math.abs(H1) > deg2rad(0.0003)) {
    const t1p = new Date(t1.getTime() + stepMinutes * 60000);
    const t1m = new Date(t1.getTime() - stepMinutes * 60000);
    const adot1 = wrapSym(alphaAt(t1p) - alphaAt(t1m)) / (2 * stepMinutes * 60);
    const dt1 = -H1 / (omegaSid - adot1);
    return new Date(t1.getTime() + dt1 * 1000);
  }
  return t1;
}
function solarNoonWindow(nowUTC, lonRadians) {
  // Start near mean local noon. A fixed 12:00 UTC guess sits on hour-angle's
  // wrap boundary at the antimeridian and can map two dates to the same noon.
  const meanNoon = Date.UTC(nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(), nowUTC.getUTCDate(), 12)
    - lonRadians / τ * 86400000;
  const candidates = [-2, -1, 0, 1, 2]
    .map(day => localSolarNoonUTC(new Date(meanNoon + day * 86400000), lonRadians))
    .sort((a,b)=>a-b);
  const ms = nowUTC.getTime();
  let prev = candidates[0], next = candidates[candidates.length - 1];
  for (const candidate of candidates) {
    if (candidate.getTime() <= ms) prev = candidate;
    else { next = candidate; break; }
  }
  return { prevNoonUTC: prev, nextNoonUTC: next };
}

function nextTurningUTC(nowUTC) {
  function lambdaDegAt(dateUTC) {
    const JD = jdFromUTC(dateUTC);
    const yfrac = dateUTC.getUTCFullYear() + (dateUTC.getUTCMonth() + 1 - 0.5) / 12;
    const JDtt = ttFromUTC(JD, yfrac);
    const T = centuriesFromJ2000(JDtt);
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M  = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    const Mr = deg2rad(M);
    const C  = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
             + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
             + 0.000289 * Math.sin(3 * Mr);
    const trueLong = L0 + C;
    const Omega = 125.04 - 1934.136 * T;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(deg2rad(Omega));
    return ((lambda % 360) + 360) % 360;
  }
  const lam0 = lambdaDegAt(nowUTC);
  const k = Math.ceil(lam0 / 90) % 4;
  const names = ["March equinox", "June solstice", "September equinox", "December solstice"];
  let t0 = new Date(nowUTC);
  let f0 = ((((lam0 - k * 90) + 540) % 360) - 180);
  let t1 = new Date(t0.getTime() + 6 * 3600 * 1000);
  let f1 = ((((lambdaDegAt(t1) - k * 90) + 540) % 360) - 180);
  for (let guard = 0; Math.sign(f0) === Math.sign(f1) && guard < 2000; guard++) {
    t0 = t1; f0 = f1;
    t1 = new Date(t1.getTime() + 6 * 3600 * 1000);
    f1 = ((((lambdaDegAt(t1) - k * 90) + 540) % 360) - 180);
  }
  for (let i = 0; i < 4; i++) {
    const df = f1 - f0; if (Math.abs(df) < 1e-9) break;
    const dt = (t1 - t0) * (-f0 / df);
    const t2 = new Date(t0.getTime() + dt);
    const f2 = ((((lambdaDegAt(t2) - k * 90) + 540) % 360) - 180);
    t0 = t1; f0 = f1; t1 = t2; f1 = f2;
  }
  return { name: names[k], instantUTC: t1 };
}
function previousTurningUTC(nowUTC) {
  return nextTurningUTC(new Date(nowUTC.getTime() - 100 * 86400000));
}

function isSecure() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return true;
  return window.isSecureContext === true;
}
function tzOffsetMinutesAt(d) { return -d.getTimezoneOffset(); }
function fallbackLongitudeForTZ(d) {
  // Use the year's standard-time offset: daylight saving is a clock change,
  // not a 15-degree movement of the observer's longitude.
  const jan = new Date(d.getFullYear(), 0, 1);
  const jul = new Date(d.getFullYear(), 6, 1);
  const standardOffset = Math.min(tzOffsetMinutesAt(jan), tzOffsetMinutesAt(jul));
  return wrapSym(deg2rad((standardOffset / 60) * 15));
}
function fallbackLocation(reason) {
  return { ok: false, lat: null, lon: fallbackLongitudeForTZ(new Date()), source: "fallback", reason };
}
let inFlightLocationFix = null, locationCleanupFailed = false, activeLocationCancel = null;
function cancelLocationFix() { activeLocationCancel?.(); }
function requestLocationFix() {
  if (inFlightLocationFix) return inFlightLocationFix;
  locationCleanupFailed = false;
  let resolveFix;
  const request = new Promise(resolve => { resolveFix = resolve; });
  inFlightLocationFix = request;

  let geolocation = null, id = null, settled = false, watchReady = false, cleanupFailed = false;
  const release = () => {
    if (activeLocationCancel === cancel) activeLocationCancel = null;
    if (watchReady && !cleanupFailed && inFlightLocationFix === request) inFlightLocationFix = null;
  };
  const clear = () => {
    if (id === null) return;
    const watchId = id; id = null;
    try { geolocation.clearWatch(watchId); } catch { cleanupFailed = locationCleanupFailed = true; }
  };
  const finish = fix => {
    if (settled) return;
    settled = true; clear(); resolveFix(fix);
    release();
  };
  const cancel = () => finish(fallbackLocation("suspended"));
  activeLocationCancel = cancel;
  try {
    geolocation = navigator.geolocation;
    if (!geolocation) {
      finish(fallbackLocation("unsupported"));
    } else {
      const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };
      id = geolocation.watchPosition(
        pos => finish({ ok: true, lat: pos.coords.latitude, lon: deg2rad(pos.coords.longitude), source: "gps" }),
        err => finish(fallbackLocation(err?.code ?? "error")),
        opts
      );
      if (settled) clear();
    }
  } catch {
    finish(fallbackLocation("error"));
  }
  watchReady = true;
  if (settled) { clear(); release(); }
  return request;
}
async function geoPermissionState() { try { if (!("permissions" in navigator)) return null; return (await navigator.permissions.query({ name: "geolocation" })).state; } catch { return null; } }
let inFlightLocationOperation = null;
function obtainLocationThenRefresh(prefs, onFix) {
  if (prefs.source === "gps" && Number.isFinite(prefs.lat) && Number.isFinite(prefs.lon)) return Promise.resolve();
  if (!isSecure()) return Promise.resolve();
  if (inFlightLocationOperation) return inFlightLocationOperation;
  let resolveOperation, rejectOperation;
  const operation = new Promise((resolve, reject) => { resolveOperation = resolve; rejectOperation = reject; });
  inFlightLocationOperation = operation;
  (async () => {
    const fix = await requestLocationFix();
    if (fix.ok) { prefs.lat = fix.lat; prefs.lon = fix.lon; prefs.source = fix.source; Prefs.save(prefs); await onFix(); }
    else if (fix.reason === 1) {
      // An explicitly denied permission must not leave an old GPS fix labelled
      // as the user's current, precise place.
      prefs.lat = null; prefs.lon = null; prefs.source = "fallback";
      Prefs.save(prefs); await onFix();
    }
  })().then(resolveOperation, rejectOperation);
  operation.then(
    () => { if (!locationCleanupFailed && inFlightLocationOperation === operation) inFlightLocationOperation = null; },
    () => { if (!locationCleanupFailed && inFlightLocationOperation === operation) inFlightLocationOperation = null; }
  );
  return operation;
}

function mix(a, b, t) { return a + (b - a) * t; }
function mixColorRGB(c1, c2, t) {
  const a = hex2rgb(c1), b = hex2rgb(c2);
  const r = Math.round(mix(a.r, b.r, t)), g = Math.round(mix(a.g, b.g, t)), b2 = Math.round(mix(a.b, b.b, t));
  return `rgb(${r},${g},${b2})`;
}
function hex2rgb(h) {
  const m = h.replace('#',''); const n = parseInt(m.length===3 ? m.split('').map(x=>x+x).join('') : m, 16);
  return { r: (n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function hslToRgbCss(h, s, l) {
  const c = (1 - Math.abs(2*l - 1)) * s;
  const hp = h / 60; const x = c * (1 - Math.abs(hp % 2 - 1));
  let r=0,g=0,b=0;
  if (hp>=0 && hp<1) { r=c; g=x; }
  else if (hp<2){ r=x; g=c; }
  else if (hp<3){ g=c; b=x; }
  else if (hp<4){ g=x; b=c; }
  else if (hp<5){ r=x; b=c; }
  else { r=c; b=x; }
  const m = l - c/2;
  return `rgb(${Math.round((r+m)*255)},${Math.round((g+m)*255)},${Math.round((b+m)*255)})`;
}
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
function solarVisualProgress(progress) {
  if (progress < 0.98) return progress;
  const t = (progress - 0.98) / 0.02;
  return 0.98 + easeOutCubic(t) * 0.02;
}

async function sampleState(prefs) {
  const nowLocal = new Date();
  const nowUTC = new Date(nowLocal.toISOString());
  const JD = jdFromUTC(nowUTC);
  const yfrac = nowUTC.getUTCFullYear() + (nowUTC.getUTCMonth() + 1 - 0.5) / 12;
  const JDtt = ttFromUTC(JD, yfrac);
  const T = centuriesFromJ2000(JDtt);

  const lon = typeof prefs.lon === "number" ? prefs.lon : fallbackLongitudeForTZ(nowLocal);
  const lat = typeof prefs.lat === "number" ? deg2rad(prefs.lat) : null;

  const { prevNoonUTC, nextNoonUTC } = solarNoonWindow(nowUTC, lon);
  const span = nextNoonUTC - prevNoonUTC;
  const elapsed = nowUTC - prevNoonUTC;
  const solarProgress = clamp(elapsed / span, 0, 1);

  const sun = sunApparent(T);
  const moon = moonApparent(T, sun.epsilon);
  const { phase, illum, waxing } = phaseAndIllum(sun, moon);

  const synodic = 29.530588853;
  const age = phase / τ * synodic;
  const ageFrac = age / synodic;

  const turning = nextTurningUTC(nowUTC);
  const previousTurning = previousTurningUTC(nowUTC);
  const seasonalSpan = turning.instantUTC - previousTurning.instantUTC;
  const seasonalProgress = seasonalSpan > 0 ? clamp((nowUTC - previousTurning.instantUTC) / seasonalSpan, 0, 1) : 0;

  let solarAltitude = 0;
  try {
    if (lat !== null) {
      const gast = gastRadians(JD, T);
      const H = wrapSym(gast + lon - sun.alpha);
      solarAltitude = Math.asin(Math.sin(lat) * Math.sin(sun.delta) + Math.cos(lat) * Math.cos(sun.delta) * Math.cos(H));
    }
  } catch {}

  return {
    nowLocal, nowUTC, lon, lat,
    sun, moon,
    solar: {
      prevNoon: prevNoonUTC,
      nextNoon: nextNoonUTC,
      progress: solarProgress,
      visualProgress: solarVisualProgress(solarProgress)
    },
    lunar: { ageDays: age, illum, waxing, ageFrac, phaseName: phaseName(phase) },
    turning: { name: turning.name, instantUTC: turning.instantUTC, countdownMs: turning.instantUTC - nowUTC },
    seasonal: { prevTurningUTC: previousTurning.instantUTC, nextTurningUTC: turning.instantUTC, progress: seasonalProgress },
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    source: prefs.source || "fallback",
    solarAltitude
  };
}

function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let renderDpr = 0, renderWidth = 0, renderHeight = 0;
  let ringBg = "#2f2f2f", reducedMotion = false, palette = {};
  const coarsePointer = matchMedia("(pointer: coarse)").matches;
  const maxDpr = coarsePointer ? 2 : 3;
  let colorKey = "", cachedColors = null;
  let staticStateKey = "", staticInvalid = true;

  const grain = document.createElement('canvas');
  grain.width = grain.height = 128;
  const gctx = grain.getContext("2d");
  const imgData = gctx.createImageData(grain.width, grain.height);
  let grainReady = false;
  const staticCanvas = document.createElement("canvas");
  const staticCtx = staticCanvas.getContext("2d");

  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    const value = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    const number = (name, fallback) => Number.parseFloat(value(name, fallback));
    ringBg = value("--ring-bg", ringBg);
    palette = {
      bgBase: number("--canvas-bg-base", 0), bgDayScale: number("--canvas-bg-day-scale", 255),
      bgEdge: value("--canvas-bg-edge", "#000000"), tick: value("--canvas-tick", "rgba(238,238,238,0.46)"),
      seasonalActive: value("--canvas-seasonal-active", "rgba(238,238,238,0.46)"),
      seasonalActiveAlpha: number("--canvas-seasonal-active-alpha", .42),
      seasonalActiveWidth: number("--canvas-seasonal-active-width", 1),
      solarCool: value("--canvas-solar-cool", "#aeb4c2"), solarWarm: value("--canvas-solar-warm", "#d0c4a8"),
      lunarHueStart: number("--canvas-lunar-hue-start", 45), lunarHueEnd: number("--canvas-lunar-hue-end", 200),
      lunarSaturation: number("--canvas-lunar-saturation", .45), lunarLightness: number("--canvas-lunar-lightness", .70),
      grainOpacity: number("--canvas-grain-opacity", .06), fineAlpha: number("--canvas-fine-alpha", 1),
      ringLineScale: number("--canvas-ring-line-scale", 1),
      pulseColor: value("--canvas-pulse-color", "solar-active"),
      pulseAlpha: number("--canvas-pulse-alpha", .85), pulseWidth: number("--canvas-pulse-width", .6),
      guideLineAlpha: number("--canvas-guide-line-alpha", .20),
      guideLineWidth: number("--canvas-guide-line-width", .6),
      shadow: value("--canvas-shadow", "rgba(255,255,255,0.08)")
    };
    colorKey = "";
    staticInvalid = true;
    if (!grainReady) {
      const grainRgb = number("--canvas-grain-rgb", 8), grainAlpha = number("--canvas-grain-alpha", 32);
      for (let i=0; i<imgData.data.length; i+=4) {
        const v = grainRgb + Math.random()*10;
        imgData.data[i] = imgData.data[i+1] = imgData.data[i+2] = v;
        imgData.data[i+3] = grainAlpha;
      }
      gctx.putImageData(imgData, 0, 0);
      grainReady = true;
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const pixelW = Math.max(1, Math.round(cssW * dpr));
    const pixelH = Math.max(1, Math.round(cssH * dpr));

    renderWidth = cssW;
    renderHeight = cssH;
    readTheme();

    if (canvas.width !== pixelW || canvas.height !== pixelH || renderDpr !== dpr) {
      canvas.width = pixelW;
      canvas.height = pixelH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderDpr = dpr;
      staticCanvas.width = pixelW;
      staticCanvas.height = pixelH;
      staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      staticInvalid = true;
    }
  }

  function setReducedMotion(value) { reducedMotion = value; }

  function computeColors(state) {
    const key = [state.sun.delta, state.lunar.ageFrac, palette.solarCool, palette.solarWarm,
      palette.lunarHueStart, palette.lunarHueEnd, palette.lunarSaturation, palette.lunarLightness].join("|");
    if (key === colorKey && cachedColors) return cachedColors;

    const dec = rad2deg(state.sun.delta);
    const t = (dec + 23.44) / (2 * 23.44);
    const cool = palette.solarCool;
    const warm = palette.solarWarm;
    const solarActive = mixColorRGB(cool, warm, t);

    const hue = mix(palette.lunarHueStart, palette.lunarHueEnd, state.lunar.ageFrac);
    const lunarAccent = hslToRgbCss(hue, palette.lunarSaturation, palette.lunarLightness);

    colorKey = key;
    cachedColors = { solarActive, lunarAccent };
    return cachedColors;
  }

  function metrics(w, h) {
    const size = Math.min(w, h);
    const innerRadius = clamp(size * 0.03, 16, 20);
    return {
      w, h, cx: w / 2, cy: h / 2, size,
      Rseasonal: size * 0.47,
      Rsolar: size * 0.31,
      Rlunar: size * 0.39,
      innerRadius,
      outerRadius: innerRadius + 7,
      startAngle: -Math.PI / 2
    };
  }

  function drawArcArrowhead(target, {
    cx, cy, radius, angle, direction, color, lineWidth, alpha = 1
  }) {
    const length = Math.max(9, lineWidth * 3);
    const halfWidth = Math.max(4, lineWidth * 1.35);
    const overlap = lineWidth * 0.75;
    const joinX = cx + Math.cos(angle) * radius;
    const joinY = cy + Math.sin(angle) * radius;
    const tangentX = direction * -Math.sin(angle);
    const tangentY = direction * Math.cos(angle);
    const normalX = -tangentY;
    const normalY = tangentX;
    const tipX = joinX + tangentX * length;
    const tipY = joinY + tangentY * length;
    const baseX = joinX - tangentX * overlap;
    const baseY = joinY - tangentY * overlap;

    target.save();
    target.fillStyle = color;
    target.globalAlpha = alpha;
    target.shadowBlur = 0;
    target.beginPath();
    target.moveTo(baseX + normalX * halfWidth, baseY + normalY * halfWidth);
    target.lineTo(tipX, tipY);
    target.lineTo(baseX - normalX * halfWidth, baseY - normalY * halfWidth);
    target.closePath();
    target.fill();
    target.restore();
  }

  function staticKey(state, colors, centerTone) {
    return [renderWidth, renderHeight, renderDpr, centerTone,
      state.seasonal.progress, state.solar.visualProgress,
      colors.solarActive, colors.lunarAccent].join("|");
  }

  function renderStatic(state, m, colors, centerTone) {
    const { w, h, cx, cy, Rseasonal, Rsolar, Rlunar, innerRadius, outerRadius, startAngle } = m;
    const target = staticCtx;
    target.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
    target.clearRect(0, 0, w, h);

    const grad = target.createRadialGradient(cx, cy, m.size * 0.05, cx, cy, m.size * 0.6);
    grad.addColorStop(0, `rgb(${centerTone},${centerTone},${centerTone})`);
    grad.addColorStop(1, palette.bgEdge);
    target.fillStyle = grad;
    target.fillRect(0, 0, w, h);

    const pattern = target.createPattern(grain, "repeat");
    if (pattern) {
      target.globalAlpha = palette.grainOpacity;
      target.fillStyle = pattern;
      target.fillRect(0, 0, w, h);
      target.globalAlpha = 1;
    }

    target.save();
    target.translate(cx, cy);
    target.lineCap = "round";

    target.strokeStyle = ringBg;
    target.globalAlpha = Math.min(1, 0.42 * palette.fineAlpha);
    target.lineWidth = palette.ringLineScale;
    target.beginPath();
    target.arc(0, 0, Rseasonal, 0, τ);
    target.stroke();

    target.strokeStyle = palette.tick;
    for (const a of [startAngle, 0, Math.PI / 2, Math.PI]) {
      target.beginPath();
      target.moveTo(Math.cos(a) * (Rseasonal - 2), Math.sin(a) * (Rseasonal - 2));
      target.lineTo(Math.cos(a) * (Rseasonal + 3), Math.sin(a) * (Rseasonal + 3));
      target.stroke();
    }

    target.strokeStyle = palette.seasonalActive;
    target.globalAlpha = palette.seasonalActiveAlpha;
    target.lineWidth = palette.seasonalActiveWidth;
    target.beginPath();
    target.arc(0, 0, Rseasonal, startAngle, startAngle + τ * state.seasonal.progress, false);
    target.stroke();

    target.lineCap = "butt";
    target.strokeStyle = colors.solarActive;
    target.globalAlpha = palette.guideLineAlpha;
    target.lineWidth = palette.guideLineWidth;
    target.beginPath();
    target.moveTo(-Rseasonal + 2, 0);
    target.lineTo(-outerRadius, 0);
    target.stroke();

    target.globalAlpha = 0.28;
    target.lineWidth = 0.7;
    target.beginPath();
    target.arc(0, 0, outerRadius, 0, τ);
    target.stroke();

    target.globalAlpha = 0.36;
    target.beginPath();
    target.arc(0, 0, innerRadius, 0, τ);
    target.stroke();

    target.globalAlpha = 1;
    target.strokeStyle = ringBg;
    target.lineWidth = 1.25 * palette.ringLineScale;
    target.beginPath();
    target.arc(0, 0, Rsolar, 0, τ);
    target.stroke();
    target.beginPath();
    target.arc(0, 0, Rlunar, 0, τ);
    target.stroke();

    target.shadowColor = palette.shadow;
    target.shadowBlur = 4;
    target.strokeStyle = colors.solarActive;
    target.lineWidth = 3;
    target.beginPath();
    target.arc(0, 0, Rsolar, startAngle, startAngle + τ * state.solar.visualProgress, false);
    target.stroke();
    target.shadowBlur = 0;
    target.restore();
  }

  function dynamicBounds(m) {
    const padding = 12;
    const left = Math.max(0, Math.floor(m.cx - m.Rseasonal - padding));
    const top = Math.max(0, Math.floor(m.cy - m.Rlunar - padding));
    const right = Math.min(m.w, Math.ceil(m.cx + m.Rlunar + padding));
    const bottom = Math.min(m.h, Math.ceil(m.cy + m.Rlunar + padding));
    return { left, top, width: right - left, height: bottom - top };
  }

  function copyStatic(bounds = null) {
    if (!bounds) {
      ctx.drawImage(staticCanvas, 0, 0, renderWidth, renderHeight);
      return;
    }

    const sx = Math.max(0, Math.floor(bounds.left * renderDpr));
    const sy = Math.max(0, Math.floor(bounds.top * renderDpr));
    const ex = Math.min(staticCanvas.width, Math.ceil((bounds.left + bounds.width) * renderDpr));
    const ey = Math.min(staticCanvas.height, Math.ceil((bounds.top + bounds.height) * renderDpr));
    const sourceWidth = ex - sx;
    const sourceHeight = ey - sy;
    ctx.drawImage(
      staticCanvas,
      sx, sy, sourceWidth, sourceHeight,
      sx / renderDpr, sy / renderDpr, sourceWidth / renderDpr, sourceHeight / renderDpr
    );
  }

  function renderDynamic(state, m, colors) {
    const { cx, cy, Rseasonal, Rlunar, innerRadius, outerRadius, startAngle } = m;
    const now = new Date();
    const secondsIntoCycle =
      (now.getMinutes() % 4) * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    const rotation = τ * (secondsIntoCycle / 240);
    const pulseColor = palette.pulseColor === "solar-active" ? colors.solarActive : palette.pulseColor;
    const pulseActive = !reducedMotion && secondsIntoCycle < westernPulseDuration;

    function drawWesternPulse() {
      const progress = secondsIntoCycle / westernPulseDuration;
      const pulseX = mix(-outerRadius, -Rseasonal + 2, easeOutCubic(progress));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.lineCap = "butt";
      ctx.strokeStyle = pulseColor;
      ctx.globalAlpha = palette.pulseAlpha * (1 - 0.8 * progress);
      ctx.lineWidth = palette.pulseWidth;
      ctx.beginPath();
      ctx.moveTo(pulseX, 0);
      ctx.lineTo(Math.max(-Rseasonal + 2, pulseX - 5), 0);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = colors.solarActive;
    ctx.globalAlpha = 0.40;
    ctx.lineWidth = palette.guideLineWidth;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, innerRadius, 0, τ);
    ctx.clip();
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(innerRadius, 0);
    ctx.moveTo(0, -innerRadius);
    ctx.lineTo(0, innerRadius);
    ctx.stroke();
    ctx.restore();

    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-outerRadius, 0);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = colors.solarActive;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.25, 0, τ);
    ctx.fill();

    const shimmer = reducedMotion ? 0 : 0.02 * Math.sin(performance.now() / 1400);
    const lunarProgress = clamp(state.lunar.illum, 0, 1);
    const lunarAlpha = clamp(0.92 + shimmer, 0.88, 1);
    ctx.strokeStyle = colors.lunarAccent;
    ctx.globalAlpha = lunarAlpha;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.shadowColor = palette.shadow;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    const lunarDirection = state.lunar.waxing ? 1 : -1;
    const lunarEndAngle = startAngle + τ * lunarProgress;
    ctx.arc(
      cx,
      cy,
      Rlunar,
      startAngle,
      lunarEndAngle,
      false
    );
    ctx.stroke();
    const lunarLandmark = state.lunar.phaseName === "New" || state.lunar.phaseName === "Full";
    if (!lunarLandmark) {
      drawArcArrowhead(ctx, {
        cx,
        cy,
        radius: Rlunar,
        angle: lunarEndAngle,
        direction: lunarDirection,
        color: colors.lunarAccent,
        lineWidth: 3,
        alpha: lunarAlpha
      });
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Draw last so the western pulse crosses over the noon and lunar lines.
    if (pulseActive) drawWesternPulse();
  }

  function draw(state, { forceStatic = false } = {}) {
    const w = renderWidth, h = renderHeight;
    if (w <= 0 || h <= 0) return;
    const m = metrics(w, h);
    const dayFactor = state.lat === null ? 0.05 : (clamp((Math.sin(state.solarAltitude) + 0.2) / 1.2, 0, 1) * 0.08 + 0.02);
    const centerTone = Math.round(palette.bgBase + dayFactor * palette.bgDayScale);
    const colors = computeColors(state);
    const nextStaticKey = staticKey(state, colors, centerTone);
    const rebuildStatic = forceStatic || staticInvalid || nextStaticKey !== staticStateKey;

    if (rebuildStatic) {
      renderStatic(state, m, colors, centerTone);
      staticStateKey = nextStaticKey;
      staticInvalid = false;
      copyStatic();
    } else {
      copyStatic(dynamicBounds(m));
    }

    renderDynamic(state, m, colors);
  }

  return { resize, draw, setReducedMotion };
}

function fmtPercent(x) { return Math.round(x * 100); }
function fmtProgressPercent(x) { return Math.min(99, Math.floor(x * 100)); }
function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d} d ${h} h` : `${h} h ${m} m`;
}
function fmtLonRadToDegE(lonRad) {
  const deg = rad2deg(lonRad);
  const E = deg >= 0 ? "E" : "W";
  const abs = Math.abs(deg).toFixed(2);
  return `${abs}° ${E}`;
}

function solarPhrase(progress) {
  if (progress < 0.25) return "The day leans west.";
  if (progress < 0.50) return "The western arc deepens.";
  if (progress < 0.75) return "The Earth turns in darkness.";
  return "The light returns.";
}

function lunarPhrase(lunar) {
  if (lunar.phaseName === "New") return "The Moon keeps its silence.";
  if (lunar.phaseName === "Full") return "Nothing remains concealed.";
  if (lunar.waxing) return "Light gathers along the edge.";
  return "The night begins to empty.";
}

function turningPhrase(countdownMs) {
  const days = Math.max(0, Math.floor(countdownMs / 86400000));

  if (days < 3) return "The year holds its breath.";
  if (days < 21) return "The next turning draws near.";
  if (days < 55) return "The long shift continues.";
  return "The year rests between turnings.";
}

function temporalPhrase(state) {
  const p = state.solar.progress;

  if (p < 0.08) return "after solar noon";
  if (p < 0.25) return "moving away from noon";
  if (p < 0.50) return "approaching solar midnight";
  if (p < 0.75) return "after solar midnight";
  if (p < 0.92) return "returning toward noon";

  return "before solar noon";
}

(async function main() {
  const canvas = document.getElementById("clock");
  const renderer = createRenderer(canvas);
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  let reducedMotion = reducedMotionQuery.matches;
  renderer.setReducedMotion(reducedMotion);

  let resizeFrame = 0, resizePending = false, canDrawAfterResize = false;
  const scheduleResize = () => {
    if (!AppLifecycle.isActive()) {
      resizePending = true;
      return;
    }
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resizePending = false;
      renderer.resize();
      if (canDrawAfterResize) drawNow();
    });
  };

  renderer.resize();
  window.addEventListener("resize", scheduleResize, { passive: true });
  window.addEventListener("orientationchange", scheduleResize, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleResize, { passive: true });
  if ("ResizeObserver" in window) new ResizeObserver(scheduleResize).observe(canvas);

  const overlay = document.getElementById("overlay");
  const hintKey = "soluna_hint_seen_v1";
  if (SafeStorage.get(hintKey) === "true") document.body.classList.add("hint-seen");

  let prefs = Prefs.load();
  let cached = await sampleState(prefs);
  if (AppLifecycle.isActive()) renderer.draw(cached);
  canDrawAfterResize = true;

  let stateRefreshPromise = null;
  async function refreshCachedState(forceFresh = false) {
    if (forceFresh && stateRefreshPromise) await stateRefreshPromise;
    if (stateRefreshPromise) return stateRefreshPromise;
    stateRefreshPromise = (async () => {
      cached = await sampleState(Prefs.load());
      return cached;
    })();
    try { return await stateRefreshPromise; }
    finally { stateRefreshPromise = null; }
  }

  let frameTimer = 0, animationFrame = 0, frameRunning = false;
  let lifecycleRun = 0;
  let lastMath = performance.now(), lastDraw = lastMath;
  let overlayThrottleAt = 0;

  function overlayIsOpen() { return overlay.getAttribute("aria-hidden") === "false"; }
  function frameInterval(now = performance.now()) {
    if (reducedMotion) return 1000;
    const pulseNow = new Date();
    const secondsIntoCycle =
      (pulseNow.getMinutes() % 4) * 60 +
      pulseNow.getSeconds() +
      pulseNow.getMilliseconds() / 1000;
    if (secondsIntoCycle < westernPulseDuration) return 1000 / (coarsePointer ? 30 : 60);
    if (overlayIsOpen() && now >= overlayThrottleAt) return 1000;
    return 1000 / (coarsePointer ? 10 : 15);
  }
  function stopScheduler() {
    if (frameTimer) { clearTimeout(frameTimer); frameTimer = 0; }
    if (animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = 0; }
  }
  function scheduleNextFrame(immediate = false) {
    if (!AppLifecycle.isActive() || frameRunning || frameTimer || animationFrame) return;
    const now = performance.now();
    const delay = immediate ? 0 : Math.max(0, frameInterval(now) - (now - lastDraw));
    frameTimer = window.setTimeout(() => {
      frameTimer = 0;
      if (AppLifecycle.isActive()) animationFrame = requestAnimationFrame(frame);
    }, delay);
  }
  function rescheduleFrame(immediate = false) {
    stopScheduler();
    scheduleNextFrame(immediate);
  }
  function drawNow() {
    if (!AppLifecycle.isActive()) return;
    const now = performance.now();
    renderer.draw(cached);
    lastDraw = now;
  }
  async function updateTimeState(ts) {
    if (ts - lastMath < 1000) return;

    const nowLocal = new Date();
    const minuteChange = cached.nowLocal.getMinutes() !== nowLocal.getMinutes();
    cached.nowLocal = nowLocal;

    const nowUTC = nowLocal;
    const span = cached.solar.nextNoon - cached.solar.prevNoon;
    const elapsed = nowUTC - cached.solar.prevNoon;
    const p = clamp(elapsed / span, 0, 1);
    cached.solar.progress = p;
    cached.solar.visualProgress = solarVisualProgress(p);
    cached.turning.countdownMs = cached.turning.instantUTC - nowUTC;
    const seasonalSpan = cached.seasonal.nextTurningUTC - cached.seasonal.prevTurningUTC;
    cached.seasonal.progress = seasonalSpan > 0 ? clamp((nowUTC - cached.seasonal.prevTurningUTC) / seasonalSpan, 0, 1) : 0;

    if (minuteChange || nowUTC >= cached.solar.nextNoon) {
      await refreshCachedState();
      if (overlayIsOpen()) updateOverlay(cached);
    } else if (overlayIsOpen()) {
      const temporal = document.getElementById("temporalPhrase");
      if (temporal) temporal.textContent = temporalPhrase(cached);
    }
    lastMath = ts;
  }
  async function frame(ts) {
    animationFrame = 0;
    if (!AppLifecycle.isActive() || frameRunning) return;
    frameRunning = true;
    try {
      await updateTimeState(ts);
      if (AppLifecycle.isActive()) {
        renderer.draw(cached);
        lastDraw = ts;
      }
    } finally {
      frameRunning = false;
      scheduleNextFrame();
    }
  }
  async function resumeFromHidden(run) {
    stopScheduler();
    await refreshCachedState(true);
    if (run !== lifecycleRun || !AppLifecycle.isActive()) return;
    renderer.resize();
    resizePending = false;
    if (overlayIsOpen()) updateOverlay(cached);
    const now = performance.now();
    renderer.draw(cached);
    lastMath = lastDraw = now;
    scheduleNextFrame();
  }

  function handleReducedMotionChange(event) {
    reducedMotion = event.matches;
    renderer.setReducedMotion(reducedMotion);
    rescheduleFrame(true);
  }
  if (reducedMotionQuery.addEventListener) reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  else reducedMotionQuery.addListener(handleReducedMotionChange);

  scheduleNextFrame();

  const refreshAfterLocation = async () => {
    if (!AppLifecycle.isActive()) return;
    await refreshCachedState();
    if (!AppLifecycle.isActive()) return;
    if (overlayIsOpen()) updateOverlay(cached);
    drawNow();
    rescheduleFrame();
  };
  const requestLocationRefresh = () => obtainLocationThenRefresh(Prefs.load(), refreshAfterLocation);
  geoPermissionState().then(state => {
    if (AppLifecycle.isActive() && state === "granted") requestLocationRefresh();
  });
  let locationGestureConsumed = false;
  const onceGesture = () => {
    if (locationGestureConsumed) return;
    locationGestureConsumed = true;
    document.removeEventListener("pointerdown", onceGesture, { passive: true });
    requestLocationRefresh();
  };
  document.addEventListener("pointerdown", onceGesture, { passive: true });
  AppLifecycle.subscribe(async active => {
    const run = ++lifecycleRun;
    if (!active) {
      stopScheduler();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
      resizePending = true;
      cancelLocationFix();
      return;
    }

    await resumeFromHidden(run);
    if (run !== lifecycleRun || !AppLifecycle.isActive()) return;
    if (resizePending) scheduleResize();
    const state = await geoPermissionState();
    if (run !== lifecycleRun || !AppLifecycle.isActive()) return;
    const p = Prefs.load();
    if (state === "granted" && typeof p.lon !== "number") {
      requestLocationRefresh();
    }
  });

  const panel = overlay.querySelector(".panel");
  let readingsTrigger = canvas;
  function openOverlay(trigger = canvas) {
    readingsTrigger = trigger;
    SafeStorage.set(hintKey, "true");
    document.body.classList.add("hint-seen");
    document.body.classList.add("overlay-open");
    overlay.scrollTop = 0;
    overlay.setAttribute("aria-hidden", "false");
    canvas.setAttribute("aria-expanded", "true");
    overlayThrottleAt = performance.now() + 520;
    updateOverlay(cached);
    rescheduleFrame(true);
    panel.focus({ preventScroll: true });
  }
  function closeReadings() {
    if (!overlayIsOpen()) return;
    document.body.classList.remove("overlay-open");
    overlay.setAttribute("aria-hidden", "true");
    canvas.setAttribute("aria-expanded", "false");
    overlayThrottleAt = 0;
    rescheduleFrame(true);
    readingsTrigger?.focus?.({ preventScroll: true });
  }
  function toggleReadings(trigger = canvas) {
    if (overlay.getAttribute("aria-hidden") === "false") {
      closeReadings();
    } else {
      openOverlay(trigger);
    }
  }

  canvas.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onceGesture();
    if (!overlayIsOpen()) openOverlay(canvas);
  });
  document.addEventListener("click", () => toggleReadings(canvas));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeReadings(); });

  function updateOverlay(state) {
    const insecure = !isSecure();
    const status = insecure ? "HTTPS needed for precise place" : (state.source === "gps" ? "precise place" : "time zone estimate");
    document.getElementById("temporalPhrase").textContent = temporalPhrase(state);
    document.getElementById("solarSummary").textContent =
      `Noon to noon · ${fmtProgressPercent(state.solar.progress)}% complete`;
    document.getElementById("solarPhrase").textContent = solarPhrase(state.solar.progress);
    document.getElementById("lunaSummary").textContent =
      `${state.lunar.phaseName} · ${fmtPercent(state.lunar.illum)}% lit · day ${state.lunar.ageDays.toFixed(1)}`;
    document.getElementById("lunaPhrase").textContent = lunarPhrase(state.lunar);
    document.getElementById("turningSummary").textContent =
      `${state.turning.name} · ${fmtCountdown(state.turning.countdownMs)}`;
    document.getElementById("turningPhrase").textContent = turningPhrase(state.turning.countdownMs);
    document.getElementById("locSummary").textContent =
      `${state.tz} · ${fmtLonRadToDegE(state.lon)} · ${status}`;
    document.getElementById("locPhrase").textContent =
      state.source === "gps" ? "The dial is tuned to your longitude." : "The dial listens to local time until place is known.";
  }

})();
