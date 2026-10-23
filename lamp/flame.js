
const COLOR_MAP = {
  amber: {
    core: ['#fffdf0', '#fff1ad', '#ffd96a'],
    aura: ['#e94f16', '#ff8a2c', '#ffc15a'],
    response: { core: 1, aura: 1, light: 1 }
  },
  blue: {
    core: ['#fbfeff', '#dff7ff', '#a8ddff'],
    aura: ['#174bd6', '#287cff', '#65c6ff'],
    response: { core: 1.1, aura: 1.03, light: 0.9 }
  },
  green: {
    core: ['#fbfff8', '#dcffd3', '#a6efb1'],
    aura: ['#16854a', '#35b968', '#78d28b'],
    response: { core: 1.03, aura: 0.92, light: 0.78 }
  },
  purple: {
    core: ['#fffaff', '#f4e3ff', '#d9bdff'],
    aura: ['#5a31cf', '#8052ee', '#bd83ff'],
    response: { core: 1.12, aura: 1, light: 0.84 }
  }
};

const BASE_OFFSETS = {
  'base-01': { x: 0,  y: -8,  scale: 1.00 },
  'base-02': { x: 2,  y: -10, scale: 0.96 },
  'base-03': { x: -1, y: -12, scale: 1.06 }
};

function vhash(n) { n = Math.sin(n) * 43758.5453; return n - Math.floor(n); }
function vnoise1D(x) {
  const i = Math.floor(x), f = x - i;
  const a = vhash(i), b = vhash(i + 1);
  const u = f * f * (3 - 2 * f);
  return a * (1 - u) + b * u;
}
function n11(x) { return vnoise1D(x) * 2 - 1; }

