import type { ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { getSafeErrorMessage } from "@/lib/errorHandling";

const ERROR_TITLE_PATTERN = /error|failed|unable|problem/i;

const getToastDescription = ({
  description,
  title,
  variant,
}: {
  description: ReactNode;
  title?: ReactNode;
  variant?: string;
}) => {
  if (typeof description !== "string") {
    return description;
  }

  const shouldSanitize =
    variant === "destructive" || (typeof title === "string" && ERROR_TITLE_PATTERN.test(title));

  return shouldSanitize ? getSafeErrorMessage(description) : description;
};

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>
                  {getToastDescription({
                    description,
                    title,
                    variant: props.variant,
                  })}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
