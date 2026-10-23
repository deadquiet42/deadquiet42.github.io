const canvas = document.getElementById('art');
const ctx = canvas.getContext('2d');
const artworkSnapshot = document.createElement('canvas');
const artworkSnapshotCtx = artworkSnapshot.getContext('2d');
const generateBtn = document.getElementById('generate');
const sizeVarianceSlider = document.getElementById("sizeVariance");
const rotationRangeSlider = document.getElementById("rotationRange");
const strokeWeightSlider = document.getElementById("strokeWeight");

const sizeVarVal = document.getElementById("sizeVarVal");
const rotationVal = document.getElementById("rotationVal");
const strokeVal = document.getElementById("strokeVal");
const shapeTypeToggle = document.getElementById("shapeTypeToggle");
const glitchToggle = document.getElementById("glitchToggle");

const SHAPE_TYPE_OPTIONS = [
  { type: 'semicircle', label: 'Semicircles' },
  { type: 'triangle', label: 'Triangles' },
  { type: 'hexagon', label: 'Hexagons' }
];

let selectedShapeTypeIndex = 0;

function syncShapeTypeControl() {
  const selected = SHAPE_TYPE_OPTIONS[selectedShapeTypeIndex];
  shapeTypeToggle.textContent = selected.label;
  shapeTypeToggle.setAttribute('aria-label', `Shape type: ${selected.label}. Activate to change shape`);
  document.getElementById('semicircleCount').dataset.shapeType = selected.type;
  document.getElementById('semicircleCount').setAttribute('aria-label', `${selected.label} count`);
}

shapeTypeToggle.addEventListener('click', () => {
  selectedShapeTypeIndex = (selectedShapeTypeIndex + 1) % SHAPE_TYPE_OPTIONS.length;
  syncShapeTypeControl();
});

syncShapeTypeControl();

sizeVarianceSlider.addEventListener("input", () => {
  sizeVarVal.textContent = `${sizeVarianceSlider.value}%`;
});

rotationRangeSlider.addEventListener("input", () => {
  rotationVal.textContent = `${rotationRangeSlider.value}°`;
});

strokeWeightSlider.addEventListener("input", () => {
  strokeVal.textContent = `${strokeWeightSlider.value} px`;
});

let drawLog = [];
let originalMonochromeStyles = [];
import { setupDownload } from './download.js';
import { getShapeBounds, renderGalleryCanvas } from './render.js';
import { createGlitchPlan } from './glitch.js';

const sliders = {
  square: document.getElementById('squareCount'),
  circle: document.getElementById('circleCount'),
  line: document.getElementById('lineCount'),
  semicircle: document.getElementById('semicircleCount'),
  dot: document.getElementById('dotCount')
};

const values = {
  square: document.getElementById('squareVal'),
  circle: document.getElementById('circleVal'),
  line: document.getElementById('lineVal'),
  semicircle: document.getElementById('semicircleVal'),
  dot: document.getElementById('dotVal')
};

let WIDTH, HEIGHT, PADDING, SAFE_WIDTH, SAFE_HEIGHT;

function setCanvasSize() {
  canvas.style.width = '';
  canvas.style.height = '';

  const renderedSize = canvas.getBoundingClientRect?.().width;
  const cssSize = renderedSize || Math.min(window.innerWidth, window.innerHeight) * 0.9;
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  WIDTH = cssSize;
  HEIGHT = cssSize;

  PADDING = cssSize * 0.1;
  SAFE_WIDTH = WIDTH - PADDING * 2;
  SAFE_HEIGHT = HEIGHT - PADDING * 2;
}

function captureArtworkSnapshot() {
  artworkSnapshot.width = canvas.width;
  artworkSnapshot.height = canvas.height;
  artworkSnapshotCtx.drawImage(canvas, 0, 0);
}

