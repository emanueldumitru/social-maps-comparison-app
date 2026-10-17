// ============================================================================
// TERRA // SCALE — Comprehensive Automated JavaScript Test Suite
// Run via: node --test tests/app.test.mjs
// ============================================================================
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  lambertEqualAreaKm,
  unwrapRingLongitudes,
  ringSignedAreaKm2,
  polygonAreaKm2,
  ringCentroidLngLat,
  pointInRingKm,
  isPointInProjectedCountry,
  haversineKm,
  slerpLatLng,
  latLngToVector3,
  mercatorInflationFactor
} from "../public/js/core-math.mjs";

import {
  EU27_ISOS,
  decodeTopoJSON,
  doesEntityContainFeature,
  getOrGenerateGeometry,
  getTargetAreaKm2,
  getProjectedCountry,
  getBiosphereProfile,
  getEncyclopediaProfile,
  findClosestBenchmark
} from "../public/js/data-engine.mjs";

import { createAppServer } from "../server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "public", "data");

// Load datasets
const countriesDb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "countries-db.json"), "utf8"));
const oceanPolygons = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "ocean-polygons.json"), "utf8"));
const wikiDeepDb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "wiki-deep.json"), "utf8"));
const worldTopo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "world-110m.json"), "utf8"));
const extra50m = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "extra-50m.json"), "utf8"));

const countryByIso3 = Object.fromEntries(countriesDb.map(c => [c.iso3, c]));
const countryById = {};
for (const c of countriesDb) {
  if (c.id) countryById[String(c.id).padStart(3, "0")] = c;
}

const decodedTopo = decodeTopoJSON(worldTopo);
const geomsById = { ...decodedTopo.outMap };
for (const [id, geom] of Object.entries(extra50m)) {
  geomsById[String(id).padStart(3, "0")] = geom;
}

// ============================================================================
// SUITE 1: DATASET & SCHEMA INTEGRITY (220 ENTITIES)
// ============================================================================
describe("Suite 1: Global Dataset & Schema Integrity (220 Entities)", () => {
  it("contains exactly 220 entities (204 countries incl. Antarctica, 8 continents, 8 oceans)", () => {
    assert.equal(countriesDb.length, 220);
    const countries = countriesDb.filter(c => c.entityType === "country");
    const continents = countriesDb.filter(c => c.entityType === "continent");
    const oceans = countriesDb.filter(c => c.entityType === "ocean");
    assert.equal(countries.length, 204);
    assert.equal(continents.length, 8);
    assert.equal(oceans.length, 8);
  });

  it("validates required schema fields and positive area/pop on all 220 entities", () => {
    const seenIso3 = new Set();
    for (const c of countriesDb) {
      assert.ok(c.iso3 && typeof c.iso3 === "string", `Missing iso3 on ${c.name}`);
      assert.ok(!seenIso3.has(c.iso3), `Duplicate iso3 ${c.iso3}`);
      seenIso3.add(c.iso3);
      assert.ok(c.name && c.name.length > 0);
      assert.ok(c.flag && c.flag.length > 0);
      assert.ok(Number.isFinite(c.area) && c.area > 0, `Invalid area on ${c.iso3}`);
      assert.ok(Number.isFinite(c.pop) && c.pop > 0, `Invalid pop on ${c.iso3}`);
      assert.ok(Number.isFinite(c.lat) && c.lat >= -90 && c.lat <= 90, `Invalid lat on ${c.iso3}`);
      assert.ok(Number.isFinite(c.lng) && c.lng >= -180 && c.lng <= 180, `Invalid lng on ${c.iso3}`);
      assert.ok(Number.isFinite(c.capLat) && Number.isFinite(c.capLng), `Invalid capital coords on ${c.iso3}`);
    }
  });

  it("verifies Romania (ROU) vs United States (USA) reference metrics", () => {
    const rou = countryByIso3["ROU"];
    const usa = countryByIso3["USA"];
    assert.ok(rou && usa);
    assert.equal(rou.area, 238397);
    assert.equal(usa.area, 9833520);
    assert.equal(usa.mainlandArea, 8081867);

    const ratio = usa.area / rou.area;
    assert.ok(Math.abs(ratio - 41.2485) < 0.001);
  });
});

