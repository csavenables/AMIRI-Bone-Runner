export class AnnotationAuthoring {
  constructor(enabled) {
    this.enabled = enabled;
  }

  bind() {
    if (!this.enabled) {
      return;
    }
    // Hook for future ?author=1 workflow toggles.
  }

  dispose() {}
}
