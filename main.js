import {
  ANNOTATIONS_CONFIG,
  ANNOTATION_UI_CONFIG,
  AUTHORING_CONFIG,
  INTRO_CONFIG,
  LIGHTING_CONFIG,
  MIRIS_ASSETS,
  PIVOT_CONFIG,
  START_VIEW_CONFIG,
} from "./splat-config.js";
import { IntroController } from "./intro-controller.js";
import { AnnotationManager } from "./annotation-manager.js";
import { AnnotationPersistence } from "./annotation-persistence.js";
import { AnnotationAuthoring } from "./annotation-authoring.js";

const MIRIS_NOISE =
  /^\[[\d-]+ [\d:.]+\]|LOD|nbf|rsnap|worker result|[Mm]iris|splat|[Ss]tream|viewer|[Jj][Ww][Tt]|violation|requestAnimationFrame handler took|[Pp]oint[Cc]loud|Received modified event/;

function isMirisNoise(args) {
  return MIRIS_NOISE.test(String(args[0] ?? ""));
}

["log", "warn", "error"].forEach((method) => {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (!isMirisNoise(args)) {
      original(...args);
    }
  };
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseBoolFlag(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(String(value).toLowerCase())) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(String(value).toLowerCase())) {
    return false;
  }
  return fallback;
}

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseVec3(value, fallback = [0, 0, 0]) {
  if (Array.isArray(value) && value.length >= 3) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    const z = Number(value[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  }

  if (typeof value === "string") {
    const parts = value
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number(part));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }

  if (value && typeof value === "object") {
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  }

  return [...fallback];
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function makeTextVec3(vec) {
  return `${vec[0]} ${vec[1]} ${vec[2]}`;
}

function createAnnotationEditorHost(root, enabled) {
  const panel = document.createElement("aside");
  panel.className = "annotation-editor hidden";
  panel.innerHTML = `
    <h3 class="annotation-editor-title">Annotations</h3>
    <p class="annotation-editor-status" data-ann="status"></p>
    <label class="annotation-row annotation-check">
      <input data-ann="editMode" type="checkbox" />
      Edit Mode
    </label>
    <label class="annotation-row">
      Pin
      <select data-ann="pinSelect"></select>
    </label>
    <div class="annotation-actions">
      <button type="button" class="annotation-btn" data-ann="add">Add</button>
      <button type="button" class="annotation-btn" data-ann="delete">Delete</button>
      <button type="button" class="annotation-btn" data-ann="save">Save</button>
    </div>
    <label class="annotation-row">
      Asset
      <select data-ann="assetSelect"></select>
    </label>
    <label class="annotation-row">
      X
      <input data-ann="x" type="number" step="0.01" />
    </label>
    <label class="annotation-row">
      Y
      <input data-ann="y" type="number" step="0.01" />
    </label>
    <label class="annotation-row">
      Z
      <input data-ann="z" type="number" step="0.01" />
    </label>
    <label class="annotation-row">
      Nudge
      <input data-ann="step" type="number" step="0.005" value="0.01" />
    </label>
    <div class="annotation-actions annotation-actions-grid">
      <button type="button" class="annotation-btn" data-ann="x-">X-</button>
      <button type="button" class="annotation-btn" data-ann="x+">X+</button>
      <button type="button" class="annotation-btn" data-ann="y-">Y-</button>
      <button type="button" class="annotation-btn" data-ann="y+">Y+</button>
      <button type="button" class="annotation-btn" data-ann="z-">Z-</button>
      <button type="button" class="annotation-btn" data-ann="z+">Z+</button>
    </div>
    <label class="annotation-row">
      Title
      <input data-ann="title" type="text" />
    </label>
    <label class="annotation-row annotation-textarea-row">
      Body
      <textarea data-ann="body" rows="3"></textarea>
    </label>
  `;

  if (!enabled) {
    panel.classList.add("hidden");
  }

  root.appendChild(panel);

  const getInput = (key) => panel.querySelector(`input[data-ann="${key}"]`);
  const getSelect = (key) => panel.querySelector(`select[data-ann="${key}"]`);
  const getButton = (key) => panel.querySelector(`button[data-ann="${key}"]`);

  return {
    root: panel,
    status: panel.querySelector('[data-ann="status"]'),
    editMode: getInput("editMode"),
    pinSelect: getSelect("pinSelect"),
    assetSelect: getSelect("assetSelect"),
    x: getInput("x"),
    y: getInput("y"),
    z: getInput("z"),
    step: getInput("step"),
    title: getInput("title"),
    body: panel.querySelector('textarea[data-ann="body"]'),
    add: getButton("add"),
    remove: getButton("delete"),
    save: getButton("save"),
    xMinus: getButton("x-"),
    xPlus: getButton("x+"),
    yMinus: getButton("y-"),
    yPlus: getButton("y+"),
    zMinus: getButton("z-"),
    zPlus: getButton("z+"),
  };
}

function createFramingPanel(root, enabled) {
  const panel = document.createElement("aside");
  panel.className = `framing-panel${enabled ? "" : " hidden"}`;
  panel.innerHTML = `
    <h3 class="framing-panel-title">Framing</h3>
    <p class="framing-panel-note">Query-gated panel for startup view tuning.</p>

    <label class="annotation-row">Brightness <input data-frame="brightness" type="number" step="0.01" /></label>
    <label class="annotation-row">Lock Frames <input data-frame="lockFrames" type="number" step="1" /></label>

    <h4 class="framing-panel-subtitle">Camera</h4>
    <label class="annotation-row">Cam X <input data-frame="camX" type="number" step="0.01" /></label>
    <label class="annotation-row">Cam Y <input data-frame="camY" type="number" step="0.01" /></label>
    <label class="annotation-row">Cam Z <input data-frame="camZ" type="number" step="0.01" /></label>
    <label class="annotation-row">Target X <input data-frame="targetX" type="number" step="0.01" /></label>
    <label class="annotation-row">Target Y <input data-frame="targetY" type="number" step="0.01" /></label>
    <label class="annotation-row">Target Z <input data-frame="targetZ" type="number" step="0.01" /></label>
    <label class="annotation-row">FOV <input data-frame="fov" type="number" step="0.1" /></label>

    <h4 class="framing-panel-subtitle">Asset</h4>
    <label class="annotation-row">Pos X <input data-frame="assetX" type="number" step="0.01" /></label>
    <label class="annotation-row">Pos Y <input data-frame="assetY" type="number" step="0.01" /></label>
    <label class="annotation-row">Pos Z <input data-frame="assetZ" type="number" step="0.01" /></label>
    <label class="annotation-row">RotY (rad) <input data-frame="rotY" type="number" step="0.01" /></label>
    <label class="annotation-row">Scale X <input data-frame="scaleX" type="number" step="0.01" /></label>
    <label class="annotation-row">Scale Y <input data-frame="scaleY" type="number" step="0.01" /></label>
    <label class="annotation-row">Scale Z <input data-frame="scaleZ" type="number" step="0.01" /></label>

    <div class="annotation-actions">
      <button type="button" class="annotation-btn" data-frame="capture">Capture Camera</button>
      <button type="button" class="annotation-btn" data-frame="apply">Apply</button>
      <button type="button" class="annotation-btn" data-frame="copy">Copy JSON</button>
    </div>
  `;

  root.appendChild(panel);

  const getInput = (key) => panel.querySelector(`input[data-frame="${key}"]`);
  const getButton = (key) => panel.querySelector(`button[data-frame="${key}"]`);

  return {
    root: panel,
    brightness: getInput("brightness"),
    lockFrames: getInput("lockFrames"),
    camX: getInput("camX"),
    camY: getInput("camY"),
    camZ: getInput("camZ"),
    targetX: getInput("targetX"),
    targetY: getInput("targetY"),
    targetZ: getInput("targetZ"),
    fov: getInput("fov"),
    assetX: getInput("assetX"),
    assetY: getInput("assetY"),
    assetZ: getInput("assetZ"),
    rotY: getInput("rotY"),
    scaleX: getInput("scaleX"),
    scaleY: getInput("scaleY"),
    scaleZ: getInput("scaleZ"),
    capture: getButton("capture"),
    apply: getButton("apply"),
    copy: getButton("copy"),
  };
}

function createOcclusionDebugPanel(root, enabled) {
  const panel = document.createElement("aside");
  panel.className = `occ-debug${enabled ? "" : " hidden"}`;
  panel.innerHTML = `
    <h3 class="occ-debug-title">Occlusion Debug</h3>
    <p class="occ-debug-line" data-occ="mode">Mode: -</p>
    <p class="occ-debug-line" data-occ="reason">Reason: -</p>
    <p class="occ-debug-line" data-occ="counts">Visible/Occluded: -</p>
  `;
  root.appendChild(panel);
  return {
    root: panel,
    mode: panel.querySelector('[data-occ="mode"]'),
    reason: panel.querySelector('[data-occ="reason"]'),
    counts: panel.querySelector('[data-occ="counts"]'),
  };
}

function createAnnotationEditorToggle(root, enabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `annotation-editor-toggle${enabled ? "" : " hidden"}`;
  button.textContent = "Annotations +";
  button.setAttribute("aria-label", "Toggle annotations editor");
  button.setAttribute("aria-expanded", "false");
  root.appendChild(button);
  return button;
}

function inferForwardFromRotation(rotation) {
  const rawX = Number(rotation?.x);
  const rawY = Number(rotation?.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return null;
  }

  const scale = Math.abs(rawX) > Math.PI * 2 || Math.abs(rawY) > Math.PI * 2 ? Math.PI / 180 : 1;
  const x = rawX * scale;
  const y = rawY * scale;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);

  return [-sy * cx, sx, -cy * cx];
}

