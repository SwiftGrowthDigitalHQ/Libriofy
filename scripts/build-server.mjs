import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const outdir = path.join(projectRoot, "dist-server");

fs.rmSync(outdir, { force: true, recursive: true });

await build({
  entryPoints: [path.join(projectRoot, "server", "index.ts")],
  bundle: true,
  format: "esm",
  logLevel: "info",
  outfile: path.join(outdir, "index.mjs"),
  platform: "node",
  sourcemap: true,
  target: "node20",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
  },
});