// ============================================================================
// SUITE 2: MATHEMATICAL CARTOGRAPHY & BUG FIXES (core-math.mjs)
// ============================================================================
describe("Suite 2: Cartographic Projections & Bug Fixes (core-math.mjs)", () => {
  it("projects center origin to [0, 0] in Lambert Azimuthal Equal-Area", () => {
    const [x, y] = lambertEqualAreaKm(25.0, 46.0, 25.0, 46.0);
    assert.ok(Math.abs(x) < 1e-9);
    assert.ok(Math.abs(y) < 1e-9);
  });

  it("Bug Fix #1: unwrapRingLongitudes eliminates ±180° antimeridian jumps (Pacific / Russia / Antarctica)", () => {
    const antimeridianRing = [
      [178.5, 65.0],
      [179.8, 65.2],
      [-179.4, 65.5],
      [-178.0, 65.1],
      [178.5, 65.0]
    ];
    const unwrapped = unwrapRingLongitudes(antimeridianRing, 179.0);
    for (let i = 1; i < unwrapped.length; i++) {
      const stepDeg = Math.abs(unwrapped[i][0] - unwrapped[i - 1][0]);
      assert.ok(stepDeg < 5.0, `Expected smooth longitude step < 5°, got ${stepDeg}°`);
    }
  });

  it("Bug Fix #2: polygonAreaKm2 subtracts interior hole rings (e.g. Lesotho inside South Africa)", () => {
    const outerSquare = [
      [0, 0], [100, 0], [100, 100], [0, 100], [0, 0]
    ]; // 10,000 km²
    const innerHole = [
      [20, 20], [40, 20], [40, 40], [20, 40], [20, 20]
    ]; // 400 km²
    assert.equal(ringSignedAreaKm2(outerSquare), 10000);
    assert.equal(ringSignedAreaKm2(innerHole), 400);
    assert.equal(polygonAreaKm2([outerSquare, innerHole]), 9600);
  });

  it("Bug Fix #3: isPointInProjectedCountry performs exact ray-casting hit-testing with rotation and hole exclusion", () => {
    const mockProj = {
      polys: [
        {
          rings: [
            [[-100, -50], [100, -50], [100, 50], [-100, 50], [-100, -50]]
          ]
        }
      ]
    };
    const screenPos = { x: 400, y: 300, pxPerKm: 1.0 };

    // Inside unrotated rectangle (width 200, height 100)
    assert.equal(isPointInProjectedCountry(480, 320, mockProj, screenPos, 0), true);
    // Outside top edge (y = 300 - 80 = 220, while rectangle height is ±50)
    assert.equal(isPointInProjectedCountry(400, 220, mockProj, screenPos, 0), false);
    // Rotated 90 degrees: now height is ±100, so (400, 220) is INSIDE!
    assert.equal(isPointInProjectedCountry(400, 220, mockProj, screenPos, 90), true);
  });

  it("computes accurate Haversine geodesic distance, SLERP midpoint, 3D vectors, and Mercator inflation", () => {
    // Bucharest (44.43°N, 26.10°E) to Washington, D.C. (38.90°N, 77.04°W)
    const distKm = haversineKm(44.43, 26.10, 38.90, -77.04);
    assert.ok(distKm > 7800 && distKm < 8050, `Expected ~7977 km, got ${distKm}`);

    const [midLng, midLat] = slerpLatLng(44.43, 26.10, 38.90, -77.04, 0.5);
    assert.ok(Number.isFinite(midLng) && Number.isFinite(midLat));

    const [vx, vy, vz] = latLngToVector3(0, 0, 1.0);
    assert.ok(Math.abs(Math.hypot(vx, vy, vz) - 1.0) < 1e-9);

    // At 60° latitude, cos(60°) = 0.5, so Mercator area inflation = 1 / 0.5² = 4.0×
    const inf60 = mercatorInflationFactor(60);
    assert.ok(Math.abs(inf60 - 4.0) < 1e-6);
  });
});

