import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves a library from the current hostname (custom domain support).
 * Returns the library if the current domain matches a library's custom_domain.
 * Returns null if on the main app domain.
 */
export const useDomainLibrary = () => {
  const hostname = window.location.hostname;

  // Skip resolution for known app domains
  const isAppDomain =
    hostname === "localhost" ||
    hostname.endsWith(".lovable.app") ||
    hostname.endsWith(".lovable.dev") ||
    hostname === "libriofy.com" ||
    hostname === "www.libriofy.com";

  return useQuery({
    queryKey: ["domain-library", hostname],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_library_public", {
        p_identifier: hostname,
      });
      if (error) throw error;
      if (!data || (data as any[]).length === 0) return null;
      return (data as any[])[0];
    },
    enabled: !isAppDomain,
    staleTime: 5 * 60 * 1000,
  });
};
