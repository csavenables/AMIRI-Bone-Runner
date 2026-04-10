export class AnnotationOverlay {
  constructor(host, callbacks) {
    this.callbacks = callbacks;
    this.pinElements = new Map();
    const chevronLeft =
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`;
    const chevronRight =
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;

    this.root = document.createElement("div");
    this.root.className = "annotation-overlay hidden";

    this.pinLayer = document.createElement("div");
    this.pinLayer.className = "annotation-pins";
    this.root.appendChild(this.pinLayer);

    this.tooltip = document.createElement("aside");
    this.tooltip.className = "annotation-tooltip hidden";

    this.tooltipTitle = document.createElement("h3");
    this.tooltipTitle.className = "annotation-tooltip-title";
    this.tooltipBody = document.createElement("p");
    this.tooltipBody.className = "annotation-tooltip-body";
    this.tooltip.append(this.tooltipTitle, this.tooltipBody);
    this.root.appendChild(this.tooltip);

    this.nav = document.createElement("nav");
    this.nav.className = "annotation-nav hidden";

    this.prevButton = document.createElement("button");
    this.prevButton.type = "button";
    this.prevButton.className = "annotation-nav-btn annotation-nav-btn-icon";
    this.prevButton.innerHTML = chevronLeft;
    this.prevButton.setAttribute("aria-label", "Previous annotation");
    this.prevButton.onclick = () => this.callbacks.onPrev();

    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "annotation-nav-btn annotation-nav-btn-close";
    this.closeButton.textContent = "Close";
    this.closeButton.onclick = () => this.callbacks.onClose();

    this.nextButton = document.createElement("button");
    this.nextButton.type = "button";
    this.nextButton.className = "annotation-nav-btn annotation-nav-btn-icon";
    this.nextButton.innerHTML = chevronRight;
    this.nextButton.setAttribute("aria-label", "Next annotation");
    this.nextButton.onclick = () => this.callbacks.onNext();

    this.nav.append(this.prevButton, this.closeButton, this.nextButton);
    this.root.appendChild(this.nav);

    host.appendChild(this.root);

    this.root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const pinButton = target.closest("button.annotation-pin");
      if (!(pinButton instanceof HTMLButtonElement)) {
        return;
      }
      const pinId = pinButton.dataset.pinId;
      if (!pinId || pinButton.dataset.clickable !== "true") {
        return;
      }
      this.callbacks.onSelect(pinId);
    });
  }

  setVisible(visible) {
    this.root.classList.toggle("hidden", !visible);
  }

  render(model) {
    const introGreyActive = Boolean(model.introGreyActive);
    this.root.classList.toggle("is-intro-grey", introGreyActive);
    if (model.introPinColor) {
      this.root.style.setProperty("--annotation-intro-pin-bg", model.introPinColor);
    } else {
      this.root.style.removeProperty("--annotation-intro-pin-bg");
    }

    for (const projected of model.pins) {
      let element = this.pinElements.get(projected.pin.id);
      if (!element) {
        element = document.createElement("button");
        element.type = "button";
        element.className = "annotation-pin";
        element.dataset.pinId = projected.pin.id;
        this.pinLayer.appendChild(element);
        this.pinElements.set(projected.pin.id, element);
      }

      element.textContent = String(projected.pin.order);
      element.style.left = `${projected.screenX}px`;
      element.style.top = `${projected.screenY}px`;
      element.style.opacity = `${projected.alpha}`;
      element.dataset.clickable = projected.clickable ? "true" : "false";
      element.classList.toggle("is-selected", model.selectedId === projected.pin.id);
      element.classList.toggle("is-occluded", projected.occluded);
      element.classList.toggle("hidden", !projected.visible);
      element.disabled = !projected.clickable;
      element.setAttribute("aria-label", `${projected.pin.order}. ${projected.pin.title}`);
    }

    for (const [pinId, element] of this.pinElements.entries()) {
      if (!model.pins.some((entry) => entry.pin.id === pinId)) {
        element.remove();
        this.pinElements.delete(pinId);
      }
    }

    const selectedPin = model.pins.find((entry) => entry.pin.id === model.selectedId);
    const showTooltip = Boolean(selectedPin && model.showTooltip && selectedPin.visible);
    this.tooltip.classList.toggle("hidden", !showTooltip);
    if (showTooltip) {
      const width = this.root.clientWidth;
      const height = this.root.clientHeight;
      this.tooltipTitle.textContent = selectedPin.pin.title;
      this.tooltipBody.textContent = selectedPin.pin.body;
      this.tooltip.style.left = `${Math.max(12, Math.min(width - 260, selectedPin.screenX + 18))}px`;
      this.tooltip.style.top = `${Math.max(12, Math.min(height - 120, selectedPin.screenY + 16))}px`;
    }

    const showNav = Boolean(model.showNav);
    this.nav.classList.toggle("hidden", !showNav);
    this.prevButton.disabled = !model.canPrev;
    this.closeButton.disabled = !model.selectedId;
    this.nextButton.disabled = !model.canNext;
  }

  dispose() {
    this.root.remove();
    this.pinElements.clear();
  }
}
