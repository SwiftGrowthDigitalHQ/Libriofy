import { Phone, MapPin, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ContactSectionProps {
  library: any;
}

const normalizeWhatsAppNumber = (raw?: string | null): string => {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const ContactSection = ({ library }: ContactSectionProps) => {
  const phone = library.phone || "+91 98765 43210";
  const whatsappNumber = normalizeWhatsAppNumber(library.whatsapp_number || library.phone);
  const address = `${library.address || "Koramangala, 5th Block"}${library.city ? `, ${library.city}` : ", Bangalore"}`;

  return (
    <section className="py-16">
      <div className="container mx-auto px-4 max-w-4xl">
        <h2 className="text-2xl sm:text-3xl font-bold font-display text-foreground text-center mb-10">
          Get In Touch
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <MapPin className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold font-display text-foreground text-sm mb-1">Address</h3>
            <p className="text-sm text-muted-foreground">{address}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Phone className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold font-display text-foreground text-sm mb-1">Phone</h3>
            <p className="text-sm text-muted-foreground">{phone}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <MessageCircle className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold font-display text-foreground text-sm mb-1">WhatsApp</h3>
            {whatsappNumber ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => window.open(`https://wa.me/${whatsappNumber}?text=Hi, I'm interested in joining your library`, "_blank")}
              >
                Chat on WhatsApp
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Not added yet</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