function fbm(x, octaves = 2, lacunarity = 2, gain = 0.5) {
  let a = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    a += amp * n11(x * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return a / norm;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = t => t * t * (3 - 2 * t);

export class Flame {
  constructor(containerEl, { colorId = 'amber', baseId = 'base-01', onIntensity = null } = {}) {
    if (!containerEl) throw new Error('Flame requires a container element');

    this.container = containerEl;
    this.colorId = colorId;
    this.baseId = baseId;
    this.onIntensity = typeof onIntensity === 'function' ? onIntensity : null;
    this._paletteResponse = COLOR_MAP.amber.response;
    this._lastIntensity = 1;

    this._t = 0;
    this._time = 0;
    this._targetFps = matchMedia('(pointer: coarse)').matches ? 24 : 30;
    this._dt = 1 / this._targetFps;
    this._frameMs = 1000 / this._targetFps;
    this._lastFrameAt = 0;
    this._nextFrameAt = 0;
    this._paused = false;
    this._highPowerVisuals = false;

    this._seed = Math.random() * 1000;
    this._seeds = {
      aura: Math.random() * 1000,
      core: Math.random() * 1000,
      lick: Math.random() * 1000,
      whip: Math.random() * 1000,
      pivot: Math.random() * 1000,
      flick: Math.random() * 1000,
      collapse: Math.random() * 1000,
      colour: Math.random() * 1000
    };

    this._baselineDrift = 0;

    this._animFrame = null;
    this._frameTimer = null;
    this._isLit = false;

    this._auraBase = {
      tip: { x: 47.5, y: 4 },
      r1:  { x: 60, y: 14 },
      r2:  { x: 70, y: 32 },
      r3:  { x: 69, y: 52 },
      bellyR1: { x: 67, y: 68 },
      bellyR2: { x: 56, y: 82 },
      bellyEnd:{ x: 52, y: 96 },
      baseCtrl1: { x: 50, y: 104 },
      baseCtrl2: { x: 51, y: 112 },
      base: { x: 50, y: 120 },
      baseCtrl3: { x: 49, y: 112 },
      baseCtrl4: { x: 50, y: 104 },
      bellyL1: { x: 48, y: 96 },
      bellyL2: { x: 44, y: 82 },
      bellyL3: { x: 33, y: 68 },
      l3:  { x: 31, y: 52 },
      l2:  { x: 29, y: 32 },
      l1:  { x: 36, y: 14 }
    };
    this._aura = JSON.parse(JSON.stringify(this._auraBase));

    this._coreBase = {
      tip: { x: 48.5, y: 8 },
      r1:  { x: 58, y: 20 },
      r2:  { x: 62, y: 36 },
      r3:  { x: 60, y: 53 },
      bellyR1: { x: 57, y: 69 },
      bellyR2: { x: 51, y: 83 },
      bellyEnd:{ x: 50, y: 98 },
      l3:  { x: 40, y: 53 },
      l2:  { x: 38, y: 36 },
      l1:  { x: 42, y: 20 }
    };
    this._core = JSON.parse(JSON.stringify(this._coreBase));

    this._auraDrift = Object.fromEntries(
      Object.entries(this._auraBase).map(([key, point]) => [key, {
        x: n11(this._seeds.aura + point.x * 0.15),
        y: n11(this._seeds.aura - point.y * 0.12)
      }])
    );
    this._coreDrift = Object.fromEntries(
      Object.entries(this._coreBase).map(([key, point]) => [key, {
        x: n11(this._seeds.core + point.x * 0.18),
        y: n11(this._seeds.core - point.y * 0.14)
      }])
    );

    this._mount();

    this.setColor(this.colorId);
    this.setBase(this.baseId);

    this._reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this._reducedMotionQuery.matches;
    this._handleReducedMotionChange = (event) => {
      this.reducedMotion = event.matches;

      if (this.reducedMotion) {
        this._stop();
        this._resetShape();
      } else if (this._isLit && !this._paused) {
        this._start();
      }
    };

    if (typeof this._reducedMotionQuery.addEventListener === 'function') {
      this._reducedMotionQuery.addEventListener('change', this._handleReducedMotionChange);
    } else {
      this._reducedMotionQuery.addListener(this._handleReducedMotionChange);
    }
  }

  _mount() {
    const svgNS = 'http://www.w3.org/2000/svg';
    this.container.innerHTML = '';

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 140');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.classList.add('flame-root');
    svg.setAttribute('data-lit', 'false');

    const defs = document.createElementNS(svgNS, 'defs');

    const gradAura = document.createElementNS(svgNS, 'linearGradient');
    gradAura.setAttribute('id', 'flame-aura-grad');
    gradAura.setAttribute('x1', '50%');
    gradAura.setAttribute('y1', '100%');
    gradAura.setAttribute('x2', '50%');
    gradAura.setAttribute('y2', '0%');
    gradAura.setAttribute('gradientUnits', 'objectBoundingBox');
    gradAura.setAttribute('gradientTransform', 'scale(1,-1) translate(0,-1)');

    const a0 = document.createElementNS(svgNS, 'stop'); a0.setAttribute('offset', '0%');
    const a1 = document.createElementNS(svgNS, 'stop'); a1.setAttribute('offset', '55%');
    const a2 = document.createElementNS(svgNS, 'stop'); a2.setAttribute('offset', '100%');
    a0.setAttribute('stop-opacity', '0.42');
    gradAura.append(a0, a1, a2);

    const gradCore = document.createElementNS(svgNS, 'linearGradient');
    gradCore.setAttribute('id', 'flame-core-grad');
    gradCore.setAttribute('x1', '50%');
    gradCore.setAttribute('y1', '100%');
    gradCore.setAttribute('x2', '50%');
    gradCore.setAttribute('y2', '0%');
    gradCore.setAttribute('gradientUnits', 'objectBoundingBox');
    gradCore.setAttribute('gradientTransform', 'scale(1,-1) translate(0,-1)');

    const c0 = document.createElementNS(svgNS, 'stop'); c0.setAttribute('offset', '0%');
    const c1 = document.createElementNS(svgNS, 'stop'); c1.setAttribute('offset', '45%');
    const c2 = document.createElementNS(svgNS, 'stop'); c2.setAttribute('offset', '100%');
    c0.setAttribute('stop-opacity', '0.78');
    gradCore.append(c0, c1, c2);

    const blur = document.createElementNS(svgNS, 'filter');
    blur.setAttribute('id', 'flame-core-blur');
    blur.setAttribute('x', '-20%'); blur.setAttribute('y', '-20%');
    blur.setAttribute('width', '140%'); blur.setAttribute('height', '160%');
    const feBlur = document.createElementNS(svgNS, 'feGaussianBlur');
    feBlur.setAttribute('in', 'SourceGraphic');
    feBlur.setAttribute('stdDeviation', '1.35');
    blur.appendChild(feBlur);

    const feT = null;

    defs.append(gradAura, gradCore, blur);

    const wrap = document.createElementNS(svgNS, 'g');
    wrap.setAttribute('class', 'flame-wrap');

    const gAura = document.createElementNS(svgNS, 'g');
    gAura.setAttribute('class', 'aura-wrap');

    const gCore = document.createElementNS(svgNS, 'g');
    gCore.setAttribute('class', 'core-wrap');

    const aura = document.createElementNS(svgNS, 'path');
    aura.setAttribute('class', 'flame-aura');
    aura.setAttribute('fill', 'url(#flame-aura-grad)');
    aura.setAttribute('fill-opacity', '0.76');

    const core = document.createElementNS(svgNS, 'path');
    core.setAttribute('class', 'flame-core');
    core.setAttribute('fill', 'url(#flame-core-grad)');
    core.setAttribute('fill-opacity', '0.52');

    gAura.appendChild(aura);
    gCore.appendChild(core);
    wrap.appendChild(gAura);
    wrap.appendChild(gCore);

    const world = document.createElementNS(svgNS, 'g');
    world.setAttribute('class', 'flame-world');
    world.setAttribute('transform', 'scale(1,-1) translate(0,-140)');
    world.appendChild(wrap);

    svg.appendChild(defs);
    svg.appendChild(world);
    this.container.appendChild(svg);

    this.svg = svg;
    this.defs = defs;
    this.world = world;
    this.wrap = wrap;
    this.gAura = gAura;
    this.gCore = gCore;
    this.aura = aura;
    this.core = core;
    this._stops = { aura: [a0, a1, a2], core: [c0, c1, c2] };
    this._feT = feT;

    this._baseTransform = '';
  }

  _tick() {
    const t = this._time;
    const F = this._freqs;

    this._baselineDrift += 0.002 * n11(t * 0.05 + this._seeds.aura);
    this._baselineDrift = clamp(this._baselineDrift, -2.5, 2.5);

    const burstNoise = fbm(t * F.burst + this._seeds.flick, 1, 2, 0.5);
    const isBurst = burstNoise > 0.35;
    const burstPower = isBurst ? smooth(clamp((burstNoise - 0.35) / 0.65, 0, 1)) : 0;

    const burstSide = isBurst ? fbm(t * 0.18 + this._seeds.whip, 2, 2, 0.55) : 0;
    const burstFlutter = isBurst ? fbm(t * 0.7 + this._seeds.lick, 2, 2, 0.55) : 0;

    const collapseWave = 0.5 + 0.5 * Math.sin(t * 0.33 + this._seeds.collapse);
    const collapseGate = smooth(clamp((collapseWave - 0.965) / 0.035, 0, 1));
    const collapse = collapseGate > 0
      ? collapseGate * (0.5 + 0.5 * fbm(t * 0.09 + this._seeds.collapse, 2, 2, 0.55))
      : 0;
    const energyNoise = 0.5 + 0.5 * fbm(t * 0.72 + this._seeds.flick, 2, 2, 0.6);
    const intensity = clamp(0.72 + energyNoise * 0.22 + burstPower * 0.14 - collapse * 0.18, 0.58, 1.08);
    this._lastIntensity = intensity;

    const b = this._auraBase;
    const p = this._aura;
    for (const k in b) {
      const base = b[k];
      const driftX = this._baselineDrift * 0.4 * this._auraDrift[k].x;
      const driftY = this._baselineDrift * 0.4 * this._auraDrift[k].y;
      p[k].x = base.x + driftX;
      p[k].y = base.y + driftY;
    }

    const lickPhase = t * F.lick + this._seeds.lick;
    const lickUp = (1.5 + 1.2 * Math.max(0, fbm(lickPhase, 2, 2, 0.6))) * (0.76 + intensity * 0.28);

    const whip = 0.9 * fbm(t * F.whip + this._seeds.whip, 3, 2, 0.55);
    const coreLean = 1.1 * fbm(t * 0.23 + this._seeds.core, 3, 2, 0.5);
    const surfaceNoise = new Map();
    const surf = s => {
      if (!surfaceNoise.has(s)) surfaceNoise.set(s, 1.1 * fbm(t * s + this._seeds.aura, 3, 2, 0.55));
      return surfaceNoise.get(s);
    };

    p.tip.x += 1.2 * whip;
    p.tip.y -= 0.8 * Math.abs(whip);

    p.r2.x += 1.2 * surf(0.18);
    p.r2.y += -lickUp * 0.6 + 0.6 * surf(0.16);

    p.r3.x += 0.8 * surf(0.15);
    p.r3.y += -lickUp * 0.9 + 0.8 * surf(0.14);

    p.bellyR1.x += 0.6 * surf(0.13);
    p.bellyR1.y += -lickUp * 0.4 + 0.5 * surf(0.12);

    p.l2.x += -0.8 * surf(0.19);
    p.l2.y += 0.4 * surf(0.17);

    p.l3.x += -0.9 * surf(0.16);
    p.l3.y += 0.3 * surf(0.15);

    const baseWaver = 0.85 * fbm(t * 0.42 + this._seeds.aura, 3, 2, 0.55);
    const basePulse = 0.35 * n11(t * 1.7 + this._seeds.lick);

    p.baseCtrl1.x += baseWaver + basePulse;
    p.baseCtrl2.x += baseWaver * 0.75;
    p.base.x += baseWaver * 0.35;
    p.baseCtrl3.x += baseWaver * 0.75 - basePulse;
    p.baseCtrl4.x += baseWaver - basePulse * 0.5;

    p.baseCtrl1.y += 0.8 * surf(0.11);
    p.baseCtrl2.y += 0.9 * surf(0.10);
    p.baseCtrl3.y += 0.9 * surf(0.09);
    p.baseCtrl4.y += 0.8 * surf(0.08);

    if (isBurst) {
      const k = 1.15 + 1.05 * burstPower;
      const side = burstSide * burstPower;
      const flutter = burstFlutter * burstPower;

      p.tip.y += 1.15 * k;
      p.tip.x += (0.45 * side + 0.22 * flutter) * k;

      p.r1.x += 0.18 * side * k;
      p.r2.x += 0.38 * side * k;
      p.r3.x += 0.30 * side * k;
      p.bellyR1.x += 0.16 * side * k;

      p.l1.x += 0.14 * side * k;
      p.l2.x += 0.26 * side * k;
      p.l3.x += 0.22 * side * k;
      p.bellyL3.x += 0.12 * side * k;

      p.r2.y += 0.36 * k;
      p.r3.y += 0.28 * k;
      p.l2.y += 0.18 * k;
      p.l3.y += 0.16 * k;
    }

    const cb = this._coreBase;
    const c = this._core;
    for (const k in cb) {
      const base = cb[k];
      const driftX = this._baselineDrift * 0.35 * this._coreDrift[k].x;
      const driftY = this._baselineDrift * 0.35 * this._coreDrift[k].y;
      c[k].x = base.x + driftX;
      c[k].y = base.y + driftY;
    }

    const lagT = t - (0.16 + 0.09 * (0.5 + 0.5 * Math.sin(t * 0.07 + this._seeds.core)));
    const lagSurf = s => 1.0 * fbm(lagT * s + this._seeds.core, 3, 2, 0.55);

    c.tip.x += 0.9 * fbm(lagT * F.whip + 31.7, 2, 2, 0.6);
    c.tip.y -= 1.4 * Math.abs(fbm(lagT * F.whip + 13.1, 2, 2, 0.6));

    c.r2.y += -lickUp * 0.5 + 0.6 * lagSurf(0.16);
    c.r3.y += -lickUp * 0.6 + 0.5 * lagSurf(0.14);
    c.r2.x += 0.6 * lagSurf(0.18);
    c.r3.x += 0.5 * lagSurf(0.15);

    for (const k of ['r1', 'r2', 'r3', 'l1', 'l2', 'l3', 'bellyR1', 'bellyR2']) {
      if (c[k]) c[k].x += coreLean * 0.9;
    }
    c.tip.x += coreLean;

    if (isBurst) {
      const kc = 1.05 + 0.85 * burstPower;
      const side = burstSide * burstPower;
      c.tip.y += 1.0 * kc;
      c.tip.x += 0.22 * side * kc;
      c.r2.y += 0.42 * kc;
      c.r2.x += 0.22 * side * kc;
      c.r3.x += 0.16 * side * kc;
      c.l2.x += 0.16 * side * kc;
    }

    this.aura.setAttribute('d', this._auraPath(p));
    this.core.setAttribute('d', this._corePath(c));

    const pivotX = 50, pivotY = 20;

    let squish = 1 + 0.08 * Math.sin(2 * Math.PI * F.squish * t + this._seed);
    const squishJit = 0.015 * fbm(t * 0.9 + this._seeds.aura, 2, 2, 0.6);
    squish += squishJit;
    squish *= (0.94 + intensity * 0.065) * (1 - 0.055 * collapse);
    const pinch = (1 / Math.sqrt(squish)) * (1 + 0.035 * collapse);

    const swayDeg = 0.6 * fbm(t * F.pivot + this._seeds.pivot, 3, 2, 0.55);
    const microSway = 0.25 * n11(t * 6.3 + this._seeds.pivot);
    const leanBias = 0.42 * fbm(t * 0.015 + this._seeds.pivot, 2, 2, 0.5);
    const auraAngle = swayDeg + microSway + leanBias;

    const auraTf =
      `translate(${pivotX},${pivotY}) ` +
      `scale(${pinch},${squish}) ` +
      `translate(0,${(collapse * 2.2).toFixed(3)}) ` +
      `rotate(${auraAngle.toFixed(3)}) ` +
      `translate(${-pivotX},${-pivotY})`;
    this.gAura.setAttribute('transform', auraTf);

    let squishCore = 1 + 0.10 * Math.sin(2 * Math.PI * F.coreLag * (t - 0.08) + this._seed);
    const squishCoreJit = 0.018 * fbm(t * 0.95 + this._seeds.core, 2, 2, 0.6);
    squishCore += squishCoreJit;
    squishCore *= (0.93 + intensity * 0.075) * (1 - 0.07 * collapse);
    const pinchCore = (1 / Math.sqrt(squishCore)) * (1 + 0.045 * collapse);
    const coreSway = swayDeg * 1.15;
    const microCore = 0.30 * n11(t * 7.1 + this._seeds.core);
    const coreAngle = coreSway + microCore + leanBias * 1.12;

    const coreTf =
      `translate(${pivotX},${pivotY}) ` +
      `scale(${pinchCore},${squishCore}) ` +
      `translate(0,${(collapse * 2.8).toFixed(3)}) ` +
      `rotate(${coreAngle.toFixed(3)}) ` +
      `translate(${-pivotX},${-pivotY}) ` +
      `translate(${coreLean},0)`;
    this.gCore.setAttribute('transform', coreTf);

    let flick = 0.76 + 0.15 *
      Math.max(0, Math.min(1,
        0.5 + 0.5 * fbm(t * F.flick + this._seeds.flick, 2, 2, 0.65)
      ));

    if (isBurst) flick += 0.05 * burstPower;
    flick -= 0.04 * collapse;
    const auraOpacity = flick * this._paletteResponse.aura * (0.82 + intensity * 0.18);
    this.aura.setAttribute('opacity', clamp(auraOpacity, 0.62, 0.98).toFixed(2));
    this.core.setAttribute('fill-opacity', clamp((0.42 + intensity * 0.16) * this._paletteResponse.core, 0.42, 0.68).toFixed(3));

    if (this._t % 2 === 0) {
      const breath = 0.5 + 0.5 * fbm(t * 0.18 + this._seeds.colour, 3, 2, 0.55);
      const auraMid = 0.78 + 0.10 * breath - 0.03 * collapse;
      const auraTip = 0.82 + 0.08 * breath;
      const coreGlow = 0.76 + 0.16 * breath - 0.04 * collapse;

      this._stops.aura[1].setAttribute('stop-opacity', auraMid.toFixed(3));
      this._stops.aura[2].setAttribute('stop-opacity', auraTip.toFixed(3));
      this._stops.core[1].setAttribute('stop-opacity', coreGlow.toFixed(3));
      this._stops.core[2].setAttribute('stop-opacity', (0.90 + 0.08 * breath).toFixed(3));
      if (this.onIntensity) this.onIntensity(clamp(intensity * this._paletteResponse.light, 0.58, 1.08));
    }
  }

  setColor(colorId) {
    this.colorId = colorId;
    const pal = COLOR_MAP[colorId] || COLOR_MAP.amber;
    const [a0, a1, a2] = this._stops.aura;
    const [c0, c1, c2] = this._stops.core;
    a0.setAttribute('stop-color', pal.aura[0]);
    a1.setAttribute('stop-color', pal.aura[1]);
    a2.setAttribute('stop-color', pal.aura[2]);
    c0.setAttribute('stop-color', pal.core[0]);
    c1.setAttribute('stop-color', pal.core[1]);
    c2.setAttribute('stop-color', pal.core[2]);
    this._paletteResponse = pal.response;
  }

  setBase(baseId) {
    this.baseId = baseId;
    const o = BASE_OFFSETS[baseId] || { x: 0, y: -8, scale: 1 };
    this._baseTransform = `translate(${o.x}%, ${o.y}%) scale(${o.scale})`;
    this.wrap.setAttribute('transform', this._baseTransform);
  }

  setLit(isLit) {
    this._isLit = !!isLit;
    this.svg.setAttribute('data-lit', isLit ? 'true' : 'false');

    if (isLit && !this.reducedMotion) {
      this._start();
    } else {
      this._stop();
      this._resetShape();
    }
  }

  setPaused(paused) {
    this._paused = !!paused;

    if (this._paused) {
      this._stop();
    } else if (this._isLit && !this.reducedMotion) {
      this._start();
    }
  }

  destroy() {
    this._stop();
    if (typeof this._reducedMotionQuery.removeEventListener === 'function') {
      this._reducedMotionQuery.removeEventListener('change', this._handleReducedMotionChange);
    } else {
      this._reducedMotionQuery.removeListener(this._handleReducedMotionChange);
    }
    if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
    this.svg = this.wrap = this.gAura = this.gCore = this.aura = this.core = null;
  }

  _start() {
    if (this._paused || this._animFrame || this._frameTimer) return;

    this._freqs = {
      squish: 0.45 + Math.random() * 0.2,
      coreLag: 0.45 + Math.random() * 0.2,
      lick: 0.9 + Math.random() * 0.3,
      whip: 2.2 + Math.random() * 0.6,
      pivot: 0.25 + Math.random() * 0.25,
      flick: 10 + Math.random() * 4,
      burst: 0.35 + Math.random() * 0.25
    };

    this.core.setAttribute('filter', 'url(#flame-core-blur)');

    const schedule = () => {
      if (!this._isLit || this._paused) return;
      const delay = Math.max(0, this._nextFrameAt - performance.now() - 8);
      this._frameTimer = window.setTimeout(() => {
        this._frameTimer = null;
        this._animFrame = requestAnimationFrame(step);
      }, delay);
    };

    const step = (now = performance.now()) => {
      this._animFrame = null;
      if (!this._isLit || this._paused) {
        return;
      }

      const elapsed = this._lastFrameAt ? Math.min(0.1, Math.max(0, (now - this._lastFrameAt) / 1000)) : this._dt;
      this._lastFrameAt = now;
      if (!this._nextFrameAt || this._nextFrameAt < now - this._frameMs) {
        this._nextFrameAt = now;
      }
      this._nextFrameAt += this._frameMs;
      this._t++;
      this._time += elapsed;
      this._tick();

      schedule();
    };
    this._animFrame = requestAnimationFrame(step);
  }

  _stop() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this._frameTimer) clearTimeout(this._frameTimer);
    this._animFrame = null;
    this._frameTimer = null;
    this._lastFrameAt = 0;
    this._nextFrameAt = 0;
  }

  _resetShape() {
    this._baselineDrift = 0;
    this._aura = JSON.parse(JSON.stringify(this._auraBase));
    this._core = JSON.parse(JSON.stringify(this._coreBase));
    this.aura.setAttribute('d', this._auraPath(this._aura));
    this.core.setAttribute('d', this._corePath(this._core));
    this.gAura.setAttribute('transform', '');
    this.gCore.setAttribute('transform', '');
    this.wrap.setAttribute('transform', this._baseTransform);
    this.aura.setAttribute('opacity', '0.84');
    this.core.setAttribute('fill-opacity', '0.52');
    this.core.removeAttribute('filter');
    if (this.onIntensity) this.onIntensity(1);
  }

  _auraPath(p) {
    return [
      `M${p.tip.x} ${p.tip.y}`,
      `C${p.r1.x} ${p.r1.y}, ${p.r2.x} ${p.r2.y}, ${p.r3.x} ${p.r3.y}`,
      `C${p.bellyR1.x} ${p.bellyR1.y}, ${p.bellyR2.x} ${p.bellyR2.y}, ${p.bellyEnd.x} ${p.bellyEnd.y}`,
      `C${p.baseCtrl1.x} ${p.baseCtrl1.y}, ${p.baseCtrl2.x} ${p.baseCtrl2.y}, ${p.base.x} ${p.base.y}`,
      `C${p.baseCtrl3.x} ${p.baseCtrl3.y}, ${p.baseCtrl4.x} ${p.baseCtrl4.y}, ${p.bellyL1.x} ${p.bellyL1.y}`,
      `C${p.bellyL2.x} ${p.bellyL2.y}, ${p.bellyL3.x} ${p.bellyL3.y}, ${p.l3.x} ${p.l3.y}`,
      `C${p.l2.x} ${p.l2.y}, ${p.l1.x} ${p.l1.y}, ${p.tip.x} ${p.tip.y} Z`
    ].join(' ');
  }

  _corePath(c) {
    return [
      `M${c.tip.x} ${c.tip.y}`,
      `C${c.r1.x} ${c.r1.y}, ${c.r2.x} ${c.r2.y}, ${c.r3.x} ${c.r3.y}`,
      `C${c.bellyR1.x} ${c.bellyR1.y}, ${c.bellyR2.x} ${c.bellyR2.y}, ${c.bellyEnd.x} ${c.bellyEnd.y}`,
      `C${(c.bellyR2.x - 1)} ${c.bellyR2.y}, ${(c.bellyR1.x - 5)} ${(c.bellyR1.y - 8)}, ${c.l3.x || 42} ${c.l3?.y || 53}`,
      `C${c.l2.x || 38} ${c.l2?.y || 36}, ${c.l1.x || 42} ${c.l1?.y || 20}, ${c.tip.x} ${c.tip.y} Z`
    ].join(' ');
  }
}
