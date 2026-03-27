import { motion } from "framer-motion";
import { PlayCircle, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Button } from "@/components/ui/button";

const demoVideoUrl = String(import.meta.env.VITE_PRODUCT_DEMO_VIDEO_URL ?? "").trim();
const demoEmbedUrl = String(import.meta.env.VITE_PRODUCT_DEMO_EMBED_URL ?? "").trim();

const ProductDemoSection = () => {
  const hasSelfHostedVideo = demoVideoUrl.length > 0;
  const hasEmbedVideo = !hasSelfHostedVideo && demoEmbedUrl.length > 0;

  return (
    <section id="demo" className="relative -mt-20 scroll-mt-24 bg-background pb-24 sm:-mt-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          className="mx-auto max-w-5xl"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6 }}
        >
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-4 py-2 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" />
              <span>Product demo</span>
            </div>
            <h2 className="text-3xl font-bold font-display text-foreground sm:text-4xl">
              See how Libriofy works in under two minutes
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              A quick walkthrough of admissions, seat allocation, payments, renewals, and the live dashboard.
            </p>
          </div>

          <div className="mx-auto max-w-5xl rounded-[2rem] border border-border/80 bg-card/95 p-3 shadow-[0_24px_80px_-32px_rgba(8,38,44,0.45)] backdrop-blur sm:p-5">
            <AspectRatio ratio={16 / 9}>
              {hasSelfHostedVideo ? (
                <video
                  className="h-full w-full rounded-[1.5rem] border border-border/60 bg-slate-950 object-cover"
                  controls
                  playsInline
                  preload="metadata"
                >
                  <source src={demoVideoUrl} type="video/mp4" />
                  Your browser does not support embedded videos.
                </video>
              ) : hasEmbedVideo ? (
                <iframe
                  src={demoEmbedUrl}
                  title="Libriofy product demo"
                  className="h-full w-full rounded-[1.5rem] border border-border/60 bg-slate-950"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[1.5rem] border border-border/60 bg-slate-950 text-white">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.18),_transparent_34%),linear-gradient(135deg,_rgba(7,30,36,0.98)_0%,_rgba(12,56,59,0.95)_52%,_rgba(8,18,26,1)_100%)]" />
                  <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />

                  <div className="relative z-10 flex h-full w-full flex-col justify-between p-6 sm:p-8 lg:p-10">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-white/70">
                        Walkthrough ready
                      </div>
                      <div className="rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-xs font-medium text-primary-foreground">
                        Add your MP4 or embed URL
                      </div>
                    </div>

                    <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr] md:items-end">
                      <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 backdrop-blur">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            "Live seat map",
                            "Admission flow",
                            "Payment automation",
                            "Renewal reminders",
                          ].map((item) => (
                            <div key={item} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/80">
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="text-center md:text-left">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/10 md:mx-0">
                          <PlayCircle className="h-8 w-8 text-accent" />
                        </div>
                        <h3 className="text-2xl font-bold font-display">
                          Drop in your product walkthrough
                        </h3>
                        <p className="mt-3 text-sm leading-relaxed text-white/70 sm:text-base">
                          Set <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">VITE_PRODUCT_DEMO_VIDEO_URL</code> for a self-hosted MP4, or use <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">VITE_PRODUCT_DEMO_EMBED_URL</code> for an embed.
                        </p>
                        <Link to="/library/demo" className="mt-5 inline-flex">
                          <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                            View Live Demo Library
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </AspectRatio>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default ProductDemoSection;