function resizePreservingArtwork() {
  if (!artworkSnapshot.width || !artworkSnapshot.height) return;

  setCanvasSize();
  ctx.drawImage(artworkSnapshot, 0, 0, WIDTH, HEIGHT);
}

const LIMITED_PALETTE = [
  { hex: "#00FFEC", w: 50 },
  { hex: "#CC00FF", w: 18 },
  { hex: "#FF00CE", w: 18 },
  { hex: "#21FF25", w: 10 },
  { hex: "#FFFC02", w: 4 }
];

function pickWeightedHex() {
  const total = LIMITED_PALETTE.reduce((s, c) => s + c.w, 0);
  let r = Math.random() * total;

  for (const c of LIMITED_PALETTE) {
    r -= c.w;
    if (r <= 0) return c.hex;
  }

  return LIMITED_PALETTE[0].hex;
}

function hexToRgba(hex, a = 1) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function colourModeOn() {
  return document.body.classList.contains("colour-mode");
}

function invertModeOn() {
  return document.body.classList.contains("gg-invert") ||
         document.body.classList.contains("invert-mode");
}

function pickStrokeOrFill(alpha, type = null) {
  const toneChance = Math.random();

  if (!colourModeOn()) {
    if (toneChance < 0.05) return "black";
    if (toneChance > 0.95) return "white";
    return grey(Math.floor(Math.random() * 256), alpha);
  }

  if (toneChance < 0.03) return invertModeOn() ? "white" : "black";
  if (toneChance > 0.97) return invertModeOn() ? "black" : "white";

  if (type === "dot") {
    return hexToRgba("#00FFEC", alpha);
  }

  const hex = pickWeightedHex();
  return hexToRgba(hex, alpha);
}

function grey(val, alpha = 1) {
  return `rgba(${val}, ${val}, ${val}, ${alpha})`;
}

function randomGradient(x, y, size) {
  const vertical = Math.random() < 0.5;
  const start = vertical ? y - size / 2 : x - size / 2;
  const end = vertical ? y + size / 2 : x + size / 2;
  const g1 = Math.floor(Math.random() * 100 + 50);
  const g2 = Math.floor(Math.random() * 100 + 150);
  const grad = vertical
    ? ctx.createLinearGradient(x, start, x, end)
    : ctx.createLinearGradient(start, y, end, y);
  grad.addColorStop(0, grey(g1));
  grad.addColorStop(1, grey(g2));
  return {
    fill: grad,
    meta: {
      vertical,
      g1,
      g2
    }
  };
}

function createShapeData(type, x, y, size, color, filled = true) {
  const strokeWeight = parseFloat(document.getElementById("strokeWeight").value);
  const rotationRange = parseFloat(document.getElementById("rotationRange").value);
  const sizeVariance = parseFloat(document.getElementById("sizeVariance").value);
  const ROTATABLE_SHAPES = ['square', 'semicircle', 'triangle', 'hexagon'];

  const sizeOffset = size * (sizeVariance / 100) * (Math.random() - 0.5);
  const minSize = size * 0.2;
  const maxSize = size * 2;
  const finalSize = Math.max(minSize, Math.min(maxSize, size + sizeOffset));

  const shapeData = {
    type,
    x, y, size: finalSize,
    color,
    filled,
    strokeWeight
  };

  if (ROTATABLE_SHAPES.includes(type)) {
    shapeData.rotation = (Math.random() - 0.5) * (rotationRange * Math.PI / 180);
  }

  if (type === 'line') {
    const isVertical = Math.random() < 0.5;
    const length = Math.min(finalSize, SAFE_WIDTH, SAFE_HEIGHT);
    shapeData.x2 = isVertical ? x : Math.min(x + length, WIDTH - PADDING);
    shapeData.y2 = isVertical ? Math.min(y + length, HEIGHT - PADDING) : y;
    shapeData.isBroken = Math.random() < 0.2;
    shapeData.isDotted = shapeData.isBroken && Math.random() < 0.5;

    if (!shapeData.isBroken && Math.random() < 0.15) {
      const tx = (x + shapeData.x2) / 2;
      const ty = (y + shapeData.y2) / 2;
      const triangleSize = 5 + Math.random() * 5;
      const angle = Math.atan2(shapeData.y2 - y, shapeData.x2 - x);

      shapeData.triangle = [
        { x: tx + Math.cos(angle) * triangleSize, y: ty + Math.sin(angle) * triangleSize },
        { x: tx + Math.cos(angle + 2.5) * triangleSize, y: ty + Math.sin(angle + 2.5) * triangleSize },
        { x: tx + Math.cos(angle - 2.5) * triangleSize, y: ty + Math.sin(angle - 2.5) * triangleSize }
      ];
      shapeData.triangleFilled = Math.random() < 0.5;
    }
  } else if (type === 'semicircle') {
    const flip = Math.floor(Math.random() * 4);
    shapeData.startAngle = flip * (Math.PI / 2);
    shapeData.endAngle = shapeData.startAngle + Math.PI;
  }

  return shapeData;
}

