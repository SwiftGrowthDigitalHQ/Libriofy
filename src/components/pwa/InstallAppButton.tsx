import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button, ButtonProps } from "@/components/ui/button";
import { usePWA } from "@/components/pwa/PWAProvider";

type InstallAppButtonProps = ButtonProps & {
  label?: string;
};

const InstallAppButton = ({
  label = "Install App",
  children,
  disabled,
  ...props
}: InstallAppButtonProps) => {
  const { canInstall, installApp } = usePWA();
  const [installing, setInstalling] = useState(false);

  if (!canInstall) {
    return null;
  }

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await installApp();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Button {...props} disabled={disabled || installing} onClick={handleInstall}>
      {installing ? <Loader2 className="animate-spin" /> : <Download />}
      {children ?? label}
    </Button>
  );
};

export default InstallAppButton;
