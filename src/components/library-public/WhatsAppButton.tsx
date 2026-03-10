import { MessageCircle } from "lucide-react";

interface WhatsAppButtonProps {
  whatsappNumber?: string | null;
}

const normalizeWhatsAppNumber = (raw?: string | null): string => {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const WhatsAppButton = ({ whatsappNumber }: WhatsAppButtonProps) => {
  const normalized = normalizeWhatsAppNumber(whatsappNumber);
  if (!normalized) return null;

  return (
    <a
      href={`https://wa.me/${normalized}?text=Hi, I'm interested in joining your library`}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-success text-success-foreground flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
      aria-label="Chat on WhatsApp"
    >
      <MessageCircle className="w-7 h-7" />
    </a>
  );
};

export default WhatsAppButton;