function drawShape(shapeData) {
  const { type, x, y, size: finalSize, color, filled, strokeWeight } = shapeData;
  const shouldRotate = ['square', 'semicircle', 'triangle', 'hexagon'].includes(type);

  ctx.lineWidth = strokeWeight;
  ctx.strokeStyle = color;

  let gradient = null;
  let fillStyle = color;

  if (!colourModeOn() && filled && Math.random() < 0.2 && type !== 'line') {
    const gradResult = randomGradient(x, y, finalSize);
    gradient = gradResult.fill;
    fillStyle = gradient;

    shapeData.gradientMeta = {
      vertical: gradResult.meta.vertical,
      g1: gradResult.meta.g1,
      g2: gradResult.meta.g2
    };
  }

  ctx.fillStyle = fillStyle;

  if (shouldRotate) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(shapeData.rotation || 0);
  }

  switch (type) {
    case 'square':
      filled
        ? ctx.fillRect(-finalSize / 2, -finalSize / 2, finalSize, finalSize)
        : ctx.strokeRect(-finalSize / 2, -finalSize / 2, finalSize, finalSize);
      break;

    case 'circle':
      ctx.beginPath();
      ctx.arc(x, y, finalSize / 2, 0, 2 * Math.PI);
      filled ? ctx.fill() : ctx.stroke();
      break;

    case 'line':
      ctx.beginPath();
      if (shapeData.isBroken) {
        ctx.setLineDash(shapeData.isDotted ? [2, 6] : [10, 6]);
      }

      ctx.moveTo(x, y);
      ctx.lineTo(shapeData.x2, shapeData.y2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (shapeData.triangle) {
        ctx.beginPath();
        ctx.moveTo(shapeData.triangle[0].x, shapeData.triangle[0].y);
        ctx.lineTo(shapeData.triangle[1].x, shapeData.triangle[1].y);
        ctx.lineTo(shapeData.triangle[2].x, shapeData.triangle[2].y);
        ctx.closePath();
        shapeData.triangleFilled ? ctx.fill() : ctx.stroke();
      }
      break;

    case 'semicircle':
      ctx.beginPath();
      ctx.arc(0, 0, finalSize / 2, shapeData.startAngle, shapeData.endAngle);
      filled ? ctx.fill() : ctx.stroke();
      break;

    case 'triangle':
    case 'hexagon': {
      const sides = type === 'triangle' ? 3 : 6;
      ctx.beginPath();

      for (let side = 0; side < sides; side++) {
        const angle = -Math.PI / 2 + side * (Math.PI * 2 / sides);
        const pointX = Math.cos(angle) * finalSize / 2;
        const pointY = Math.sin(angle) * finalSize / 2;
        side === 0 ? ctx.moveTo(pointX, pointY) : ctx.lineTo(pointX, pointY);
      }

      ctx.closePath();
      filled ? ctx.fill() : ctx.stroke();
      break;
    }

    case 'dot':
      ctx.beginPath();
      ctx.arc(x, y, finalSize / 2, 0, 2 * Math.PI);
      filled ? ctx.fill() : ctx.stroke();
      break;
  }

  if (shouldRotate) {
    ctx.restore();
  }

  drawLog.push(shapeData);
}

