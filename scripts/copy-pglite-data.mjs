import { copyFileSync, existsSync } from "node:fs";

const destDir = ".vercel/output/functions/__server.func/_libs";
const dest = `${destDir}/pglite.data`;
const src = "node_modules/@electric-sql/pglite/dist/pglite.data";
if (!existsSync(destDir)) {
  console.log("[pglite] server bundle not present, skip");
  process.exit(0);
}
copyFileSync(src, dest);
console.log("[pglite] copied data file into the server bundle");
