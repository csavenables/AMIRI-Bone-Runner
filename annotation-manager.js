import { AnnotationOverlay } from "./annotation-overlay.js";
import { OcclusionResolver } from "./occlusion-resolver.js";
import {
  add3,
  clamp,
  easeInOutCubic,
  lerp3,
  mul3,
  normalize3,
  projectPointToScreen,
  rotateY,
  sub3,
} from "./annotation-utils.js";

function clonePin(pin) {
  return {
    ...pin,
    pos: [...pin.pos],
    camera: {
      ...pin.camera,
      position: [...pin.camera.position],
      target: [...pin.camera.target],
      orbitLimits: pin.camera.orbitLimits ? { ...pin.camera.orbitLimits } : undefined,
    },
  };
}

function parseNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
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
  return [...fallback];
}

function easeInOutSine(t) {
  const x = clamp(t, 0, 1);
  return 0.5 * (1 - Math.cos(Math.PI * x));
}

function lerpNumber(from, to, t) {
  const x = clamp(t, 0, 1);
  return from + (to - from) * x;
}

export class AnnotationManager {
  constructor(options) {
    this.options = options;
    this.overlay = new AnnotationOverlay(options.host, {
      onSelect: (id) => this.selectAnnotation(id),
      onPrev: () => this.selectPrev(),
      onNext: () => this.selectNext(),
      onClose: () => this.close(),
    });
    this.occlusionResolver = new OcclusionResolver();

    this.config = null;
    this.assetIds = [];
    this.pins = [];
    this.selectedId = null;
    this.activeAssetId = null;
    this.editMode = false;
    this.editorListener = null;

    this.cameraTarget = [0, 0, 0];
    this.cameraAnimationFrame = 0;
    this.liveCameraPose = null;
    this.wrapNavigation = true;
    this.pendingAnimateFov = null;
    this.offscreenRecoveryTriggered = false;
    this.offscreenRecoveryExpiresAt = 0;
    this.debugTransformSync = Boolean(options.debugTransformSync);
    this.transformSyncWarned = false;
    this.introPinOptions = {
      enabled: false,
      fadeMs: 700,
      greyAlpha: 0.4,
      greyColor: "#7f7f7f",
    };
    this.introPlaybackState = "completed";
    this.introFadeStartMs = 0;
    this.introFadeProgress = 1;
    this.lastOcclusionDebug = {
      requestedMode: "heuristic",
      activeMode: "heuristic",
      nativeAvailable: false,
      reason: "heuristic-selected",
      occludedCount: 0,
      visibleCount: 0,
      hiddenByDeclutter: 0,
    };
  }

  configure(config, assetIds) {
    this.assetIds = [...assetIds];
    this.config = config?.enabled ? this.deepCloneConfig(config) : null;
    this.pins = this.config?.pins.slice(0, 20).map(clonePin) ?? [];
    this.pins.sort((a, b) => a.order - b.order);

    this.selectedId = null;
    this.activeAssetId = this.options.getActiveAssetId?.() ?? this.assetIds[0] ?? null;
    this.editMode = false;
    this.cameraTarget = this.getPreferredTarget([0, 0, 0]);
    this.wrapNavigation = Boolean(this.config?.ui?.wrapNavigation ?? true);
    this.offscreenRecoveryTriggered = false;
    this.offscreenRecoveryExpiresAt = performance.now() + 7000;
    this.transformSyncWarned = false;
    this.introPinOptions = this.getIntroPinOptions();
    this.introPlaybackState = "completed";
    this.introFadeStartMs = 0;
    this.introFadeProgress = 1;
    this.occlusionResolver.configure({
      mode: this.getOcclusionConfig().mode,
      cameraEl: this.options.cameraEl,
      sceneEl: this.options.sceneEl,
      streamEl: this.options.streamEl,
    });
    this.lastOcclusionDebug = {
      ...this.lastOcclusionDebug,
      ...this.occlusionResolver.getStatus(),
      occludedCount: 0,
      visibleCount: 0,
      hiddenByDeclutter: 0,
    };

    this.overlay.setVisible(Boolean(this.config && this.pins.length > 0));

    this.emitEditorState();
  }

  clear() {
    this.config = null;
    this.assetIds = [];
    this.pins = [];
    this.selectedId = null;
    this.activeAssetId = null;
    this.editMode = false;
    this.cameraTarget = this.getPreferredTarget([0, 0, 0]);
    this.overlay.setVisible(false);
    this.stopCameraAnimation();
    this.emitEditorState();
  }

