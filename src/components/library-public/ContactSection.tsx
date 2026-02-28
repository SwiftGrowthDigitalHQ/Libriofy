import { Phone, MapPin, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ContactSectionProps {
  library: any;
}

const ContactSection = ({ library }: ContactSectionProps) => (
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
          <p className="text-sm text-muted-foreground">{library.address || "Koramangala, 5th Block"}{library.city ? `, ${library.city}` : ", Bangalore"}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Phone className="w-6 h-6 text-primary" />
          </div>
          <h3 className="font-semibold font-display text-foreground text-sm mb-1">Phone</h3>
          <p className="text-sm text-muted-foreground">+91 98765 43210</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <MessageCircle className="w-6 h-6 text-primary" />
          </div>
          <h3 className="font-semibold font-display text-foreground text-sm mb-1">WhatsApp</h3>
          <Button
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => window.open("https://wa.me/919876543210?text=Hi, I'm interested in joining your library", "_blank")}
          >
            Chat on WhatsApp
          </Button>
        </div>
      </div>
    </div>
  </section>
);

export default ContactSection;
