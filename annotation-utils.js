export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function mul3(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize3(a, fallback = [0, 0, 1]) {
  const len = length3(a);
  if (len < 1e-6) {
    return [...fallback];
  }
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function rotateY(point, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    point[0] * c - point[2] * s,
    point[1],
    point[0] * s + point[2] * c,
  ];
}

export function projectPointToScreen({
  world,
  cameraPosition,
  cameraTarget,
  cameraForward,
  fovDegrees,
  near = 0.01,
  far = 100,
  width,
  height,
}) {
  if (width <= 0 || height <= 0) {
    return { visible: false, screenX: 0, screenY: 0, ndcDepth: 1, viewDepth: 0 };
  }

  const forward = cameraForward
    ? normalize3(cameraForward, [0, 0, -1])
    : normalize3(sub3(cameraTarget, cameraPosition), [0, 0, -1]);
  let right = cross3(forward, [0, 1, 0]);
  if (length3(right) < 1e-6) {
    right = [1, 0, 0];
  }
  right = normalize3(right, [1, 0, 0]);
  const up = normalize3(cross3(right, forward), [0, 1, 0]);

  const relative = sub3(world, cameraPosition);
  const depth = dot3(relative, forward);
  if (depth <= 0.0001) {
    return { visible: false, screenX: 0, screenY: 0, ndcDepth: 1, viewDepth: depth };
  }

  const verticalTan = Math.tan((Math.max(1, fovDegrees) * Math.PI) / 360);
  const horizontalTan = verticalTan * (width / height);

  const x = dot3(relative, right) / (depth * horizontalTan);
  const y = dot3(relative, up) / (depth * verticalTan);

  const inViewport = x >= -1 && x <= 1 && y >= -1 && y <= 1;
  let ndcDepth = clamp(depth / 20, 0, 1);
  const safeNear = Math.max(0.0001, Number(near) || 0.01);
  const safeFar = Math.max(safeNear + 0.001, Number(far) || 100);
  if (Number.isFinite(safeNear) && Number.isFinite(safeFar) && safeFar > safeNear) {
    const zView = -depth;
    const a = (safeFar + safeNear) / (safeNear - safeFar);
    const b = (2 * safeFar * safeNear) / (safeNear - safeFar);
    const zNdc = (a * zView + b) / depth;
    ndcDepth = clamp(zNdc * 0.5 + 0.5, 0, 1);
  }

  return {
    visible: inViewport,
    screenX: (x * 0.5 + 0.5) * width,
    screenY: (-y * 0.5 + 0.5) * height,
    ndcDepth,
    viewDepth: depth,
  };
}
