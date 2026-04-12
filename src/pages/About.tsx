import { BarChart3, QrCode, ShieldCheck, Users } from "lucide-react";

import PublicPageLayout from "@/components/landing/PublicPageLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMPANY_DESCRIPTION,
  COMPANY_DISPLAY_NAME,
  COMPANY_NAME,
  TRUST_SIGNAL,
} from "@/lib/companyInfo";

const coreCapabilities = [
  {
    title: "QR attendance",
    description: "Track student entry and exit quickly with QR-based attendance and live logs.",
    icon: QrCode,
  },
  {
    title: "Seat management",
    description: "Assign seats, monitor availability, and reduce manual errors across shifts.",
    icon: Users,
  },
  {
    title: "Reports and visibility",
    description: "Review attendance trends, payments, renewals, and operational performance in one place.",
    icon: BarChart3,
  },
];

const trustHighlights = [
  "Fast setup for libraries, reading rooms, and study centers.",
  "Built to simplify daily operations for owners and staff.",
  "Designed around secure workflows and clear reporting.",
];

const About = () => (
  <PublicPageLayout
    eyebrow="About Libriofy"
    title={COMPANY_DISPLAY_NAME}
    description={`${COMPANY_NAME} is a library automation system for QR attendance, seat management, and reports. It helps libraries run smoother every day with less manual follow-up.`}
    heroAside={
      <Card className="border-white/10 bg-white/10 text-primary-foreground shadow-glow backdrop-blur">
        <CardContent className="p-6">
          <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-primary-foreground">
            {TRUST_SIGNAL}
          </div>

          <div className="mt-6 space-y-4">
            {trustHighlights.map((highlight) => (
              <div key={highlight} className="flex items-start gap-3">
                <div className="mt-1 rounded-full bg-emerald-400/15 p-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                </div>
                <p className="text-sm leading-relaxed text-primary-foreground/80">{highlight}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    }
  >
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Card className="border-border/70 shadow-[0_24px_60px_-36px_rgba(8,38,44,0.35)]">
        <CardHeader className="space-y-3">
          <CardTitle className="text-3xl font-display">Built for modern library operations</CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {COMPANY_DESCRIPTION}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
          <p>
            Libriofy helps library teams move from manual registers and scattered spreadsheets to a single operating
            system. From attendance tracking to seat availability and reporting, teams can work faster and with more
            confidence.
          </p>
          <p>
            The platform is built by Sangita Group to support libraries that want reliable day-to-day automation without
            adding complexity for staff or members.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        {coreCapabilities.map(({ title, description, icon: Icon }) => (
          <Card key={title} className="border-border/70">
            <CardHeader>
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <CardTitle className="text-xl font-display">{title}</CardTitle>
              <CardDescription className="leading-relaxed">{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  </PublicPageLayout>
);

export default About;
