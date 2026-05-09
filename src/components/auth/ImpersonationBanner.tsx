import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, SquareArrowOutUpRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { auditImpersonationActivity } from "@/lib/authApi";
import { SUPER_ADMIN_DASHBOARD_ROUTE } from "@/lib/superAdminPaths";
import { Button } from "@/components/ui/button";

const formatCountdown = (remainingMs: number) => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const buildIdentityLabel = (fullName: string | null, email: string | null, fallbackId: string) =>
  fullName || email || fallbackId;

const ImpersonationBanner = () => {
  const auth = useAuth();
  const session = auth?.session ?? null;
  const stopImpersonation = auth?.stopImpersonation ?? (async () => undefined);
  const navigate = useNavigate();
  const location = useLocation();
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);

  const impersonation = session?.impersonation ?? null;
  const expiresAtMs = useMemo(() => Date.parse(impersonation?.expiresAt ?? ""), [impersonation?.expiresAt]);
  const remainingMs = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - now) : 0;

  useEffect(() => {
    if (!impersonation) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [impersonation]);

  useEffect(() => {
    if (!impersonation) {
      return;
    }

    void auditImpersonationActivity({
      action: "route_view",
      metadata: {
        search: location.search || null,
      },
      requestPath: `${location.pathname}${location.search}`,
      requestSource: "browser_route_transition",
    }).catch(() => undefined);
  }, [impersonation, location.pathname, location.search]);

  useEffect(() => {
    if (!impersonation || remainingMs > 0 || stopping) {
      return;
    }

    setStopping(true);
    void stopImpersonation()
      .then(() => {
        navigate(SUPER_ADMIN_DASHBOARD_ROUTE, { replace: true });
      })
      .catch(() => undefined)
      .finally(() => {
        setStopping(false);
      });
  }, [impersonation, navigate, remainingMs, stopImpersonation, stopping]);

  if (!impersonation) {
    return null;
  }

  const realUserLabel = buildIdentityLabel(
    impersonation.realUser.fullName,
    impersonation.realUser.email,
    impersonation.realUser.id,
  );
  const effectiveUserLabel = buildIdentityLabel(
    impersonation.effectiveUser.fullName,
    impersonation.effectiveUser.email,
    impersonation.effectiveUser.id,
  );

  return (
    <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-screen-2xl flex-col gap-3 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-900">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span>Impersonation active</span>
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium">
                {formatCountdown(remainingMs)} left
              </span>
            </div>
            <p className="text-sm text-amber-900/85">
              {realUserLabel} is acting as {effectiveUserLabel}.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100"
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              try {
                await stopImpersonation();
                navigate(SUPER_ADMIN_DASHBOARD_ROUTE, { replace: true });
              } finally {
                setStopping(false);
              }
            }}
            size="sm"
            variant="outline"
          >
            Stop Impersonation
          </Button>
          <div className="flex items-center gap-1 text-xs text-amber-900/70">
            <SquareArrowOutUpRight className="h-3.5 w-3.5" />
            <span>{location.pathname}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImpersonationBanner;
