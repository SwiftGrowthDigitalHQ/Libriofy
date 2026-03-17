import { supabase } from "@/integrations/supabase/client";

export type RenewalReminderScanResponse = {
  results?: {
    legacyNotifications?: {
      failed?: number;
      processed?: number;
      sent?: number;
      skipped?: number;
    };
    lockerScan?: Record<string, unknown> | null;
    reminderDelivery?: {
      failed?: number;
      processed?: number;
      sent?: number;
      skipped?: number;
    };
    renewalScan?: Record<string, unknown> | null;
  };
  success?: boolean;
  timestamp?: string;
};

const getRenewalScanErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    const message = error.message.trim();

    if (message.includes("Failed to send a request to the Edge Function")) {
      return "The process-renewals Edge Function is not reachable from the browser. Deploy the real function code and make sure it handles OPTIONS/CORS, then try again.";
    }

    if (message) {
      return message;
    }
  }

  return "Unable to run the renewal reminder scan.";
};

export const runRenewalReminderScan = async (libraryId: string) => {
  const { data, error } = await supabase.functions.invoke<RenewalReminderScanResponse>("process-renewals", {
    body: {
      includeLockerRenewalScan: false,
      includeRenewalScan: true,
      libraryId,
      source: "renewals_page",
    },
  });

  if (error) {
    throw new Error(getRenewalScanErrorMessage(error));
  }

  return data;
};
