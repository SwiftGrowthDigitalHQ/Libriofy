import { Component, type ErrorInfo, type ReactNode, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { buildIssueReportHref, extractErrorMessage } from "@/lib/errorHandling";
import { logAppError } from "@/lib/errorMonitoring";

const PremiumCrashScreen = lazy(() => import("@/components/error/PremiumCrashScreen"));

type BoundaryProps = {
  children: ReactNode;
  onGoDashboard: () => void;
  route: string;
  userId?: string | null;
};

type BoundaryState = {
  error: Error | null;
};

const CrashScreenFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-slate-950">
    <Loader2 className="h-8 w-8 animate-spin text-sky-300" />
  </div>
);

const isBenignMediaPlaybackAbortError = (error: unknown) => {
  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes("the play() request was interrupted because the media was removed from the document") ||
    message.includes("the play request was interrupted because the media was removed from the document") ||
    (message.includes("aborterror") && message.includes("media was removed from the document"))
  );
};

const renderCrashScreen = ({
  error,
  onGoDashboard,
  onReportIssue,
  onRetry,
}: {
  error: Error;
  onGoDashboard: () => void;
  onReportIssue: () => void;
  onRetry: () => Promise<void>;
}) => (
  <Suspense fallback={<CrashScreenFallback />}>
    <PremiumCrashScreen
      error={error}
      onGoDashboard={onGoDashboard}
      onReportIssue={onReportIssue}
      onRetry={onRetry}
    />
  </Suspense>
);

class ReactRuntimeBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[GlobalErrorBoundary] React error boundary caught:", error, errorInfo);
    void logAppError({
      error,
      metadata: {
        componentStack: errorInfo.componentStack,
      },
      route: this.props.route,
      source: "react_boundary",
      userId: this.props.userId,
    });
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    if (prevProps.route !== this.props.route && this.state.error) {
      this.setState({ error: null });
    }
  }

  handleRetry = async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    window.location.reload();
  };

  handleGoDashboard = () => {
    this.setState({ error: null }, this.props.onGoDashboard);
  };

  handleReportIssue = () => {
    const href = buildIssueReportHref({
      route: this.props.route,
      timestamp: new Date().toISOString(),
      userId: this.props.userId,
    });
    window.location.href = href;
  };

  render() {
    if (this.state.error) {
      return renderCrashScreen({
        error: this.state.error,
        onGoDashboard: this.handleGoDashboard,
        onReportIssue: this.handleReportIssue,
        onRetry: this.handleRetry,
      });
    }

    return this.props.children;
  }
}

export const GlobalErrorBoundary = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [externalError, setExternalError] = useState<Error | null>(null);
  const route = useMemo(
    () => `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.pathname, location.search],
  );

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const error = event.error instanceof Error
        ? event.error
        : new Error(event.message || "Unexpected runtime error");

      if (isBenignMediaPlaybackAbortError(error)) {
        event.preventDefault();
        console.warn("[GlobalErrorBoundary] Ignored benign media playback abort:", error);
        return;
      }

      console.error("[GlobalErrorBoundary] window error:", error, {
        filename: event.filename || null,
        lineNumber: event.lineno || null,
        columnNumber: event.colno || null,
      });

      setExternalError(error);
      void logAppError({
        error,
        metadata: {
          filename: event.filename || null,
          lineNumber: event.lineno || null,
        },
        route,
        source: "window_error",
        userId: user?.id,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error
        ? event.reason
        : new Error(typeof event.reason === "string" ? event.reason : "Unhandled promise rejection");

      event.preventDefault();
      if (isBenignMediaPlaybackAbortError(error)) {
        console.warn("[GlobalErrorBoundary] Ignored benign media playback abort:", error);
        return;
      }

      console.error("[GlobalErrorBoundary] unhandled rejection:", error, {
        reasonType: typeof event.reason,
      });
      setExternalError(error);
      void logAppError({
        error,
        metadata: {
          reasonType: typeof event.reason,
        },
        route,
        source: "unhandled_rejection",
        userId: user?.id,
      });
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [route, user?.id]);

  const handleRetry = async () => {
    setExternalError(null);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    window.location.reload();
  };

  const handleReportIssue = () => {
    const href = buildIssueReportHref({
      route,
      timestamp: new Date().toISOString(),
      userId: user?.id,
    });
    window.location.href = href;
  };

  const handleGoDashboard = () => {
    setExternalError(null);
    navigate("/dashboard");
  };

  if (externalError) {
    return renderCrashScreen({
      error: externalError,
      onGoDashboard: handleGoDashboard,
      onReportIssue: handleReportIssue,
      onRetry: handleRetry,
    });
  }

  return (
    <ReactRuntimeBoundary onGoDashboard={handleGoDashboard} route={route} userId={user?.id}>
      {children}
    </ReactRuntimeBoundary>
  );
};