  update(nowMs, width, height) {
    if (!this.config || this.pins.length === 0 || width <= 0 || height <= 0) {
      return;
    }

    const introPresentation = this.getIntroPresentation(nowMs);
    const projectedPins = this.projectPins(width, height, nowMs, introPresentation);
    if (
      introPresentation.pinsVisible &&
      !this.offscreenRecoveryTriggered &&
      projectedPins.length > 0 &&
      projectedPins.every((entry) => !entry.visible) &&
      performance.now() <= this.offscreenRecoveryExpiresAt
    ) {
      this.offscreenRecoveryTriggered = true;
      this.options.onAllPinsOffscreen?.();
      return;
    }

    const visiblePins = this.pins.filter((pin) => !pin.assetId || pin.assetId === this.activeAssetId);
    const selectedIndex = this.selectedId
      ? visiblePins.findIndex((pin) => pin.id === this.selectedId)
      : -1;
    const hasAny = visiblePins.length > 0;
    const hasMany = visiblePins.length > 1;
    const canNavigateFromNone = selectedIndex < 0 && hasAny;
    const canPrev = canNavigateFromNone
      ? true
      : this.wrapNavigation
        ? hasMany
        : selectedIndex > 0;
    const canNext = canNavigateFromNone
      ? true
      : this.wrapNavigation
        ? hasMany
        : selectedIndex >= 0 && selectedIndex < visiblePins.length - 1;

    this.overlay.render({
      pins: projectedPins,
      selectedId: this.selectedId,
      showTooltip: Boolean(this.config.ui?.showTooltip) && introPresentation.tooltipReady,
      showNav: Boolean(this.config.ui?.showNav) && introPresentation.navReady,
      canPrev,
      canNext,
      introGreyActive: introPresentation.introGreyActive,
      introPinColor: this.introPinOptions.greyColor,
    });
  }

  setLiveCameraPose(pose) {
    if (!pose) {
      return;
    }
    const nextPosition = parseVec3(pose.position, this.getCameraPosition());
    const preferredTarget = this.getPreferredTarget(this.cameraTarget);
    const nextTarget = this.getPreferredTarget(parseVec3(pose.target, preferredTarget));
    const inferredForward = [
      nextTarget[0] - nextPosition[0],
      nextTarget[1] - nextPosition[1],
      nextTarget[2] - nextPosition[2],
    ];
    this.liveCameraPose = {
      position: nextPosition,
      target: nextTarget,
      fov: pose.fov,
      forward: pose.forward ? [...pose.forward] : normalize3(inferredForward, [0, 0, -1]),
    };
    this.cameraTarget = [...nextTarget];
  }

  setActiveAssetId(assetId) {
    this.activeAssetId = assetId;
    if (!this.selectedId) {
      this.emitEditorState();
      return;
    }

    const selected = this.pins.find((pin) => pin.id === this.selectedId);
    if (selected?.assetId && selected.assetId !== assetId) {
      this.close();
      return;
    }

    this.emitEditorState();
  }

  setEditMode(enabled) {
    this.editMode = Boolean(enabled);
    this.emitEditorState();
  }

  onEditorStateChange(listener) {
    this.editorListener = listener;
    this.emitEditorState();
  }

  setIntroPlaybackState(state, nowMs = performance.now()) {
    if (!this.introPinOptions.enabled) {
      this.introPlaybackState = "completed";
      this.introFadeProgress = 1;
      this.introFadeStartMs = 0;
      return;
    }

    const phase = String(state || "").toLowerCase();
    if (phase === "running") {
      this.introPlaybackState = "running";
      this.introFadeProgress = 0;
      this.introFadeStartMs = 0;
      return;
    }

    if (phase === "cancelled") {
      this.introPlaybackState = "cancelled";
      this.introFadeProgress = 0;
      this.introFadeStartMs = 0;
      return;
    }

    if (phase === "completed") {
      this.introPlaybackState = "completed";
      this.introFadeStartMs = nowMs;
      this.introFadeProgress = this.introPinOptions.fadeMs <= 0 ? 1 : 0;
      return;
    }
  }