function inferForwardFromQuaternion(quaternion) {
  const x = Number(quaternion?.x);
  const y = Number(quaternion?.y);
  const z = Number(quaternion?.z);
  const w = Number(quaternion?.w);
  if (![x, y, z, w].every((n) => Number.isFinite(n))) {
    return null;
  }

  const fx = 2 * (x * z + w * y);
  const fy = 2 * (y * z - w * x);
  const fz = 1 - 2 * (x * x + y * y);
  return [-fx, -fy, -fz];
}

function normalizeVec3(vec, fallback = [0, 0, -1]) {
  const len = Math.hypot(vec[0], vec[1], vec[2]);
  if (len < 1e-6) {
    return [...fallback];
  }
  return [vec[0] / len, vec[1] / len, vec[2] / len];
}

function addVec3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lengthVec3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

const params = new URLSearchParams(window.location.search);
const frameQueryKey = AUTHORING_CONFIG.queryKey || "frame";
const runtime = {
  introEnabled: parseBoolFlag(params.get("intro"), true),
  annotationsEnabled: parseBoolFlag(params.get("annotations"), true),
  editorEnabled: parseBoolFlag(params.get("author"), true),
  occDebugEnabled: parseBoolFlag(params.get("occdebug"), false),
  debugTransforms:
    parseBoolFlag(params.get("debugpins"), false) || parseBoolFlag(params.get("occdebug"), false),
  framingEnabled:
    Boolean(AUTHORING_CONFIG.framingPanelEnabled) && parseBoolFlag(params.get(frameQueryKey), false),
};

