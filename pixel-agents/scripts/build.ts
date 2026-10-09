import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { buildFurnitureCatalog } from "../vendor/core/src/assets/build.ts";
import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllWalls,
  decodeAllCarpets,
  decodeAllFurniture,
} from "../vendor/core/src/assets/loader.ts";
const assets = path.resolve("vendor/webview-ui/public/assets");
const catalog = buildFurnitureCatalog(assets);
fs.writeFileSync(
  "src/assets.json",
  JSON.stringify({
    characters: decodeAllCharacters(assets),
    floors: decodeAllFloors(assets),
    walls: decodeAllWalls(assets),
    carpets: decodeAllCarpets(assets),
    furniture: { catalog, sprites: decodeAllFurniture(assets, catalog) },
  }),
);
await build({
  entryPoints: ["src/extension.tsx"],
  outfile: "extension.js",
  bundle: true,
  jsx: "automatic",
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  loader: { ".css": "text" },
  legalComments: "eof",
  banner: {
    js: "/*! Pixel Agents for Agent Canvas. Includes MIT-licensed Pixel Agents by Pablo De Lucca. See LICENSE.pixel-agents. */",
  },
  metafile: true,
}).then((r) => {
  fs.writeFileSync("build-meta.json", JSON.stringify(r.metafile, null, 2));
  console.log(
    "Built one self-contained extension.js (" +
      fs.statSync("extension.js").size +
      " bytes)",
  );
});
