// Bundles src/main.js into app.js (one classic script, as both apps load it).
// `node build.mjs --check` only verifies that app.js is up to date with src/.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const BANNER = `/* Karteikarten-Engine: gebaut aus src/ (npm run build). Nicht von Hand ändern.
   Gemeinsam für mehrere Apps. Alles Persönliche (Texte, Kartenfelder, Gemini-Regeln, Erinnerungs-Schlüssel)
   kommt aus window.APP in index.html, die Karten aus window.CARDS. */`;

const result = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  target: ["safari15", "chrome100"],
  charset: "utf8",
  legalComments: "none",
  minify: true,
  sourcemap: "linked",
  outfile: "app.js",
  banner: { js: BANNER },
  write: false,
  logLevel: "warning"
});
const js = result.outputFiles.find(f => f.path.endsWith(".js")), map = result.outputFiles.find(f => f.path.endsWith(".map"));
const out = js.text;

if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync("app.js", "utf8"); } catch (e) {}
  if (cur !== out) { console.error("app.js ist nicht aktuell: npm run build ausführen und app.js mit committen."); process.exit(1); }
  console.log("app.js ist aktuell.");
} else {
  writeFileSync("app.js", out);
  writeFileSync("app.js.map", map.text);
  console.log(`app.js geschrieben (${(out.length / 1024).toFixed(1)} KB).`);
}
