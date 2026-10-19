import { act } from "@testing-library/react";

// jsdom has no layout, these fill the gaps the renderer runs into. They're
// assigned instead of stubbed, since unstubGlobals would undo vi.stubGlobal.

// The virtualized lists (Select) render no rows at zero size.
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get: () => 600 },
  offsetWidth: { configurable: true, get: () => 600 },
});

// useSoundSearch scrolls its list, and the router can scroll the window.
Element.prototype.scrollTo = () => {};
globalThis.scrollTo = () => {};

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const observers = new Set<FakeIntersectionObserver>();

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  readonly targets = new Set<Element>();

  constructor(readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    this.targets.add(target);
    observers.add(this);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }

  takeRecords() {
    return [];
  }
}

globalThis.IntersectionObserver = FakeIntersectionObserver;

/**
 * Scrolls every observed element into view, e.g. the sentinel at the end of
 * an infinite list.
 */
export function intersect() {
  act(() => {
    for (const observer of [...observers]) {
      const entries = [...observer.targets].map(
        (target): IntersectionObserverEntry => {
          const rect = target.getBoundingClientRect();
          return {
            target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            time: performance.now(),
          };
        },
      );
      if (entries.length > 0) observer.callback(entries, observer);
    }
  });
}
