import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toBadgeVariant } from "@/lib/superAdmin/presentation";

export const ControlPlanePageHeader = ({
  actions,
  description,
  title,
}: {
  actions?: ReactNode;
  description: string;
  title: string;
}) => (
  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <h2 className="text-2xl font-bold font-display text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
    {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
  </div>
);

export const ControlPlaneCard = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-lg font-display">{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

export const StatusPill = ({ label, value }: { label: string; value: string | number | null | undefined }) => (
  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <Badge variant={toBadgeVariant(String(value))}>{String(value || "unknown")}</Badge>
  </div>
);

export const PaginationControls = ({
  onNext,
  onPrevious,
  page,
  pageCount,
}: {
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  pageCount: number;
}) => (
  <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
    <p className="text-sm text-muted-foreground">
      Page {page} of {pageCount}
    </p>
    <div className="flex gap-2">
      <Button onClick={onPrevious} disabled={page <= 1} variant="outline">
        Previous
      </Button>
      <Button onClick={onNext} disabled={page >= pageCount} variant="outline">
        Next
      </Button>
    </div>
  </div>
);