  selectAnnotation(id, options = {}) {
    const pin = this.pins.find((entry) => entry.id === id);
    if (!pin) {
      return;
    }

    const animate = options.animate !== false;
    const target = this.getPreferredTarget(this.cameraTarget);
    this.selectedId = id;
    this.cameraTarget = [...target];
    if (animate) {
      this.pendingAnimateFov = pin.camera.fov;
      this.animateCameraTo(pin.camera.position, undefined, target);
    } else {
      this.stopCameraAnimation();
    }
    this.applyCameraFov(pin.camera.fov);
    this.emitEditorState();
  }

  captureSelectedCameraFromLivePose() {
    if (!this.config || !this.selectedId) {
      return false;
    }

    const index = this.pins.findIndex((pin) => pin.id === this.selectedId);
    if (index < 0) {
      return false;
    }

    const existing = this.pins[index];
    const capturePosition = this.liveCameraPose?.position
      ? [...this.liveCameraPose.position]
      : this.getCameraPosition();
    const captureTarget = this.liveCameraPose?.target
      ? this.getPreferredTarget(this.liveCameraPose.target)
      : this.getPreferredTarget(this.cameraTarget);
    const captureFov = this.getCameraFov();

    this.pins[index] = {
      ...existing,
      camera: {
        ...existing.camera,
        position: [...capturePosition],
        target: [...captureTarget],
        fov: captureFov,
      },
    };

    this.syncConfigPins();
    this.emitEditorState();
    return true;
  }

  updateSelected(patch) {
    if (!this.config || !this.selectedId) {
      return;
    }

    const index = this.pins.findIndex((pin) => pin.id === this.selectedId);
    if (index < 0) {
      return;
    }

    const existing = this.pins[index];
    const nextCamera = patch.camera
      ? {
          ...existing.camera,
          ...patch.camera,
          position: parseVec3(patch.camera.position, existing.camera.position),
          target: parseVec3(patch.camera.target, existing.camera.target),
          fov: parseNumber(patch.camera.fov, existing.camera.fov),
        }
      : existing.camera;

    this.pins[index] = {
      ...existing,
      title: patch.title ?? existing.title,
      body: patch.body ?? existing.body,
      pos: patch.pos ? [...patch.pos] : existing.pos,
      assetId:
        patch.assetId === undefined
          ? existing.assetId
          : patch.assetId === null || patch.assetId === "__all__"
            ? undefined
            : patch.assetId,
      camera: nextCamera,
    };

    this.syncConfigPins();
    this.emitEditorState();
  }

  nudgeSelected(axis, delta) {
    if (!this.selectedId) {
      return;
    }

    const pin = this.pins.find((entry) => entry.id === this.selectedId);
    if (!pin) {
      return;
    }

    const next = [...pin.pos];
    if (axis === "x") {
      next[0] += delta;
    }
    if (axis === "y") {
      next[1] += delta;
    }
    if (axis === "z") {
      next[2] += delta;
    }

    this.updateSelected({ pos: next });
  }

  addPin() {
    if (!this.config) {
      return;
    }

    if (this.pins.length >= 20) {
      console.warn("AnnotationManager: max 20 pins reached.");
      return;
    }

    const nextOrder = this.pins.reduce((max, pin) => Math.max(max, pin.order), 0) + 1;
    const id = `pin_${nextOrder}`;
    const target = this.getPreferredTarget(this.cameraTarget);
    const cameraPosition = this.getCameraPosition();

    let direction = normalize3(sub3(cameraPosition, target), [0, 0, 1]);
    if (!Number.isFinite(direction[0])) {
      direction = [0, 0, 1];
    }

    const pinPos = add3(target, mul3(direction, 0.2));

    const pin = {
      id,
      order: nextOrder,
      pos: [...pinPos],
      title: `Annotation ${nextOrder}`,
      body: "Edit this description.",
      assetId: this.activeAssetId ?? undefined,
      camera: {
        position: [...cameraPosition],
        target: [...target],
        fov: this.getCameraFov(),
        transitionMs: this.getCameraMotionConfig().durationMs,
        lockControls: false,
      },
    };

    this.pins.push(pin);
    this.pins.sort((a, b) => a.order - b.order);
    this.selectedId = pin.id;
    this.overlay.setVisible(true);

    this.syncConfigPins();
    this.emitEditorState();
  }

  deleteSelected() {
    if (!this.selectedId) {
      return;
    }

    const nextPins = this.pins.filter((pin) => pin.id !== this.selectedId);
    this.pins = nextPins;
    this.selectedId = nextPins[0]?.id ?? null;

    this.syncConfigPins();
    this.emitEditorState();
  }

