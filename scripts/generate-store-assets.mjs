/**
 * Generate Microsoft Store required assets (PNG icons + screenshots).
 * Run: node scripts/generate-store-assets.mjs
 */
import sharp from "sharp";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ICONS_DIR = resolve(ROOT, "public/icons");
const SCREENSHOTS_DIR = resolve(ROOT, "public/screenshots");

// Libriofy brand colors
const BG = "#0e161b";
const PRIMARY = "#1a7f72";
const TEXT_COLOR = "#ffffff";
const LIGHT_BG = "#f9fafb";
const MUTED = "#64748b";

function iconSvg(size, maskable = false) {
  const padding = maskable ? Math.round(size * 0.1) : Math.round(size * 0.05);
  const innerSize = size - padding * 2;
  const fontSize = Math.round(innerSize * 0.55);
  const radius = maskable ? 0 : Math.round(size * 0.18);
  const barY = size - padding - Math.max(4, Math.round(size * 0.03));
  const barH = Math.max(3, Math.round(size * 0.03));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
    <text x="${size / 2}" y="${size / 2 + fontSize * 0.35}" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="700" fill="${TEXT_COLOR}" text-anchor="middle">L</text>
    <rect x="${padding}" y="${barY}" width="${innerSize}" height="${barH}" rx="${barH / 2}" fill="${PRIMARY}" opacity="0.85"/>
  </svg>`;
}

function wideSvg(width, height) {
  const titleSize = Math.round(height * 0.3);
  const subtitleSize = Math.round(height * 0.11);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${BG}"/>
    <text x="${width / 2}" y="${height / 2 - 5}" font-family="system-ui,-apple-system,sans-serif" font-size="${titleSize}" font-weight="700" fill="${TEXT_COLOR}" text-anchor="middle">Libriofy</text>
    <text x="${width / 2}" y="${height / 2 + subtitleSize + 10}" font-family="system-ui,-apple-system,sans-serif" font-size="${subtitleSize}" fill="${PRIMARY}" text-anchor="middle">Library Automation</text>
  </svg>`;
}

function screenshotSvg(label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <rect width="1920" height="1080" fill="${LIGHT_BG}"/>
    <rect x="0" y="0" width="260" height="1080" fill="${BG}"/>
    <text x="130" y="50" font-family="system-ui" font-size="24" font-weight="700" fill="${TEXT_COLOR}" text-anchor="middle">Libriofy</text>
    <rect x="300" y="80" width="800" height="60" rx="12" fill="white" stroke="#e2e8f0"/>
    <text x="960" y="540" font-family="system-ui" font-size="48" font-weight="600" fill="${BG}" text-anchor="middle">${label}</text>
    <text x="960" y="590" font-family="system-ui" font-size="20" fill="${MUTED}" text-anchor="middle">Library Automation Platform</text>
  </svg>`;
}

async function main() {
  if (!existsSync(ICONS_DIR)) mkdirSync(ICONS_DIR, { recursive: true });
  if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  console.log("🎨 Generating PNG icons...\n");

  // Square icons
  const squareSizes = [44, 50, 71, 89, 107, 142, 150, 192, 284, 300, 310, 512];
  for (const size of squareSizes) {
    const svg = Buffer.from(iconSvg(size));
    await sharp(svg).resize(size, size).png().toFile(resolve(ICONS_DIR, `icon-${size}x${size}.png`));
    console.log(`  ✓ icon-${size}x${size}.png`);
  }

  // Maskable icons
  for (const size of [192, 512]) {
    const svg = Buffer.from(iconSvg(size, true));
    await sharp(svg).resize(size, size).png().toFile(resolve(ICONS_DIR, `maskable-${size}x${size}.png`));
    console.log(`  ✓ maskable-${size}x${size}.png (maskable)`);
  }

  // Wide tiles
  const wideSizes = [{ w: 310, h: 150 }, { w: 620, h: 300 }];
  for (const { w, h } of wideSizes) {
    const svg = Buffer.from(wideSvg(w, h));
    await sharp(svg).resize(w, h).png().toFile(resolve(ICONS_DIR, `wide-${w}x${h}.png`));
    console.log(`  ✓ wide-${w}x${h}.png`);
  }

  // mstile icons
  for (const size of [70, 144, 150, 310]) {
    const svg = Buffer.from(iconSvg(size));
    await sharp(svg).resize(size, size).png().toFile(resolve(ICONS_DIR, `mstile-${size}x${size}.png`));
    console.log(`  ✓ mstile-${size}x${size}.png`);
  }

  console.log("\n📸 Generating screenshots...\n");

  // Screenshots
  const screenshotLabels = ["Dashboard", "Attendance", "Students", "Payments", "Analytics", "Settings"];
  for (const label of screenshotLabels) {
    const filename = label.toLowerCase();
    const svg = Buffer.from(screenshotSvg(label));
    await sharp(svg).resize(1920, 1080).png().toFile(resolve(SCREENSHOTS_DIR, `${filename}.png`));
    console.log(`  ✓ ${filename}.png (1920x1080)`);
  }

  // Generate favicon.ico (32x32 PNG wrapped as ICO)
  const faviconSvg = Buffer.from(iconSvg(32));
  const faviconPng = await sharp(faviconSvg).resize(32, 32).png().toBuffer();

  // ICO format: header + directory entry + PNG data
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type: ICO
  icoHeader.writeUInt16LE(1, 4); // Number of images

  const icoDir = Buffer.alloc(16);
  icoDir.writeUInt8(32, 0); // Width
  icoDir.writeUInt8(32, 1); // Height
  icoDir.writeUInt8(0, 2); // Color palette
  icoDir.writeUInt8(0, 3); // Reserved
  icoDir.writeUInt16LE(1, 4); // Color planes
  icoDir.writeUInt16LE(32, 6); // Bits per pixel
  icoDir.writeUInt32LE(faviconPng.length, 8); // Size of PNG data
  icoDir.writeUInt32LE(22, 12); // Offset to PNG data (6 + 16 = 22)

  const ico = Buffer.concat([icoHeader, icoDir, faviconPng]);
  const { writeFileSync } = await import("fs");
  writeFileSync(resolve(ROOT, "public/favicon.ico"), ico);
  console.log("\n  ✓ favicon.ico (32x32)");

  console.log("\n✅ All store assets generated successfully!");
}

main().catch((err) => {
  console.error("❌ Asset generation failed:", err);
  process.exit(1);
});
