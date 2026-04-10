import { clamp, easeInOutCubic } from "./annotation-utils.js";

function waitMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

function animateMs(durationMs, onFrame) {
  const duration = Math.max(1, durationMs);
  const start = performance.now();

  return new Promise((resolve) => {
    const step = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      onFrame(t, now - start);
      if (t >= 1) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

export class IntroController {
  constructor(options) {
    this.options = options;
    this.config = options.config;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.runningPromise = null;
    this.particles = [];

    this.overlay = document.createElement("div");
    this.overlay.className = "intro-overlay hidden";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "intro-particles hidden";
    this.ctx = this.canvas.getContext("2d", { alpha: true });

    this.replayButton = null;
    if (this.config.replayButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "replay-button";
      button.textContent = "Replay";
      button.setAttribute("aria-label", "Replay intro");
      button.onclick = () => {
        void this.replay();
      };
      this.replayButton = button;
      options.host.append(this.overlay, this.canvas, button);
    } else {
      options.host.append(this.overlay, this.canvas);
    }

    this.onResize = () => this.resizeCanvas();
    window.addEventListener("resize", this.onResize, { passive: true });
    this.resizeCanvas();

    this.overlay.style.background = this.config.overlayColor || "#ffffff";
  }

  async runIntro() {
    if (!this.config.enabled) {
      return;
    }

    if (this.runningPromise) {
      return this.runningPromise;
    }

    this.runningPromise = this.executeIntro();
    try {
      await this.runningPromise;
    } finally {
      this.runningPromise = null;
    }
  }

  async replay() {
    await this.runIntro();
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.overlay.remove();
    this.canvas.remove();
    this.replayButton?.remove();
  }

  async executeIntro() {
    const showOverlay = this.config.showRevealOverlay !== false && this.config.revealFadeMs > 0;
    const showParticles =
      this.config.particlesEnabled !== false &&
      this.config.particleCount > 0 &&
      this.config.particleDurationMs > 0;

    this.overlay.classList.toggle("hidden", !showOverlay);
    this.canvas.classList.toggle("hidden", !showParticles);
    this.overlay.style.opacity = showOverlay ? "1" : "0";

    const direction = Number(this.config.spinDirection) < 0 ? -1 : 1;
    const spinRadians = ((this.config.spinDegrees * Math.PI) / 180) * direction;
    this.options.setRotationOffset(spinRadians);

    if (this.reducedMotion) {
      await animateMs(Math.max(220, this.config.spinDurationMs * 0.55), (t) => {
        const eased = easeInOutCubic(t);
        this.options.setRotationOffset(spinRadians * (1 - eased));
        if (showOverlay) {
          this.overlay.style.opacity = `${1 - eased}`;
        }
      });
      this.finishIntroState();
      return;
    }

    await waitMs(this.config.preSpinHoldMs);

    if (showParticles) {
      this.seedParticles();
    }

    const motionDuration = Math.max(
      this.config.spinDurationMs,
      showParticles ? this.config.particleDurationMs : 0,
    );
    await animateMs(motionDuration, (t) => {
      const eased = easeInOutCubic(t);
      this.options.setRotationOffset(spinRadians * (1 - eased));
      if (showParticles) {
        this.renderParticles(t);
      }
    });

    if (showOverlay) {
      await animateMs(this.config.revealFadeMs, (t) => {
        const eased = easeInOutCubic(t);
        this.overlay.style.opacity = `${1 - eased}`;
        if (showParticles) {
          this.renderParticles(1 + eased * 0.4);
        }
      });
    }

    await waitMs(this.config.settleMs);
    this.finishIntroState();
  }

  finishIntroState() {
    this.options.setRotationOffset(0);
    this.overlay.classList.add("hidden");
    this.canvas.classList.add("hidden");
    this.overlay.style.opacity = "0";
    this.clearCanvas();
  }

  resizeCanvas() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);

    this.canvas.width = Math.floor(width * window.devicePixelRatio);
    this.canvas.height = Math.floor(height * window.devicePixelRatio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    if (this.ctx) {
      this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    }
  }

  seedParticles() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const count = Math.max(0, this.config.particleCount | 0);
    const spread = Math.max(0.05, this.config.particleSpread || 0.4);

    this.particles = [];
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = (Math.random() * 0.35 + 0.25) * Math.min(width, height) * spread;
      const speed = Math.random() * 0.45 + 0.75;
      const jitter = Math.random() * 0.14;

      this.particles.push({
        x: width * 0.5,
        y: height * 0.5,
        vx: Math.cos(angle) * radius,
        vy: Math.sin(angle) * radius,
        size: this.config.particleSizeMin + Math.random() * (this.config.particleSizeMax - this.config.particleSizeMin),
        speed,
        jitter,
        seed: Math.random() * 1000,
      });
    }
  }

  renderParticles(progress) {
    if (!this.ctx) {
      return;
    }

    const p = clamp(progress, 0, 1.4);
    const fade = clamp(1 - Math.max(0, p - 0.8) / 0.6, 0, 1);

    this.clearCanvas();
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";

    for (const particle of this.particles) {
      const local = clamp(p * particle.speed, 0, 1.12);
      const jitterX = Math.sin(local * 7 + particle.seed) * particle.jitter * 14;
      const jitterY = Math.cos(local * 9 + particle.seed) * particle.jitter * 14;
      const x = particle.x + particle.vx * local + jitterX;
      const y = particle.y + particle.vy * local + jitterY;
      const alpha = fade * clamp(1 - local * 0.82, 0, 1);

      this.ctx.fillStyle = `rgba(255, 220, 170, ${alpha})`;
      this.ctx.beginPath();
      this.ctx.arc(x, y, particle.size * (1 + local * 0.35), 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  clearCanvas() {
    if (!this.ctx) {
      return;
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