  exportAnnotations() {
    if (!this.config) {
      return null;
    }

    return {
      ...this.config,
      pins: this.pins.map((pin) => clonePin(pin)),
    };
  }

  isOcclusionAvailable() {
    return this.occlusionResolver.isAvailable();
  }

  getOcclusionDebugInfo() {
    return { ...this.lastOcclusionDebug };
  }

  dispose() {
    this.stopCameraAnimation();
    this.overlay.dispose();
    this.occlusionResolver.dispose();
  }

  deepCloneConfig(config) {
    return {
      ...config,
      pins: (config.pins ?? []).map((pin) => clonePin(pin)),
      ui: {
        ...config.ui,
        declutter: {
          ...config.ui?.declutter,
        },
        occlusion: {
          ...config.ui?.occlusion,
        },
      },
    };
  }

  getOcclusionConfig() {
    const occlusion = this.config?.ui?.occlusion ?? {};
    const rawMode = String(occlusion.mode || "").toLowerCase();
    const mode =
      rawMode === "native-depth" || rawMode === "depth"
        ? "native-depth"
        : rawMode === "heuristic"
          ? "heuristic"
          : "heuristic";
    return {
      enabled: Boolean(occlusion.enabled),
      mode,
      fadeAlphaOccluded: clamp(
        Number(occlusion.fadeAlphaOccluded ?? occlusion.fadeAlpha ?? 0.2),
        0,
        1,
      ),
      disableClickWhenOccluded: Boolean(occlusion.disableClickWhenOccluded ?? true),
      epsilon: Math.max(0, Number(occlusion.epsilon) || 0.01),
    };
  }

  getDeclutterConfig() {
    const declutter = this.config?.ui?.declutter ?? {};
    return {
      selectedOnlyStrong: Boolean(declutter.selectedOnlyStrong ?? true),
      unselectedAlpha: clamp(Number(declutter.unselectedAlpha ?? 0.18), 0.02, 1),
      maxVisibleUnselected: Math.max(0, Math.floor(Number(declutter.maxVisibleUnselected) || 6)),
      silhouetteConfidenceThreshold: clamp(
        Number(declutter.silhouetteConfidenceThreshold ?? 0.66),
        0.2,
        0.98,
      ),
    };
  }

  getTransformConfig() {
    const transform = this.config?.ui?.transform ?? {};
    const fallbackRotationSign =
      Number(transform.fallbackRotationSign) < 0 ? -1 : 1;
    return { fallbackRotationSign };
  }

  getCameraMotionConfig() {
    const cameraMotion = this.config?.ui?.cameraMotion ?? {};
    const durationMs = Math.max(200, Number(cameraMotion.durationMs) || 1500);
    const easing = String(cameraMotion.easing || "sine").toLowerCase() === "cubic"
      ? "cubic"
      : "sine";
    const distanceScale = clamp(Number(cameraMotion.distanceScale ?? 1), 0.45, 1.8);
    return { durationMs, easing, distanceScale };
  }

  getIntroPinOptions() {
    const ui = this.config?.ui ?? {};
    return {
      enabled: Boolean(ui.introPinsHidden),
      fadeMs: Math.max(0, Number(ui.introPinFadeMs) || 700),
      greyAlpha: clamp(Number(ui.introPinGreyAlpha ?? 0.4), 0, 1),
      greyColor: String(ui.introPinGreyColor || "#7f7f7f"),
    };
  }

  getIntroPresentation(nowMs) {
    if (!this.introPinOptions.enabled) {
      return {
        pinsVisible: true,
        fade: 1,
        navReady: true,
        tooltipReady: true,
        introGreyActive: false,
      };
    }

    if (this.introPlaybackState === "running" || this.introPlaybackState === "cancelled") {
      return {
        pinsVisible: false,
        fade: 0,
        navReady: false,
        tooltipReady: false,
        introGreyActive: true,
      };
    }

    if (this.introPlaybackState === "completed") {
      if (this.introFadeProgress < 1) {
        const elapsed = Math.max(0, nowMs - this.introFadeStartMs);
        const fadeMs = Math.max(1, this.introPinOptions.fadeMs);
        this.introFadeProgress = clamp(elapsed / fadeMs, 0, 1);
      }
      return {
        pinsVisible: this.introFadeProgress > 0.001,
        fade: this.introFadeProgress,
        navReady: true,
        tooltipReady: true,
        introGreyActive: true,
      };
    }

    return {
      pinsVisible: true,
      fade: 1,
      navReady: true,
      tooltipReady: true,
      introGreyActive: false,
    };
  }