const sceneEl = document.getElementById("scene");
const stream = document.getElementById("stream");
const cameraEl = document.querySelector("miris-camera");
const controlsEl = document.getElementById("controls");

if (!stream || !cameraEl || !controlsEl || !sceneEl) {
  throw new Error("Miris scene elements are missing.");
}

const annotationHost = document.createElement("div");
annotationHost.className = "annotation-host";
controlsEl.appendChild(annotationHost);

const editorEnabled = runtime.editorEnabled && (ANNOTATIONS_CONFIG.editor?.enabled ?? true);
const editor = createAnnotationEditorHost(controlsEl, editorEnabled);
const editorToggle = createAnnotationEditorToggle(controlsEl, editorEnabled);
const framingPanel = createFramingPanel(controlsEl, runtime.framingEnabled);
const occDebugPanel = createOcclusionDebugPanel(controlsEl, runtime.occDebugEnabled);

const editorUiState = {
  collapsed: true,
  available: false,
};
let persistenceStatusLabel = "Fallback to config";

const persistence = new AnnotationPersistence();
const authoring = new AnnotationAuthoring(editorEnabled);
authoring.bind();

const lightingState = deepClone(LIGHTING_CONFIG);
const startViewState = deepClone(START_VIEW_CONFIG);
const pivotState = {
  world: parseVec3(
    PIVOT_CONFIG?.pivotWorld,
    parseVec3(startViewState.camera?.target, [0, 0, 0]),
  ),
  enforce: PIVOT_CONFIG?.enforce !== false,
  disablePan: PIVOT_CONFIG?.disablePan !== false,
};

if (!startViewState.camera) {
  startViewState.camera = {};
}
startViewState.camera.target = [...pivotState.world];

let activeIndex = 0;
let introRotationOffset = 0;
let activeAnnotationsConfig = null;
let liveCameraPose = {
  position: [...(START_VIEW_CONFIG.camera?.position ?? [0, 0.83, 1.44])],
  target: [...pivotState.world],
  fov: parseNumber(START_VIEW_CONFIG.camera?.fov, 50),
  forward: normalizeVec3(
    subVec3(
      parseVec3(START_VIEW_CONFIG.camera?.target, pivotState.world),
      parseVec3(START_VIEW_CONFIG.camera?.position, [0, 0.83, 1.44]),
    ),
    [0, 0, -1],
  ),
};
const orbitState = {
  enabled: true,
  dragging: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
  radius: 1.2,
  azimuth: 0,
  polar: Math.PI / 2,
  rotateSpeed: 0.005,
  zoomSpeed: 0.0022,
  minRadius: 0.5,
  maxRadius: 3.5,
  minPolar: 0.2,
  maxPolar: Math.PI - 0.2,
};

function getActiveAsset() {
  return MIRIS_ASSETS[activeIndex] ?? null;
}

function getPivotWorld() {
  return [...pivotState.world];
}

function setPivotWorld(nextPivot) {
  pivotState.world = parseVec3(nextPivot, pivotState.world);
  startViewState.camera.target = [...pivotState.world];
}

function getControlHandles() {
  const rawHandles = [
    cameraEl.controls,
    cameraEl.orbitControls,
    cameraEl.camera?.controls,
    cameraEl.camera?.orbitControls,
    cameraEl.object3D?.controls,
    cameraEl.object3D?.orbitControls,
  ];
  const seen = new Set();
  const handles = [];
  for (const handle of rawHandles) {
    if (!handle || typeof handle !== "object" || seen.has(handle)) {
      continue;
    }
    seen.add(handle);
    handles.push(handle);
  }
  return handles;
}

function forceControlTarget(target) {
  const handles = getControlHandles();
  for (const handle of handles) {
    if (handle.target?.set) {
      handle.target.set(target[0], target[1], target[2]);
    }
  }
}

function disablePanOnControls() {
  if (!pivotState.disablePan) {
    return;
  }

  for (const handle of getControlHandles()) {
    if ("enablePan" in handle) {
      handle.enablePan = false;
    }
    if ("panSpeed" in handle) {
      handle.panSpeed = 0;
    }
    if ("screenSpacePanning" in handle) {
      handle.screenSpacePanning = false;
    }
    if (handle.mouseButtons && typeof handle.mouseButtons === "object") {
      const rotateMode = handle.mouseButtons.ROTATE;
      if (rotateMode !== undefined) {
        if ("RIGHT" in handle.mouseButtons) {
          handle.mouseButtons.RIGHT = rotateMode;
        }
        if ("MIDDLE" in handle.mouseButtons) {
          handle.mouseButtons.MIDDLE = rotateMode;
        }
      }
    }
    if (handle.touches && typeof handle.touches === "object") {
      const twoFingerRotate = handle.touches.DOLLY_ROTATE;
      if (twoFingerRotate !== undefined && "TWO" in handle.touches) {
        handle.touches.TWO = twoFingerRotate;
      }
    }
  }

  if (cameraEl.setAttribute) {
    cameraEl.setAttribute("pan-enabled", "false");
  }
}

function getObjectVec3(value, fallback) {
  if (!value) {
    return null;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return [x, y, z];
  }
  return fallback;
}

function getCameraFov() {
  const direct = Number(cameraEl?.fov);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const nested = Number(cameraEl?.camera?.fov);
  if (Number.isFinite(nested) && nested > 0) {
    return nested;
  }

  const attr = Number(cameraEl.getAttribute?.("fov"));
  if (Number.isFinite(attr) && attr > 0) {
    return attr;
  }

  return liveCameraPose.fov;
}