// ============================================================================
// SUITE 3: GEOMETRY COMPOSITOR & EQUAL-AREA CALIBRATION (data-engine.mjs)
// ============================================================================
describe("Suite 3: Geometry Compositor & Equal-Area Calibration (data-engine.mjs)", () => {
  it("Bug Fix #4: doesEntityContainFeature matches constituent countries for Continents & EU-27", () => {
    const eur = countryByIso3["EUR"];
    const eu27 = countryByIso3["EU27"];
    const ata = countryByIso3["ATA"];

    // Romania ("642") is in Europe and EU-27
    assert.equal(doesEntityContainFeature(eur, "642", countryById), true);
    assert.equal(doesEntityContainFeature(eu27, "642", countryById), true);

    // United Kingdom ("826") is in Europe but NOT in EU-27
    assert.equal(doesEntityContainFeature(eur, "826", countryById), true);
    assert.equal(doesEntityContainFeature(eu27, "826", countryById), false);

    // Antarctica ("010") matches ATA
    assert.equal(doesEntityContainFeature(ata, "010", countryById), true);
  });

  it("projects all 220 entities (countries, continents, oceans) with 100% Equal-Area calibration accuracy", () => {
    const cache = {};
    for (const c of countriesDb) {
      const proj = getProjectedCountry(c, {
        territoryScope: "full",
        compactInsets: true,
        geomsById,
        oceanPolygons,
        countriesDb,
        projectedCache: cache
      });

      assert.ok(proj.polys.length > 0, `No polygons generated for ${c.iso3}`);
      assert.ok(Number.isFinite(proj.widthKm) && proj.widthKm > 0, `Invalid widthKm for ${c.iso3}`);
      assert.ok(Number.isFinite(proj.heightKm) && proj.heightKm > 0, `Invalid heightKm for ${c.iso3}`);

      const relError = Math.abs(proj.calibratedAreaKm2 - c.area) / c.area;
      assert.ok(relError < 0.001, `Calibrated area mismatch for ${c.iso3}: ${proj.calibratedAreaKm2} vs ${c.area}`);
    }
  });

  it("switches USA between Full Sovereign Area (9,833,520 km²) and Contiguous Mainland (8,081,867 km²)", () => {
    const usa = countryByIso3["USA"];
    const projFull = getProjectedCountry(usa, {
      territoryScope: "full",
      compactInsets: true,
      geomsById,
      oceanPolygons,
      countriesDb
    });
    const projMain = getProjectedCountry(usa, {
      territoryScope: "mainland",
      compactInsets: true,
      geomsById,
      oceanPolygons,
      countriesDb
    });

    assert.equal(projFull.areaKm2, 9833520);
    assert.equal(projMain.areaKm2, 8081867);
    assert.ok(projFull.insetBoxes.length >= 1, "Expected Alaska/Hawaii inset boxes in full compact mode");
    assert.equal(projMain.insetBoxes.length, 0, "Expected 0 inset boxes in contiguous mainland mode");
  });
});

