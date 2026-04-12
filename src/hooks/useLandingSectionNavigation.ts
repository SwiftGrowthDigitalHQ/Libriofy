import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export const LANDING_SECTION_PARAM = "section";

export const getLandingSectionFromSearch = (search: string) =>
  new URLSearchParams(search).get(LANDING_SECTION_PARAM);

export const scrollToLandingSection = (sectionId: string, behavior: ScrollBehavior = "smooth") => {
  const element = document.getElementById(sectionId);

  if (!element) {
    return false;
  }

  element.scrollIntoView({ behavior, block: "start" });
  return true;
};

export const useLandingSectionNavigation = (onBeforeNavigate?: () => void) => {
  const location = useLocation();
  const navigate = useNavigate();

  return useCallback(
    (sectionId: string) => {
      onBeforeNavigate?.();

      if (location.pathname === "/") {
        scrollToLandingSection(sectionId);
        navigate(
          {
            pathname: "/",
            search: `?${LANDING_SECTION_PARAM}=${sectionId}`,
          },
          { replace: true },
        );
        return;
      }

      navigate({
        pathname: "/",
        search: `?${LANDING_SECTION_PARAM}=${sectionId}`,
      });
    },
    [location.pathname, navigate, onBeforeNavigate],
  );
};