function readCameraPose() {
  const parsedPosAttr = parseVec3(cameraEl.getAttribute?.("position"), liveCameraPose.position);
  const parsedTargetAttr = parseVec3(cameraEl.getAttribute?.("target"), liveCameraPose.target);

  const nextPosition =
    getObjectVec3(cameraEl.position, null) ||
    getObjectVec3(cameraEl.camera?.position, null) ||
    getObjectVec3(cameraEl.object3D?.position, null) ||
    parsedPosAttr;

  const quaternionForward =
    inferForwardFromQuaternion(cameraEl.quaternion) ||
    inferForwardFromQuaternion(cameraEl.camera?.quaternion) ||
    inferForwardFromQuaternion(cameraEl.object3D?.quaternion);
  const rotationForward =
    inferForwardFromRotation(cameraEl.rotation) ||
    inferForwardFromRotation(cameraEl.object3D?.rotation);
  const forward = quaternionForward || rotationForward || [0, 0, -1];

  let nextTarget =
    getObjectVec3(cameraEl.target, null) ||
    getObjectVec3(cameraEl.controls?.target, null) ||
    getObjectVec3(cameraEl.orbitControls?.target, null) ||
    parsedTargetAttr;

  if (!nextTarget) {
    nextTarget = addVec3(nextPosition, normalizeVec3(forward));
  }

  const nextFov = getCameraFov();

  liveCameraPose = {
    position: [...nextPosition],
    target: nextTarget ? [...nextTarget] : [...liveCameraPose.target],
    fov: Number.isFinite(nextFov) && nextFov > 0 ? nextFov : liveCameraPose.fov,
    forward: normalizeVec3(forward),
  };

  return liveCameraPose;
}

function setCameraPose(pose) {
  const position = parseVec3(pose.position, liveCameraPose.position);
  const target = pivotState.enforce
    ? getPivotWorld()
    : parseVec3(pose.target, liveCameraPose.target);
  const fov = parseNumber(pose.fov, liveCameraPose.fov);

  if (cameraEl.position?.set) {
    cameraEl.position.set(position[0], position[1], position[2]);
  } else if (cameraEl.setAttribute) {
    cameraEl.setAttribute("position", makeTextVec3(position));
  }

  const targetHandles = [cameraEl.target, cameraEl.controls?.target, cameraEl.orbitControls?.target];
  let targetSet = false;
  for (const handle of targetHandles) {
    if (handle?.set) {
      handle.set(target[0], target[1], target[2]);
      targetSet = true;
      break;
    }
  }
  if (!targetSet && cameraEl.setAttribute) {
    cameraEl.setAttribute("target", makeTextVec3(target));
  }
  forceControlTarget(target);

  if (Number.isFinite(fov) && fov > 0) {
    if ("fov" in cameraEl) {
      cameraEl.fov = fov;
    }
    if (cameraEl.setAttribute) {
      cameraEl.setAttribute("fov", String(fov));
    }
  }

  liveCameraPose = {
    position: [...position],
    target: [...target],
    fov: Number.isFinite(fov) && fov > 0 ? fov : liveCameraPose.fov,
    forward: normalizeVec3(subVec3(target, position), [0, 0, -1]),
  };
  updateOrbitFromPose(liveCameraPose);
}

function enforceFixedPivot(pose) {
  if (!pivotState.enforce) {
    return pose;
  }

  const pivot = getPivotWorld();
  const sourcePosition = parseVec3(pose?.position, liveCameraPose.position);
  const sourceTarget = parseVec3(pose?.target, pivot);
  const orbitOffset = subVec3(sourcePosition, sourceTarget);
  const correctedPosition = addVec3(pivot, orbitOffset);

  const drift = Math.hypot(
    sourceTarget[0] - pivot[0],
    sourceTarget[1] - pivot[1],
    sourceTarget[2] - pivot[2],
  );
  const correctionDistance = Math.hypot(
    correctedPosition[0] - sourcePosition[0],
    correctedPosition[1] - sourcePosition[1],
    correctedPosition[2] - sourcePosition[2],
  );

  if (drift > 0.0005 || correctionDistance > 0.0005) {
    setCameraPose({
      position: correctedPosition,
      target: pivot,
      fov: pose?.fov ?? liveCameraPose.fov,
    });
  } else {
    forceControlTarget(pivot);
  }

  return {
    position: correctedPosition,
    target: pivot,
    fov: parseNumber(pose?.fov, liveCameraPose.fov),
    forward: normalizeVec3(subVec3(pivot, correctedPosition), [0, 0, -1]),
  };
}

function recenterCameraToPivot(useStartupPosition = false) {
  const pivot = getPivotWorld();
  const pose = readCameraPose();
  const sourcePosition = parseVec3(pose.position, liveCameraPose.position);
  const sourceTarget = parseVec3(pose.target, pivot);

  let nextPosition = addVec3(pivot, subVec3(sourcePosition, sourceTarget));
  if (useStartupPosition) {
    nextPosition = parseVec3(startViewState.camera?.position, nextPosition);
  }

  const distanceToPivot = Math.hypot(
    nextPosition[0] - pivot[0],
    nextPosition[1] - pivot[1],
    nextPosition[2] - pivot[2],
  );
  if (distanceToPivot < 0.08) {
    nextPosition = parseVec3(startViewState.camera?.position, sourcePosition);
  }

  setCameraPose({
    position: nextPosition,
    target: pivot,
    fov: parseNumber(startViewState.camera?.fov, pose.fov),
  });
}

function updateOrbitFromPose(pose) {
  const pivot = getPivotWorld();
  const position = parseVec3(pose?.position, liveCameraPose.position);
  const offset = subVec3(position, pivot);
  const radius = lengthVec3(offset);
  if (radius < 0.01) {
    return;
  }
  const safeY = clamp(offset[1] / radius, -1, 1);
  orbitState.radius = clamp(radius, orbitState.minRadius, orbitState.maxRadius);
  orbitState.polar = clamp(Math.acos(safeY), orbitState.minPolar, orbitState.maxPolar);
  orbitState.azimuth = Math.atan2(offset[0], offset[2]);
}

