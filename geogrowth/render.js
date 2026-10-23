
const TAU = Math.PI * 2;
export const GALLERY_PADDING_RATIO = 100 / 1024;

function normaliseAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

function angleIsOnClockwiseArc(angle, startAngle, endAngle) {
  const rawSweep = endAngle - startAngle;
  if (Math.abs(rawSweep) >= TAU - Number.EPSILON * 16) return true;

  const sweep = normaliseAngle(rawSweep);
  const offset = normaliseAngle(angle - startAngle);
  return offset <= sweep + Number.EPSILON * 16;
}

function boundsFromPoints(points) {
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y)
  }), {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  });
}

function expandBounds(bounds, amount) {
  if (!(amount > 0)) return bounds;
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount
  };
}

function unionBounds(...items) {
  return items.reduce((bounds, item) => ({
    minX: Math.min(bounds.minX, item.minX),
    minY: Math.min(bounds.minY, item.minY),
    maxX: Math.max(bounds.maxX, item.maxX),
    maxY: Math.max(bounds.maxY, item.maxY)
  }));
}

function shapeStrokeWidth(shape) {
  const value = Number(shape.strokeWeight);
  return Number.isFinite(value) && value > 0 ? value : 2;
}

function approximatePathLength(shape, size, scale) {
  switch (shape.type) {
    case 'square':
      return size * 4;
    case 'circle':
    case 'dot':
      return Math.PI * size;
    case 'semicircle':
      return Math.PI * size / 2;
    case 'triangle':
      return 3 * Math.sqrt(3) * size / 2;
    case 'hexagon':
      return size * 3;
    case 'line':
      return Math.hypot(
        (shape.x2 - shape.x) * scale,
        (shape.y2 - shape.y) * scale
      );
    default:
      return size;
  }
}

function renderShape(ctx, shape, scale, offsetX, offsetY, grey, interruption = null) {
  const { type, x, y, size: sizeValue, color, filled } = shape;
  const sx = x * scale + offsetX;
  const sy = y * scale + offsetY;
  const size = sizeValue * scale;

  ctx.lineWidth = shapeStrokeWidth(shape) * scale;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  if (filled && shape.gradientMeta) {
    const { vertical, g1, g2 } = shape.gradientMeta;
    const start = vertical ? sy - size / 2 : sx - size / 2;
    const end = vertical ? sy + size / 2 : sx + size / 2;
    const gradient = vertical
      ? ctx.createLinearGradient(sx, start, sx, end)
      : ctx.createLinearGradient(start, sy, end, sy);
    gradient.addColorStop(0, grey(g1));
    gradient.addColorStop(1, grey(g2));
    ctx.fillStyle = gradient;
  }

  if (interruption && !filled) {
    const pathLength = approximatePathLength(shape, size, scale);
    ctx.setLineDash([
      interruption.start * pathLength,
      interruption.length * pathLength,
      pathLength
    ]);
  }

  switch (type) {
    case 'square':
      ctx.save();
      ctx.translate(sx, sy);
      if (shape.rotation) ctx.rotate(shape.rotation);
      filled
        ? ctx.fillRect(-size / 2, -size / 2, size, size)
        : ctx.strokeRect(-size / 2, -size / 2, size, size);
      ctx.restore();
      break;

    case 'circle':
    case 'dot':
      ctx.beginPath();
      ctx.arc(sx, sy, size / 2, 0, TAU);
      filled ? ctx.fill() : ctx.stroke();
      break;

    case 'semicircle':
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(shape.rotation || 0);
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, shape.startAngle, shape.endAngle);
      filled ? ctx.fill() : ctx.stroke();
      ctx.restore();
      break;

    case 'triangle':
    case 'hexagon': {
      const sides = type === 'triangle' ? 3 : 6;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(shape.rotation || 0);
      ctx.beginPath();

      for (let side = 0; side < sides; side++) {
        const angle = -Math.PI / 2 + side * (TAU / sides);
        const pointX = Math.cos(angle) * size / 2;
        const pointY = Math.sin(angle) * size / 2;
        side === 0 ? ctx.moveTo(pointX, pointY) : ctx.lineTo(pointX, pointY);
      }

      ctx.closePath();
      filled ? ctx.fill() : ctx.stroke();
      ctx.restore();
      break;
    }

    case 'line': {
      const x2 = shape.x2 * scale + offsetX;
      const y2 = shape.y2 * scale + offsetY;

      if (!interruption && shape.isBroken) {
        ctx.setLineDash(shape.isDotted ? [2 * scale, 6 * scale] : [10 * scale, 6 * scale]);
      }

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (shape.triangle) {
        const points = shape.triangle.map(point => ({
          x: point.x * scale + offsetX,
          y: point.y * scale + offsetY
        }));
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.lineTo(points[2].x, points[2].y);
        ctx.closePath();
        shape.triangleFilled ? ctx.fill() : ctx.stroke();
      }
      break;
    }
  }

  ctx.setLineDash([]);
}

