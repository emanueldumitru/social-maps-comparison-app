// ============================================================================
// TERRA // SCALE — Zero-Dependency Node.js HTTP & REST API Server
// ============================================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { haversineKm, mercatorInflationFactor } from "./public/js/core-math.mjs";
import { getBiosphereProfile, getEncyclopediaProfile } from "./public/js/data-engine.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// Load datasets once into memory for fast API responses
const countriesDb = JSON.parse(
  fs.readFileSync(path.join(PUBLIC_DIR, "data", "countries-db.json"), "utf8")
);
const wikiDeepDb = JSON.parse(
  fs.readFileSync(path.join(PUBLIC_DIR, "data", "wiki-deep.json"), "utf8")
);
const countryByIso3 = Object.fromEntries(countriesDb.map(c => [c.iso3, c]));

export function createAppServer() {
  return http.createServer((req, res) => {
    try {
      const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = decodeURIComponent(parsedUrl.pathname);

      // 1. REST API: Health Check
      if (pathname === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          status: "ok",
          app: "TERRA // SCALE",
          version: "3.0.0",
          engine: "Three.js 3D WebGL + GSAP + 1:1 Lambert Azimuthal Equal-Area",
          totalEntities: countriesDb.length,
          breakdown: {
            countries: countriesDb.filter(c => c.entityType === "country").length,
            continents: countriesDb.filter(c => c.entityType === "continent").length,
            oceans: countriesDb.filter(c => c.entityType === "ocean").length
          }
        }));
        return;
      }

      // 2. REST API: Query Entities
      if (pathname === "/api/entities") {
        const q = (parsedUrl.searchParams.get("q") || "").trim().toLowerCase();
        const region = parsedUrl.searchParams.get("region") || "All";
        const type = parsedUrl.searchParams.get("type") || "All";

        const filtered = countriesDb.filter(c => {
          if (region !== "All" && c.region !== region) return false;
          if (type !== "All" && c.entityType !== type) return false;
          if (!q) return true;
          return (
            c.name.toLowerCase().includes(q) ||
            c.iso3.toLowerCase().includes(q) ||
            (c.capital && c.capital.toLowerCase().includes(q))
          );
        });

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ count: filtered.length, entities: filtered }));
        return;
      }

      // 3. REST API: Head-to-Head Comparison Telemetry
      if (pathname === "/api/compare") {
        const isoA = (parsedUrl.searchParams.get("a") || "ROU").toUpperCase();
        const isoB = (parsedUrl.searchParams.get("b") || "USA").toUpperCase();
        const cA = countryByIso3[isoA];
        const cB = countryByIso3[isoB];

        if (!cA || !cB) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "One or both ISO3 entity codes not found", isoA, isoB }));
          return;
        }

        const distanceKm = haversineKm(cA.capLat, cA.capLng, cB.capLat, cB.capLng);
        const areaRatio = cB.area / Math.max(1e-6, cA.area);
        const popRatio = cB.pop / Math.max(1, cA.pop);

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          entityA: cA,
          entityB: cB,
          metrics: {
            distanceKm: Number(distanceKm.toFixed(2)),
            areaRatioBtoA: Number(areaRatio.toFixed(4)),
            popRatioBtoA: Number(popRatio.toFixed(4)),
            mercatorInflationA: Number(mercatorInflationFactor(cA.lat).toFixed(3)),
            mercatorInflationB: Number(mercatorInflationFactor(cB.lat).toFixed(3))
          },
          biosphereA: getBiosphereProfile(cA),
          biosphereB: getBiosphereProfile(cB),
          encyclopediaA: getEncyclopediaProfile(cA, wikiDeepDb),
          encyclopediaB: getEncyclopediaProfile(cB, wikiDeepDb)
        }));
        return;
      }

      // 4. Legacy standalone HTML route (/maps-agg.html)
      if (pathname === "/maps-agg.html") {
        const standalonePath = path.join(__dirname, "maps-agg.html");
        if (fs.existsSync(standalonePath)) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          fs.createReadStream(standalonePath).pipe(res);
          return;
        }
      }

      // 5. Static File Serving from /public
      const safeRelPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = path.resolve(PUBLIC_DIR, safeRelPath);

      // Prevent directory traversal outside PUBLIC_DIR
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("403 Forbidden");
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-cache"
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not Found", path: pathname }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
    }
  });
}

// Start listening if executed directly (`node server.mjs`)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || "127.0.0.1";
  const server = createAppServer();
  server.listen(PORT, HOST, () => {
    console.log("");
    console.log("  ╔══════════════════════════════════════════════════════════════════╗");
    console.log("  ║  🌍 TERRA // SCALE — 3D WebGL Cartographic & Encyclopedia Studio ║");
    console.log("  ╠══════════════════════════════════════════════════════════════════╣");
    console.log(`  ║  🚀 Web Application : http://localhost:${PORT}                      ║`);
    console.log(`  ║  📦 Standalone HTML : http://localhost:${PORT}/maps-agg.html        ║`);
    console.log(`  ║  🩺 Health Telemetry: http://localhost:${PORT}/api/health           ║`);
    console.log("  ╚══════════════════════════════════════════════════════════════════╝");
    console.log("");
  });
}
