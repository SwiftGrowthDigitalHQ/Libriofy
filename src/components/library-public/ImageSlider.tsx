import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import lib1 from "@/assets/library-1.jpg";
import lib2 from "@/assets/library-2.jpg";
import lib3 from "@/assets/library-3.jpg";
import lib4 from "@/assets/library-4.jpg";
import lib5 from "@/assets/library-5.jpg";

const defaultImages = [
  { src: lib1, alt: "Premium study desks with warm lighting" },
  { src: lib2, alt: "Air conditioned study room" },
  { src: lib3, alt: "Silent study zone with cubicles" },
  { src: lib4, alt: "Students studying in a productive environment" },
  { src: lib5, alt: "Cozy reading area with bookshelves" },
];

const ImageSlider = () => {
  const [current, setCurrent] = useState(0);
  const images = defaultImages;

  const next = useCallback(() => setCurrent((c) => (c + 1) % images.length), [images.length]);
  const prev = () => setCurrent((c) => (c - 1 + images.length) % images.length);

  useEffect(() => {
    const timer = setInterval(next, 3000);
    return () => clearInterval(timer);
  }, [next]);

  return (
    <section className="py-16 bg-secondary/30">
      <div className="container mx-auto px-4 max-w-5xl">
        <h2 className="text-2xl sm:text-3xl font-bold font-display text-foreground text-center mb-8">
          Our Study Space
        </h2>
        <div className="relative rounded-2xl overflow-hidden aspect-video shadow-lg">
          <AnimatePresence mode="wait">
            <motion.img
              key={current}
              src={images[current].src}
              alt={images[current].alt}
              className="w-full h-full object-cover absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            />
          </AnimatePresence>
          <button
            onClick={prev}
            className="absolute left-3 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur-sm rounded-full p-2 hover:bg-background transition-colors"
            aria-label="Previous"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <button
            onClick={next}
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur-sm rounded-full p-2 hover:bg-background transition-colors"
            aria-label="Next"
          >
            <ChevronRight className="w-5 h-5 text-foreground" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${i === current ? "bg-primary" : "bg-background/60"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ImageSlider;