function drawComposition() {
  drawLog.length = 0;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const bg = (invertModeOn() && colourModeOn()) ? "#000000" : "#ffffff";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const selectedShapeType = sliders.semicircle.dataset.shapeType || 'semicircle';
  const shapeCounts = {
    square: parseInt(sliders.square.value),
    circle: parseInt(sliders.circle.value),
    line: parseInt(sliders.line.value),
    [selectedShapeType]: parseInt(sliders.semicircle.value)
  };

  const placed = [];

  function overlaps(bounds) {
    return placed.some(s =>
      !(
        bounds.maxX < s.minX ||
        bounds.minX > s.maxX ||
        bounds.maxY < s.minY ||
        bounds.minY > s.maxY
      )
    );
  }

  function isInsideSafeArea(bounds) {
    return bounds.minX >= PADDING &&
      bounds.minY >= PADDING &&
      bounds.maxX <= WIDTH - PADDING &&
      bounds.maxY <= HEIGHT - PADDING;
  }

  function commitShape(shape, bounds) {
    drawShape(shape);
    placed.push({ ...bounds, shapeType: shape.type });
  }

  function translateShape(shape, dx, dy) {
    shape.x += dx;
    shape.y += dy;

    if (shape.type === 'line') {
      shape.x2 += dx;
      shape.y2 += dy;
      shape.triangle?.forEach(point => {
        point.x += dx;
        point.y += dy;
      });
    }
  }

  function positionAtEdge(shape, anchor, angle) {
    const bounds = getShapeBounds(shape);
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const overlapDepth = shape.type === 'dot' ? 0.75 : 2;

    if (shape.type === 'dot' && anchor.shapeType === 'dot') {
      const anchorRadius = Math.min(
        anchor.maxX - anchor.minX,
        anchor.maxY - anchor.minY
      ) / 2;
      const shapeRadius = Math.min(
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY
      ) / 2;
      const distance = Math.max(0, anchorRadius + shapeRadius - overlapDepth);
      const dx = directionX * distance;
      const dy = directionY * distance;

      translateShape(shape, dx, dy);

      return {
        minX: bounds.minX + dx,
        minY: bounds.minY + dy,
        maxX: bounds.maxX + dx,
        maxY: bounds.maxY + dy
      };
    }

    const distanceX = Math.abs(directionX) < 0.0001
      ? Infinity
      : directionX > 0
        ? (anchor.maxX - overlapDepth - bounds.minX) / directionX
        : (bounds.maxX - anchor.minX - overlapDepth) / -directionX;
    const distanceY = Math.abs(directionY) < 0.0001
      ? Infinity
      : directionY > 0
        ? (anchor.maxY - overlapDepth - bounds.minY) / directionY
        : (bounds.maxY - anchor.minY - overlapDepth) / -directionY;
    const distance = Math.max(0, Math.min(distanceX, distanceY));
    const dx = directionX * distance;
    const dy = directionY * distance;

    translateShape(shape, dx, dy);

    return {
      minX: bounds.minX + dx,
      minY: bounds.minY + dy,
      maxX: bounds.maxX + dx,
      maxY: bounds.maxY + dy
    };
  }

  function createGrowthFallback(type, size, filled) {
    const angleSteps = 16;
    const phase = Math.random() * Math.PI * 2;

    for (let anchorIndex = placed.length - 1; anchorIndex >= 0; anchorIndex--) {
      const anchor = placed[anchorIndex];
      const centerX = (anchor.minX + anchor.maxX) / 2;
      const centerY = (anchor.minY + anchor.maxY) / 2;

      for (let step = 0; step < angleSteps; step++) {
        const shape = createShapeData(type, centerX, centerY, size, null, filled);
        const angle = phase + step * (Math.PI * 2 / angleSteps);
        const bounds = positionAtEdge(shape, anchor, angle);

        if (isInsideSafeArea(bounds) && overlaps(bounds)) {
          return { shape, bounds };
        }
      }
    }

    const shape = createShapeData(type, WIDTH / 2, HEIGHT / 2, size, null, filled);
    return { shape, bounds: getShapeBounds(shape) };
  }

  const centerType = Object.keys(shapeCounts).find(type => shapeCounts[type] > 0);
  let dotCount = parseInt(sliders.dot.value);

  if (centerType) {
    const size = Math.random() * (WIDTH / 8) + 20;
    const filled = centerType === 'line' ? false : Math.random() > 0.3;
    const x = WIDTH / 2;
    const y = HEIGHT / 2;
    const alpha = 0.25 + Math.random() * 0.2;
    const color = pickStrokeOrFill(alpha, centerType);
    const shape = createShapeData(centerType, x, y, size, color, filled);
    const bounds = getShapeBounds(shape);

    commitShape(shape, bounds);
    shapeCounts[centerType]--;
  } else if (dotCount > 0) {
    const radius = 2 + Math.random() * 3;
    const color = pickStrokeOrFill(0.3 + Math.random() * 0.3, 'dot');
    const shape = createShapeData('dot', WIDTH / 2, HEIGHT / 2, radius * 2, color, true);
    const bounds = getShapeBounds(shape);

    commitShape(shape, bounds);
    dotCount--;
  }

  Object.entries(shapeCounts).forEach(([type, count]) => {
    for (let n = 0; n < count; n++) {
      const size = Math.random() * (WIDTH / 8) + 20;
      const filled = type === 'line' ? false : Math.random() > 0.3;

      let x, y, bounds, attempt = 0, placedShape = false;

      while (!placedShape && attempt < 50) {
        x = PADDING + Math.random() * SAFE_WIDTH;
        y = PADDING + Math.random() * SAFE_HEIGHT;
        const shape = createShapeData(type, x, y, size, null, filled);
        bounds = getShapeBounds(shape);

        if (isInsideSafeArea(bounds) && overlaps(bounds)) {
          const alpha = 0.25 + Math.random() * 0.2;
          shape.color = pickStrokeOrFill(alpha, type);

          commitShape(shape, bounds);
          placedShape = true;
        }

        attempt++;
      }

      if (!placedShape) {
        const fallback = createGrowthFallback(type, size, filled);
        fallback.shape.color = pickStrokeOrFill(0.25 + Math.random() * 0.2, type);
        commitShape(fallback.shape, fallback.bounds);
      }
    }
  });

  for (let i = 0; i < dotCount; i++) {
    const radius = 2 + Math.random() * 3;
    let x, y, bounds, attempt = 0, placed = false;

    while (!placed && attempt < 50) {
      x = PADDING + Math.random() * SAFE_WIDTH;
      y = PADDING + Math.random() * SAFE_HEIGHT;

      const shape = createShapeData('dot', x, y, radius * 2, null, true);
      bounds = getShapeBounds(shape);

      if (isInsideSafeArea(bounds) && overlaps(bounds)) {
        const alpha = 0.3 + Math.random() * 0.3;
        shape.color = pickStrokeOrFill(alpha, "dot");
        commitShape(shape, bounds);
        placed = true;
      }

      attempt++;
    }

    if (!placed) {
      const fallback = createGrowthFallback('dot', radius * 2, true);
      fallback.shape.color = pickStrokeOrFill(0.3 + Math.random() * 0.3, 'dot');
      commitShape(fallback.shape, fallback.bounds);
    }
  }

  drawLog.glitch = createGlitchPlan(drawLog);

  return drawLog;
}

