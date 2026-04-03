import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { maskLibraryAccessKey } from "@/lib/libraryAccessKey";
import { useToast } from "@/hooks/use-toast";
import { Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCcw } from "lucide-react";

type LibraryAccessKeyCardProps = {
  libraryId: string;
};

type LibraryAccessKeyRecord = {
  access_key: string;
  rotated_at: string;
};

type RegenerateLibraryAccessKeyResponse = {
  access_key?: string;
  rotated_at?: string;
} | null;

const resolveLibraryAccessKeyErrorMessage = (error: Error) => {
  const message = error.message?.trim() ?? "";

  if (/library_access_keys|schema cache|does not exist|regenerate_library_access_key/i.test(message)) {
    return "The secure Library Access Key tables are not available in this database yet. Apply the latest scanner security migration and refresh.";
  }

  if (/not authorized|permission denied/i.test(message)) {
    return "Your account is not allowed to rotate this Library Access Key.";
  }

  return message || "Unable to reach the Library Access Key service right now.";
};

const formatRotatedAt = (value?: string) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const LibraryAccessKeyCard = ({ libraryId }: LibraryAccessKeyCardProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAccessKey, setShowAccessKey] = useState(false);

  const { data: accessKeyRecord, error: accessKeyError, isLoading } = useQuery({
    queryKey: ["library-access-key", libraryId],
    queryFn: async (): Promise<LibraryAccessKeyRecord | null> => {
      const { data, error } = await supabase
        .from("library_access_keys")
        .select("access_key, rotated_at")
        .eq("library_id", libraryId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data;
    },
    enabled: Boolean(libraryId),
  });

  const regenerateMutation = useMutation({
    mutationFn: async (): Promise<RegenerateLibraryAccessKeyResponse> => {
      const { data, error } = await supabase.rpc("regenerate_library_access_key", {
        p_library_id: libraryId,
      });

      if (error) {
        throw error;
      }

      const record = data && typeof data === "object" && !Array.isArray(data) ? data : null;
      return record as RegenerateLibraryAccessKeyResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-access-key", libraryId] });
      setShowAccessKey(true);
      toast({
        title: "Library Access Key regenerated",
        description: "Old scanner keys are now invalid and devices must reconnect with the new key.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to regenerate Library Access Key",
        description: resolveLibraryAccessKeyErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const handleCopy = async () => {
    const accessKey = accessKeyRecord?.access_key?.trim();
    if (!accessKey) {
      toast({
        title: "Library Access Key unavailable",
        description: "The access key is still loading.",
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(accessKey);
      toast({ title: "Library Access Key copied" });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard access is not available in this browser.",
        variant: "destructive",
      });
    }
  };

  const resolvedAccessKey = accessKeyRecord?.access_key?.trim() || "";
  const displayedAccessKey = resolvedAccessKey
    ? showAccessKey
      ? resolvedAccessKey
      : maskLibraryAccessKey(resolvedAccessKey)
    : "Not provisioned";
  const rotatedAt = formatRotatedAt(accessKeyRecord?.rotated_at);
  const helperText = accessKeyError
    ? resolveLibraryAccessKeyErrorMessage(accessKeyError)
    : rotatedAt
      ? `Last regenerated ${rotatedAt}`
      : resolvedAccessKey
        ? "Generated automatically for this library."
        : "No Library Access Key has been issued yet. Regenerate after the latest scanner migration is applied.";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-display">
          <KeyRound className="h-5 w-5" />
          Library Access Key
        </CardTitle>
        <CardDescription>
          This secure Library Access Key binds scanners to your library and is required on device setup and attendance scan requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-2xl">
        <div className="rounded-2xl border border-border/80 bg-secondary/40 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current Library Access Key</p>
              <div className="font-mono text-xl font-semibold tracking-[0.12em] text-foreground">
                {isLoading ? "Loading..." : displayedAccessKey}
              </div>
              <p className="text-xs text-muted-foreground">{helperText}</p>
            </div>
            <Badge variant="secondary" className="w-fit">
              Secure device key
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowAccessKey((current) => !current)}
            disabled={isLoading || !resolvedAccessKey}
          >
            {showAccessKey ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
            {showAccessKey ? "Hide" : "Show"}
          </Button>

          <Button type="button" variant="outline" onClick={handleCopy} disabled={isLoading || !resolvedAccessKey}>
            <Copy className="mr-2 h-4 w-4" />
            Copy
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={regenerateMutation.isPending}>
                {regenerateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Regenerate
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Regenerate Library Access Key?</AlertDialogTitle>
                <AlertDialogDescription>
                  This invalidates the old Library Access Key immediately. Any scanner using the previous key will have to reconnect.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => regenerateMutation.mutate()}>
                  Regenerate now
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <p className="text-xs text-muted-foreground">
          Treat this like an API key. Share it only with trusted kiosk devices and rotate it if you suspect misuse.
        </p>
      </CardContent>
    </Card>
  );
};

export default LibraryAccessKeyCard;