function getOrbitPosition() {
  const pivot = getPivotWorld();
  const sinPolar = Math.sin(orbitState.polar);
  const offset = [
    orbitState.radius * sinPolar * Math.sin(orbitState.azimuth),
    orbitState.radius * Math.cos(orbitState.polar),
    orbitState.radius * sinPolar * Math.cos(orbitState.azimuth),
  ];
  return addVec3(pivot, offset);
}

function applyOrbitPose() {
  setCameraPose({
    position: getOrbitPosition(),
    target: getPivotWorld(),
    fov: liveCameraPose.fov,
  });
}

function enableSingleOrbitController() {
  if (!orbitState.enabled) {
    return;
  }

  cameraEl.removeAttribute?.("controls");
  if ("controls" in cameraEl) {
    cameraEl.controls = false;
  }

  const onPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType !== "touch") {
      return;
    }
    orbitState.dragging = true;
    orbitState.pointerId = event.pointerId;
    orbitState.lastX = event.clientX;
    orbitState.lastY = event.clientY;
    sceneEl.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!orbitState.dragging || orbitState.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - orbitState.lastX;
    const dy = event.clientY - orbitState.lastY;
    orbitState.lastX = event.clientX;
    orbitState.lastY = event.clientY;

    orbitState.azimuth -= dx * orbitState.rotateSpeed;
    orbitState.polar = clamp(
      orbitState.polar - dy * orbitState.rotateSpeed,
      orbitState.minPolar,
      orbitState.maxPolar,
    );
    applyOrbitPose();
    event.stopPropagation();
    event.preventDefault();
  };

  const endDrag = (event) => {
    if (orbitState.pointerId !== null && orbitState.pointerId !== event.pointerId) {
      return;
    }
    orbitState.dragging = false;
    orbitState.pointerId = null;
    event.stopPropagation();
    event.preventDefault();
  };

  const onWheel = (event) => {
    const nextRadius = orbitState.radius * (1 + event.deltaY * orbitState.zoomSpeed * 0.1);
    orbitState.radius = clamp(nextRadius, orbitState.minRadius, orbitState.maxRadius);
    applyOrbitPose();
    event.stopPropagation();
    event.preventDefault();
  };

  sceneEl.addEventListener("pointerdown", onPointerDown, true);
  sceneEl.addEventListener("pointermove", onPointerMove, true);
  sceneEl.addEventListener("pointerup", endDrag, true);
  sceneEl.addEventListener("pointercancel", endDrag, true);
  sceneEl.addEventListener("wheel", onWheel, { passive: false, capture: true });
}

function applyBrightness() {
  const brightness = clamp(parseNumber(lightingState.globalBrightness, 1), 0.35, 3);
  lightingState.globalBrightness = brightness;

  if ("exposure" in sceneEl) {
    sceneEl.exposure = brightness;
  }
  if (sceneEl.setAttribute) {
    sceneEl.setAttribute("exposure", String(brightness));
  }

  sceneEl.style.filter = `brightness(${brightness})`;
}

function applyStreamTransform() {
  const activeAsset = getActiveAsset();
  if (!activeAsset) {
    return;
  }

  const assetPos = parseVec3(startViewState.asset?.position, [0, -0.5, 0]);
  const assetScale = parseVec3(startViewState.asset?.scale, [1, 1, 1]);
  const baseRotY = Number.isFinite(Number(startViewState.asset?.rotY))
    ? Number(startViewState.asset.rotY)
    : Number(activeAsset.rotY) || 0;

  if (stream.position?.set) {
    stream.position.set(assetPos[0], assetPos[1], assetPos[2]);
  } else if (stream.setAttribute) {
    stream.setAttribute("position", makeTextVec3(assetPos));
  }

  if (stream.scale?.set) {
    stream.scale.set(assetScale[0], assetScale[1], assetScale[2]);
  } else if (stream.setAttribute) {
    stream.setAttribute("scale", makeTextVec3(assetScale));
  }

  if (stream.rotation) {
    stream.rotation.y = baseRotY + introRotationOffset;
  }
}

function applyView() {
  applyBrightness();
  applyStreamTransform();
  setCameraPose({
    ...startViewState.camera,
    target: getPivotWorld(),
  });
  disablePanOnControls();
}

function lockView(frames) {
  applyView();
  if (frames > 0) {
    requestAnimationFrame(() => lockView(frames - 1));
  }
}

function getIntroTotalMs() {
  if (!(INTRO_CONFIG.enabled && runtime.introEnabled)) {
    return 0;
  }
  const motionDuration = Math.max(
    parseNumber(INTRO_CONFIG.spinDurationMs, 0),
    parseNumber(INTRO_CONFIG.particleDurationMs, 0),
  );
  return (
    parseNumber(INTRO_CONFIG.preSpinHoldMs, 0) +
    motionDuration +
    parseNumber(INTRO_CONFIG.revealFadeMs, 0) +
    parseNumber(INTRO_CONFIG.settleMs, 0)
  );
}

function getStartupLockFrames() {
  const configured = Math.max(1, parseNumber(startViewState.lockFrames, 32));
  const introMs = getIntroTotalMs();
  const introFrames = introMs > 0 ? Math.ceil((introMs + 300) / (1000 / 60)) : 0;
  return Math.max(configured, introFrames);
}