function glitchModeOn() {
  return document.body.classList.contains("glitch-mode");
}

function displayCroppedComposition(composition) {
  const previewSize = canvas.width;
  const preview = renderGalleryCanvas(composition, previewSize);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function styleAlphaFor(shape) {
  return shape.type === 'dot'
    ? 0.3 + Math.random() * 0.3
    : 0.25 + Math.random() * 0.2;
}

function captureOriginalMonochromeStyles(composition) {
  originalMonochromeStyles = composition.map(shape => ({
    color: shape.color,
    gradientMeta: shape.gradientMeta ? { ...shape.gradientMeta } : null
  }));
}

function applyFreshCompositionStyle() {
  for (const shape of drawLog) {
    shape.color = pickStrokeOrFill(styleAlphaFor(shape), shape.type);
    delete shape.gradientMeta;

    if (!colourModeOn() && shape.filled && shape.type !== 'line' && Math.random() < 0.2) {
      shape.gradientMeta = {
        vertical: Math.random() < 0.5,
        g1: Math.floor(Math.random() * 100 + 50),
        g2: Math.floor(Math.random() * 100 + 150)
      };
    }
  }
}

function restoreOriginalMonochromeStyles() {
  if (originalMonochromeStyles.length !== drawLog.length) {
    applyFreshCompositionStyle();
    captureOriginalMonochromeStyles(drawLog);
    return;
  }

  drawLog.forEach((shape, index) => {
    const originalStyle = originalMonochromeStyles[index];
    shape.color = originalStyle.color;

    if (originalStyle.gradientMeta) {
      shape.gradientMeta = { ...originalStyle.gradientMeta };
    } else {
      delete shape.gradientMeta;
    }
  });
}

function restyleComposition() {
  if (colourModeOn()) {
    applyFreshCompositionStyle();
  } else {
    restoreOriginalMonochromeStyles();
  }

  displayCroppedComposition(drawLog);
  captureArtworkSnapshot();
}

function invertCompositionStyle() {
  if (colourModeOn()) {
    for (const shape of drawLog) {
      if (shape.color === 'black') shape.color = 'white';
      else if (shape.color === 'white') shape.color = 'black';
    }
  }

  displayCroppedComposition(drawLog);
  captureArtworkSnapshot();
}

function toggleGlitchMode() {
  document.body.classList.toggle('glitch-mode', glitchToggle.checked);
  displayCroppedComposition(drawLog);
  captureArtworkSnapshot();
}

function regenerate() {
  setCanvasSize();
  const composition = drawComposition();

  if (!colourModeOn()) {
    captureOriginalMonochromeStyles(composition);
  } else {
    originalMonochromeStyles = [];
  }

  displayCroppedComposition(composition);
  captureArtworkSnapshot();
  return composition;
}

window.regenerate = regenerate;
window.restyleGeogrowth = restyleComposition;
window.invertGeogrowth = invertCompositionStyle;

function syncSliderLabels() {
  for (const type in sliders) {
    if (values[type]) {
      values[type].textContent = sliders[type].value;
    }
  }
}

generateBtn.addEventListener('click', regenerate);
if (glitchToggle) {
  glitchToggle.checked = glitchModeOn();
  glitchToggle.addEventListener('change', toggleGlitchMode);
}
Object.values(sliders).forEach(slider => {
  slider.addEventListener('input', () => {
    syncSliderLabels();
  });
});

let resizeFrame = 0;
function scheduleCanvasResize() {
  if (resizeFrame) return;

  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    resizePreservingArtwork();
  });
}

window.addEventListener('resize', scheduleCanvasResize, { passive: true });
window.addEventListener('orientationchange', scheduleCanvasResize, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleCanvasResize, { passive: true });

syncSliderLabels();
regenerate();
setupDownload(drawLog);
