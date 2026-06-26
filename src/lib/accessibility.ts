/**
 * Accessibility utilities for Libriofy.
 * Provides focus management, screen reader announcements,
 * and keyboard navigation helpers.
 */

/**
 * Announce a message to screen readers via a live region.
 * Creates or reuses an aria-live region in the DOM.
 */
export function announceToScreenReader(
  message: string,
  priority: "polite" | "assertive" = "polite",
): void {
  const id = `libriofy-a11y-announcer-${priority}`;
  let announcer = document.getElementById(id);

  if (!announcer) {
    announcer = document.createElement("div");
    announcer.id = id;
    announcer.setAttribute("aria-live", priority);
    announcer.setAttribute("aria-atomic", "true");
    announcer.setAttribute("role", priority === "assertive" ? "alert" : "status");
    announcer.className = "sr-only";
    Object.assign(announcer.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      borderWidth: "0",
    });
    document.body.appendChild(announcer);
  }

  // Clear and re-set to trigger announcement
  announcer.textContent = "";
  requestAnimationFrame(() => {
    announcer!.textContent = message;
  });
}

/**
 * Move focus to the main content area.
 * Used after route changes for proper focus management.
 */
export function focusMainContent(): void {
  const main = document.getElementById("main-content") ?? document.querySelector("main");
  if (main) {
    main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
    // Remove tabindex after blur to avoid tabbing back to it
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
  }
}

/**
 * Trap focus within a container (for modals, dialogs).
 * Returns a cleanup function.
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableSelectors = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;

    const focusableElements = container.querySelectorAll<HTMLElement>(focusableSelectors);
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  };

  container.addEventListener("keydown", handleKeyDown);
  return () => container.removeEventListener("keydown", handleKeyDown);
}

/**
 * Check if user prefers reduced motion.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Check if high contrast mode is active.
 */
export function isHighContrastMode(): boolean {
  return window.matchMedia("(forced-colors: active)").matches;
}