const annotationManager = new AnnotationManager({
  host: annotationHost,
  sceneEl,
  cameraEl,
  streamEl: stream,
  getActiveAssetId: () => getActiveAsset()?.id ?? null,
  defaultCameraPosition: parseVec3(startViewState.camera?.position, [0, 0.83, 1.44]),
  defaultCameraFov: parseNumber(startViewState.camera?.fov, 50),
  defaultStreamPosition: parseVec3(startViewState.asset?.position, [0, -0.5, 0]),
  getFixedPivotWorld: () => getPivotWorld(),
  onAllPinsOffscreen: () => {
    recenterCameraToPivot(true);
  },
  debugTransformSync: runtime.debugTransforms,
  setCameraPose,
});

async function saveAnnotations() {
  const annotations = annotationManager.exportAnnotations();
  if (!annotations) {
    return;
  }

  const result = await persistence.save("amiri", annotations);
  if (result.ok) {
    activeAnnotationsConfig = deepClone(annotations);
    setPersistenceStatusLabel("Saved locally");
    annotationManager.emitEditorState?.();
    return;
  }

  const payload = JSON.stringify({ annotations }, null, 2);
  triggerDownload("amiri-annotations.json", payload);
  console.warn(`Annotation save fallback used: ${result.reason}`);
  setPersistenceStatusLabel("Local save failed (downloaded JSON)");
  annotationManager.emitEditorState?.();
}

function wireEditorEvents() {
  if (!editorEnabled) {
    return;
  }

  const nudgeValue = () => Math.max(0.001, Number(editor.step?.value) || 0.01);

  editor.editMode?.addEventListener("change", () => {
    annotationManager.setEditMode(Boolean(editor.editMode?.checked));
  });

  editor.pinSelect?.addEventListener("change", () => {
    if (editor.pinSelect?.value) {
      annotationManager.selectAnnotation(editor.pinSelect.value);
    }
  });

  editor.add?.addEventListener("click", () => annotationManager.addPin());
  editor.remove?.addEventListener("click", () => annotationManager.deleteSelected());
  editor.save?.addEventListener("click", () => {
    void saveAnnotations();
  });

  const emitPos = () => {
    annotationManager.updateSelected({
      pos: [
        Number(editor.x?.value ?? 0),
        Number(editor.y?.value ?? 0),
        Number(editor.z?.value ?? 0),
      ],
    });
  };

  editor.x?.addEventListener("change", emitPos);
  editor.y?.addEventListener("change", emitPos);
  editor.z?.addEventListener("change", emitPos);

  editor.title?.addEventListener("change", () => {
    annotationManager.updateSelected({ title: editor.title?.value ?? "" });
  });

  editor.body?.addEventListener("change", () => {
    annotationManager.updateSelected({ body: editor.body?.value ?? "" });
  });

  editor.assetSelect?.addEventListener("change", () => {
    annotationManager.updateSelected({
      assetId: editor.assetSelect?.value === "__all__" ? null : editor.assetSelect?.value,
    });
  });

  editor.xMinus?.addEventListener("click", () => annotationManager.nudgeSelected("x", -nudgeValue()));
  editor.xPlus?.addEventListener("click", () => annotationManager.nudgeSelected("x", nudgeValue()));
  editor.yMinus?.addEventListener("click", () => annotationManager.nudgeSelected("y", -nudgeValue()));
  editor.yPlus?.addEventListener("click", () => annotationManager.nudgeSelected("y", nudgeValue()));
  editor.zMinus?.addEventListener("click", () => annotationManager.nudgeSelected("z", -nudgeValue()));
  editor.zPlus?.addEventListener("click", () => annotationManager.nudgeSelected("z", nudgeValue()));
}

function syncEditorVisibility() {
  if (!editorEnabled) {
    editor.root.classList.add("hidden");
    editorToggle.classList.add("hidden");
    return;
  }
  const showToggle = editorUiState.available;
  const showEditor = editorUiState.available && !editorUiState.collapsed;
  editor.root.classList.toggle("hidden", !showEditor);
  editorToggle.classList.toggle("hidden", !showToggle);
  editorToggle.textContent = editorUiState.collapsed ? "Annotations +" : "Annotations -";
  editorToggle.setAttribute("aria-expanded", String(!editorUiState.collapsed));
}

function setPersistenceStatusLabel(text) {
  persistenceStatusLabel = text;
}

function renderEditorState(state) {
  if (!editorEnabled) {
    return;
  }

  editorUiState.available = state.available;
  syncEditorVisibility();
  editor.editMode.checked = state.editMode;

  const modeLabel = state.occlusionMode || (state.occlusionAvailable ? "native-depth" : "heuristic");
  const reasonLabel = state.occlusionReason || (state.occlusionAvailable ? "native" : "fallback");
  const occlusionText = `Occlusion: ${modeLabel} (${reasonLabel})`;
  editor.status.textContent = `${persistenceStatusLabel} · ${occlusionText}`;

  editor.pinSelect.innerHTML = "";
  for (const pin of state.pins) {
    const option = document.createElement("option");
    option.value = pin.id;
    option.textContent = `${pin.order}. ${pin.title || pin.id}`;
    editor.pinSelect.appendChild(option);
  }

  if (state.selectedId) {
    editor.pinSelect.value = state.selectedId;
  }

  editor.assetSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "__all__";
  allOption.textContent = "All splats";
  editor.assetSelect.appendChild(allOption);

  for (const assetId of state.assetIds) {
    const option = document.createElement("option");
    option.value = assetId;
    option.textContent = assetId;
    editor.assetSelect.appendChild(option);
  }

  const selected = state.pins.find((pin) => pin.id === state.selectedId) ?? null;

  if (selected) {
    editor.x.value = selected.pos[0].toFixed(4);
    editor.y.value = selected.pos[1].toFixed(4);
    editor.z.value = selected.pos[2].toFixed(4);
    editor.title.value = selected.title;
    editor.body.value = selected.body;
    editor.assetSelect.value = selected.assetId ?? "__all__";
  }

  editor.remove.disabled = !selected;
  const readonly = !state.editMode || !selected;
  editor.x.disabled = readonly;
  editor.y.disabled = readonly;
  editor.z.disabled = readonly;
  editor.title.disabled = readonly;
  editor.body.disabled = readonly;
  editor.assetSelect.disabled = readonly;
}