  buildHeuristicOcclusion(projected, width, height, streamPosition, pose, declutterConfig) {
    const centerProjection = projectPointToScreen({
      world: streamPosition,
      cameraPosition: pose.position,
      cameraTarget: pose.target,
      cameraForward: pose.forward,
      fovDegrees: pose.fov,
      near: pose.near,
      far: pose.far,
      width,
      height,
    });

    const centerX = centerProjection.visible ? centerProjection.screenX : width * 0.5;
    const centerY = centerProjection.visible ? centerProjection.screenY : height * 0.5;
    const visible = projected.filter((entry) => entry.visible);
    const sortedByDepth = [...visible].sort((a, b) => a.ndcDepth - b.ndcDepth);
    const denominator = Math.max(1, sortedByDepth.length - 1);
    const depthRankById = new Map(
      sortedByDepth.map((entry, index) => [entry.pin.id, index / denominator]),
    );

    const maxRadius = Math.max(1, Math.min(width, height) * 0.48);
    const threshold = declutterConfig.silhouetteConfidenceThreshold;
    const occludedById = new Map();
    for (const entry of projected) {
      if (!entry.visible) {
        occludedById.set(entry.pin.id, false);
        continue;
      }

      const dx = entry.screenX - centerX;
      const dy = entry.screenY - centerY;
      const distanceNorm = clamp(Math.hypot(dx, dy) / maxRadius, 0, 1);
      const depthRank = depthRankById.get(entry.pin.id) ?? 0;
      const confidence = clamp(distanceNorm * 0.55 + depthRank * 0.45, 0, 1);
      occludedById.set(entry.pin.id, confidence >= threshold);
    }

    return occludedById;
  }

  applyDeclutter(projected, width, height, declutterConfig) {
    const maxVisibleUnselected = declutterConfig.maxVisibleUnselected;
    if (maxVisibleUnselected <= 0) {
      return 0;
    }

    const selected = projected.find((entry) => entry.pin.id === this.selectedId && entry.visible) ?? null;
    const candidates = projected.filter(
      (entry) => entry.visible && entry.pin.id !== this.selectedId,
    );
    if (candidates.length <= maxVisibleUnselected) {
      return 0;
    }

    const refX = selected ? selected.screenX : width * 0.5;
    const refY = selected ? selected.screenY : height * 0.5;
    const sorted = [...candidates].sort((a, b) => {
      const da = Math.hypot(a.screenX - refX, a.screenY - refY);
      const db = Math.hypot(b.screenX - refX, b.screenY - refY);
      if (da !== db) {
        return da - db;
      }
      return a.ndcDepth - b.ndcDepth;
    });

    const keepSet = new Set(sorted.slice(0, maxVisibleUnselected).map((entry) => entry.pin.id));
    let hiddenCount = 0;
    for (const entry of projected) {
      if (entry.pin.id === this.selectedId || !entry.visible) {
        continue;
      }
      if (!keepSet.has(entry.pin.id)) {
        entry.visible = false;
        entry.clickable = false;
        entry.alpha = 0;
        hiddenCount += 1;
      }
    }
    return hiddenCount;
  }

