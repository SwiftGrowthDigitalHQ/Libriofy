/**
 * Microsoft Store Icon Generator for Libriofy
 * 
 * Generates all required icon sizes for Microsoft Store certification.
 * Run: node scripts/generate-icons.mjs
 * 
 * Prerequisites: npm install sharp (dev dependency)
 * 
 * Required sizes for Microsoft Store PWA submission:
 * - 44x44 (Taskbar)
 * - 50x50 (Store listing)
 * - 71x71 (Small tile)
 * - 89x89
 * - 107x107
 * - 142x142
 * - 150x150 (Medium tile)
 * - 284x284
 * - 300x300 (Store logo)
 * - 310x150 (Wide tile)
 * - 310x310 (Large tile)
 * - 620x300 (Splash)
 * - 192x192 (PWA standard)
 * - 512x512 (PWA standard)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const ICONS_DIR = resolve(ROOT, "public/icons");

const SQUARE_SIZES = [44, 50, 71, 89, 107, 142, 150, 192, 284, 300, 310, 512];
const WIDE_SIZES = [
  { width: 310, height: 150 },
  { width: 620, height: 300 },
];

// Libriofy brand colors
const BRAND_BG = "#0e161b";
const BRAND_PRIMARY = "#1a7f72";

function generateSVGIcon(size, maskable = false) {
  const padding = maskable ? Math.round(size * 0.1) : Math.round(size * 0.05);
  const innerSize = size - padding * 2;
  const fontSize = Math.round(innerSize * 0.55);
  const radius = maskable ? 0 : Math.round(size * 0.18);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND_BG}"/>
  <text x="${size / 2}" y="${size / 2 + fontSize * 0.35}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="700" fill="white" text-anchor="middle">L</text>
  <rect x="${padding}" y="${size - padding - 4}" width="${innerSize}" height="4" rx="2" fill="${BRAND_PRIMARY}" opacity="0.8"/>
</svg>`;
}

function generateWideSVG(width, height) {
  const fontSize = Math.round(height * 0.35);
  const subtitleSize = Math.round(height * 0.12);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${BRAND_BG}"/>
  <text x="${width / 2}" y="${height / 2 - 5}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="700" fill="white" text-anchor="middle">Libriofy</text>
  <text x="${width / 2}" y="${height / 2 + subtitleSize + 10}" font-family="system-ui, -apple-system, sans-serif" font-size="${subtitleSize}" fill="${BRAND_PRIMARY}" text-anchor="middle">Library Automation</text>
</svg>`;
}

function generateICO() {
  // Generate a minimal 16x16 + 32x32 ICO file header
  // For production, use sharp or ico-encoder
  console.log("  → favicon.ico requires sharp. Using SVG fallback reference.");
  return null;
}

function main() {
  if (!existsSync(ICONS_DIR)) {
    mkdirSync(ICONS_DIR, { recursive: true });
  }

  console.log("🎨 Generating Microsoft Store icons for Libriofy...\n");

  // Generate square icons (any purpose)
  for (const size of SQUARE_SIZES) {
    const svg = generateSVGIcon(size, false);
    const filename = `icon-${size}x${size}.png.svg`;
    writeFileSync(resolve(ICONS_DIR, filename), svg);
    console.log(`  ✓ ${filename}`);
  }

  // Generate maskable icons
  for (const size of [192, 512]) {
    const svg = generateSVGIcon(size, true);
    const filename = `maskable-${size}x${size}.png.svg`;
    writeFileSync(resolve(ICONS_DIR, filename), svg);
    console.log(`  ✓ ${filename} (maskable)`);
  }

  // Generate wide tiles
  for (const { width, height } of WIDE_SIZES) {
    const svg = generateWideSVG(width, height);
    const filename = `wide-${width}x${height}.png.svg`;
    writeFileSync(resolve(ICONS_DIR, filename), svg);
    console.log(`  ✓ ${filename}`);
  }

  // Generate mstile icons
  const mstileSizes = [70, 144, 150, 310];
  for (const size of mstileSizes) {
    const svg = generateSVGIcon(size, false);
    writeFileSync(resolve(ICONS_DIR, `mstile-${size}x${size}.svg`), svg);
    console.log(`  ✓ mstile-${size}x${size}.svg`);
  }

  // Wide mstile
  const wideMstile = generateWideSVG(310, 150);
  writeFileSync(resolve(ICONS_DIR, "mstile-310x150.svg"), wideMstile);
  console.log("  ✓ mstile-310x150.svg");

  console.log("\n✅ Icon generation complete.");
  console.log("\n⚠️  For production PNG icons, install sharp and run:");
  console.log("   npm install -D sharp && node scripts/generate-icons-sharp.mjs");
  console.log("\n   Or use PWABuilder Image Generator: https://www.pwabuilder.com/imageGenerator");
}

main();
