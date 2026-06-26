import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { announceToScreenReader, focusMainContent } from "@/lib/accessibility";

/**
 * Announces route changes to screen readers and manages focus.
 * Should be placed once in the app root.
 */
export function useRouteAnnouncer() {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip the first render (initial page load)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Announce the new page
    const pageTitle = document.title || "Page";
    announceToScreenReader(`Navigated to ${pageTitle}`);

    // Move focus to main content for keyboard users
    requestAnimationFrame(() => {
      focusMainContent();
    });
  }, [location.pathname]);
}