function applySliceGlitch(canvas, ctx, slice, background) {
  if (!slice) return;

  const source = document.createElement('canvas');
  source.width = canvas.width;
  source.height = canvas.height;
  source.getContext('2d').drawImage(canvas, 0, 0);

  const y = Math.round(slice.y * canvas.height);
  const height = Math.max(1, Math.round(slice.height * canvas.height));
  const offset = Math.round(slice.offset * canvas.width);

  ctx.fillStyle = background;
  ctx.fillRect(0, y, canvas.width, height);
  ctx.drawImage(source, 0, y, canvas.width, height, offset, y, canvas.width, height);
}

function regularPolygonPoints(shape, radius) {
  const sides = shape.type === 'triangle' ? 3 : 6;
  const rotation = shape.rotation || 0;

  return Array.from({ length: sides }, (_, side) => {
    const angle = -Math.PI / 2 + rotation + side * (TAU / sides);
    return {
      x: shape.x + Math.cos(angle) * radius,
      y: shape.y + Math.sin(angle) * radius
    };
  });
}

export function getShapeBounds(shape) {
  const { type, x, y, size, filled } = shape;
  const half = size / 2;
  let bounds;

  switch (type) {
    case 'line': {
      const dx = shape.x2 - x;
      const dy = shape.y2 - y;
      const length = Math.hypot(dx, dy);
      const strokeHalf = shapeStrokeWidth(shape) / 2;
      const strokeX = length > 0 ? Math.abs(dy / length) * strokeHalf : strokeHalf;
      const strokeY = length > 0 ? Math.abs(dx / length) * strokeHalf : strokeHalf;
      const lineBounds = {
        minX: Math.min(x, shape.x2) - strokeX,
        minY: Math.min(y, shape.y2) - strokeY,
        maxX: Math.max(x, shape.x2) + strokeX,
        maxY: Math.max(y, shape.y2) + strokeY
      };

      if (Array.isArray(shape.triangle) && shape.triangle.length > 0) {
        const triangleBounds = boundsFromPoints(shape.triangle);
        bounds = unionBounds(
          lineBounds,
          shape.triangleFilled ? triangleBounds : expandBounds(triangleBounds, strokeHalf)
        );
      } else {
        bounds = lineBounds;
      }
      break;
    }

    case 'square': {
      const rotation = shape.rotation || 0;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const extent = filled ? half : half + shapeStrokeWidth(shape) / 2;
      const corners = [
        { x: -extent, y: -extent },
        { x: extent, y: -extent },
        { x: extent, y: extent },
        { x: -extent, y: extent }
      ].map(point => ({
        x: x + point.x * cos - point.y * sin,
        y: y + point.x * sin + point.y * cos
      }));
      bounds = boundsFromPoints(corners);
      break;
    }

    case 'semicircle': {
      const startAngle = shape.startAngle ?? 0;
      const endAngle = shape.endAngle ?? Math.PI;
      const rotation = shape.rotation || 0;
      const candidateAngles = [
        startAngle,
        endAngle,
        -rotation,
        Math.PI / 2 - rotation,
        Math.PI - rotation,
        Math.PI * 1.5 - rotation
      ].filter((angle, index, angles) => (
        angleIsOnClockwiseArc(angle, startAngle, endAngle) &&
        angles.indexOf(angle) === index
      ));
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const strokeHalf = filled ? 0 : shapeStrokeWidth(shape) / 2;
      const radii = filled
        ? [half]
        : [Math.max(0, half - strokeHalf), half + strokeHalf];
      const points = candidateAngles.flatMap(angle => (
        radii.map(radius => {
          const localX = Math.cos(angle) * radius;
          const localY = Math.sin(angle) * radius;
          return {
            x: x + localX * cos - localY * sin,
            y: y + localX * sin + localY * cos
          };
        })
      ));
      bounds = boundsFromPoints(points);
      break;
    }

    case 'triangle':
    case 'hexagon': {
      const sides = type === 'triangle' ? 3 : 6;
      const interiorAngle = (sides - 2) * Math.PI / sides;
      const strokeExtension = filled
        ? 0
        : (shapeStrokeWidth(shape) / 2) / Math.sin(interiorAngle / 2);
      bounds = boundsFromPoints(regularPolygonPoints(shape, half + strokeExtension));
      break;
    }

    case 'circle':
    case 'dot':
    default:
      bounds = {
        minX: x - half,
        minY: y - half,
        maxX: x + half,
        maxY: y + half
      };
      break;
  }

  const needsStrokeExpansion = !filled && !['line', 'square', 'semicircle', 'triangle', 'hexagon'].includes(type);
  return expandBounds(bounds, needsStrokeExpansion ? shapeStrokeWidth(shape) / 2 : 0);
}

