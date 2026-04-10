import { clamp, easeInOutCubic } from "./annotation-utils.js";

export class IntroController {
  constructor(options) {
    this.options = options;
    this.config = options.config;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.runningPromise = null;
    this.particles = [];
    this.lifecycle = "idle";
    this.activeToken = null;
    this.pendingStepCancel = null;
    this.cancelSettleTimer = 0;
    this.currentRotationOffset = 0;

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

  setLifecycle(nextState, meta = {}) {
    this.lifecycle = nextState;
    this.options.onStateChange?.(nextState, meta);
  }

  setRotationOffset(offset) {
    this.currentRotationOffset = Number(offset) || 0;
    this.options.setRotationOffset(this.currentRotationOffset);
  }

  async runIntro() {
    if (!this.config.enabled) {
      return;
    }

    if (this.runningPromise) {
      return this.runningPromise;
    }

    window.clearTimeout(this.cancelSettleTimer);
    this.cancelSettleTimer = 0;

    const token = { cancelled: false };
    this.activeToken = token;
    this.setLifecycle("running");

    this.runningPromise = this.executeIntro(token);
    try {
      await this.runningPromise;
    } finally {
      if (this.activeToken === token) {
        this.activeToken = null;
      }
      this.runningPromise = null;
    }
  }

  cancel(reason = "cancelled") {
    if (!this.runningPromise || !this.activeToken || this.activeToken.cancelled) {
      return false;
    }

    this.activeToken.cancelled = true;
    this.pendingStepCancel?.();
    this.pendingStepCancel = null;
    this.finishFxOnly();
    this.setLifecycle("cancelled", { reason });

    const settleMs = Math.max(0, Number(this.config.cancelSettleMs) || 0);
    window.clearTimeout(this.cancelSettleTimer);
    this.cancelSettleTimer = window.setTimeout(() => {
      this.finishIntroState({
        forceOffset: this.currentRotationOffset,
        reason,
        cancelled: true,
      });
    }, settleMs);
    return true;
  }

  async replay() {
    await this.runIntro();
  }

  dispose() {
    this.cancel("dispose");
    window.clearTimeout(this.cancelSettleTimer);
    this.cancelSettleTimer = 0;
    this.pendingStepCancel?.();
    this.pendingStepCancel = null;
    window.removeEventListener("resize", this.onResize);
    this.overlay.remove();
    this.canvas.remove();
    this.replayButton?.remove();
  }

  async executeIntro(token) {
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
    const finalOffsetRadians = ((Number(this.config.finalOffsetDegrees) || 0) * Math.PI) / 180;
    this.setRotationOffset(finalOffsetRadians + spinRadians);

    if (this.reducedMotion) {
      const animated = await this.animateMs(Math.max(220, this.config.spinDurationMs * 0.55), token, (t) => {
        const eased = easeInOutCubic(t);
        this.setRotationOffset(finalOffsetRadians + spinRadians * (1 - eased));
        if (showOverlay) {
          this.overlay.style.opacity = `${1 - eased}`;
        }
      });
      if (!animated) {
        return;
      }
      this.finishIntroState({ forceOffset: finalOffsetRadians, reason: "completed" });
      return;
    }

    if (!(await this.waitMs(this.config.preSpinHoldMs, token))) {
      return;
    }

    if (showParticles) {
      this.seedParticles();
    }

    const motionDuration = Math.max(
      this.config.spinDurationMs,
      showParticles ? this.config.particleDurationMs : 0,
    );
    const moved = await this.animateMs(motionDuration, token, (t) => {
      const eased = easeInOutCubic(t);
      this.setRotationOffset(finalOffsetRadians + spinRadians * (1 - eased));
      if (showParticles) {
        this.renderParticles(t);
      }
    });
    if (!moved) {
      return;
    }

    if (showOverlay) {
      const faded = await this.animateMs(this.config.revealFadeMs, token, (t) => {
        const eased = easeInOutCubic(t);
        this.overlay.style.opacity = `${1 - eased}`;
        if (showParticles) {
          this.renderParticles(1 + eased * 0.4);
        }
      });
      if (!faded) {
        return;
      }
    }

    if (!(await this.waitMs(this.config.settleMs, token))) {
      return;
    }
    this.finishIntroState({ forceOffset: finalOffsetRadians, reason: "completed" });
  }

  waitMs(ms, token) {
    const duration = Math.max(0, Number(ms) || 0);
    if (duration <= 0) {
      return Promise.resolve(this.isTokenActive(token));
    }

    return new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) {
          return;
        }
        finished = true;
        this.pendingStepCancel = null;
        resolve(value);
      };
      const timer = window.setTimeout(() => finish(this.isTokenActive(token)), duration);
      this.pendingStepCancel = () => {
        window.clearTimeout(timer);
        finish(false);
      };
    });
  }

  animateMs(durationMs, token, onFrame) {
    const duration = Math.max(1, Number(durationMs) || 1);
    const start = performance.now();

    return new Promise((resolve) => {
      let finished = false;
      let rafId = 0;
      const finish = (value) => {
        if (finished) {
          return;
        }
        finished = true;
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        this.pendingStepCancel = null;
        resolve(value);
      };

      const step = (now) => {
        if (!this.isTokenActive(token)) {
          finish(false);
          return;
        }
        const t = clamp((now - start) / duration, 0, 1);
        onFrame(t, now - start);
        if (t >= 1) {
          finish(true);
          return;
        }
        rafId = requestAnimationFrame(step);
      };

      this.pendingStepCancel = () => finish(false);
      rafId = requestAnimationFrame(step);
    });
  }

  isTokenActive(token) {
    return Boolean(token && this.activeToken === token && !token.cancelled);
  }

  finishFxOnly() {
    this.overlay.classList.add("hidden");
    this.canvas.classList.add("hidden");
    this.overlay.style.opacity = "0";
    this.clearCanvas();
  }

  finishIntroState({ forceOffset, reason = "completed", cancelled = false } = {}) {
    this.setRotationOffset(
      Number.isFinite(Number(forceOffset)) ? Number(forceOffset) : this.currentRotationOffset,
    );
    this.finishFxOnly();
    this.setLifecycle("completed", { reason, cancelled });
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
        size:
          this.config.particleSizeMin +
          Math.random() * (this.config.particleSizeMax - this.config.particleSizeMin),
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
