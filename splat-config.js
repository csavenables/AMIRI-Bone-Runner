export const MIRIS_VIEWER_KEY = "SCpKAMoKc-mLURyO0DJQnSUIHYBmEclh5j5i1a_qteA";
export const SUPPRESS_MIRIS_LOD_WARNINGS = true;

export const MIRIS_CAMERA = { x: 0.16, y: 1.22, z: 0.86, fov: 38 };
export const STREAM_POSITION = { x: 0, y: 0.34, z: 0 };
export const LIGHTING_CONFIG = { globalBrightness: 1.2 };
export const PIVOT_CONFIG = {
  pivotWorld: [0.0, 0.0, 0.0],
  enforce: true,
  disablePan: true,
};

export const START_VIEW_CONFIG = {
  camera: {
    position: [0.16, 0.5, 0.86],
    target: [0.04, 0.5, 0.02],
    fov: 38,
  },
  asset: {
    position: [0, 0.0, 0],
    rotY: 4.491592653589793,
    scale: [2, 2, 2],
  },
  lockFrames: 32,
};

export const AUTHORING_CONFIG = {
  framingPanelEnabled: true,
  queryKey: "frame",
};

export const ANNOTATION_UI_CONFIG = {
  wrapNavigation: true,
};

export const MIRIS_ASSETS = [
  {
    id: "splat-1",
    label: "Splat 1",
    uuid: "5b3416d4-28c4-4c40-a2ea-89e720a5a60d",
    rotY: 4.491592653589793,
  },
];

export const INTRO_CONFIG = {
  enabled: true,
  replayButton: false,
  showRevealOverlay: false,
  particlesEnabled: false,
  spinDegrees: 180,
  spinDirection: 1,
  spinDurationMs: 2300,
  preSpinHoldMs: 120,
  particleDurationMs: 1300,
  particleCount: 320,
  particleSpread: 0.42,
  particleSizeMin: 1.4,
  particleSizeMax: 3.8,
  revealFadeMs: 900,
  settleMs: 120,
  overlayColor: "#ffffff",
};

export const ANNOTATIONS_CONFIG = {
  enabled: true,
  defaultSelectedId: "pin_1",
  pins: [
    {
      id: "pin_1",
      assetId: "splat-1",
      order: 1,
      pos: [0, 0.03, 0.06],
      title: "Center Detail",
      body: "Primary annotation point for the single streaming asset.",
      camera: {
        position: [0.18, 1.24, 0.89],
        target: [0.04, 0.72, 0.02],
        fov: 38,
        transitionMs: 750,
        lockControls: false,
      },
    },
    {
      id: "pin_2",
      assetId: "splat-1",
      order: 2,
      pos: [-0.1, 0.02, -0.02],
      title: "Left Feature",
      body: "Secondary annotation point for interactive walkthroughs.",
      camera: {
        position: [0.08, 1.26, 0.92],
        target: [0.04, 0.72, 0.02],
        fov: 38,
        transitionMs: 750,
        lockControls: false,
      },
    },
  ],
  ui: {
    showTooltip: true,
    showNav: true,
    pinStyle: "numbered",
    wrapNavigation: true,
    cameraMotion: {
      durationMs: 1700,
      easing: "sine",
      distanceScale: 0.82,
    },
    declutter: {
      selectedOnlyStrong: true,
      unselectedAlpha: 0.18,
      maxVisibleUnselected: 6,
      silhouetteConfidenceThreshold: 0.66,
    },
    occlusion: {
      enabled: true,
      mode: "native-depth",
      fadeAlphaOccluded: 0.2,
      disableClickWhenOccluded: true,
      epsilon: 0.01,
    },
    transform: {
      fallbackRotationSign: -1,
    },
  },
  editor: {
    enabled: true,
  },
};
