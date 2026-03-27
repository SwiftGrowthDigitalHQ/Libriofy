import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useToast } from "@/hooks/use-toast";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

interface PWAContextValue {
  canInstall: boolean;
  isStandalone: boolean;
  installApp: () => Promise<boolean>;
}

const PWAContext = createContext<PWAContextValue | null>(null);

const isStandaloneMode = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: window-controls-overlay)").matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

const bindMediaQueryListener = (query: MediaQueryList, listener: () => void) => {
  if ("addEventListener" in query) {
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }

  query.addListener(listener);
  return () => query.removeListener(listener);
};

export const PWAProvider = ({ children }: { children: ReactNode }) => {
  const { toast } = useToast();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(() =>
    typeof window === "undefined" ? false : isStandaloneMode(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const displayModeQuery = window.matchMedia("(display-mode: standalone)");
    const overlayModeQuery = window.matchMedia("(display-mode: window-controls-overlay)");

    const syncStandaloneState = () => {
      setIsStandalone(isStandaloneMode());
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      syncStandaloneState();
      toast({
        title: "Libriofy installed",
        description: "App ab standalone window me launch hoga.",
      });
    };

    syncStandaloneState();

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    const cleanupDisplayModeListener = bindMediaQueryListener(displayModeQuery, syncStandaloneState);
    const cleanupOverlayModeListener = bindMediaQueryListener(overlayModeQuery, syncStandaloneState);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      cleanupDisplayModeListener();
      cleanupOverlayModeListener();
    };
  }, [toast]);

  const installApp = useCallback(async () => {
    if (!deferredPrompt) {
      return false;
    }

    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;

    if (result.outcome !== "accepted") {
      return false;
    }

    setDeferredPrompt(null);
    return true;
  }, [deferredPrompt]);

  const value = useMemo<PWAContextValue>(
    () => ({
      canInstall: !isStandalone && deferredPrompt !== null,
      isStandalone,
      installApp,
    }),
    [deferredPrompt, installApp, isStandalone],
  );

  return <PWAContext.Provider value={value}>{children}</PWAContext.Provider>;
};

export const usePWA = () => {
  const context = useContext(PWAContext);

  if (!context) {
    throw new Error("usePWA must be used within PWAProvider.");
  }

  return context;
};