annotationManager.onEditorStateChange(renderEditorState);
wireEditorEvents();
if (editorEnabled) {
  editorToggle.addEventListener("click", () => {
    editorUiState.collapsed = !editorUiState.collapsed;
    syncEditorVisibility();
  });
  syncEditorVisibility();
}

function syncFramingPanel() {
  if (!runtime.framingEnabled) {
    return;
  }

  framingPanel.brightness.value = String(lightingState.globalBrightness);
  framingPanel.lockFrames.value = String(parseNumber(startViewState.lockFrames, 32));

  const camPos = parseVec3(startViewState.camera?.position, [0, 0.83, 1.44]);
  const camTarget = getPivotWorld();
  framingPanel.camX.value = String(camPos[0]);
  framingPanel.camY.value = String(camPos[1]);
  framingPanel.camZ.value = String(camPos[2]);
  framingPanel.targetX.value = String(camTarget[0]);
  framingPanel.targetY.value = String(camTarget[1]);
  framingPanel.targetZ.value = String(camTarget[2]);
  framingPanel.fov.value = String(parseNumber(startViewState.camera?.fov, 50));

  const assetPos = parseVec3(startViewState.asset?.position, [0, -0.5, 0]);
  const assetScale = parseVec3(startViewState.asset?.scale, [1, 1, 1]);
  framingPanel.assetX.value = String(assetPos[0]);
  framingPanel.assetY.value = String(assetPos[1]);
  framingPanel.assetZ.value = String(assetPos[2]);
  framingPanel.rotY.value = String(parseNumber(startViewState.asset?.rotY, 0));
  framingPanel.scaleX.value = String(assetScale[0]);
  framingPanel.scaleY.value = String(assetScale[1]);
  framingPanel.scaleZ.value = String(assetScale[2]);
}

function readFramingPanelIntoState() {
  if (!runtime.framingEnabled) {
    return;
  }

  lightingState.globalBrightness = parseNumber(framingPanel.brightness.value, lightingState.globalBrightness);
  startViewState.lockFrames = Math.max(1, Math.round(parseNumber(framingPanel.lockFrames.value, startViewState.lockFrames || 32)));

  setPivotWorld([
    parseNumber(framingPanel.targetX.value, pivotState.world[0]),
    parseNumber(framingPanel.targetY.value, pivotState.world[1]),
    parseNumber(framingPanel.targetZ.value, pivotState.world[2]),
  ]);

  startViewState.camera = {
    position: [
      parseNumber(framingPanel.camX.value, startViewState.camera.position[0]),
      parseNumber(framingPanel.camY.value, startViewState.camera.position[1]),
      parseNumber(framingPanel.camZ.value, startViewState.camera.position[2]),
    ],
    target: getPivotWorld(),
    fov: parseNumber(framingPanel.fov.value, startViewState.camera.fov),
  };

  startViewState.asset = {
    position: [
      parseNumber(framingPanel.assetX.value, startViewState.asset.position[0]),
      parseNumber(framingPanel.assetY.value, startViewState.asset.position[1]),
      parseNumber(framingPanel.assetZ.value, startViewState.asset.position[2]),
    ],
    rotY: parseNumber(framingPanel.rotY.value, startViewState.asset.rotY),
    scale: [
      parseNumber(framingPanel.scaleX.value, startViewState.asset.scale[0]),
      parseNumber(framingPanel.scaleY.value, startViewState.asset.scale[1]),
      parseNumber(framingPanel.scaleZ.value, startViewState.asset.scale[2]),
    ],
  };
}

async function copyFramingJson() {
  const pivotExport = {
    pivotWorld: getPivotWorld(),
    enforce: pivotState.enforce,
    disablePan: pivotState.disablePan,
  };
  const payload = [
    `export const LIGHTING_CONFIG = ${JSON.stringify({ globalBrightness: lightingState.globalBrightness }, null, 2)};`,
    `export const PIVOT_CONFIG = ${JSON.stringify(pivotExport, null, 2)};`,
    `export const START_VIEW_CONFIG = ${JSON.stringify(startViewState, null, 2)};`,
  ].join("\n\n");

  try {
    await navigator.clipboard.writeText(payload);
  } catch {
    window.prompt("Copy START_VIEW/LIGHTING config:", payload);
  }
}

function wireFramingPanelEvents() {
  if (!runtime.framingEnabled) {
    return;
  }

  const onEdit = () => {
    readFramingPanelIntoState();
    applyBrightness();
    lockView(1);
  };

  const inputs = framingPanel.root.querySelectorAll("input[data-frame]");
  inputs.forEach((input) => {
    input.addEventListener("change", onEdit);
  });

  framingPanel.capture?.addEventListener("click", () => {
    const pose = enforceFixedPivot(readCameraPose());
    startViewState.camera = {
      position: [...pose.position],
      target: getPivotWorld(),
      fov: pose.fov,
    };
    syncFramingPanel();
  });

  framingPanel.apply?.addEventListener("click", () => {
    readFramingPanelIntoState();
    lockView(getStartupLockFrames());
  });

  framingPanel.copy?.addEventListener("click", () => {
    readFramingPanelIntoState();
    void copyFramingJson();
  });
}

