/**
 * Skip-to-content link for keyboard and screen reader users.
 * Renders an anchor that is visually hidden until focused,
 * then jumps focus to the main content area.
 */
const SkipToContent = () => (
  <a
    href="#main-content"
    className="fixed left-2 top-2 z-[9999] -translate-y-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
  >
    Skip to content
  </a>
);

export default SkipToContent;