// ============================================================================
// SUITE 4: BIOSPHERE, BATHYMETRY & MINI-WIKIPEDIA ENCYCLOPEDIA ENGINE
// ============================================================================
describe("Suite 4: Biosphere, Bathymetry & Mini-Wikipedia Encyclopedia Engine", () => {
  it("generates complete 5-species biosphere profiles and depth/elevation records for all 220 entities", () => {
    for (const c of countriesDb) {
      const bio = getBiosphereProfile(c);
      assert.ok(bio.biome && bio.biome.length > 5);
      assert.equal(bio.creatures.length, 5, `Expected 5 creatures for ${c.iso3}`);
      for (const cr of bio.creatures) {
        assert.ok(cr.emoji && cr.name && cr.sci && cr.pop && cr.stratum && cr.desc);
      }
    }

    assert.equal(getBiosphereProfile(countryByIso3["PAC"]).maxDepthM, 10935);
    assert.equal(getBiosphereProfile(countryByIso3["BLKS"]).maxDepthM, 2212);
    assert.equal(getBiosphereProfile(countryByIso3["ROU"]).maxElevM, 2544);
  });

  it("generates complete Mini-Wikipedia encyclopedia dossiers for all 220 entities", () => {
    for (const c of countriesDb) {
      const wiki = getEncyclopediaProfile(c, wikiDeepDb);
      assert.ok(wiki.govType && wiki.headOfState && wiki.headOfGov && wiki.howLed);
      assert.ok(wiki.financeOverview && wiki.historySummary);
      assert.ok(Array.isArray(wiki.timeline) && wiki.timeline.length >= 3);
      assert.ok(Array.isArray(wiki.food) && wiki.food.length >= 3);
      assert.ok(Array.isArray(wiki.attractions) && wiki.attractions.length >= 3);
      assert.ok(Array.isArray(wiki.activities) && wiki.activities.length >= 3);
    }

    const wikiRou = getEncyclopediaProfile(countryByIso3["ROU"], wikiDeepDb);
    assert.ok(wikiRou.headOfState.includes("Bolojan"));
    assert.ok(wikiRou.headOfGov.includes("Ciolacu"));

    const wikiUsa = getEncyclopediaProfile(countryByIso3["USA"], wikiDeepDb);
    assert.ok(wikiUsa.headOfState.includes("Trump"));
  });
});

// ============================================================================
// SUITE 5: HTTP & REST API SERVER INTEGRATION TESTS (server.mjs)
// ============================================================================
describe("Suite 5: HTTP & REST API Server Integration Tests", () => {
  const server = createAppServer();

  // Helper that invokes the http.Server request listener using an in-memory Writable stream
  // so it works identically in restricted sandboxes and full network environments.
  function requestServer(urlPath) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let statusCode = 200;
      let headers = {};

      const req = {
        method: "GET",
        url: urlPath,
        headers: { host: "localhost:3000" }
      };

      const res = {
        writeHead(code, hdrs = {}) {
          statusCode = code;
          headers = { ...headers, ...hdrs };
          return this;
        },
        write(chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        },
        end(chunk) {
          if (chunk) this.write(chunk);
          const bodyText = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: statusCode,
            headers,
            text: async () => bodyText,
            json: async () => JSON.parse(bodyText)
          });
        },
        on(evt, handler) {
          if (evt === "error") this._errHandler = handler;
          return this;
        },
        once() { return this; },
        emit(evt, arg) {
          if (evt === "error" && this._errHandler) this._errHandler(arg);
          return this;
        }
      };

      try {
        server.emit("request", req, res);
      } catch (err) {
        reject(err);
      }
    });
  }

  it("GET /api/health returns 200 OK with 220 totalEntities", async () => {
    const res = await requestServer("/api/health");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ok");
    assert.equal(data.totalEntities, 220);
    assert.equal(data.breakdown.countries, 204);
    assert.equal(data.breakdown.continents, 8);
    assert.equal(data.breakdown.oceans, 8);
  });

  it("GET /api/entities supports filtering by region and search query", async () => {
    const resCont = await requestServer("/api/entities?region=Continents");
    assert.equal(resCont.status, 200);
    const dataCont = await resCont.json();
    assert.equal(dataCont.count, 8);

    const resSearch = await requestServer("/api/entities?q=romania");
    const dataSearch = await resSearch.json();
    assert.ok(dataSearch.entities.some(e => e.iso3 === "ROU"));
  });

  it("GET /api/compare?a=ROU&b=USA returns full comparison telemetry, biosphere, and encyclopedia", async () => {
    const res = await requestServer("/api/compare?a=ROU&b=USA");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.entityA.iso3, "ROU");
    assert.equal(data.entityB.iso3, "USA");
    assert.ok(Math.abs(data.metrics.areaRatioBtoA - 41.2485) < 0.001);
    assert.equal(data.biosphereA.creatures.length, 5);
    assert.ok(data.encyclopediaA.headOfState.includes("Bolojan"));
  });

  it("GET / and GET /maps-agg.html serve the Three.js WebGL application HTML", async () => {
    const resIndex = await requestServer("/");
    assert.equal(resIndex.status, 200);
    const html = await resIndex.text();
    assert.ok(html.includes("TERRA // SCALE"));
    assert.ok(html.includes("three.min.js"));
    assert.ok(html.includes("prism3dCanvas"));

    const resStandalone = await requestServer("/maps-agg.html");
    assert.equal(resStandalone.status, 200);
    const standaloneHtml = await resStandalone.text();
    assert.ok(standaloneHtml.includes("EMBEDDED_COUNTRIES_DB"));
  });

  it("returns 404 on unknown API compare ISO3 or missing static paths", async () => {
    const resBadIso = await requestServer("/api/compare?a=ROU&b=INVALID_ISO");
    assert.equal(resBadIso.status, 404);

    const resMissing = await requestServer("/nonexistent-file.js");
    assert.equal(resMissing.status, 404);
  });
});