async function loadAnnotationConfig() {
  const base = deepClone(ANNOTATIONS_CONFIG);
  base.ui = {
    ...base.ui,
    ...ANNOTATION_UI_CONFIG,
    wrapNavigation: ANNOTATION_UI_CONFIG.wrapNavigation ?? base.ui?.wrapNavigation ?? true,
  };

  if (!runtime.annotationsEnabled) {
    setPersistenceStatusLabel("Annotations disabled");
    return { ...base, enabled: false };
  }

  const loadedRecord = await persistence.load("amiri");
  if (!loadedRecord?.annotations) {
    setPersistenceStatusLabel("Fallback to config");
    return base;
  }
  const loaded = loadedRecord.annotations;
  if (loadedRecord.source === "local") {
    setPersistenceStatusLabel("Loaded local");
  } else if (loadedRecord.source === "legacy-file") {
    setPersistenceStatusLabel("Loaded legacy file (migrated local)");
  }

  return {
    ...base,
    ...loaded,
    ui: {
      ...base.ui,
      ...loaded.ui,
      wrapNavigation:
        loaded.ui?.wrapNavigation ?? base.ui.wrapNavigation ?? true,
      declutter: {
        ...base.ui?.declutter,
        ...loaded.ui?.declutter,
      },
      occlusion: {
        ...base.ui?.occlusion,
        ...loaded.ui?.occlusion,
        fadeAlphaOccluded: 0.2,
      },
    },
    pins: Array.isArray(loaded.pins) ? loaded.pins : base.pins,
  };
}

const introController = new IntroController({
  host: controlsEl,
  config: {
    ...INTRO_CONFIG,
    enabled: INTRO_CONFIG.enabled && runtime.introEnabled,
  },
  setRotationOffset: (offset) => {
    introRotationOffset = offset;
    applyStreamTransform();
  },
});

function goTo(index) {
  const total = MIRIS_ASSETS.length;
  if (total <= 0) {
    return;
  }

  const nextIndex = ((index % total) + total) % total;
  if (nextIndex === activeIndex) {
    return;
  }

  buttons[activeIndex]?.classList.remove("is-active");
  activeIndex = nextIndex;

  const activeAsset = getActiveAsset();
  if (!activeAsset) {
    return;
  }

  stream.setAttribute("uuid", activeAsset.uuid);
  lockView(getStartupLockFrames());
  buttons[activeIndex]?.classList.add("is-active");
  annotationManager.setActiveAssetId(activeAsset.id);
}

const nav = document.createElement("div");
nav.className = "scene-nav";

const buttons = MIRIS_ASSETS.map((asset, index) => {
  const button = document.createElement("button");
  button.className = "scene-btn" + (index === 0 ? " is-active" : "");
  button.textContent = String(index + 1);
  button.setAttribute("aria-label", asset.label);
  button.addEventListener("click", () => goTo(index));
  nav.appendChild(button);
  return button;
});

controlsEl.appendChild(nav);

const CHEVRON_L = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const CHEVRON_R = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

function makeArrow(className, label, svg, onClick) {
  const button = document.createElement("button");
  button.className = `scene-arrow ${className}`;
  button.setAttribute("aria-label", label);
  button.innerHTML = svg;
  button.addEventListener("click", onClick);
  return button;
}

const leftArrow = makeArrow("scene-arrow--left", "Previous scene", CHEVRON_L, () => goTo(activeIndex - 1));
const rightArrow = makeArrow("scene-arrow--right", "Next scene", CHEVRON_R, () => goTo(activeIndex + 1));
controlsEl.append(leftArrow, rightArrow);

const hasMultipleAssets = MIRIS_ASSETS.length > 1;
nav.classList.toggle("hidden", !hasMultipleAssets);
leftArrow.classList.toggle("hidden", !hasMultipleAssets);
rightArrow.classList.toggle("hidden", !hasMultipleAssets);

function renderOcclusionDebugPanel() {
  if (!runtime.occDebugEnabled) {
    return;
  }
  const debug = annotationManager.getOcclusionDebugInfo?.() ?? null;
  if (!debug) {
    return;
  }
  occDebugPanel.mode.textContent = `Mode: ${debug.activeMode || "unknown"} (req: ${debug.requestedMode || "-"})`;
  occDebugPanel.reason.textContent = `Reason: ${debug.reason || "-"}`;
  occDebugPanel.counts.textContent =
    `Visible/Occluded/Hidden: ${debug.visibleCount ?? 0}/${debug.occludedCount ?? 0}/${debug.hiddenByDeclutter ?? 0}`;
}

function onFrame(now) {
  disablePanOnControls();
  const pose = enforceFixedPivot(readCameraPose());
  annotationManager.setLiveCameraPose(pose);
  annotationManager.update(now, window.innerWidth, window.innerHeight);
  renderOcclusionDebugPanel();
  requestAnimationFrame(onFrame);
}

async function init() {
  const activeAsset = getActiveAsset();
  if (!activeAsset) {
    return;
  }

  stream.setAttribute("uuid", activeAsset.uuid);

  syncFramingPanel();
  wireFramingPanelEvents();

  const initialPose = {
    position: parseVec3(startViewState.camera?.position, [0, 0.83, 1.44]),
    target: getPivotWorld(),
    fov: parseNumber(startViewState.camera?.fov, 50),
  };
  setCameraPose(initialPose);
  enableSingleOrbitController();
  disablePanOnControls();

  lockView(getStartupLockFrames());
  applyBrightness();

  activeAnnotationsConfig = await loadAnnotationConfig();
  annotationManager.configure(activeAnnotationsConfig, MIRIS_ASSETS.map((asset) => asset.id));
  annotationManager.setActiveAssetId(activeAsset.id);
  annotationManager.setLiveCameraPose(enforceFixedPivot(readCameraPose()));

  requestAnimationFrame(onFrame);

  window.setTimeout(() => {
    void introController.runIntro();
  }, 520);
}

void init();