  projectPins(width, height, nowMs, introPresentation = null) {
    const streamPosition = this.getStreamPosition();
    const streamRotation = this.getStreamRotationY();
    const streamScale = this.getStreamScale();
    const streamMatrixWorld = this.getStreamMatrixWorldElements();
    const transformConfig = this.getTransformConfig();
    const pose = this.getProjectionPose();
    const cameraPosition = [...pose.position];
    const cameraTarget = [...pose.target];
    const fov = pose.fov;

    const samples = [];
    const projected = [];

    for (const pin of this.pins) {
      if (pin.assetId && pin.assetId !== this.activeAssetId) {
        continue;
      }

      const scaled = [
        pin.pos[0] * streamScale[0],
        pin.pos[1] * streamScale[1],
        pin.pos[2] * streamScale[2],
      ];
      const rotated = rotateY(scaled, streamRotation * transformConfig.fallbackRotationSign);
      const manualWorld = add3(rotated, streamPosition);
      const world = streamMatrixWorld
        ? this.transformPointByMatrix(pin.pos, streamMatrixWorld)
        : manualWorld;
      if (this.debugTransformSync && streamMatrixWorld && !this.transformSyncWarned) {
        const dx = world[0] - manualWorld[0];
        const dy = world[1] - manualWorld[1];
        const dz = world[2] - manualWorld[2];
        const delta = Math.hypot(dx, dy, dz);
        if (delta > 0.05) {
          this.transformSyncWarned = true;
          console.warn(
            `Annotation transform mismatch detected (matrix/manual delta=${delta.toFixed(4)}). Using matrix path.`,
          );
        }
      }
      const projection = projectPointToScreen({
        world,
        cameraPosition,
        cameraTarget,
        cameraForward: pose.forward,
        fovDegrees: fov,
        near: pose.near,
        far: pose.far,
        width,
        height,
      });

      samples.push({
        id: pin.id,
        visible: projection.visible,
        x: projection.screenX / width,
        y: projection.screenY / height,
        ndcDepth: projection.ndcDepth,
      });

      projected.push({
        pin,
        world,
        screenX: projection.screenX,
        screenY: projection.screenY,
        ndcDepth: projection.ndcDepth,
        visible: projection.visible,
        occluded: false,
        alpha: 1,
        clickable: true,
      });
    }

    const occlusionConfig = this.getOcclusionConfig();
    const declutterConfig = this.getDeclutterConfig();
    let occludedById = new Map();
    let status = this.occlusionResolver.getStatus();

    if (occlusionConfig.enabled) {
      if (occlusionConfig.mode === "native-depth") {
        occludedById = this.occlusionResolver.resolve(
          samples,
          width,
          height,
          occlusionConfig.epsilon,
          nowMs,
        );
        status = this.occlusionResolver.getStatus();
        if (status.activeMode !== "native-depth") {
          occludedById = this.buildHeuristicOcclusion(
            projected,
            width,
            height,
            streamPosition,
            pose,
            declutterConfig,
          );
          status = {
            ...status,
            activeMode: "heuristic",
            reason: "fallback-heuristic",
          };
        }
      } else {
        occludedById = this.buildHeuristicOcclusion(
          projected,
          width,
          height,
          streamPosition,
          pose,
          declutterConfig,
        );
        status = {
          ...status,
          activeMode: "heuristic",
          reason: "heuristic-selected",
        };
      }
    }

    const selectedOnlyStrong = declutterConfig.selectedOnlyStrong;
    const unselectedAlpha = declutterConfig.unselectedAlpha;
    const fadeAlphaOccluded = occlusionConfig.fadeAlphaOccluded;
    let occludedCount = 0;

    for (const entry of projected) {
      const isSelected = entry.pin.id === this.selectedId;
      const occluded = entry.visible && Boolean(occludedById.get(entry.pin.id));
      if (occluded) {
        occludedCount += 1;
      }

      let alpha = selectedOnlyStrong ? (isSelected ? 1 : unselectedAlpha) : 1;
      if (occluded && !isSelected) {
        alpha = Math.min(alpha, fadeAlphaOccluded);
      }
      if (isSelected && selectedOnlyStrong) {
        alpha = 1;
      }

      entry.occluded = occluded;
      entry.alpha = alpha;
      entry.clickable = isSelected || !occluded || !occlusionConfig.disableClickWhenOccluded;
    }

    const introFade = clamp(introPresentation?.fade ?? 1, 0, 1);
    const introGreyAlpha = this.introPinOptions.greyAlpha;
    for (const entry of projected) {
      const targetAlpha = Math.max(entry.alpha, introGreyAlpha);
      entry.alpha = lerpNumber(0, targetAlpha, introFade);
      if (!(introPresentation?.pinsVisible ?? true)) {
        entry.visible = false;
        entry.alpha = 0;
        entry.clickable = false;
      }
    }

    const hiddenByDeclutter = this.applyDeclutter(projected, width, height, declutterConfig);
    const visibleCount = projected.filter((entry) => entry.visible).length;
    this.lastOcclusionDebug = {
      ...this.lastOcclusionDebug,
      ...status,
      requestedMode: occlusionConfig.mode,
      occludedCount,
      visibleCount,
      hiddenByDeclutter,
    };

    return projected;
  }

  selectPrev() {
    const visiblePins = this.pins.filter((pin) => !pin.assetId || pin.assetId === this.activeAssetId);
    if (visiblePins.length === 0) {
      return;
    }
    if (!this.selectedId) {
      this.selectAnnotation(visiblePins[0].id);
      return;
    }

    const index = visiblePins.findIndex((pin) => pin.id === this.selectedId);
    if (index < 0) {
      this.selectAnnotation(visiblePins[0].id);
      return;
    }

    const nextIndex = index <= 0
      ? (this.wrapNavigation ? visiblePins.length - 1 : 0)
      : index - 1;
    if (nextIndex === index && !this.wrapNavigation) {
      return;
    }
    this.selectAnnotation(visiblePins[nextIndex].id);
  }

