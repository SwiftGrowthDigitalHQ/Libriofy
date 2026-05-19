import { PauseCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/superAdmin/presentation";

type SuperAdminSnapshotNoticeProps = {
  description: string;
  generatedAt?: string | null;
  refreshIntervalMs?: number | false;
  title: string;
};

export const SuperAdminSnapshotNotice = ({
  description,
  generatedAt,
  refreshIntervalMs = false,
  title,
}: SuperAdminSnapshotNoticeProps) => {
  const cadence = refreshIntervalMs
    ? `Platform health snapshots refresh every ${Math.round(refreshIntervalMs / 60_000)} minutes.`
    : "Use Refresh snapshot when you need a fresh control-plane view.";

  return (
    <Alert>
      <PauseCircle className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>{title}</span>
        <Badge variant="outline">Lightweight mode</Badge>
      </AlertTitle>
      <AlertDescription className="space-y-1">
        <p>{description}</p>
        <p>{cadence}</p>
        {generatedAt ? <p>Last snapshot: {formatDateTime(generatedAt)}.</p> : null}
      </AlertDescription>
    </Alert>
  );
};