export function renderToCanvas(drawLog, size = 2400, padding = 240) {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = exportCanvas.height = size;
  const ctx = exportCanvas.getContext('2d');

  const body = (typeof document !== "undefined") ? document.body : null;
  const inverted = !!body && (body.classList.contains("gg-invert") || body.classList.contains("invert-mode"));
  const colourMode = !!body && body.classList.contains("colour-mode");
  const glitchMode = !!body && body.classList.contains("glitch-mode");
  const background = (inverted && colourMode) ? "#000000" : "#ffffff";

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  const grey = (v, a = 1) => `rgba(${v}, ${v}, ${v}, ${a})`;

  if (drawLog.length === 0) return exportCanvas;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of drawLog) {
    const bounds = getShapeBounds(shape);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const availableSize = size - padding * 2;
  const widthScale = contentWidth > 0 ? availableSize / contentWidth : Infinity;
  const heightScale = contentHeight > 0 ? availableSize / contentHeight : Infinity;
  const scale = Math.min(
    widthScale,
    heightScale
  );

  if (!Number.isFinite(scale) || scale <= 0) return exportCanvas;

  const scaledWidth = contentWidth * scale;
  const scaledHeight = contentHeight * scale;
  const extraX = size - scaledWidth;
  const extraY = size - scaledHeight;
  const offsetX = extraX / 2 - minX * scale;
  const offsetY = extraY / 2 - minY * scale;

  const glitch = glitchMode ? drawLog.glitch : null;
  for (let index = 0; index < drawLog.length; index += 1) {
    const interruption = glitch?.interruption?.shapeIndex === index
      ? glitch.interruption
      : null;
    renderShape(ctx, drawLog[index], scale, offsetX, offsetY, grey, interruption);
  }

  const duplicatedShape = glitch?.duplication
    ? drawLog[glitch.duplication.shapeIndex]
    : null;
  if (duplicatedShape) {
    ctx.save();
    ctx.translate(
      glitch.duplication.offsetX * size,
      glitch.duplication.offsetY * size
    );
    renderShape(ctx, duplicatedShape, scale, offsetX, offsetY, grey);
    ctx.restore();
  }

  if (glitch) applySliceGlitch(exportCanvas, ctx, glitch.slice, background);
  
  if (inverted && !colourMode) {
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
  }

  return exportCanvas;
}

export function renderGalleryCanvas(drawLog, size) {
  return renderToCanvas(drawLog, size, size * GALLERY_PADDING_RATIO);
}