  selectNext() {
    const visiblePins = this.pins.filter((pin) => !pin.assetId || pin.assetId === this.activeAssetId);
    if (visiblePins.length === 0) {
      return;
    }
    if (!this.selectedId) {
      this.selectAnnotation(visiblePins[0].id);
      return;
    }

    const index = visiblePins.findIndex((pin) => pin.id === this.selectedId);
    if (index < 0) {
      this.selectAnnotation(visiblePins[0].id);
      return;
    }

    const nextIndex = index >= visiblePins.length - 1
      ? (this.wrapNavigation ? 0 : index)
      : index + 1;
    if (nextIndex === index && !this.wrapNavigation) {
      return;
    }
    this.selectAnnotation(visiblePins[nextIndex].id);
  }

  close() {
    this.selectedId = null;
    this.emitEditorState();
  }

  syncConfigPins() {
    if (!this.config) {
      return;
    }

    this.config = {
      ...this.config,
      pins: this.pins.map((pin) => clonePin(pin)),
    };
  }

  emitEditorState() {
    if (!this.editorListener) {
      return;
    }

    this.editorListener({
      available: Boolean(this.config),
      editMode: this.editMode,
      selectedId: this.selectedId,
      activeAssetId: this.activeAssetId,
      assetIds: [...this.assetIds],
      pins: this.pins.map((pin) => ({
        id: pin.id,
        assetId: pin.assetId,
        order: pin.order,
        pos: [...pin.pos],
        title: pin.title,
        body: pin.body,
      })),
      occlusionAvailable: this.occlusionResolver.isAvailable(),
      occlusionMode: this.lastOcclusionDebug.activeMode,
      occlusionReason: this.lastOcclusionDebug.reason,
    });
  }

  getCameraPosition() {
    if (this.liveCameraPose?.position) {
      return [...this.liveCameraPose.position];
    }
    const position = this.options.cameraEl?.position;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
      return [position.x, position.y, position.z];
    }

