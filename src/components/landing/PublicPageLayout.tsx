import type { ReactNode } from "react";

import LandingFooter from "@/components/landing/LandingFooter";
import LandingNav from "@/components/landing/LandingNav";
import { cn } from "@/lib/utils";

type PublicPageLayoutProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  heroAside?: ReactNode;
  contentClassName?: string;
};

const PublicPageLayout = ({
  eyebrow,
  title,
  description,
  children,
  heroAside,
  contentClassName,
}: PublicPageLayoutProps) => (
  <div className="min-h-screen bg-background">
    <LandingNav />

    <main className="pt-16">
      <section className="relative overflow-hidden bg-hero-gradient">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.18),transparent_30%),radial-gradient(circle_at_left,rgba(45,212,191,0.16),transparent_34%)]" />

        <div className="container mx-auto px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div
            className={cn(
              "relative grid gap-8 lg:items-end",
              heroAside ? "lg:grid-cols-[1.1fr_0.9fr]" : "max-w-4xl",
            )}
          >
            <div className="space-y-5 text-primary-foreground">
              <div className="inline-flex w-fit items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-primary-foreground/85 backdrop-blur">
                {eyebrow}
              </div>
              <h1 className="max-w-3xl text-4xl font-bold font-display leading-tight sm:text-5xl">
                {title}
              </h1>
              <p className="max-w-2xl text-base leading-relaxed text-primary-foreground/75 sm:text-lg">
                {description}
              </p>
            </div>

            {heroAside ? <div className="relative">{heroAside}</div> : null}
          </div>
        </div>
      </section>

      <section className="relative">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/5 to-transparent" />
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className={cn("relative", contentClassName)}>{children}</div>
        </div>
      </section>
    </main>

    <LandingFooter />
  </div>
);

export default PublicPageLayout;
