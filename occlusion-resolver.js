const DEFAULT_SAMPLE_INTERVAL_MS = 1000 / 12;
const DEPTH_DOWNSAMPLE = 0.25;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readDepthValue(value) {
  if (Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (value && typeof value === "object") {
    const depth = Number(value.depth ?? value.z ?? value.value);
    if (Number.isFinite(depth)) {
      return depth;
    }
  }
  return null;
}

function unpackRGBADepth(pixel) {
  const r = pixel[0] / 255;
  const g = pixel[1] / 255;
  const b = pixel[2] / 255;
  const a = pixel[3] / 255;
  return r / (256 * 256 * 256) + g / (256 * 256) + b / 256 + a;
}

export class OcclusionResolver {
  constructor() {
    this.occlusionById = new Map();
    this.available = false;
    this.requestedMode = "heuristic";
    this.activeMode = "heuristic";
    this.reason = "heuristic-selected";
    this.nextSampleAtMs = 0;
    this.sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
    this.depthHook = null;
    this.runtime = null;
    this.handles = {
      sceneEl: null,
      cameraEl: null,
      streamEl: null,
    };
    this.pixel = new Uint8Array(4);
  }

  configure(config = {}) {
    this.requestedMode = config.mode === "native-depth" ? "native-depth" : "heuristic";
    this.sampleIntervalMs = Math.max(16, Number(config.sampleIntervalMs) || DEFAULT_SAMPLE_INTERVAL_MS);
    this.handles = {
      sceneEl: config.sceneEl ?? this.handles.sceneEl,
      cameraEl: config.cameraEl ?? this.handles.cameraEl,
      streamEl: config.streamEl ?? this.handles.streamEl,
    };

    this.depthHook = null;
    this.disposeThreeRuntime();
    this.probeNativeDepth();
  }

  isAvailable() {
    return this.available;
  }

  getStatus() {
    return {
      requestedMode: this.requestedMode,
      activeMode: this.activeMode,
      nativeAvailable: this.available,
      reason: this.reason,
    };
  }

  resolve(samples, width, height, epsilon = 0.01, nowMs = 0) {
    if (!Array.isArray(samples) || samples.length === 0) {
      this.occlusionById.clear();
      return this.occlusionById;
    }

    if (this.requestedMode !== "native-depth" || !this.available) {
      return this.markAll(samples, false);
    }

    if (nowMs < this.nextSampleAtMs && this.occlusionById.size > 0) {
      return this.occlusionById;
    }
    this.nextSampleAtMs = nowMs + this.sampleIntervalMs;

    try {
      if (this.depthHook) {
        this.updateFromHook(samples, epsilon);
        return this.occlusionById;
      }
      if (this.runtime) {
        this.updateFromThreeDepth(samples, width, height, epsilon);
        return this.occlusionById;
      }
    } catch (error) {
      this.available = false;
      this.activeMode = "heuristic";
      this.reason = `native-depth-error:${String(error?.message || error)}`;
    }

    return this.markAll(samples, false);
  }

  dispose() {
    this.occlusionById.clear();
    this.disposeThreeRuntime();
  }

  markAll(samples, value) {
    this.occlusionById.clear();
    for (const sample of samples) {
      this.occlusionById.set(sample.id, Boolean(value));
    }
    return this.occlusionById;
  }

  probeNativeDepth() {
    if (this.requestedMode !== "native-depth") {
      this.available = false;
      this.activeMode = "heuristic";
      this.reason = "heuristic-selected";
      return;
    }

    const hook = this.findDepthHook();
    if (hook) {
      this.depthHook = hook;
      this.available = true;
      this.activeMode = "native-depth";
      this.reason = "native-depth-hook";
      return;
    }

    const runtime = this.findThreeRuntime();
    if (runtime) {
      this.runtime = runtime;
      this.available = true;
      this.activeMode = "native-depth";
      this.reason = "native-depth-pass";
      return;
    }

    this.available = false;
    this.activeMode = "heuristic";
    this.reason = "native-depth-unavailable";
  }

  findDepthHook() {
    const { sceneEl, cameraEl, streamEl } = this.handles;
    const targets = [
      sceneEl,
      cameraEl,
      streamEl,
      sceneEl?.viewer,
      sceneEl?.engine,
      sceneEl?.renderer,
      cameraEl?.camera,
      streamEl?.viewer,
    ].filter(Boolean);

    const methodNames = [
      "getDepthAtUv",
      "sampleDepthAtUv",
      "sampleDepthUv",
      "readDepthAtUv",
      "sampleDepth",
      "getDepthNormalizedAtUv",
    ];

    for (const target of targets) {
      for (const name of methodNames) {
        const fn = target?.[name];
        if (typeof fn !== "function") {
          continue;
        }

        try {
          const probe = readDepthValue(fn.call(target, 0.5, 0.5));
          if (Number.isFinite(probe)) {
            return (u, v) => readDepthValue(fn.call(target, u, v));
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  findThreeRuntime() {
    const THREE = globalThis.THREE;
    if (!THREE?.MeshDepthMaterial || !THREE?.WebGLRenderTarget) {
      return null;
    }

    const { sceneEl, cameraEl, streamEl } = this.handles;
    const rendererCandidates = [
      sceneEl?.renderer,
      sceneEl?.threeRenderer,
      sceneEl?.engine?.renderer,
      cameraEl?.renderer,
      streamEl?.renderer,
    ].filter(Boolean);
    const sceneCandidates = [
      sceneEl?.scene,
      sceneEl?.threeScene,
      sceneEl?.object3D,
      streamEl?.object3D?.parent,
    ].filter(Boolean);
    const cameraCandidates = [
      cameraEl?.camera,
      cameraEl?.object3D,
      sceneEl?.camera,
      sceneEl?.engine?.camera,
    ].filter(Boolean);

    const renderer = rendererCandidates.find((candidate) =>
      typeof candidate.render === "function" &&
      typeof candidate.setRenderTarget === "function" &&
      typeof candidate.getRenderTarget === "function" &&
      typeof candidate.readRenderTargetPixels === "function",
    );
    const scene = sceneCandidates.find((candidate) => "overrideMaterial" in candidate);
    const camera = cameraCandidates.find((candidate) =>
      candidate?.projectionMatrix && candidate?.matrixWorldInverse,
    );

    if (!renderer || !scene || !camera) {
      return null;
    }

    const depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      blending: THREE.NoBlending,
    });

    return {
      THREE,
      renderer,
      scene,
      camera,
      depthMaterial,
      renderTarget: null,
    };
  }

  updateFromHook(samples, epsilon) {
    this.occlusionById.clear();

    for (const sample of samples) {
      if (!sample.visible) {
        this.occlusionById.set(sample.id, false);
        continue;
      }

      const sampledDepth = readDepthValue(this.depthHook(sample.x, sample.y));
      if (!Number.isFinite(sampledDepth)) {
        this.occlusionById.set(sample.id, false);
        continue;
      }

      const depth = clamp(sampledDepth, 0, 1);
      const occluded = sample.ndcDepth > depth + epsilon;
      this.occlusionById.set(sample.id, occluded);
    }
  }

  updateFromThreeDepth(samples, width, height, epsilon) {
    const runtime = this.runtime;
    this.ensureRenderTarget(width, height);
    if (!runtime?.renderTarget) {
      this.markAll(samples, false);
      return;
    }

    const targetWidth = runtime.renderTarget.width;
    const targetHeight = runtime.renderTarget.height;
    const previousTarget = runtime.renderer.getRenderTarget();
    const previousAutoClear = runtime.renderer.autoClear;
    const previousOverride = runtime.scene.overrideMaterial;

    try {
      runtime.renderer.autoClear = true;
      runtime.scene.overrideMaterial = runtime.depthMaterial;
      runtime.renderer.setRenderTarget(runtime.renderTarget);
      runtime.renderer.clear(true, true, true);
      runtime.renderer.render(runtime.scene, runtime.camera);

      this.occlusionById.clear();
      for (const sample of samples) {
        if (!sample.visible) {
          this.occlusionById.set(sample.id, false);
          continue;
        }
        const px = Math.round(sample.x * (targetWidth - 1));
        const py = Math.round(sample.y * (targetHeight - 1));
        const sx = clamp(px, 0, targetWidth - 1);
        const sy = clamp(targetHeight - 1 - py, 0, targetHeight - 1);
        runtime.renderer.readRenderTargetPixels(runtime.renderTarget, sx, sy, 1, 1, this.pixel);
        const sampledDepth = unpackRGBADepth(this.pixel);
        const occluded = sample.ndcDepth > sampledDepth + epsilon;
        this.occlusionById.set(sample.id, occluded);
      }
    } finally {
      runtime.scene.overrideMaterial = previousOverride;
      runtime.renderer.setRenderTarget(previousTarget);
      runtime.renderer.autoClear = previousAutoClear;
    }
  }

  ensureRenderTarget(width, height) {
    if (!this.runtime) {
      return;
    }
    const { THREE } = this.runtime;
    const targetWidth = Math.max(16, Math.floor(width * DEPTH_DOWNSAMPLE));
    const targetHeight = Math.max(16, Math.floor(height * DEPTH_DOWNSAMPLE));
    if (
      this.runtime.renderTarget &&
      this.runtime.renderTarget.width === targetWidth &&
      this.runtime.renderTarget.height === targetHeight
    ) {
      return;
    }

    this.runtime.renderTarget?.dispose();
    this.runtime.renderTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
  }

  disposeThreeRuntime() {
    if (!this.runtime) {
      return;
    }
    this.runtime.renderTarget?.dispose();
    this.runtime.renderTarget = null;
    this.runtime.depthMaterial?.dispose();
    this.runtime.depthMaterial = null;
    this.runtime = null;
  }
}
