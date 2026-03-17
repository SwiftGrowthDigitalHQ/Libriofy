import { Link } from "react-router-dom";

interface LibraryFooterProps {
  library: any;
}

const LibraryFooter = ({ library }: LibraryFooterProps) => (
  <footer className="bg-card border-t border-border pt-12 pb-6">
    <div className="container mx-auto px-4 max-w-5xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
        {/* Left */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            {library.logo_url ? (
              <img src={library.logo_url} alt={library.name} className="w-8 h-8 rounded-lg object-cover" />
            ) : null}
            <span className="font-bold font-display text-foreground">{library.name}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            A premium study space designed for focused learning and academic success.
          </p>
        </div>

        {/* Center */}
        <div>
          <h4 className="font-semibold font-display text-foreground mb-3 text-sm">Quick Links</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><a href="#" className="hover:text-primary transition-colors">Home</a></li>
            <li><a href="#plans" className="hover:text-primary transition-colors">Plans</a></li>
            <li><a href="#contact" className="hover:text-primary transition-colors">Contact</a></li>
          </ul>
        </div>

        {/* Right */}
        <div>
          <h4 className="font-semibold font-display text-foreground mb-3 text-sm">Contact Info</h4>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{library.address || "Koramangala, 5th Block"}{library.city ? `, ${library.city}` : ", Bangalore"}</p>
            <p>{library.phone || "+91 98765 43210"}</p>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-6 text-center">
        <Link to="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          Powered by <span className="font-semibold">Libriofy</span>
        </Link>
        <p className="text-xs text-muted-foreground/50 mt-1">by Sangita Group</p>
      </div>
    </div>
  </footer>
);

export default LibraryFooter;
