function hashComposition(shapes) {
  const source = JSON.stringify(shapes);
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000;
}

export function createGlitchPlan(shapes) {
  if (!Array.isArray(shapes) || shapes.length === 0) {
    return {
      version: 1,
      slice: null,
      duplication: null,
      interruption: null
    };
  }

  const random = seededRandom(hashComposition(shapes));
  const outlinedShapeIndexes = shapes
    .map((shape, index) => ({ shape, index }))
    .filter(({ shape }) => !shape.filled)
    .map(({ index }) => index);
  const direction = random() < 0.5 ? -1 : 1;
  const duplicateDirection = random() < 0.5 ? -1 : 1;

  return {
    version: 1,
    slice: {
      y: rounded(0.2 + random() * 0.6),
      height: rounded(0.035 + random() * 0.055),
      offset: rounded(direction * (0.025 + random() * 0.045))
    },
    duplication: {
      shapeIndex: Math.floor(random() * shapes.length),
      offsetX: rounded(duplicateDirection * (0.012 + random() * 0.025)),
      offsetY: rounded((random() - 0.5) * 0.025)
    },
    interruption: outlinedShapeIndexes.length > 0
      ? {
          shapeIndex: outlinedShapeIndexes[
            Math.floor(random() * outlinedShapeIndexes.length)
          ],
          start: rounded(0.12 + random() * 0.58),
          length: rounded(0.1 + random() * 0.16)
        }
      : null
  };
}
