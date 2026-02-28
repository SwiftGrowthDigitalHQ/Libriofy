import { ReactNode } from "react";
import { useLibrarySubscription, isSubscriptionActive } from "@/hooks/useLibrarySubscription";
import { AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

const SubscriptionGate = ({ children }: { children: ReactNode }) => {
  const { data: sub, isLoading } = useLibrarySubscription();

  if (isLoading) return null;

  if (sub?.status === "blocked") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground mb-2">Account Suspended</h1>
          <p className="text-muted-foreground mb-6">
            Your library account has been suspended. Please contact support to resolve this issue.
          </p>
          <a href="https://wa.me/919999999999" target="_blank" rel="noopener noreferrer">
            <Button variant="outline">Contact Support</Button>
          </a>
        </div>
      </div>
    );
  }

  if (sub && !isSubscriptionActive(sub)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-warning" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground mb-2">Subscription Expired</h1>
          <p className="text-muted-foreground mb-6">
            Your subscription has expired. Please renew to continue using the platform.
          </p>
          <a href="https://wa.me/919999999999" target="_blank" rel="noopener noreferrer">
            <Button>Renew Now</Button>
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default SubscriptionGate;
