import { ReactNode } from "react";
import { useDomainLibrary } from "@/hooks/useDomainLibrary";
import LibraryPublicPage from "@/pages/LibraryPublicPage";
import { Loader2 } from "lucide-react";

/**
 * If the current hostname matches a library's custom_domain,
 * render that library's public page instead of normal routes.
 */
const DomainRouter = ({ children }: { children: ReactNode }) => {
  const { data: domainLibrary, isLoading, isError } = useDomainLibrary();

  // If we're on the main app domain, render normal routes
  const hostname = window.location.hostname;
  const isAppDomain =
    hostname === "localhost" ||
    hostname.endsWith(".lovable.app") ||
    hostname.endsWith(".lovable.dev") ||
    hostname === "libriofy.com" ||
    hostname === "www.libriofy.com";

  if (isAppDomain) return <>{children}</>;

  // Custom domain — loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Custom domain matched a library
  if (domainLibrary) {
    return <LibraryPublicPage domainLibrary={domainLibrary} />;
  }

  // Custom domain didn't match — show normal routes as fallback
  return <>{children}</>;
};

export default DomainRouter;