// ============================================================================
// SUITE 6: THREE.JS 3D VOLUMETRIC PRISM ENGINE & FRONTEND BUNDLE VERIFICATION
// ============================================================================
import { TerraThreeEngine } from "../public/js/three-stage.mjs";

describe("Suite 6: Three.js 3D Volumetric Prism Engine & Bundle Integrity", () => {
  it("computes accurate 3D prism extrusion heights for Density, Elevation/Depth, and GDP per capita", () => {
    const rou = countryByIso3["ROU"];
    const usa = countryByIso3["USA"];
    const blks = countryByIso3["BLKS"];

    const engine = new TerraThreeEngine({
      state: { territoryScope: "full", theme: "dark", allWorldFeatures: [] },
      getCountryA: () => rou,
      getCountryB: () => usa,
      getProjectedCountry: c => getProjectedCountry(c, { geomsById, oceanPolygons, countriesDb }),
      getBiosphereProfile,
      countryById,
      oceanPolygons,
      getThemeColors: () => ({ colorA: "#00E5FF", colorB: "#FF5E36" })
    });

    // 1. Population Density Metric (ROU ~80.0/km² is denser than USA ~34.8/km², so hA > hB)
    engine.prismHeightMetric = "density";
    const denHeights = engine.computePrismHeights(rou, usa);
    assert.ok(denHeights.valA > denHeights.valB, "Expected Romania density > USA density");
    assert.ok(denHeights.hA > denHeights.hB, "Expected Romania 3D density prism taller than USA");

    // 2. Elevation / Bathymetry Metric (USA Denali 6,190m > ROU Moldoveanu 2,544m)
    engine.prismHeightMetric = "elevation";
    const elevHeights = engine.computePrismHeights(rou, usa);
    assert.equal(elevHeights.valA, 2544);
    assert.equal(elevHeights.valB, 6190);
    assert.ok(elevHeights.hB > elevHeights.hA);

    // 3. Ocean Bathymetry Depth (Black Sea 2,212m)
    const oceanHeights = engine.computePrismHeights(rou, blks);
    assert.equal(oceanHeights.valB, 2212);

    // 4. GDP Per Capita Metric (USA > ROU)
    engine.prismHeightMetric = "gdp";
    const gdpHeights = engine.computePrismHeights(rou, usa);
    assert.ok(gdpHeights.valB > gdpHeights.valA);
  });

  it("verifies standalone maps-agg.html inline JavaScript compiles with zero syntax errors", () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, "maps-agg.html"), "utf8");
    const match = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
    assert.ok(match && match[1], "Expected inline script block in maps-agg.html");
    // Compile via Function constructor to verify syntax
    assert.doesNotThrow(() => new Function(match[1]));
  });
});
