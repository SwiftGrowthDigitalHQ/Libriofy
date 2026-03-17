import { useState } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import lib1 from "@/assets/library-1.jpg";
import lib2 from "@/assets/library-2.jpg";
import lib3 from "@/assets/library-3.jpg";
import lib4 from "@/assets/library-4.jpg";
import lib5 from "@/assets/library-5.jpg";

interface GalleryImage {
  src: string;
  alt?: string | null;
}

interface GallerySectionProps {
  images?: GalleryImage[];
  headingColor?: string;
}

const defaultImages = [
  { src: lib1, alt: "Study area" },
  { src: lib5, alt: "Reading lounge" },
  { src: lib3, alt: "Silent zone" },
  { src: lib4, alt: "Students at work" },
  { src: lib2, alt: "Classroom" },
  { src: lib1, alt: "Interior view" },
];

const GallerySection = ({ images, headingColor }: GallerySectionProps) => {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const galleryImages = images && images.length > 0 ? images : defaultImages;

  return (
    <section className="py-16 bg-secondary/30">
      <div className="container mx-auto px-4 max-w-5xl">
        <h2 className="text-2xl sm:text-3xl font-bold font-display text-center mb-2" style={headingColor ? { color: headingColor } : undefined}>
          Gallery
        </h2>
        <p className="text-muted-foreground text-center mb-10">Take a virtual tour of our space</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {galleryImages.map((img, i) => (
            <motion.button
              key={i}
              onClick={() => setLightbox(i)}
              className="relative aspect-[4/3] rounded-xl overflow-hidden group"
              whileHover={{ scale: 1.02 }}
            >
              <img src={img.src} alt={img.alt} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
              <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/20 transition-colors" />
            </motion.button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {lightbox !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setLightbox(null)}
          >
            <button className="absolute top-4 right-4 bg-card rounded-full p-2" onClick={() => setLightbox(null)}>
              <X className="w-6 h-6 text-foreground" />
            </button>
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              src={galleryImages[lightbox].src}
              alt={galleryImages[lightbox].alt || "Library gallery image"}
              className="max-w-full max-h-[80vh] rounded-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export default GallerySection;