    const fallback = this.options.defaultCameraPosition ?? [0, 0.83, 1.44];
    return [...fallback];
  }

  getCameraFov() {
    if (this.liveCameraPose?.fov && Number.isFinite(this.liveCameraPose.fov) && this.liveCameraPose.fov > 0) {
      return this.liveCameraPose.fov;
    }
    const fov = parseNumber(this.options.cameraEl?.fov, NaN);
    if (Number.isFinite(fov) && fov > 0) {
      return fov;
    }
    return this.options.defaultCameraFov ?? 50;
  }

  getCameraNearFar() {
    const nearCandidates = [
      this.options.cameraEl?.near,
      this.options.cameraEl?.camera?.near,
      this.options.cameraEl?.object3D?.near,
    ];
    const farCandidates = [
      this.options.cameraEl?.far,
      this.options.cameraEl?.camera?.far,
      this.options.cameraEl?.object3D?.far,
    ];

    const near = nearCandidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0);
    const far = farCandidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0);
    const safeNear = Number.isFinite(Number(near)) ? Number(near) : 0.01;
    const safeFar = Number.isFinite(Number(far)) ? Number(far) : 100;
    return {
      near: safeNear,
      far: Math.max(safeNear + 0.001, safeFar),
    };
  }

  applyCameraFov(fov) {
    if (!Number.isFinite(fov) || fov <= 0) {
      return;
    }
    if (this.options.cameraEl && "fov" in this.options.cameraEl) {
      this.options.cameraEl.fov = fov;
    }
  }

  getStreamMatrixWorldElements() {
    const object3D = this.options.streamEl?.object3D;
    if (!object3D?.matrixWorld?.elements) {
      return null;
    }
    if (typeof object3D.updateMatrixWorld === "function") {
      object3D.updateMatrixWorld(true);
    }
    const elements = object3D.matrixWorld.elements;
    if (!Array.isArray(elements) && !(elements instanceof Float32Array)) {
      return null;
    }
    if (elements.length < 16) {
      return null;
    }
    return elements;
  }

  transformPointByMatrix(local, m) {
    return [
      m[0] * local[0] + m[4] * local[1] + m[8] * local[2] + m[12],
      m[1] * local[0] + m[5] * local[1] + m[9] * local[2] + m[13],
      m[2] * local[0] + m[6] * local[1] + m[10] * local[2] + m[14],
    ];
  }

  getStreamPosition() {
    const position = this.options.streamEl?.position;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
      return [position.x, position.y, position.z];
    }

    const fallback = this.options.defaultStreamPosition ?? [0, -0.5, 0];
    return [...fallback];
  }

  getStreamRotationY() {
    const rotation = this.options.streamEl?.rotation;
    if (rotation && Number.isFinite(rotation.y)) {
      return rotation.y;
    }
    return 0;
  }

  getStreamScale() {
    const scale = this.options.streamEl?.scale;
    if (scale && Number.isFinite(scale.x) && Number.isFinite(scale.y) && Number.isFinite(scale.z)) {
      return [scale.x, scale.y, scale.z];
    }
    return [1, 1, 1];
  }

  getPreferredTarget(fallback = [0, 0, 0]) {
    const fixedPivot = this.options.getFixedPivotWorld?.();
    if (Array.isArray(fixedPivot) && fixedPivot.length >= 3) {
      return parseVec3(fixedPivot, fallback);
    }
    return [...fallback];
  }

  getProjectionPose() {
    const position = this.getCameraPosition();
    const target = this.getPreferredTarget(
      this.liveCameraPose?.target ? [...this.liveCameraPose.target] : [...this.cameraTarget],
    );
    const fov = this.getCameraFov();
    const forward = this.liveCameraPose?.forward
      ? [...this.liveCameraPose.forward]
      : normalize3(sub3(target, position), [0, 0, -1]);
    const nearFar = this.getCameraNearFar();
    return { position, target, fov, forward, ...nearFar };
  }

  animateCameraTo(targetPosition, durationMs, targetOverride) {
    const cameraMotionConfig = this.getCameraMotionConfig();
    const fromPose = this.liveCameraPose
      ? {
          position: [...this.liveCameraPose.position],
          target: this.getPreferredTarget(this.liveCameraPose.target),
          fov: this.liveCameraPose.fov,
        }
      : {
          position: this.getCameraPosition(),
          target: this.getPreferredTarget(this.cameraTarget),
          fov: this.getCameraFov(),
        };

    const toPosition = parseVec3(targetPosition, fromPose.position);
    const toTarget = this.getPreferredTarget(parseVec3(targetOverride, fromPose.target));
    const toOffset = sub3(toPosition, toTarget);
    const scaledOffset = mul3(toOffset, cameraMotionConfig.distanceScale);
    const toPositionScaled = add3(toTarget, scaledOffset);
    const scaledDistance = Math.hypot(scaledOffset[0], scaledOffset[1], scaledOffset[2]);
    const toPositionFinal = scaledDistance < 0.08
      ? add3(toTarget, mul3(normalize3(toOffset, [0, 0, 1]), 0.08))
      : toPositionScaled;
    const toFov = Number.isFinite(this.pendingAnimateFov)
      ? this.pendingAnimateFov
      : this.getCameraFov();

    this.stopCameraAnimation();

    if (!this.options.setCameraPose) {
      return;
    }

    const duration = Math.max(
      220,
      Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
        ? Number(durationMs)
        : cameraMotionConfig.durationMs,
    );
    const easingFn = cameraMotionConfig.easing === "cubic" ? easeInOutCubic : easeInOutSine;
    const start = performance.now();

    const step = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      const eased = easingFn(t);
      const currentPosition = lerp3(fromPose.position, toPositionFinal, eased);
      const currentTarget = lerp3(fromPose.target, toTarget, eased);
      this.options.setCameraPose({
        position: currentPosition,
        target: currentTarget,
        fov: toFov,
      });
      this.setLiveCameraPose({
        position: currentPosition,
        target: currentTarget,
        fov: toFov,
      });

      if (t >= 1) {
        this.pendingAnimateFov = null;
        this.cameraAnimationFrame = 0;
        return;
      }

      this.cameraAnimationFrame = requestAnimationFrame(step);
    };

    this.cameraAnimationFrame = requestAnimationFrame(step);
  }

  stopCameraAnimation() {
    if (!this.cameraAnimationFrame) {
      this.pendingAnimateFov = null;
      return;
    }

    cancelAnimationFrame(this.cameraAnimationFrame);
    this.cameraAnimationFrame = 0;
    this.pendingAnimateFov = null;
  }
}
