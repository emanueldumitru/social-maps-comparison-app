// ============================================================================
// TERRA // SCALE — Geospatial Data, Geometry, Biosphere & Encyclopedia Engine
// ============================================================================
import {
  lambertEqualAreaKm,
  unwrapRingLongitudes,
  polygonAreaKm2,
  ringCentroidLngLat
} from "./core-math.mjs";

export const EU27_ISOS = new Set([
  "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN",
  "FRA", "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX",
  "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE"
]);

export const BENCHMARKS = [
  { name: "Alaska (US State)", area: 1723337, pop: 733406 },
  { name: "Texas (US State)", area: 695662, pop: 30503301 },
  { name: "California (US State)", area: 423970, pop: 38965193 },
  { name: "Montana (US State)", area: 380831, pop: 1132812 },
  { name: "New Mexico (US State)", area: 314917, pop: 2114371 },
  { name: "Arizona (US State)", area: 295234, pop: 7431344 },
  { name: "Nevada (US State)", area: 286380, pop: 3194176 },
  { name: "Colorado (US State)", area: 269601, pop: 5877610 },
  { name: "Oregon (US State)", area: 254806, pop: 4233358 },
  { name: "Wyoming (US State)", area: 253335, pop: 584057 },
  { name: "Michigan (US State)", area: 250487, pop: 10037261 },
  { name: "Minnesota (US State)", area: 225163, pop: 5737915 },
  { name: "Utah (US State)", area: 219882, pop: 3417734 },
  { name: "Idaho (US State)", area: 216443, pop: 1964726 },
  { name: "Kansas (US State)", area: 213100, pop: 2940546 },
  { name: "Nebraska (US State)", area: 200330, pop: 1978379 },
  { name: "Washington (US State)", area: 184661, pop: 7812880 },
  { name: "Florida (US State)", area: 170312, pop: 22610726 },
  { name: "Wisconsin (US State)", area: 169635, pop: 5910955 },
  { name: "Georgia (US State)", area: 153910, pop: 11029227 },
  { name: "Illinois (US State)", area: 149995, pop: 12549689 },
  { name: "New York State", area: 141297, pop: 19571216 },
  { name: "Pennsylvania (US State)", area: 119280, pop: 12961683 },
  { name: "Ohio (US State)", area: 116098, pop: 11785935 },
  { name: "Virginia (US State)", area: 110787, pop: 8715698 },
  { name: "Indiana (US State)", area: 94326, pop: 6862199 },
  { name: "Maine (US State)", area: 91633, pop: 1395722 },
  { name: "South Carolina (US State)", area: 82933, pop: 5373555 },
  { name: "West Virginia (US State)", area: 62756, pop: 1770071 },
  { name: "Maryland (US State)", area: 32131, pop: 6180253 },
  { name: "Massachusetts (US State)", area: 27336, pop: 7001399 },
  { name: "New Jersey (US State)", area: 22591, pop: 9290841 },
  { name: "Connecticut (US State)", area: 14357, pop: 3617176 },
  { name: "Rhode Island (US State)", area: 4001, pop: 1095962 },
  { name: "New York City (5 Boroughs)", area: 778, pop: 8335897 },
  { name: "Manhattan Island", area: 59, pop: 1645867 },
  { name: "Central Park (NYC)", area: 3.41, pop: 25000 }
];

export const FEATURED_PRESETS = [
  { a: "ROU", b: "USA", label: "🇷🇴 Romania vs 🇺🇸 USA" },
  { a: "ROU", b: "BLKS", label: "🇷🇴 Romania vs 🌊 Black Sea" },
  { a: "USA", b: "ATA", label: "🇺🇸 USA vs ❄️ Antarctica" },
  { a: "EUR", b: "ANTC", label: "🌍 Europe vs ❄️ Antarctica" },
  { a: "AFR", b: "ASIA", label: "🌍 Africa vs 🌏 Asia" },
  { a: "EUR", b: "SAM", label: "🌍 Europe vs 🌎 South America" },
  { a: "ATA", b: "ARCT", label: "❄️ Antarctica vs 🐻‍❄️ Arctic Ocean" },
  { a: "ASIA", b: "PAC", label: "🌏 Asia vs 🌊 Pacific Ocean" },
  { a: "ROU", b: "EU27", label: "🇷🇴 Romania vs 🇪🇺 EU-27" },
  { a: "IND", b: "CHN", label: "🇮🇳 India vs 🇨🇳 China" },
  { a: "GRL", b: "AUS", label: "🇬🇱 Greenland vs 🇦🇺 Australia" }
];

export function findClosestBenchmark(val, key) {
  let best = BENCHMARKS[0];
  let bestRatioDiff = Infinity;
  for (const b of BENCHMARKS) {
    const bVal = b[key];
    const ratio = val > bVal ? val / bVal : bVal / val;
    if (ratio < bestRatioDiff) {
      bestRatioDiff = ratio;
      best = b;
    }
  }
  return best;
}

/**
 * Decodes a TopoJSON topology into a map of padded numeric IDs and an array of features.
 */
export function decodeTopoJSON(tj) {
  if (!tj || !tj.objects || !tj.objects.countries) {
    return { outMap: {}, features: [] };
  }
  const scale = tj.transform ? tj.transform.scale : [1, 1];
  const translate = tj.transform ? tj.transform.translate : [0, 0];
  const arcs = tj.arcs || [];

  function decodeArc(idx) {
    const rev = idx < 0;
    const rawArc = arcs[rev ? ~idx : idx];
    if (!rawArc) return [];
    const pts = [];
    let x = 0, y = 0;
    for (let i = 0; i < rawArc.length; i++) {
      x += rawArc[i][0];
      y += rawArc[i][1];
      pts.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
    }
    return rev ? pts.reverse() : pts;
  }

  function decodeRing(ringIndices) {
    const coords = [];
    for (let i = 0; i < ringIndices.length; i++) {
      const pts = decodeArc(ringIndices[i]);
      if (i === 0) coords.push(...pts);
      else coords.push(...pts.slice(1));
    }
    return coords;
  }

  const geoms = tj.objects.countries.geometries;
  const outMap = {};
  const features = [];
  for (let i = 0; i < geoms.length; i++) {
    const g = geoms[i];
    const id = g.id ? String(g.id).padStart(3, "0") : null;
    let geomObj = null;
    if (g.type === "Polygon") {
      geomObj = { type: "Polygon", coordinates: g.arcs.map(decodeRing) };
    } else if (g.type === "MultiPolygon") {
      geomObj = { type: "MultiPolygon", coordinates: g.arcs.map(p => p.map(decodeRing)) };
    }
    if (geomObj) {
      if (id) outMap[id] = geomObj;
      features.push({ id, geometry: geomObj });
    }
  }
  return { outMap, features };
}

/**
 * Bug Fix #4: Checks whether a given entity (Country, Continent, EU-27) contains
 * a specific world feature ID (e.g. "642" for Romania inside "EUR" or "EU27").
 * Enables full continent and EU-27 highlighting on the 3D Globe!
 */
export function doesEntityContainFeature(entity, featureId, countryById = {}) {
  if (!entity || !featureId) return false;
  const padId = String(featureId).padStart(3, "0");
  const entPadId = String(entity.id || "").padStart(3, "0");

  if (padId === entPadId) return true;
  if ((entity.iso3 === "ATA" || entity.id === "CONT_ANT") && padId === "010") return true;

  if (entity.entityType === "continent") {
    const member = countryById[padId];
    if (!member) return false;
    if (entity.id === "CONT_AFRICA" && member.region === "Africa") return true;
    if (entity.id === "CONT_SAM" && member.subregion === "South America") return true;
    if (entity.id === "CONT_NAM" && member.region === "Americas" && member.subregion !== "South America") return true;
    if (entity.id === "CONT_OCE" && member.region === "Oceania") return true;
    if (entity.id === "CONT_EUR" && member.region === "Europe") return true;
    if (entity.id === "CONT_ASIA" && (member.region === "Asia" || member.iso3 === "RUS")) return true;
    if (entity.id === "CONT_EU27" && EU27_ISOS.has(member.iso3)) return true;
  }
  return false;
}

/**
 * Retrieves or procedurally/compositedly generates the GeoJSON geometry for any of the 220 entities.
 */
export function getOrGenerateGeometry(country, geomsById = {}, oceanPolygons = {}, countriesDb = []) {
  if (!country) return { type: "Polygon", coordinates: [[]] };

  // 1. Ocean & Sea Basin Polygon
  if (oceanPolygons && oceanPolygons[country.id]) {
    return oceanPolygons[country.id];
  }

  // 2. Antarctica (Country or Full Continent) -> polar polygon 010
  if (country.iso3 === "ATA" || country.id === "CONT_ANT") {
    if (geomsById["010"]) return geomsById["010"];
  }

  // 3. Entire Continents & EU-27 Multi-Polygon Compositor
  if (country.entityType === "continent") {
    const cacheKey = "CONT_GEOM_" + country.id;
    if (geomsById[cacheKey]) return geomsById[cacheKey];
    const multiCoords = [];
    for (const member of countriesDb) {
      if (member.entityType !== "country") continue;
      let include = false;
      if (country.id === "CONT_AFRICA" && member.region === "Africa") include = true;
      else if (country.id === "CONT_SAM" && member.subregion === "South America") include = true;
      else if (country.id === "CONT_NAM" && member.region === "Americas" && member.subregion !== "South America") include = true;
      else if (country.id === "CONT_OCE" && member.region === "Oceania") include = true;
      else if (country.id === "CONT_EUR" && member.region === "Europe") include = true;
      else if (country.id === "CONT_ASIA" && (member.region === "Asia" || member.iso3 === "RUS")) include = true;
      else if (country.id === "CONT_EU27" && EU27_ISOS.has(member.iso3)) include = true;
      if (!include) continue;

      const mId = String(member.id || "").padStart(3, "0");
      const g = geomsById[mId];
      if (!g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      for (const poly of polys) {
        const ring0 = poly[0];
        if (!ring0 || ring0.length < 3) continue;
        const [cLng, cLat] = ringCentroidLngLat(ring0);
        // Clip Russia along Ural Mountains (~60°E) between Europe and Asia
        if (country.id === "CONT_EUR" && member.iso3 === "RUS") {
          if (cLng > 68 || cLng < 18 || cLat > 71.5) continue;
          const clippedRing = ring0
            .filter(pt => pt[0] > 18)
            .map(pt => [Math.min(60.5, pt[0]), Math.min(71.2, pt[1])]);
          if (clippedRing.length >= 4) multiCoords.push([clippedRing]);
          continue;
        }
        if (country.id === "CONT_ASIA" && member.iso3 === "RUS") {
          if (cLng < 40 && cLng > -150) continue;
          const clippedRing = ring0
            .filter(pt => pt[0] > 45 || pt[0] < -160)
            .map(pt => [pt[0] < 0 ? pt[0] + 360 : Math.max(59.5, pt[0]), pt[1]]);
          if (clippedRing.length >= 4) multiCoords.push([clippedRing]);
          continue;
        }
        // Exclude distant overseas/high-arctic islands when compositing Europe/EU27
        if ((country.id === "CONT_EUR" || country.id === "CONT_EU27") && (cLat < 34.5 || cLat > 71.5 || cLng < -25 || cLng > 61)) {
          continue;
        }
        multiCoords.push(poly);
      }
    }
    if (multiCoords.length > 0) {
      const comp = { type: "MultiPolygon", coordinates: multiCoords };
      geomsById[cacheKey] = comp;
      return comp;
    }
  }

  const padId = String(country.id || "").padStart(3, "0");
  if (geomsById[padId]) return geomsById[padId];

  // Procedural organic island/territory polygon centered at [lng, lat]
  const rKm = Math.sqrt(Math.max(country.area || 10, 0.5) / Math.PI);
  const degLat = rKm / 111.13;
  const degLng = rKm / (111.32 * Math.max(0.2, Math.cos((country.lat || 0) * Math.PI / 180)));
  const ring = [];
  const steps = 28;
  let seed = 0;
  const isoStr = country.iso3 || "ISO";
  for (let i = 0; i < isoStr.length; i++) seed = (seed * 31 + isoStr.charCodeAt(i)) % 997;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble = 1 + 0.16 * Math.sin(a * 3 + seed) + 0.09 * Math.cos(a * 5 - seed);
    ring.push([
      (country.lng || 0) + Math.cos(a) * degLng * wobble,
      (country.lat || 0) + Math.sin(a) * degLat * wobble
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

export function getTargetAreaKm2(country, territoryScope = "full") {
  if (!country) return 1;
  if (territoryScope === "mainland" && country.mainlandArea) {
    return country.mainlandArea;
  }
  return country.area;
}

/**
 * Projects a country/continent/ocean geometry into true Equal-Area kilometer coordinates
 * centered at [0, 0], with antimeridian unwrapping (Bug #1 fix) and hole subtraction (Bug #2 fix).
 */
export function getProjectedCountry(country, options = {}) {
  const {
    territoryScope = "full",
    compactInsets = true,
    geomsById = {},
    oceanPolygons = {},
    countriesDb = [],
    projectedCache = null
  } = options;

  const cacheKey = `${country.iso3}_${territoryScope}_${compactInsets}`;
  if (projectedCache && projectedCache[cacheKey]) {
    return projectedCache[cacheKey];
  }

  const geom = getOrGenerateGeometry(country, geomsById, oceanPolygons, countriesDb);
  const rawPolys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;

  const projectedPolys = [];
  const insetBoxes = [];

  for (let pIdx = 0; pIdx < rawPolys.length; pIdx++) {
    const poly = rawPolys[pIdx];
    const outerRing = poly[0];
    if (!outerRing || outerRing.length < 3) continue;

    // Unwrap ring longitudes first around country.lng so antimeridian-spanning rings have an accurate centroid
    const unwrappedOuter = unwrapRingLongitudes(outerRing, country.lng);
    const [cLng, cLat] = ringCentroidLngLat(unwrappedOuter);

    let polyCenterLng = country.lng;
    let polyCenterLat = country.lat;
    let shiftKmX = 0, shiftKmY = 0;
    let polyTag = "main";

    if (country.iso3 === "USA") {
      const isAlaska = cLat > 51 && cLng < -129;
      const isHawaii = cLat < 24 && cLng < -150;
      const isPR = cLat < 20 && cLng > -70;
      if (territoryScope === "mainland" && (isAlaska || isHawaii || isPR)) {
        continue;
      }
      if (isAlaska) {
        if (compactInsets && cLng < -167.5) continue;
        polyCenterLng = -152.5;
        polyCenterLat = 64.2;
        polyTag = "alaska";
        if (compactInsets) {
          shiftKmX = -1050;
          shiftKmY = 1180;
        } else {
          const [akPosX, akPosY] = lambertEqualAreaKm(-152.5, 64.2, country.lng, country.lat);
          shiftKmX = akPosX;
          shiftKmY = akPosY;
        }
      } else if (isHawaii) {
        polyCenterLng = -156.5;
        polyCenterLat = 20.5;
        polyTag = "hawaii";
        if (compactInsets) {
          shiftKmX = 220;
          shiftKmY = 1320;
        } else {
          const [hiPosX, hiPosY] = lambertEqualAreaKm(-156.5, 20.5, country.lng, country.lat);
          shiftKmX = hiPosX;
          shiftKmY = hiPosY;
        }
      }
    } else if (country.iso3 === "FRA") {
      const distDeg = Math.hypot(cLng - 2.4, cLat - 46.6);
      if (distDeg > 12) {
        if (territoryScope === "mainland") continue;
        polyCenterLng = cLng;
        polyCenterLat = cLat;
        shiftKmX = -520;
        shiftKmY = 480;
        polyTag = "overseas";
      }
    } else if (country.iso3 === "NOR" && territoryScope === "mainland") {
      if (cLat > 73) continue;
    }

    // Bug Fix #1: Unwrap ring longitudes continuously relative to polyCenterLng before Lambert projection
    const ringsKm = poly.map(ring => {
      const unwrapped = unwrapRingLongitudes(ring, polyCenterLng);
      return unwrapped.map(pt => {
        const [x, y] = lambertEqualAreaKm(pt[0], pt[1], polyCenterLng, polyCenterLat, true);
        return [x + shiftKmX, y + shiftKmY];
      });
    });
    projectedPolys.push({ rings: ringsKm, tag: polyTag });
  }

  if (projectedPolys.length === 0 && rawPolys.length > 0) {
    const ringsKm = rawPolys[0].map(ring => {
      const unwrapped = unwrapRingLongitudes(ring, country.lng);
      return unwrapped.map(pt => lambertEqualAreaKm(pt[0], pt[1], country.lng, country.lat, true));
    });
    projectedPolys.push({ rings: ringsKm, tag: "main" });
  }

  // Bug Fix #2: Compute raw projected area subtracting any inner hole rings
  let rawAreaKm2 = 0;
  for (const p of projectedPolys) {
    rawAreaKm2 += polygonAreaKm2(p.rings);
  }
  const targetArea = getTargetAreaKm2(country, territoryScope);
  const scaleFactor = rawAreaKm2 > 0 ? Math.sqrt(targetArea / rawAreaKm2) : 1.0;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let mainMinX = Infinity, mainMaxX = -Infinity, mainMinY = Infinity, mainMaxY = -Infinity;

  for (const p of projectedPolys) {
    for (const ring of p.rings) {
      for (const pt of ring) {
        pt[0] *= scaleFactor;
        pt[1] *= scaleFactor;
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
        if (p.tag === "main") {
          if (pt[0] < mainMinX) mainMinX = pt[0];
          if (pt[0] > mainMaxX) mainMaxX = pt[0];
          if (pt[1] < mainMinY) mainMinY = pt[1];
          if (pt[1] > mainMaxY) mainMaxY = pt[1];
        }
      }
    }
  }

  const cx = isFinite(mainMinX) ? (mainMinX + mainMaxX) * 0.5 : (minX + maxX) * 0.5;
  const cy = isFinite(mainMinY) ? (mainMinY + mainMaxY) * 0.5 : (minY + maxY) * 0.5;

  minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
  let akBox = null, hiBox = null;

  for (const p of projectedPolys) {
    for (const ring of p.rings) {
      for (const pt of ring) {
        pt[0] -= cx;
        pt[1] -= cy;
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];

        if (p.tag === "alaska") {
          if (!akBox) akBox = { minX: pt[0], maxX: pt[0], minY: pt[1], maxY: pt[1], label: "ALASKA (1:1 Scale)" };
          akBox.minX = Math.min(akBox.minX, pt[0]); akBox.maxX = Math.max(akBox.maxX, pt[0]);
          akBox.minY = Math.min(akBox.minY, pt[1]); akBox.maxY = Math.max(akBox.maxY, pt[1]);
        } else if (p.tag === "hawaii") {
          if (!hiBox) hiBox = { minX: pt[0], maxX: pt[0], minY: pt[1], maxY: pt[1], label: "HAWAII (1:1)" };
          hiBox.minX = Math.min(hiBox.minX, pt[0]); hiBox.maxX = Math.max(hiBox.maxX, pt[0]);
          hiBox.minY = Math.min(hiBox.minY, pt[1]); hiBox.maxY = Math.max(hiBox.maxY, pt[1]);
        }
      }
    }
  }

  if (akBox && compactInsets) insetBoxes.push(akBox);
  if (hiBox && compactInsets) insetBoxes.push(hiBox);

  let [capX, capY] = lambertEqualAreaKm(country.capLng, country.capLat, country.lng, country.lat);
  capX = capX * scaleFactor - cx;
  capY = capY * scaleFactor - cy;

  let calibratedAreaKm2 = 0;
  for (const p of projectedPolys) {
    calibratedAreaKm2 += polygonAreaKm2(p.rings);
  }

  const result = {
    polys: projectedPolys,
    insetBoxes,
    widthKm: Math.max(1, maxX - minX),
    heightKm: Math.max(1, maxY - minY),
    minX, maxX, minY, maxY,
    capKm: [capX, capY],
    areaKm2: targetArea,
    calibratedAreaKm2
  };
  if (projectedCache) {
    projectedCache[cacheKey] = result;
  }
  return result;
}

// ============================================================================
// BIOSPHERE, WILDLIFE POPULATIONS & BATHYMETRIC DEPTH DATABASE
// ============================================================================
export const BIOSPHERE_PROFILES = {
  "ROU": {
    biome: "Carpathian Temperate-Montane Forest, Danube Delta Wetland & Black Sea Littoral",
    maxElevM: 2544, maxElevName: "Moldoveanu Peak (Făgăraș Mts)", meanElevM: 414,
    maxDepthM: 2212, maxDepthName: "Black Sea Euxine Basin",
    speciesTotal: "3,700+ Flora / 33,800+ Fauna",
    mammalCount: 112, birdCount: 382, fishCount: 195, protectedPct: 23.4,
    biomassHeadline: "Europe's #1 Large Carnivore Sanctuary & Largest Reed Delta",
    creatures: [
      { emoji: "🐻", name: "Eurasian Brown Bear", sci: "Ursus arctos", pop: "~8,000 in Carpathians", stratum: "Alt: 500 – 2,200 m", desc: "Romania hosts over 45% of the European Union's wild brown bear population inside pristine Carpathian old-growth beech and spruce forests." },
      { emoji: "🦩", name: "Great White Pelican", sci: "Pelecanus onocrotalus", pop: "~4,500+ breeding pairs", stratum: "Alt: 0 – 15 m (Danube Delta)", desc: "Flagship avian species of the UNESCO Danube Delta Biosphere Reserve, migrating between the Nile and Romania's 4,152 km² reed labyrinth." },
      { emoji: "🐺", name: "Carpathian Grey Wolf", sci: "Canis lupus lupus", pop: "~2,800 – 3,200 wolves", stratum: "Alt: 400 – 2,000 m", desc: "Apex pack predator regulating red deer and wild boar populations across the Southern and Eastern Carpathian mountain arc." },
      { emoji: "🦬", name: "European Bison (Zimbru)", sci: "Bison bonasus", pop: "~250+ free-roaming", stratum: "Alt: 600 – 1,500 m", desc: "Europe's heaviest surviving land mammal (up to 920 kg), successfully reintroduced into the Țarcu, Făgăraș, and Vânători-Neamț mountains." },
      { emoji: "🐟", name: "Beluga Sturgeon (Morun)", sci: "Huso huso", pop: "Critically Endangered Relic", stratum: "Depth: 0 – 180 m (Black Sea & Danube)", desc: "Prehistoric anadromous giant reaching up to 6 meters and living 100+ years, swimming from the Black Sea up the Lower Danube to spawn." }
    ]
  },
  "USA": {
    biome: "Continental Megabiome: Temperate Forest, Great Plains Prairie, Sonoran Desert & Arctic Tundra",
    maxElevM: 6190, maxElevName: "Denali (Alaska Range)", meanElevM: 760,
    maxDepthM: 8376, maxDepthName: "Puerto Rico Trench (EEZ)",
    speciesTotal: "21,000+ Flora / 150,000+ Fauna",
    mammalCount: 468, birdCount: 1118, fishCount: 3110, protectedPct: 13.0,
    biomassHeadline: "84 Ecoregions from Arctic Pack Ice to Subtropical Coral Reefs",
    creatures: [
      { emoji: "🦬", name: "American Bison", sci: "Bison bison", pop: "~500,000 (Wild & Conservation)", stratum: "Alt: 300 – 2,600 m", desc: "National mammal of the United States; rescued from near-extinction (325 individuals in 1884) with iconic free-ranging herds in Yellowstone." },
      { emoji: "🦅", name: "Bald Eagle", sci: "Haliaeetus leucocephalus", pop: "~316,700 individuals", stratum: "Alt: 0 – 3,000 m", desc: "Apex aerial raptor across North American rivers and coasts; population quadrupled since 2009 in one of history's greatest conservation recoveries." },
      { emoji: "🐻", name: "Grizzly & American Black Bear", sci: "Ursus arctos horribilis / U. americanus", pop: "~55,000 Grizzlies / ~350,000 Black Bears", stratum: "Alt: 0 – 3,500 m", desc: "Keystone omnivores across Alaska, the Greater Yellowstone Ecosystem, Glacier National Park, and Appalachian/Pacific forests." },
      { emoji: "🐋", name: "North Pacific Humpback & Blue Whale", sci: "Megaptera novaeangliae", pop: "~22,000+ along US Coasts", stratum: "Depth: 0 – 500 m", desc: "Migrate 8,000 km annually between Hawaii/Baja breeding lagoons and nutrient-rich Alaskan and California current upwelling zones." },
      { emoji: "🌲", name: "Giant Sequoia & Coast Redwood", sci: "Sequoiadendron giganteum", pop: "~80,000 mature monarchs", stratum: "Alt: 1,400 – 2,150 m (Sierra Nevada)", desc: "Earth's largest and tallest living organisms by volume (General Sherman: 1,487 m³) and height (Hyperion: 115.9 m), living up to 3,200 years." }
    ]
  },
  "ATA": {
    biome: "Antarctic Polar Ice Sheet, Nunataks, Subglacial Lakes & Circumpolar Sea Ice Margin",
    maxElevM: 4892, maxElevName: "Vinson Massif (Ellsworth Mts)", meanElevM: 2194,
    maxDepthM: 7434, maxDepthName: "Southern Ocean Margin",
    speciesTotal: "1,150+ Fungi/Lichens / 9,000+ Marine & Coastal Fauna",
    mammalCount: 24, birdCount: 46, fishCount: 320, protectedPct: 100.0,
    biomassHeadline: "Zero Land Predators • 379 Million Tonnes of Antarctic Krill Fueling Global Giants",
    creatures: [
      { emoji: "🐧", name: "Emperor Penguin", sci: "Aptenodytes forsteri", pop: "~595,000 adults (66 colonies)", stratum: "Alt: Sea Ice to −565 m Dive Depth", desc: "Only animal to breed during the brutal Antarctic winter (−60°C, 200 km/h katabatic winds), diving 565 meters for 27 minutes on a single breath." },
      { emoji: "🦐", name: "Antarctic Krill", sci: "Euphausia superba", pop: "~300–500 Trillion (~379M tonnes)", stratum: "Depth: 0 – 3,000 m", desc: "One of the most abundant multicellular animal species on Earth; forms super-swarms visible from space and powers the entire polar food web." },
      { emoji: "🦭", name: "Leopard & Weddell Seal", sci: "Hydrurga leptonyx / Leptonychotes weddellii", pop: "~35,000 Leopard / ~800,000 Weddell", stratum: "Depth: 0 – 600 m under fast ice", desc: "Weddell seals hold the southernmost mammal record on Earth, using specialized canine teeth to rasp breathing holes through 2-meter-thick sea ice." },
      { emoji: "🐋", name: "Antarctic Blue Whale & Type-B Orca", sci: "Balaenoptera musculus intermedia", pop: "~3,000 Blue / ~25,000 Antarctic Orcas", stratum: "Depth: 0 – 500 m", desc: "The largest animal ever to live on Earth (up to 190 tonnes, heart the size of a golf cart), consuming 4 million krill per day in summer." },
      { emoji: "🐟", name: "Antarctic Toothfish & Icefish", sci: "Dissostichus mawsoni / Channichthyidae", pop: "Endemic Antifreeze Specialists", stratum: "Depth: 100 – 2,200 m (−1.9°C water)", desc: "Produce biological antifreeze glycoproteins in their blood; Crocodile Icefish are the only known vertebrates on Earth with transparent, hemoglobin-free blood." }
    ]
  },
  "BLKS": {
    biome: "Meromictic Semi-Enclosed Basin: Oxygenated Photic Upper 150m & 90% Deep Anoxic H₂S Layer",
    maxElevM: 0, maxElevName: "Sea Level Surface", meanElevM: 0,
    maxDepthM: 2212, maxDepthName: "Central Euxine Abyssal Plain",
    speciesTotal: "2,500+ Marine Fauna / 1,600+ Phytoplankton & Algae",
    mammalCount: 3, birdCount: 165, fishCount: 184, protectedPct: 11.5,
    biomassHeadline: "World's Largest Meromictic Anoxic Basin • Ancient Shipwrecks Preserved Below 150m",
    creatures: [
      { emoji: "🐬", name: "Black Sea Bottlenose & Harbour Porpoise", sci: "Tursiops truncatus ponticus / Phocoena relicta", pop: "~250,000 cetaceans across basin", stratum: "Depth: 0 – 120 m (Oxic Zone)", desc: "Three endemic cetacean subspecies (Bottlenose, Common Dolphin, and Harbour Porpoise) hunt anchovy and sprat schools in the oxygenated upper layer." },
      { emoji: "🐟", name: "Beluga & Starry Sturgeon", sci: "Huso huso / Acipenser stellatus", pop: "Protected Pontic-Danube Relics", stratum: "Depth: 0 – 150 m (Continental Shelf)", desc: "Living fossils dating back 200 million years that feed on the NW Black Sea shelf before migrating into Romania's Danube Delta." },
      { emoji: "🦈", name: "Black Sea Spiny Dogfish Shark", sci: "Squalus acanthias", pop: "~120,000+ harmless benthic sharks", stratum: "Depth: 15 – 140 m", desc: "The primary shark of the Black Sea (reaching 1.5 m), completely harmless to humans and adapted to brackish 18‰ salinity waters." },
      { emoji: "🪼", name: "Moon Jelly & Bioluminescent Comb Jelly", sci: "Aurelia aurita / Mnemiopsis leidyi", pop: "Massive Seasonal Zooplankton Blooms", stratum: "Depth: 0 – 90 m", desc: "Translucent gelatinous filter feeders pulsing through the upper thermocline above the permanent halocline." },
      { emoji: "🦠", name: "Deep Anoxic Sulfate-Reducing Archaea", sci: "Desulfobacterota & Methanogens", pop: "10⁹ cells / liter below 150 m", stratum: "Depth: 150 – 2,212 m (Anoxic Zone)", desc: "Below 150 meters, zero dissolved oxygen exists—only extremophile microbes thrive in hydrogen sulfide, preserving 2,400-year-old Greek shipwrecks intact." }
    ]
  },
  "PAC": {
    biome: "Earth's Largest Ocean Basin: Coral Triangle, Humboldt Upwelling, Abyssal Plains & Hadal Trenches",
    maxElevM: 0, maxElevName: "Sea Level Surface", meanElevM: 0,
    maxDepthM: 10935, maxDepthName: "Challenger Deep (Mariana Trench)",
    speciesTotal: "120,000+ Described / >1M Estimated Marine Species",
    mammalCount: 88, birdCount: 340, fishCount: 14500, protectedPct: 8.4,
    biomassHeadline: "~950 Million Tonnes of Nekton Biomass • Deepest Point on Earth (10,935 m / 1,086 atm)",
    creatures: [
      { emoji: "🐋", name: "Blue, Sperm & Grey Whales", sci: "Balaenoptera musculus / Physeter macrocephalus", pop: "~15,000 Blue / ~300,000 Sperm Whales", stratum: "Depth: 0 – 2,250 m", desc: "Sperm whales dive over 2,000 meters into pitch-black bathypelagic waters using 230-decibel echolocation clicks to hunt giant squid." },
      { emoji: "🦑", name: "Giant & Vampire Squid", sci: "Architeuthis dux / Vampyroteuthis infernalis", pop: "Millions across Mesopelagic/Bathypelagic", stratum: "Depth: 300 – 3,000 m", desc: "Possessing the largest eyes in the animal kingdom (27 cm diameter) to detect faint bioluminescent flashes in the twilight and midnight zones." },
      { emoji: "🐟", name: "Bioluminescent Myctophid Lanternfish", sci: "Myctophidae (250+ species)", pop: "~600 Million Tonnes Global Biomass", stratum: "Depth: 200 – 1,200 m (Diel Vertical Migration)", desc: "Account for 65% of all deep-sea fish biomass; every night they ascend to the surface in the largest animal migration on Planet Earth." },
      { emoji: "🫧", name: "Mariana Hadal Snailfish", sci: "Pseudoliparis swirei", pop: "Endemic Trench Apex Predator", stratum: "Depth: 6,000 – 8,178 m (Hadal Trench)", desc: "Deepest living vertebrate ever filmed (8,178 m), surviving crushing 800+ atm pressure via TMAO osmolyte molecules and cartilaginous skulls." },
      { emoji: "🦐", name: "Supergiant Hadal Amphipod", sci: "Hirondellea gigas / Alicella gigantea", pop: "Thriving at 10,935 m Challenger Deep", stratum: "Depth: 7,000 – 10,935 m", desc: "Scavenging crustaceans up to 34 cm long using cellulase enzymes to digest sunken wood and marine snow on the floor of Challenger Deep." }
    ]
  },
  "ATL": {
    biome: "Mid-Atlantic Ridge Hydrothermal Vents, Sargasso Sea Floating Ecosystem & Gulf Stream",
    maxElevM: 0, maxElevName: "Sea Level Surface", meanElevM: 0,
    maxDepthM: 8376, maxDepthName: "Milwaukee Deep (Puerto Rico Trench)",
    speciesTotal: "75,000+ Documented Marine Species",
    mammalCount: 68, birdCount: 240, fishCount: 9200, protectedPct: 7.2,
    biomassHeadline: "Home to the Sargasso Sea & 16,000 km Mid-Atlantic Volcanic Mountain Chain",
    creatures: [
      { emoji: "🐋", name: "North Atlantic Right & Humpback Whale", sci: "Eubalaena glacialis", pop: "~360 Right / ~35,000 Humpback", stratum: "Depth: 0 – 400 m", desc: "Filter-feeding baleen giants skimming dense copepod patches from New England and Iceland to sub-Antarctic feeding grounds." },
      { emoji: "🐟", name: "Atlantic Bluefin Tuna", sci: "Thunnus thynnus", pop: "~2.5 Million adult pelagics", stratum: "Depth: 0 – 1,000 m", desc: "Warm-blooded hydrodynamic apex teleost capable of sprinting at 70 km/h and crossing the entire Atlantic Ocean in under 45 days." },
      { emoji: "🦈", name: "Great White & Greenland Shark", sci: "Carcharodon carcharias / Somniosus microcephalus", pop: "Apex Trans-Oceanic Cruisers", stratum: "Depth: 0 – 2,200 m", desc: "Greenland sharks in the cold North Atlantic live 270 to 500+ years—the longest-lived vertebrate species known to science." },
      { emoji: "🏮", name: "Deep-Sea Black Seadevil Anglerfish", sci: "Melanocetus johnsonii", pop: "Widespread Bathypelagic Predator", stratum: "Depth: 1,000 – 4,000 m", desc: "Uses a symbiotic bioluminescent bacterial lure (esca) to attract prey in the pitch-black Midnight Zone." },
      { emoji: "🦐", name: "Mid-Atlantic Hydrothermal Vent Shrimp", sci: "Rimicaris exoculata", pop: "Swarming 2,500 individuals / m² at vents", stratum: "Depth: 2,300 – 3,700 m (Lost City & TAG Vents)", desc: "Blind extremophile shrimp with dorsal light-sensing organs that detect infrared thermal glow from 350°C black smoker chimneys." }
    ]
  },
  "ARCT": {
    biome: "Multi-Year Polar Pack Ice, Polynias, Continental Shelves & Under-Ice Brine Channels",
    maxElevM: 0, maxElevName: "Polar Sea Ice Surface", meanElevM: 0,
    maxDepthM: 5550, maxDepthName: "Molloy Deep (Fram Strait)",
    speciesTotal: "5,500+ Cold-Adapted Marine & Sympagic Species",
    mammalCount: 17, birdCount: 85, fishCount: 240, protectedPct: 12.0,
    biomassHeadline: "Sympagic Sea-Ice Algae Base • 400-Year-Old Sharks & Tusked Cetaceans",
    creatures: [
      { emoji: "🐻‍❄️", name: "Polar Bear", sci: "Ursus maritimus", pop: "~26,000 across 19 subpopulations", stratum: "Sea Ice & 0 – 15 m swims", desc: "Earth's largest hypercarnivorous bear, capable of swimming 600+ km non-stop across open Arctic water and scenting seals through 1m of ice." },
      { emoji: "🦄", name: "Narwhal & Beluga Whale", sci: "Monodon monoceros / Delphinapterus leucas", pop: "~170,000 Narwhals / ~200,000 Belugas", stratum: "Depth: 0 – 1,500 m under pack ice", desc: "Narwhals possess a 3-meter spiraled canine tooth packed with 10 million nerve endings and dive 1,500 meters for Greenland halibut." },
      { emoji: "🦈", name: "Greenland Sleeper Shark", sci: "Somniosus microcephalus", pop: "~100,000+ in Arctic/N. Atlantic", stratum: "Depth: 200 – 2,200 m (−1°C water)", desc: "Radiocarbon-dated to live up to 400–512 years; reaches sexual maturity at age 150, cruising slowly beneath the polar ice cap." },
      { emoji: "🦭", name: "Pacific & Atlantic Walrus", sci: "Odobenus rosmarus", pop: "~250,000 individuals", stratum: "Depth: 0 – 100 m Continental Shelf", desc: "1.5-tonne benthic foragers using 700 ultra-sensitive mystacial whiskers to excavate thousands of Arctic clams per day." },
      { emoji: "🐟", name: "Polar Cod", sci: "Boreogadus saida", pop: "Billions beneath sea ice", stratum: "Depth: 0 – 400 m (Ice-edge cavities)", desc: "Crucial trophic link converting under-ice amphipod energy into food for narwhals, belugas, ringed seals, and Arctic seabirds." }
    ]
  }
};

BIOSPHERE_PROFILES["ANTC"] = BIOSPHERE_PROFILES["ATA"];

export function getBiosphereProfile(c) {
  if (!c) return BIOSPHERE_PROFILES["ROU"];
  if (BIOSPHERE_PROFILES[c.iso3]) return BIOSPHERE_PROFILES[c.iso3];

  if (c.iso3 === "EUR" || c.iso3 === "EU27") {
    return {
      biome: "Temperate Deciduous & Boreal Taiga Forests, Alpine Peaks, Mediterranean Scrub & Atlantic Coasts",
      maxElevM: 5642, maxElevName: "Mount Elbrus / Mont Blanc (4,808 m)", meanElevM: 340,
      maxDepthM: 5267, maxDepthName: "Calypso Deep (Mediterranean)",
      speciesTotal: "12,500+ Flora / 100,000+ Fauna",
      mammalCount: 270, birdCount: 530, fishCount: 640, protectedPct: 26.1,
      biomassHeadline: "Natura 2000 Network: Strongest Continent-Wide Large Carnivore & Rewilding Recovery",
      creatures: [
        { emoji: "🐻", name: "Eurasian Brown Bear & Wolf", sci: "Ursus arctos / Canis lupus", pop: "~17,000 Bears / ~19,000 Wolves in Europe", stratum: "Alt: 200 – 2,400 m", desc: "Centered in the Carpathians (Romania), Fennoscandia, Dinaric Alps, and Iberian mountains." },
        { emoji: "🦬", name: "European Bison (Wisent)", sci: "Bison bonasus", pop: "~10,000+ across Europe", stratum: "Alt: 100 – 1,600 m", desc: "Restored from just 12 zoo individuals in 1927 to thriving wild herds in Poland, Romania, Belarus, and Germany." },
        { emoji: "🐱", name: "Eurasian & Iberian Lynx", sci: "Lynx lynx / Lynx pardinus", pop: "~9,000 Eurasian / ~2,000 Iberian", stratum: "Alt: 300 – 2,200 m", desc: "Elusive forest felids; the Iberian Lynx rebounded from 94 individuals in 2002 to over 2,000 today." },
        { emoji: "🐐", name: "Alpine Ibex & Chamois", sci: "Capra ibex / Rupicapra rupicapra", pop: "~55,000 Ibex / ~500,000 Chamois", stratum: "Alt: 1,800 – 3,500 m", desc: "Gravity-defying cliff climbers scaling near-vertical Alpine and Carpathian rock faces." },
        { emoji: "🐋", name: "Mediterranean Fin & Sperm Whale", sci: "Balaenoptera physalus", pop: "~3,500 in Pelagos Sanctuary", stratum: "Depth: 0 – 2,000 m", desc: "Resident cetaceans feeding in the Ligurian, Aegean, and Atlantic shelf upwelling corridors." }
      ]
    };
  }
  if (c.iso3 === "AFR") {
    return {
      biome: "Equatorial Congo Rainforest, Savanna Grasslands, Sahara Desert & Great Rift Valley Lakes",
      maxElevM: 5895, maxElevName: "Mount Kilimanjaro (Tanzania)", meanElevM: 750,
      maxDepthM: 1470, maxDepthName: "Lake Tanganyika (2nd Deepest Lake on Earth)",
      speciesTotal: "45,000+ Flora / 1,100+ Mammal Species",
      mammalCount: 1150, birdCount: 2477, fishCount: 3600, protectedPct: 18.9,
      biomassHeadline: "Planet Earth's Highest Intact Megafauna Diversity & Great Serengeti Migration",
      creatures: [
        { emoji: "🐘", name: "African Savanna & Forest Elephant", sci: "Loxodonta africana / L. cyclotis", pop: "~415,000 across 37 countries", stratum: "Alt: 0 – 3,000 m", desc: "Earth's largest land mammal (up to 7 tonnes), ecosystem engineers shaping savannas and dispersing rainforest seeds." },
        { emoji: "🦁", name: "African Lion & Leopard", sci: "Panthera leo / Panthera pardus", pop: "~23,000 Lions / ~700,000 Leopards", stratum: "Alt: 0 – 4,000 m", desc: "Social apex predators commanding the Serengeti, Okavango Delta, Kruger, and Maasai Mara." },
        { emoji: "🐃", name: "Blue Wildebeest & Plains Zebra", sci: "Connochaetes taurinus", pop: "~1.5 Million Wildebeest / ~750K Zebra", stratum: "Alt: 1,100 – 2,000 m", desc: "Form the Great Migration—the largest overland herd movement on Earth across Tanzania and Kenya." },
        { emoji: "🦍", name: "Mountain & Lowland Gorilla", sci: "Gorilla beringei / Gorilla gorilla", pop: "~1,063 Mountain / ~300,000 Western Lowland", stratum: "Alt: 200 – 4,000 m (Virunga & Congo)", desc: "Share 98.3% of human DNA, inhabiting the mist-shrouded volcanic slopes of the Albertine Rift and Congo Basin." },
        { emoji: "🦛", name: "Hippopotamus & Nile Crocodile", sci: "Hippopotamus amphibius", pop: "~130,000 Hippos / ~500,000 Crocodiles", stratum: "Rivers & Rift Lakes (0 – 30 m)", desc: "Dominate African river systems, transferring millions of tonnes of terrestrial nutrients into freshwater ecosystems." }
      ]
    };
  }
  if (c.iso3 === "ASIA") {
    return {
      biome: "Himalayan Roof of the World, Siberian Taiga, Monsoon Rainforests, Steppe & Coral Triangle",
      maxElevM: 8849, maxElevName: "Mount Everest / Chomolungma", meanElevM: 950,
      maxDepthM: 1642, maxDepthName: "Lake Baikal (Deepest Continental Rift Lake)",
      speciesTotal: "100,000+ Flora / 2,500+ Terrestrial Vertebrates",
      mammalCount: 1180, birdCount: 2950, fishCount: 5400, protectedPct: 15.6,
      biomassHeadline: "Spans from +8,849m Everest to −1,642m Lake Baikal & the Indo-Pacific Coral Triangle",
      creatures: [
        { emoji: "🐅", name: "Bengal & Amur (Siberian) Tiger", sci: "Panthera tigris", pop: "~5,574 wild tigers (70% in India)", stratum: "Alt: 0 – 4,500 m", desc: "Earth's largest wild felid; wild tiger numbers have risen by over 40% since 2010 across India, Nepal, Bhutan, and the Russian Far East." },
        { emoji: "🐼", name: "Giant Panda & Snow Leopard", sci: "Ailuropoda melanoleuca / Panthera uncia", pop: "~1,864 Wild Pandas / ~6,000 Snow Leopards", stratum: "Alt: 1,200 – 5,800 m", desc: "High-altitude icons of the Sichuan bamboo mountains and the Himalayan-Tibetan 'Third Pole'." },
        { emoji: "🐘", name: "Asian Elephant & Indian Rhinoceros", sci: "Elephas maximus / Rhinoceros unicornis", pop: "~50,000 Elephants / ~4,000 One-Horned Rhinos", stratum: "Alt: 0 – 3,000 m", desc: "Megaherbivores of the Terai arc, Western Ghats, and Borneo/Sumatra tropical rainforests." },
        { emoji: "🦧", name: "Bornean & Sumatran Orangutan", sci: "Pongo pygmaeus / Pongo abelii", pop: "~119,000 in Borneo & Sumatra", stratum: "Alt: 0 – 1,500 m Canopy", desc: "World's largest arboreal mammal and master tool-user of Southeast Asia's dipterocarp rainforests." },
        { emoji: "🦭", name: "Baikal Seal (Nerpa) & Whale Shark", sci: "Pusa sibirica / Rhincodon typus", pop: "~100,000 Baikal Seals", stratum: "Depth: 0 – 400 m", desc: "The Baikal Nerpa is the world's only purely freshwater pinnacle seal, thriving in Siberia's 25-million-year-old Lake Baikal." }
      ]
    };
  }
  if (c.iso3 === "SAM") {
    return {
      biome: "Amazonian Hyper-Diverse Tropical Rainforest, Andean Cordillera, Pantanal Wetland & Patagonian Steppe",
      maxElevM: 6961, maxElevName: "Aconcagua (Andes)", meanElevM: 590,
      maxDepthM: 8065, maxDepthName: "Peru-Chile (Atacama) Trench",
      speciesTotal: "90,000+ Vascular Plants / 10% of All Known Species on Earth",
      mammalCount: 1320, birdCount: 3430, fishCount: 5600, protectedPct: 24.8,
      biomassHeadline: "Home to ~390 Billion Amazonian Trees & the Highest Bird/Freshwater Fish Richness on Earth",
      creatures: [
        { emoji: "🐆", name: "Jaguar", sci: "Panthera onca", pop: "~173,000 across Amazon & Pantanal", stratum: "Alt: 0 – 2,000 m", desc: "Apex cat of the Americas with the strongest bite force relative to size of any felid, hunting caiman and capybara in flooded forests." },
        { emoji: "🦅", name: "Andean Condor & Harpy Eagle", sci: "Vultur gryphus / Harpia harpyja", pop: "~6,700 Condors / ~50,000 Harpy Eagles", stratum: "Alt: 0 – 5,500 m", desc: "Soaring on 3.3-meter wingspans across the Andes while Harpy Eagles rule the emergent Amazon canopy." },
        { emoji: "🐬", name: "Amazon Pink River Dolphin (Boto)", sci: "Inia geoffrensis", pop: "~100,000+ in Amazon & Orinoco", stratum: "Freshwater Flooded Forest (0 – 50 m)", desc: "Largest freshwater dolphin on Earth, navigating submerged rainforest trees using precision biosonar." },
        { emoji: "🦙", name: "Guanaco, Vicuña & Spectacled Bear", sci: "Vicugna vicugna / Tremarctos ornatus", pop: "~2M Guanacos / ~500K Vicuñas", stratum: "Alt: 2,500 – 5,000 m (Altiplano & Patagonia)", desc: "High-altitude camelids grazing up to 5,000 meters alongside South America's only native bear." },
        { emoji: "🐍", name: "Green Anaconda & Giant Otter", sci: "Eunectes murinus / Pteronura brasiliensis", pop: "Pantanal & Amazonian Semi-Aquatic Giants", stratum: "Alt: 0 – 500 m", desc: "The world's heaviest snake (up to 250 kg) shares oxbow lakes with 1.8-meter social river otters." }
      ]
    };
  }

  if (c.entityType === "ocean") {
    const depthMap = {
      "INDO": [7290, "Java (Sunda) Trench", 3741],
      "SOU": [7434, "South Sandwich Trench", 3270],
      "CARS": [7686, "Cayman Trough", 2200],
      "MEDS": [5267, "Calypso Deep (Hellenic Trench)", 1500]
    };
    const [maxD, maxDName, meanD] = depthMap[c.iso3] || [6000, "Deep Abyssal Trench", 3500];
    return {
      biome: `${c.name} Pelagic Photic Zone, Coral/Continental Margins & Deep Bathypelagic/Abyssal Basin`,
      maxElevM: 0, maxElevName: "Sea Level Surface", meanElevM: 0,
      maxDepthM: maxD, maxDepthName: maxDName,
      speciesTotal: "17,000 – 65,000+ Marine Species",
      mammalCount: 45, birdCount: 190, fishCount: 6800, protectedPct: 9.8,
      biomassHeadline: `Mean Depth ${meanD.toLocaleString()} m • Max Depth ${maxD.toLocaleString()} m at ${maxDName}`,
      creatures: [
        { emoji: "🐋", name: "Baleen & Toothed Cetaceans", sci: "Cetacea (Whales & Dolphins)", pop: "Hundreds of thousands across basin", stratum: "Depth: 0 – 2,000 m", desc: `Keystone marine mammals migrating across ${c.name}'s nutrient-rich upwelling currents and deep trenches.` },
        { emoji: "🦈", name: "Pelagic Sharks & Manta Rays", sci: "Elasmobranchii", pop: "Apex & Filter-Feeding Cartilaginous Fish", stratum: "Depth: 0 – 1,200 m", desc: "Maintain coral reef and open-ocean trophic balance across epipelagic and mesopelagic waters." },
        { emoji: "🐢", name: "Loggerhead, Green & Leatherback Sea Turtles", sci: "Cheloniidae / Dermochelys coriacea", pop: "Trans-Basin Navigators", stratum: "Depth: 0 – 1,280 m", desc: "Leatherback turtles dive deeper than 1,200 meters to feed on deep-sea jellyfish using backward-pointing esophageal spines." },
        { emoji: "🦑", name: "Mesopelagic Squid & Octopuses", sci: "Cephalopoda", pop: "Massive Mid-Water Biomass", stratum: "Depth: 200 – 3,000 m", desc: "Intelligent jet-propelled predators connecting twilight-zone plankton to apex whales and tuna." },
        { emoji: "🪼", name: "Abyssal Bioluminescent Cnidarians & Bentho-Fauna", sci: "Siphonophorae & Holothuroidea", pop: "Benthic & Bathypelagic Specialists", stratum: `Depth: 1,500 – ${maxD} m`, desc: `Survive extreme hydrostatic pressure (${Math.round(maxD / 10)} atm) and near-freezing 2°C bottom waters.` }
      ]
    };
  }

  const absLat = Math.abs(c.lat || 0);
  const isTropical = absLat < 23.5;
  const maxElev = c.landlocked ? 3400 : Math.min(6500, Math.round(800 + Math.sqrt(c.area || 1000) * 2.1));
  const meanElev = Math.round(maxElev * 0.22);
  const spRichness = isTropical ? Math.round(3500 + Math.sqrt(c.area || 1000) * 8) : Math.round(1800 + Math.sqrt(c.area || 1000) * 4);

  return {
    biome: `${c.subregion || c.region} ${isTropical ? "Tropical & Subtropical Ecosystems" : "Temperate, Montane & Coastal Biomes"}`,
    maxElevM: maxElev, maxElevName: `${c.name} Highest Summit`, meanElevM: meanElev,
    maxDepthM: c.landlocked ? 0 : 3200, maxDepthName: c.landlocked ? "Landlocked Interior" : `${c.region} Continental Margin`,
    speciesTotal: `${spRichness.toLocaleString()}+ Documented Flora & Fauna`,
    mammalCount: Math.min(650, Math.round(65 + Math.sqrt(c.area || 1000) * 0.18)),
    birdCount: Math.min(1800, Math.round(220 + Math.sqrt(c.area || 1000) * 0.45)),
    fishCount: c.landlocked ? 95 : Math.min(2500, Math.round(180 + Math.sqrt(c.area || 1000) * 0.35)),
    protectedPct: 16.5,
    biomassHeadline: `Human Density: ${(c.pop / Math.max(1, c.area)).toFixed(1)} /km² • ${c.urban}% Urban vs ${(100 - c.urban).toFixed(1)}% Natural & Rural Habitat`,
    creatures: [
      { emoji: isTropical ? "🐆" : "🐺", name: `${c.subregion || c.region} Apex Terrestrial Carnivore`, sci: isTropical ? "Panthera / Felidae" : "Canis / Ursidae / Felidae", pop: "Protected Regional Flagship", stratum: `Alt: 100 – ${Math.round(maxElev * 0.8)} m`, desc: `Top terrestrial predator regulating herbivore populations across ${c.name}'s forest and mountain reserves.` },
      { emoji: "🦌", name: "Native Ungulates & Forest Herbivores", sci: "Artiodactyla", pop: `Widespread across ${100 - Math.round(c.urban)}% non-urban land`, stratum: `Alt: 0 – ${Math.round(maxElev * 0.7)} m`, desc: `Keystone grazers and browsers shaping woodland and grassland habitats across ${c.name}.` },
      { emoji: "🦅", name: "Raptors & Migratory Avifauna", sci: "Accipitriformes & Waterfowl", pop: `${Math.min(1800, Math.round(220 + Math.sqrt(c.area || 1000) * 0.45))} recorded bird species`, stratum: "Alt: 0 – 3,500 m Flyway", desc: `${c.name} sits along major continental avian migration corridors connecting seasonal breeding and wintering wetlands.` },
      { emoji: c.landlocked ? "🐟" : "🐬", name: c.landlocked ? "Endemic Riverine & Alpine Freshwater Fish" : "Coastal Marine Cetaceans & Pelagic Fish", sci: c.landlocked ? "Cyprinidae & Salmonidae" : "Delphinidae & Teleostei", pop: c.landlocked ? "Watershed Indicators" : `${(c.coast || 0).toLocaleString()} km Coastline Habitat`, stratum: c.landlocked ? "Rivers & Lakes (0 – 100 m)" : "Depth: 0 – 600 m EEZ", desc: c.landlocked ? `Inhabit ${c.name}'s river basins and mountain streams.` : `Thrive along ${c.name}'s ${(c.coast || 0).toLocaleString()} km marine coastline and continental shelf.` },
      { emoji: "🌳", name: "Primary Old-Growth & Endemic Flora", sci: "Tracheophyta", pop: `${spRichness.toLocaleString()}+ vascular plant & animal taxa`, stratum: `Alt: 0 – ${Math.round(maxElev * 0.65)} m`, desc: `Primary carbon sink and habitat foundation supporting ${c.name}'s terrestrial food web.` }
    ]
  };
}

// ============================================================================
// MINI-WIKIPEDIA ENCYCLOPEDIA SYNTHESIZER
// ============================================================================
export function getEncyclopediaProfile(c, wikiDeepDb = {}) {
  if (!c) return null;
  const deep = (wikiDeepDb && wikiDeepDb.deep && wikiDeepDb.deep[c.iso3]) ? wikiDeepDb.deep[c.iso3] : null;
  const leaderTuple = (wikiDeepDb && wikiDeepDb.leaders && wikiDeepDb.leaders[c.iso3]) ? wikiDeepDb.leaders[c.iso3] : null;

  const capGdp = c.entityType === "ocean" ? 0 : Math.round((c.gdp * 1e9) / Math.max(1, c.pop));
  const pppGdp = (c.gdp * (capGdp > 35000 ? 1.15 : 2.15)).toFixed(1);

  const govType = (deep && deep.govType) ? deep.govType : (leaderTuple ? leaderTuple[0] : (c.entityType === "continent" ? "Continental Macro-Region of Sovereign States" : (c.entityType === "ocean" ? "International Maritime Basin (UNCLOS & Regional Conventions)" : `Sovereign Constitutional Republic / State (${c.subregion || c.region})`)));
  const headOfState = (deep && deep.headOfState) ? deep.headOfState : (leaderTuple ? leaderTuple[1] : (c.entityType === "continent" ? `Heads of State of ${(c.subregion || c.region).split("•")[0].trim()}` : (c.entityType === "ocean" ? "International Seabed Authority & Littoral States" : `President / Head of State of ${c.name} (${c.capital})`)));
  const headOfGov = (deep && deep.headOfGov) ? deep.headOfGov : (leaderTuple ? leaderTuple[2] : (c.entityType === "continent" ? "National Prime Ministers, Presidents & Regional Summits" : (c.entityType === "ocean" ? "Regional Maritime Commissions & Port Authorities" : `Prime Minister & Cabinet of Ministers (${c.capital})`)));
  const howLed = (deep && deep.howLed) ? deep.howLed : (leaderTuple ? leaderTuple[3] : (c.entityType === "continent" ? `${c.name} encompasses diverse constitutional democracies, parliamentary monarchies, and republics cooperating through continental treaties, trade blocs, and diplomatic forums.` : `Governed under the national constitution from ${c.capital}, with executive authority exercised by the Head of State and Cabinet of Ministers, legislative oversight by the National Parliament, and an independent judiciary.`));

  const alliances = (deep && deep.alliances) ? deep.alliances : (c.region === "Europe" ? "United Nations • OSCE • Council of Europe • European Regional Treaties" : `United Nations (UN) • ${c.region} Regional Union • WTO • IMF / World Bank`);
  const centralBank = (deep && deep.centralBank) ? deep.centralBank : `Central Bank / Monetary Authority of ${c.name} (${c.currency || "National Currency"})`;
  const hdi = (deep && deep.hdi) ? deep.hdi : (capGdp > 30000 ? "0.905 (Very High)" : (capGdp > 12000 ? "0.815 (Very High)" : (capGdp > 4500 ? "0.740 (High)" : "0.645 (Medium)")));
  const lifeExp = (deep && deep.lifeExp) ? deep.lifeExp : (capGdp > 25000 ? "81.2 years" : (capGdp > 8000 ? "75.6 years" : "69.4 years"));
  const medianAge = (deep && deep.medianAge) ? deep.medianAge : (c.region === "Europe" ? "42.5 years" : (c.region === "Africa" ? "21.4 years" : "33.8 years"));

  const financeOverview = (deep && deep.financeOverview) ? deep.financeOverview :
    `${c.name} generates a Nominal GDP of $${c.gdp >= 1000 ? (c.gdp / 1000).toFixed(2) + " Trillion" : c.gdp.toFixed(1) + " Billion"} (~$${pppGdp}B PPP)${c.entityType === "ocean" ? " in annual blue-economy maritime trade, fisheries, and offshore energy" : `, equating to $${capGdp.toLocaleString()} per capita`}. Key economic pillars span ${c.urban > 70 ? "advanced services, financial banking, technology, manufacturing, and international trade" : "manufacturing, energy, agriculture, natural resources, tourism, and regional commerce"} centered around ${c.capital}.`;

  const historySummary = (deep && deep.historySummary) ? deep.historySummary :
    `From ancient indigenous civilizations and classical trade routes across ${c.subregion || c.region}, ${c.name} developed a distinct linguistic and cultural heritage centered around ${c.capital}. Through centuries of state formation, constitutional evolution, and modern sovereignty, ${c.name} has grown into a key entity of ${c.region}.`;

  const timeline = (deep && deep.timeline) ? deep.timeline : [
    { era: "Antiquity & Classical Era", title: `Early Civilizations of ${c.name}`, desc: `Early settlements, agricultural kingdoms, and trade networks shape the cultural foundations of ${c.subregion || c.region}.` },
    { era: "Medieval – 18th Century", title: "Historical Principalities, Trade & Cultural Identity", desc: `Development of historic architecture, legal traditions, and linguistic heritage (${c.languages || "native languages"}) around ${c.capital}.` },
    { era: "19th – 20th Century", title: "Modern Statehood & Constitutional Sovereignty", desc: `Consolidation of national borders (${Math.round(c.area).toLocaleString()} km²), modern infrastructure, and constitutional governance.` },
    { era: "Present Era", title: `Contemporary ${c.name} in the 21st Century`, desc: `A modern society with a $${c.gdp >= 1000 ? (c.gdp / 1000).toFixed(2) + "T" : c.gdp.toFixed(1) + "B"} economy.` }
  ];

  const food = (deep && deep.food) ? deep.food : [
    { emoji: "🍲", name: `Traditional ${c.demonym || c.name} National Feast & Slow-Simmered Stew`, desc: `Signature aromatic dish of ${c.name} prepared with local herbs, seasonal meats or seafood, and regional grains.` },
    { emoji: "🥟", name: `Artisanal Street Delicacies of ${c.capital}`, desc: `Beloved savory pastries, grilled skewers, and market specialties enjoyed across ${c.capital}'s historic quarters.` },
    { emoji: "🍰", name: `Festive ${c.demonym || c.name} Pastries & Heritage Beverages`, desc: `Traditional holiday sweets paired with indigenous wines, roasted coffee, herbal infusions, or local spirits.` }
  ];

  const attractions = (deep && deep.attractions) ? deep.attractions : [
    { emoji: "🏛️", name: `Historic Center & Monumental Quarter of ${c.capital}`, loc: c.capital, desc: `Architectural heart of ${c.name}, housing national museums, parliament palaces, and centuries-old plazas.` },
    { emoji: "🏞️", name: `${c.name} National Parks & UNESCO Natural Reserves`, loc: c.subregion || c.region, desc: `Protected landscapes spanning ${Math.round(c.area).toLocaleString()} km² of mountains, river valleys, and biodiverse ecosystems.` },
    { emoji: "🏰", name: "Ancient Fortresses, Sacred Temples & UNESCO Heritage Sites", loc: `Historic Regions of ${c.name}`, desc: `Iconic cultural monuments preserving the artistic and spiritual legacy of ${c.name}.` }
  ];

  const activities = (deep && deep.activities) ? deep.activities : [
    `Explore the historic boulevards, museums, and culinary markets of ${c.capital}.`,
    `Hike and photograph the scenic national parks and mountain/coastal trails across ${c.name}.`,
    `Taste authentic ${c.demonym || c.name} gastronomy and regional specialties at traditional family-run taverns.`,
    "Experience local cultural festivals, live music, and UNESCO heritage landmarks."
  ];

  const curiosities = (deep && deep.curiosities) ? deep.curiosities : [
    `${c.name} covers ${Math.round(c.area).toLocaleString()} km² with a density of ${(c.pop / Math.max(1, c.area)).toFixed(1)} per km².`,
    `Its hub ${c.capital} is located at coordinates ${Math.abs(c.capLat).toFixed(2)}°${c.capLat >= 0 ? "N" : "S"}, ${Math.abs(c.capLng).toFixed(2)}°${c.capLng >= 0 ? "E" : "W"}.`,
    `${c.landlocked ? c.name + " is one of the world's sovereign landlocked nations." : c.name + " features " + (c.coast || 0).toLocaleString() + " km of maritime coastline."}`
  ];

  return {
    govType, headOfState, headOfGov, howLed, alliances, centralBank,
    hdi, lifeExp, medianAge, capGdp, pppGdp,
    financeOverview, historySummary, timeline, food, attractions, activities, curiosities
  };
}

// ============================================================================
// GLOBAL TAXATION, BUSINESS ENTITIES (PFA / MICRO / SRL / LLC) & NET ENGINE
// ============================================================================
const LEGAL_FAMILY_TEMPLATES = {
  ROMANCE: {
    freelanceCode: "PFA-IND",
    freelanceName: "PFA / Independent Authorized Professional",
    microCode: "SRL-MICRO",
    microName: "Micro-SRL (Simplified Small Limited Liability)",
    corpCode: "SRL-STD",
    corpName: "SRL (Societate cu Răspundere Limitată / Standard LLC)",
    jointCode: "SA-CORP",
    jointName: "S.A. (Joint-Stock Corporation)"
  },
  GERMANIC: {
    freelanceCode: "EINZEL-PRO",
    freelanceName: "Einzelunternehmen / Freiberufler (Sole Proprietor)",
    microCode: "SME-GMBH",
    microName: "UG / Klein-GmbH (Small Limited Liability Tier)",
    corpCode: "GMBH-STD",
    corpName: "GmbH (Gesellschaft mit beschränkter Haftung)",
    jointCode: "AG-CORP",
    jointName: "AG (Aktiengesellschaft — Public Stock Corp)"
  },
  COMMON: {
    freelanceCode: "SOLE-TRADER",
    freelanceName: "Sole Trader / Independent Contractor",
    microCode: "LTD-SMALL",
    microName: "Private Limited Company (Ltd — SME / Small Profits Tier)",
    corpCode: "LLP-PARTNER",
    corpName: "LLP (Limited Liability Partnership)",
    jointCode: "LTD-PLC",
    jointName: "Ltd / PLC (Standard Corporate Rate)"
  },
  FRANCO: {
    freelanceCode: "AUTO-ENT",
    freelanceName: "Auto-Entrepreneur / Entreprise Individuelle",
    microCode: "SARL-PME",
    microName: "EURL / SARL Unipersonnelle (SME Reduced Tier)",
    corpCode: "SAS-STD",
    corpName: "SAS / SARL (Société par Actions Simplifiée)",
    jointCode: "SA-CORP",
    jointName: "S.A. (Société Anonyme)"
  },
  CEE: {
    freelanceCode: "SOLE-ENT",
    freelanceName: "Registered Sole Entrepreneur (OSVČ / FOP / IP / s.p.)",
    microCode: "MICRO-SRO",
    microName: "Simplified / Micro LLC (s.r.o. / d.o.o. / OOO SME Tier)",
    corpCode: "STD-SRO",
    corpName: "Standard Limited Liability (s.r.o. / d.o.o. / DOO)",
    jointCode: "AS-CORP",
    jointName: "Joint-Stock Company (a.s. / d.d.)"
  },
  NORDIC: {
    freelanceCode: "SOLE-FIRM",
    freelanceName: "Sole Proprietorship (Enskild Firma / Enkeltpersonforetak)",
    microCode: "SME-AB",
    microName: "Private Limited SME (AB / AS / Oy / UAB / SIA)",
    corpCode: "HOLD-AB",
    corpName: "Holding + Operating Limited Company (Participation Exemption)",
    jointCode: "PUB-ASA",
    jointName: "Public Limited Corporation (ASA / Oyj / AB publ)"
  },
  ISLAMIC_GULF: {
    freelanceCode: "FREELANCE-PERMIT",
    freelanceName: "Licensed Freelance Professional / Sole Establishment",
    microCode: "FZ-LLC",
    microName: "Free Zone LLC / Small Business Relief Entity",
    corpCode: "MAIN-WLL",
    corpName: "Mainland LLC / W.L.L. (With Limited Liability)",
    jointCode: "PJSC-CORP",
    jointName: "PJSC / Joint-Stock Holding Company"
  },
  HISPANIC: {
    freelanceCode: "AUTONOMO-MONO",
    freelanceName: "Autónomo / Monotributo / Persona Física con Actividad Empresarial",
    microCode: "SAS-PYME",
    microName: "S.A.S. / S.R.L. Régimen Pyme / Simplificado",
    corpCode: "SRL-LTDA",
    corpName: "S.R.L. / Sociedad Limitada (Standard Commercial LLC)",
    jointCode: "SA-CORP",
    jointName: "S.A. (Sociedad Anónima)"
  }
};

function inferRegionalStatutoryTuple(c) {
  const sub = (c.subregion || "").toLowerCase();
  const reg = (c.region || "").toLowerCase();
  const langs = (c.languages || "").toLowerCase();

  if (sub.includes("western asia") || sub.includes("middle east")) {
    return [15.0, 10.0, 5.0, 9.0, 15.0, 5.0, 10.0, 5.0, "ISLAMIC_GULF", `Ministry of Finance & Tax Authority of ${c.name}`];
  }
  if (reg === "europe") {
    if (sub.includes("eastern") || sub.includes("southern")) {
      return [20.0, 16.0, 14.0, 17.0, 16.0, 9.0, 20.0, 10.0, "CEE", `National Revenue & Fiscal Administration of ${c.name}`];
    }
    return [42.0, 28.0, 13.0, 19.0, 22.0, 18.0, 21.0, 22.0, "GERMANIC", `National Tax Administration of ${c.name}`];
  }
  if (reg === "americas") {
    if (sub.includes("caribbean")) {
      return [22.0, 14.0, 5.0, 7.5, 20.0, 5.0, 12.5, 5.0, "COMMON", `Inland Revenue Department of ${c.name}`];
    }
    return [30.0, 19.0, 9.5, 16.5, 27.0, 10.0, 16.0, 10.0, "HISPANIC", `Dirección General de Impuestos (${c.name})`];
  }
  if (reg === "africa") {
    const fam = langs.includes("french") ? "FRANCO" : (langs.includes("portuguese") ? "ROMANCE" : "COMMON");
    return [30.0, 21.0, 6.5, 13.5, 27.0, 4.0, 16.0, 10.0, fam, `General Revenue Authority of ${c.name}`];
  }
  if (reg === "oceania") {
    return [30.0, 19.0, 4.0, 6.0, 22.0, 15.0, 12.5, 10.0, "COMMON", `Customs & Inland Revenue Service of ${c.name}`];
  }
  // Asia default
  return [25.0, 16.5, 7.0, 11.0, 20.0, 10.0, 10.0, 10.0, "COMMON", `National Revenue & Taxation Authority of ${c.name}`];
}

/**
 * Synthesizes or retrieves a complete Personal & Business Entity (PFA / Micro / SRL / LLC / Corp)
 * taxation dossier for all 220 entities (204 countries incl. Antarctica, 8 continents, 8 oceans).
 */
export function getTaxProfile(c, taxesDb = {}) {
  if (!c) return null;

  // 1. Deep Curated Country Profile (ROU, USA, GBR, DEU, FRA, ITA, ESP, POL, HUN, NLD, IRL, CYP, MDA, ARE, CHE, EST, BGR, SGP, CAN, AUS, JPN, IND, BRA, CHN)
  if (taxesDb && taxesDb.curated && taxesDb.curated[c.iso3]) {
    return taxesDb.curated[c.iso3];
  }

  // 2. Antarctica (Polar Scientific Treaty Regime)
  if (c.iso3 === "ATA" || c.iso3 === "ANTC") {
    return {
      taxAuthority: "Antarctic Treaty System (1959) — Home-State Flag Fiscal Jurisdiction",
      currencyCode: "USD / Home Currency",
      taxYear: "Antarctic Treaty Article IV Sovereign Protocol",
      pitHeadline: "0% Local Territorial Tax (Home-Country Tax / Foreign Earned Income Exclusion)",
      pitRate: 0.0,
      pitSystem: "No indigenous tax authority; expedition personnel taxed by sponsoring country (often 0% via polar/FEIE exemptions)",
      employeeSocialRate: 0.0,
      employeeSocialBreakdown: "0% Antarctic levy (home-agency social security coverage applies)",
      employerPayrollRate: 0.0,
      employerPayrollBreakdown: "0% Antarctic payroll duty",
      vatStandard: 0.0,
      vatReduced: "0% VAT / 0% Customs Duty on scientific supplies, fuel, and expedition logistics",
      dividendTaxRate: 0.0,
      dividendNotes: "0% local withholding tax",
      capitalGainsRate: "0% local territorial tax (Madrid Protocol bans commercial mineral mining until 2048)",
      propertyTax: "0% (No private land ownership permitted under the Antarctic Treaty)",
      entities: [
        {
          code: "ATA-SCI",
          name: "Expeditionary Scientist / Contractor (FEIE / Polar Grant)",
          badge: "0% LOCAL TAX",
          turnoverCap: "Sponsored by 57 Antarctic Treaty Nations",
          corporateTaxRate: 0.0,
          dividendRate: 0.0,
          effectiveAt100k: 0.0,
          summary: "0% Antarctic territorial income tax. Many researchers and support contractors qualify for tax-free scientific stipends or Foreign Earned Income Exclusions (e.g. up to $130,000 USD under IRC § 911 depending on home-court status).",
          bestFor: "Glaciologists, astrophysicists, marine biologists, and polar station engineers."
        },
        {
          code: "ATA-SUPPORT-LLC",
          name: "Polar Logistics & Expedition Support Contractor LLC / SRL",
          badge: "HOME-FLAG CIT",
          turnoverCap: "Government & National Science Foundation Contracts",
          corporateTaxRate: 15.0,
          dividendRate: 0.0,
          effectiveAt100k: 15.0,
          summary: "0% Antarctic customs, VAT, or establishment tax; corporate profits are taxed solely in the contractor's country of incorporation (e.g. Chile, New Zealand, USA, UK, Norway).",
          bestFor: "Icebreaker operators, polar aviation, and station engineering contractors."
        },
        {
          code: "ATA-IAATO",
          name: "IAATO Polar Expedition Vessel Registry (Tonnage Tax)",
          badge: "0% – 2% TONNAGE REGIME",
          turnoverCap: "Strict IAATO 100-passenger shore-landing cap",
          corporateTaxRate: 2.0,
          dividendRate: 0.0,
          effectiveAt100k: 2.5,
          summary: "Expedition cruise vessels operating in Antarctic waters typically sail under international maritime Tonnage Tax regimes paying fixed per-tonnage fees rather than standard CIT.",
          bestFor: "Polar expedition vessels departing Ushuaia, Punta Arenas, or Hobart."
        }
      ],
      calcModel: { empTaxRate: 0.08, freelanceEffective100k: 0.05, microEffective100k: 0.025, corpEffective100k: 0.15 }
    };
  }

  // 3. Oceans & Seas (UNCLOS International Maritime & Open-Registry Tonnage Tax Framework)
  if (c.entityType === "ocean") {
    return {
      taxAuthority: "UNCLOS High-Seas Regime • IMO • International Seabed Authority (ISA)",
      currencyCode: "USD / SDR (Special Drawing Rights)",
      taxYear: "2025 / 2026 International Maritime Tonnage Tax Code",
      pitHeadline: "0% High-Seas Seafarer PIT (Flag-State / Seafarers' Earnings Deduction)",
      pitRate: 0.0,
      pitSystem: "0% PIT for qualifying international seafarers (>183 days at sea under UK SED, Philippines OFW, Singapore & EU Tonnage rules)",
      employeeSocialRate: 0.0,
      employeeSocialBreakdown: "0% High-Seas levy (Maritime Labour Convention MLC shipowner medical & repatriation protection)",
      employerPayrollRate: 1.5,
      employerPayrollBreakdown: "~1% – 2% Maritime Welfare & P&I Crew Insurance contribution",
      vatStandard: 0.0,
      vatReduced: "0% VAT / 0% Excise on International Marine Bunkers, Provisioning & High-Seas Freight",
      dividendTaxRate: 0.0,
      dividendNotes: "0% Dividend Withholding Tax across Open Maritime Registries (Panama, Liberia, Marshall Islands, Cyprus, Malta)",
      capitalGainsRate: "0% Capital Gains Tax on Vessel Transfers & Shipping SPV Shares under Open Registries",
      propertyTax: "Annual Vessel Net Tonnage Registry Fee (~$0.10 – $0.40 per Net Ton)",
      entities: [
        {
          code: "MAR-SEAFARER",
          name: "International Merchant Officer / Marine Contractor",
          badge: "0% SEAFARER EXEMPTION",
          turnoverCap: "≥ 183 days international voyage / year",
          corporateTaxRate: 0.0,
          dividendRate: 0.0,
          effectiveAt100k: 0.0,
          summary: "0% Personal Income Tax across major maritime nations (UK Seafarers' Earnings Deduction, Filipino OFW exemption, Cyprus/Malta/Singapore crew rules) for officers and marine specialists working aboard international vessels.",
          bestFor: "Master mariners, marine engineers, subsea ROV pilots, and oceanographers."
        },
        {
          code: "MAR-OPEN-IBC",
          name: "Open-Registry Shipping SPV / IBC (Panama • Liberia • Marshall Is.)",
          badge: "0% SHIPPING PROFIT TAX",
          turnoverCap: "Unlimited Global Freight & Charter Revenue",
          corporateTaxRate: 0.0,
          dividendRate: 0.0,
          effectiveAt100k: 1.2,
          summary: "0% Corporate Income Tax and 0% Dividend Tax on international maritime freight/chartering! Vessels pay only a flat annual Net Tonnage registration fee (~$1,200–$6,500/yr depending on tonnage).",
          bestFor: "Container lines, LNG/tanker SPVs, bulk carriers, and superyacht holdings."
        },
        {
          code: "MAR-EU-TONNAGE",
          name: "EU Approved Tonnage Tax Ltd (Cyprus • Malta • Greece • Netherlands)",
          badge: "1% – 2.5% EFFECTIVE",
          turnoverCap: "Qualifying EU/EEA Maritime Fleet Operations",
          corporateTaxRate: 2.0,
          dividendRate: 0.0,
          effectiveAt100k: 2.2,
          summary: "Replaces standard 12.5%–25% Corporate Tax with a tiny fixed tax based purely on ship net tonnage, regardless of how high actual shipping profits soar, with 0% dividend WHT!",
          bestFor: "European shipowners, ship-management hubs, and dredging/offshore wind fleets."
        },
        {
          code: "MAR-EEZ-ISA",
          name: "200-NM EEZ Offshore Energy / ISA Seabed Consortium",
          badge: "COASTAL CIT + ROYALTY",
          turnoverCap: `Littoral EEZ & ${c.name} Basin Concessions`,
          corporateTaxRate: 18.0,
          dividendRate: 5.0,
          effectiveAt100k: 21.5,
          summary: `Offshore wind, subsea cables, fisheries, and energy platforms inside the 200-nautical-mile Exclusive Economic Zone pay coastal-state CIT, while deep-seabed resources beyond 200 NM fall under UNCLOS International Seabed Authority (ISA) revenue-sharing.`,
          bestFor: "Offshore wind developers, subsea fiber-optic operators, and pelagic fisheries."
        }
      ],
      calcModel: { empTaxRate: 0.015, freelanceEffective100k: 0.015, microEffective100k: 0.018, corpEffective100k: 0.045 }
    };
  }

  // 4. Continents & EU-27 Macro-Blocs (Weighted Continental Benchmark & Cross-Border Vehicles)
  if (c.entityType === "continent") {
    const contProfiles = {
      "EU27": [42.8, 29.5, 14.5, 22.5, 21.2, 9.0, 21.6, 15.0, "EU-27 Single Market (Parent-Subsidiary 0% WHT • VAT Directive • 9% HU / 10% BG / 1%–3% RO Micro to 29.9% DE)"],
      "EUR":  [41.5, 28.0, 13.8, 21.0, 20.5, 9.0, 20.8, 15.0, "European Tax Authorities (EU-27 + UK HMRC + Swiss Cantons + EEA)"],
      "NAMC": [35.0, 24.5, 7.6, 8.5, 23.5, 12.2, 5.5, 15.0, "USMCA & Caribbean Authorities (IRS USA • CRA Canada • SAT Mexico • 0% Caribbean IFCs)"],
      "SAM":  [33.0, 21.5, 12.5, 19.0, 28.0, 8.5, 18.0, 7.0, "Mercosur & Andean Revenue Agencies (0% Brazil Dividend • 10% Paraguay • 0% Uruguay Software Export)"],
      "ASIA": [32.0, 17.5, 8.0, 13.5, 20.0, 6.5, 10.5, 10.0, "Asian Fiscal Regimes (0% UAE/Gulf • 17% Singapore • 16.5% HK • 5% China SLPE • 44ADA India)"],
      "AFR":  [31.5, 21.5, 7.0, 13.5, 26.5, 3.5, 16.0, 10.0, "AfCFTA Continental Fiscal Systems (15% Mauritius • 0% Nigeria Small Ltd • 1%–3% SME Turnover Regimes)"],
      "OCE":  [39.0, 24.5, 2.5, 8.5, 26.5, 25.0, 11.5, 10.0, "Oceania Revenue Authorities (ATO Australia • IRD New Zealand • Pacific Island Regimes)"]
    };
    const [pitTop, pitEff, empSoc, erSoc, citStd, citSmall, vat, divTax, authDesc] =
      contProfiles[c.iso3] || contProfiles["EUR"];
    const isEU = c.iso3 === "EU27" || c.iso3 === "EUR";

    return {
      taxAuthority: authDesc,
      currencyCode: c.currency || "Multi-Currency (USD / EUR)",
      taxYear: "2025 / 2026 Continental Statutory Benchmark",
      pitHeadline: `~${pitTop}% Avg Top Bracket (${isEU ? "10% Flat in RO/BG to 52% DK/SE" : "Weighted Continental Benchmark"})`,
      pitRate: pitTop,
      pitSystem: isEU
        ? "Mix of Flat-Tax Eastern EU Members (10% Bulgaria & Romania, 15% Hungary) and Progressive Western/Nordic Brackets"
        : `Continental spectrum of progressive and flat/territorial personal tax systems across ${c.name}`,
      employeeSocialRate: empSoc,
      employeeSocialBreakdown: `~${empSoc}% Continental average employee pension & healthcare deduction`,
      employerPayrollRate: erSoc,
      employerPayrollBreakdown: `~${erSoc}% Continental average employer social security contribution`,
      vatStandard: vat,
      vatReduced: `~${vat}% Average Standard VAT / GST (Reduced tiers 0% – 10% on essentials)`,
      dividendTaxRate: divTax,
      dividendNotes: isEU
        ? "0% Intra-EU Corporate Dividend Withholding under EU Parent-Subsidiary Directive (0% CY Non-Dom / 5% BG / 10% RO personal)"
        : `~${divTax}% regional average personal dividend withholding (0% in territorial/imputation hubs)`,
      capitalGainsRate: isEU
        ? "0% (CH, CY, BE, >1yr DE Crypto/Gold, regulated BG) up to 26%–34% across Western Europe"
        : `0% – 25% across ${c.name} jurisdictions (often 0% or 50%-discounted on long-term holdings)`,
      propertyTax: "0.1% – 1.8% municipal cadastral or land value tax",
      entities: [
        {
          code: `${c.iso3}-FREELANCE`,
          name: isEU ? "Freelancer / Sole Prop (PFA • JDG Ryczałt • Forfettario • Auto-Entrepreneur)" : `${c.name} Independent Contractor / Sole Proprietor`,
          badge: "SIMPLIFIED FREELANCE",
          turnoverCap: "Varies by Member State (€25k – €2M simplified caps)",
          corporateTaxRate: Number((pitEff * 0.65).toFixed(1)),
          dividendRate: 0.0,
          effectiveAt100k: Number((pitEff * 0.72).toFixed(1)),
          summary: isEU
            ? "Across Europe, solo professionals utilize specialized low-tax regimes like Romania's PFA (10% + capped CAS/CASS), Italy's 5% Forfettario, Poland's 12% IT Ryczałt, Bulgaria's 7.5% effective freelance tax, or France's Micro-Entrepreneur."
            : `Direct pass-through or simplified presumptive sole-proprietor regimes across ${c.name} with streamlined bookkeeping and 0% dividend layer.`,
          bestFor: "Independent contractors, remote engineers, consultants, and solo creators."
        },
        {
          code: `${c.iso3}-MICRO`,
          name: isEU ? "Micro-Company / SME Optimizer (RO Micro 1%–3% • PL 9% • EE 0% OÜ • HU 9% Kft)" : `${c.name} Small Business / Micro-LLC Regime`,
          badge: `${citSmall}% SME / MICRO TIER`,
          turnoverCap: "SME / Micro statutory revenue thresholds",
          corporateTaxRate: citSmall,
          dividendRate: Number((divTax * 0.65).toFixed(1)),
          effectiveAt100k: Number((citSmall + (100 - citSmall) * (divTax * 0.65) / 100).toFixed(1)),
          summary: isEU
            ? "Small limited companies benefit from preferential EU regimes: Romania Micro-SRL (1% or 3% turnover), Estonia/Latvia OÜ/SIA (0% retained profit tax), Hungary Kft (9% CIT), Poland Sp. z o.o. (9% small CIT), and Cyprus/Ireland (12.5% CIT)."
            : `Preferential small-business corporate tier (~${citSmall}% benchmark) designed for startups, agencies, and high-margin SMEs across ${c.name}.`,
          bestFor: "Startups, software studios, agencies, and small limited-liability businesses."
        },
        {
          code: `${c.iso3}-STD-CORP`,
          name: isEU ? "Standard LLC & Societas Europaea (SRL • GmbH • SAS • Ltd • SE)" : `${c.name} Standard Corporation (LLC / C-Corp / Ltda / Pte Ltd)`,
          badge: `${citStd}% AVG CORP TAX`,
          turnoverCap: "Unlimited (Cross-border treaty network)",
          corporateTaxRate: citStd,
          dividendRate: divTax,
          effectiveAt100k: Number((citStd + (100 - citStd) * (divTax * 0.5) / 100).toFixed(1)),
          summary: `Continental weighted headline Corporate Income Tax averages ~${citStd}%, paired with R&D tax credits, IP Box regimes, and holding participation exemptions.`,
          bestFor: "Scaling enterprises, cross-border holdings, and multinational subsidiaries."
        }
      ],
      calcModel: {
        empTaxRate: Number(Math.min(0.52, (pitEff * 0.72 + empSoc) / 100).toFixed(3)),
        freelanceEffective100k: Number((pitEff * 0.72 / 100).toFixed(3)),
        microEffective100k: Number(((citSmall + (100 - citSmall) * (divTax * 0.65) / 100) / 100).toFixed(3)),
        corpEffective100k: Number(((citStd + (100 - citStd) * (divTax * 0.65) / 100) / 100).toFixed(3))
      }
    };
  }

  // 5. Statutory Lookup Table (77 countries) or Regional Legal-Tradition Inference (remaining countries)
  const tuple = (taxesDb && taxesDb.statutory && taxesDb.statutory[c.iso3])
    ? taxesDb.statutory[c.iso3]
    : inferRegionalStatutoryTuple(c);

  const [pitTop, pitEff100k, empSoc, erSoc, citStd, citSmall, vatStd, divTax, famKey, authName] = tuple;
  const tpl = LEGAL_FAMILY_TEMPLATES[famKey] || LEGAL_FAMILY_TEMPLATES.COMMON;
  const isFlatPit = pitTop > 0 && Math.abs(pitTop - pitEff100k) <= 2.5;
  const currCode = c.currency ? c.currency.split(" ")[0] : "Local / USD";

  const empCombined = Math.min(56, Number((pitEff100k * 0.78 + empSoc).toFixed(1)));
  const freelanceEff = Math.max(0, Number(Math.min(46, pitEff100k * 0.74 + Math.min(empSoc, 11) * 0.65).toFixed(1)));
  const microEff = Math.max(0, Number((citSmall + (100 - citSmall) * (divTax * 0.75) / 100).toFixed(1)));
  const corpEff = Math.max(0, Number((citStd * 0.9 + (100 - citStd * 0.9) * (divTax * 0.85) / 100).toFixed(1)));

  return {
    taxAuthority: authName,
    currencyCode: currCode,
    taxYear: `2025 / 2026 ${c.name} Fiscal Code`,
    pitHeadline: pitTop === 0
      ? "0% Personal Income Tax"
      : (isFlatPit ? `${pitTop}% Flat Personal Income Tax` : `0% – ${pitTop}% Progressive Personal Income Tax`),
    pitRate: pitTop,
    pitSystem: pitTop === 0
      ? "0% Tax-Free Personal Income Regime"
      : (isFlatPit ? `${pitTop}% Flat Rate System` : `Progressive statutory brackets up to ${pitTop}% (~${pitEff100k}% effective PIT before social levies)`),
    employeeSocialRate: empSoc,
    employeeSocialBreakdown: empSoc === 0
      ? "0% mandatory employee payroll deduction for expatriates/residents"
      : `${empSoc}% Employee pension, health & social insurance contribution`,
    employerPayrollRate: erSoc,
    employerPayrollBreakdown: erSoc === 0
      ? "0% employer payroll tax"
      : `${erSoc}% Employer statutory social security & payroll contribution`,
    vatStandard: vatStd,
    vatReduced: vatStd === 0
      ? "0% VAT / Sales Tax"
      : `${vatStd}% Standard VAT / GST (Reduced/0% rates on exports, basic food, healthcare & books)`,
    dividendTaxRate: divTax,
    dividendNotes: divTax === 0
      ? "0% Dividend Withholding Tax on distributed corporate profits!"
      : `${divTax}% Dividend Withholding Tax (often reduced to 0%–5% under Double Tax Treaties)`,
    capitalGainsRate: divTax === 0 && pitTop === 0
      ? "0% Capital Gains Tax"
      : `~${Math.min(pitTop || 15, Math.max(divTax, 10))}% Standard Capital Gains Rate (exemptions often apply to long-term listed equities)`,
    propertyTax: "0.1% – 1.2% municipal real estate / cadastral assessment",
    entities: [
      {
        code: `${c.iso3}-${tpl.freelanceCode}`,
        name: `${tpl.freelanceName}`,
        badge: "FREELANCER / SOLE PROP",
        turnoverCap: `Simplified sole-trader registration in ${c.name}`,
        corporateTaxRate: Number((pitEff100k * 0.75).toFixed(1)),
        dividendRate: 0.0,
        effectiveAt100k: freelanceEff,
        summary: `Direct personal business registration under ${authName}. Net profit after statutory business expense deductions is taxed at personal rates (~${freelanceEff}% all-in effective at $100k) with 0% dividend withholding.`,
        bestFor: "Independent contractors, digital consultants, freelancers, and solo specialists."
      },
      {
        code: `${c.iso3}-${tpl.microCode}`,
        name: `${tpl.microName}`,
        badge: citSmall < citStd ? `${citSmall}% SME / MICRO TIER` : `${citSmall}% SMALL LLC`,
        turnoverCap: "Statutory Micro / SME annual revenue ceiling",
        corporateTaxRate: citSmall,
        dividendRate: divTax,
        effectiveAt100k: microEff,
        summary: citSmall < citStd
          ? `Preferential ${citSmall}% Micro / Small-Business tax regime (vs ${citStd}% standard CIT) + ${divTax}% dividend tax, yielding ~${microEff}% total effective tax to personal pocket.`
          : `Streamlined SME limited-liability vehicle taxed at ${citSmall}% corporate rate (0% while profits are reinvested inside the company) + ${divTax}% upon dividend payout.`,
        bestFor: "High-margin startups, software/service agencies, and small limited-liability companies."
      },
      {
        code: `${c.iso3}-${tpl.corpCode}`,
        name: `${tpl.corpName}`,
        badge: `${citStd}% STANDARD CORP`,
        turnoverCap: "Unlimited commercial turnover",
        corporateTaxRate: citStd,
        dividendRate: divTax,
        effectiveAt100k: corpEff,
        summary: `Primary commercial limited-liability entity in ${c.name}: ${citStd}% Corporate Income Tax on net profit after salaries, equipment & R&D deductions + ${divTax}% dividend withholding.`,
        bestFor: "Scaling commercial enterprises, employers, and international subsidiaries."
      },
      {
        code: `${c.iso3}-${tpl.jointCode}`,
        name: `${tpl.jointName}`,
        badge: "LARGE / PUBLIC CORP",
        turnoverCap: "Institutional share capital & multi-shareholder governance",
        corporateTaxRate: citStd,
        dividendRate: divTax,
        effectiveAt100k: corpEff,
        summary: `Full joint-stock corporate architecture (${citStd}% CIT) eligible for institutional equity issuance, holding participation exemptions, and double-taxation treaty relief.`,
        bestFor: "Large industrial corporations, financial institutions, and listed enterprises."
      }
    ],
    calcModel: {
      empTaxRate: Number((empCombined / 100).toFixed(3)),
      freelanceEffective100k: Number((freelanceEff / 100).toFixed(3)),
      microEffective100k: Number((microEff / 100).toFixed(3)),
      corpEffective100k: Number((corpEff / 100).toFixed(3))
    }
  };
}

/**
 * Computes an exact Gross-to-Net Take-Home Breakdown for any of the 220 entities
 * across any annual gross income/revenue ($10,000 – $500,000+) and 4 universal regimes:
 * - 'employee'   : Gross Employee Salary (CIM / W-2 / PAYE)
 * - 'freelancer' : Solo Freelancer / Sole Prop (PFA Sistem Real / 1099 / Autónomo / JDG)
 * - 'micro'      : Micro-Company / Small Corp Optimizer (SRL Micro 1%–3% / S-Corp / Sp. z o.o. 9% / OÜ)
 * - 'corporate'  : Standard LLC / Corporation + Dividend Extraction (SRL 16% / C-Corp / GmbH / Ltd)
 */
export function calculateTaxScenario(country, taxProfile, grossUsd = 100000, regimeKey = "micro") {
  const gross = Math.max(1000, Math.round(Number(grossUsd) || 100000));
  const tp = taxProfile || getTaxProfile(country);
  const cm = tp.calcModel || { empTaxRate: 0.30, freelanceEffective100k: 0.24, microEffective100k: 0.18, corpEffective100k: 0.26 };

  // Special exact statutory calculator for Romania (ROU) so PFA, Micro 1%/3%, SRL 16%, and CIM match ANAF rules!
  if (country && country.iso3 === "ROU") {
    const minWageMonthlyUsd = 880; // ~4,050 RON/month gross minimum wage (~$880 USD/mo; 12 wages = $10,560/yr)
    const minWageAnnualUsd = 12 * minWageMonthlyUsd;
    if (regimeKey === "employee") {
      const cas = Math.round(gross * 0.25);
      const cass = Math.round(gross * 0.10);
      const pit = Math.round((gross - cas - cass) * 0.10);
      const totalTax = cas + cass + pit;
      return {
        gross,
        netTakeHome: gross - totalTax,
        totalTax,
        primaryTax: pit,
        primaryLabel: "10% Income Tax (IV)",
        secondaryTax: cas + cass,
        secondaryLabel: "CAS 25% + CASS 10%",
        employerExtraCost: Math.round(gross * 0.0225),
        effectiveRatePct: Number(((totalTax / gross) * 100).toFixed(1)),
        regimeTitle: "Employee (CIM — Contract Individual de Muncă)",
        note: "25% CAS Pension + 10% CASS Health + 10% Income Tax on net after social (+ 2.25% Employer CAM)."
      };
    }
    if (regimeKey === "freelancer") {
      // PFA Sistem Real: CAS 25% capped at 12 or 24 MONTHLY min wages; CASS 10% capped at 60 MONTHLY min wages (min 6); 10% PIT on remaining!
      let casBase = 0;
      if (gross >= 24 * minWageMonthlyUsd) casBase = 24 * minWageMonthlyUsd;
      else if (gross >= 12 * minWageMonthlyUsd) casBase = 12 * minWageMonthlyUsd;
      const cas = Math.round(casBase * 0.25);

      const cassBase = Math.min(60 * minWageMonthlyUsd, Math.max(6 * minWageMonthlyUsd, gross));
      const cass = Math.round(cassBase * 0.10);

      const taxableNet = Math.max(0, gross - cas - cass);
      const pit = Math.round(taxableNet * 0.10);
      const totalTax = Math.min(gross, cas + cass + pit);
      return {
        gross,
        netTakeHome: gross - totalTax,
        totalTax,
        primaryTax: pit,
        primaryLabel: "10% PFA Net Income Tax",
        secondaryTax: cas + cass,
        secondaryLabel: "Capped CAS + CASS",
        employerExtraCost: 0,
        effectiveRatePct: Number(((totalTax / gross) * 100).toFixed(1)),
        regimeTitle: "PFA — Sistem Real (10% + Capped CAS/CASS)",
        note: "CAS capped at 12/24 monthly min wages & CASS capped at 60 monthly min wages; 0% dividend tax!"
      };
    }
    if (regimeKey === "micro") {
      // SRL Micro: 1% turnover if <= ~$65k (~€60k), 3% above €60k (up to €250k / ~$270k; above ~$270k transitions to 16% SRL Profit)
      if (gross > 270000) {
        const cit = Math.round(gross * 0.92 * 0.16); // ~8% deductible expenses
        const distributable = gross - cit;
        const divTax = Math.round(distributable * 0.10);
        const divCass = Math.round(24 * minWageMonthlyUsd * 0.10);
        const totalTax = cit + divTax + divCass;
        return {
          gross,
          netTakeHome: gross - totalTax,
          totalTax,
          primaryTax: cit,
          primaryLabel: "16% CIT (>€250k Micro Cap)",
          secondaryTax: divTax + divCass,
          secondaryLabel: "10% Dividend + Capped CASS",
          employerExtraCost: 0,
          effectiveRatePct: Number(((totalTax / gross) * 100).toFixed(1)),
          regimeTitle: "SRL Impozit pe Profit (Auto-Triggered >€250k Cap)",
          note: "Above the Micro-SRL turnover ceiling, Romanian SRLs automatically transition to 16% Profit Tax."
        };
      }
      const turnRate = gross <= 65000 ? 0.01 : 0.03;
      const microTax = Math.round(gross * turnRate);
      // Mandatory 1 min-wage employee: founder receives net salary, state gets ~42.8% of $10,560 (~$4,520)
      const empTaxes = Math.round(minWageAnnualUsd * 0.428);
      const remainingProfit = Math.max(0, gross - minWageAnnualUsd * 1.0225 - microTax);
      const divTax = Math.round(remainingProfit * 0.10);
      let divCassBase = 0;
      if (remainingProfit >= 24 * minWageMonthlyUsd) divCassBase = 24 * minWageMonthlyUsd;
      else if (remainingProfit >= 12 * minWageMonthlyUsd) divCassBase = 12 * minWageMonthlyUsd;
      else if (remainingProfit >= 6 * minWageMonthlyUsd) divCassBase = 6 * minWageMonthlyUsd;
      const divCass = Math.round(divCassBase * 0.10);

      const totalTax = Math.min(Math.round(gross * 0.55), microTax + empTaxes + divTax + divCass);
      return {
        gross,
        netTakeHome: gross - totalTax,
        totalTax,
        primaryTax: microTax + empTaxes,
        primaryLabel: `${turnRate * 100}% Micro Tax + 1 Min-Wage CIM`,
        secondaryTax: divTax + divCass,
        secondaryLabel: "10% Dividend + Capped CASS",
        employerExtraCost: 0,
        effectiveRatePct: Number(((totalTax / gross) * 100).toFixed(1)),
        regimeTitle: `SRL Microîntreprindere (${turnRate * 100}% Turnover Tier)`,
        note: `${turnRate * 100}% turnover tax + 1 mandatory employee salary (founder keeps net wage!) + 10% dividend tax.`
      };
    }
    // 'corporate' -> SRL Impozit pe Profit 16%
    const cit = Math.round(gross * 0.90 * 0.16); // assumes 10% deductible operational expenses
    const afterCit = gross - cit;
    const divTax = Math.round(afterCit * 0.10);
    let divCassBase = 0;
    if (afterCit >= 24 * minWageMonthlyUsd) divCassBase = 24 * minWageMonthlyUsd;
    else if (afterCit >= 12 * minWageMonthlyUsd) divCassBase = 12 * minWageMonthlyUsd;
    else if (afterCit >= 6 * minWageMonthlyUsd) divCassBase = 6 * minWageMonthlyUsd;
    const divCass = Math.round(divCassBase * 0.10);
    const totalTax = cit + divTax + divCass;
    return {
      gross,
      netTakeHome: gross - totalTax,
      totalTax,
      primaryTax: cit,
      primaryLabel: "16% Corporate Profit Tax",
      secondaryTax: divTax + divCass,
      secondaryLabel: "10% Dividend + Capped CASS",
      employerExtraCost: 0,
      effectiveRatePct: Number(((totalTax / gross) * 100).toFixed(1)),
      regimeTitle: "SRL Impozit pe Profit (16% Standard LLC)",
      note: "16% CIT on net profit (assuming ~10% deductible costs) + 10% Dividend Tax + capped CASS."
    };
  }

  // General Parametric Gross-to-Net Model across all 220 jurisdictions
  const isProgressive = tp.pitRate >= 25 && !(tp.pitSystem || "").toLowerCase().includes("flat");
  // Income progression curve relative to $100,000 anchor
  const logShift = Math.log10(gross / 100000); // -1 at $10k, 0 at $100k, +0.7 at $500k

  let baseRate = cm.microEffective100k;
  let regimeTitle = (tp.entities && tp.entities[1]) ? tp.entities[1].name : "Micro / SME Limited Company";
  let primaryLabel = "Corporate / Turnover Tax";
  let secondaryLabel = "Dividend / Social Levy";
  let primaryShare = 0.58;
  let employerExtraCost = 0;

  if (regimeKey === "employee") {
    baseRate = cm.empTaxRate;
    if (isProgressive && baseRate > 0.03) {
      baseRate = Math.max(0.02, Math.min(0.62, baseRate + logShift * 0.095));
    }
    regimeTitle = `Employee Gross Salary (${country ? country.iso3 : ""})`;
    primaryLabel = "Personal Income Tax";
    secondaryLabel = "Employee Social / Health";
    const socRatio = tp.employeeSocialRate / Math.max(1, tp.employeeSocialRate + tp.pitRate * 0.55);
    primaryShare = Math.max(0.15, Math.min(0.92, 1 - socRatio));
    employerExtraCost = Math.round(gross * ((tp.employerPayrollRate || 0) / 100));
  } else if (regimeKey === "freelancer") {
    baseRate = cm.freelanceEffective100k;
    if (isProgressive && baseRate > 0.03) {
      baseRate = Math.max(0.015, Math.min(0.56, baseRate + logShift * 0.085));
    } else if (!isProgressive && baseRate > 0.08) {
      // Capped social contributions decrease effective rate slightly at high revenue
      baseRate = Math.max(0.05, baseRate - logShift * 0.03);
    }
    regimeTitle = (tp.entities && tp.entities[0]) ? tp.entities[0].name : "Freelancer / Sole Proprietor";
    primaryLabel = "Business / Personal Tax";
    secondaryLabel = "Self-Employed Social";
    primaryShare = 0.65;
  } else if (regimeKey === "micro") {
    baseRate = cm.microEffective100k;
    if (country && country.iso3 === "ARE" && gross > 275000) {
      // UAE > $275k (~AED 1M) / > AED 375k profit: 9% above ~$102k if outside SBR, or 0% under SBR up to $816k
      baseRate = gross <= 816000 ? 0.0 : ((gross - 102000) * 0.09) / gross;
    } else if (baseRate > 0.04) {
      baseRate = Math.max(0.01, Math.min(0.52, baseRate + logShift * (isProgressive ? 0.045 : 0.015)));
    }
    const entIdx = tp.entities && tp.entities.length >= 2 ? 1 : 0;
    regimeTitle = (tp.entities && tp.entities[entIdx]) ? tp.entities[entIdx].name : "Micro / SME Company";
    primaryLabel = "SME / Micro Entity Tax";
    secondaryLabel = "Dividend / Extraction Tax";
    primaryShare = tp.dividendTaxRate === 0 ? 0.92 : 0.55;
  } else {
    // 'corporate'
    baseRate = cm.corpEffective100k;
    if (country && country.iso3 === "ARE") {
      baseRate = gross <= 102000 ? 0.0 : ((gross - 102000) * 0.09) / gross;
    } else if (baseRate > 0.04) {
      baseRate = Math.max(0.02, Math.min(0.58, baseRate + logShift * 0.03));
    }
    const lastIdx = tp.entities ? Math.max(0, tp.entities.length - 1) : 0;
    regimeTitle = (tp.entities && tp.entities[lastIdx]) ? tp.entities[lastIdx].name : "Standard Corporation";
    primaryLabel = "Corporate Income Tax (CIT)";
    secondaryLabel = "Dividend Withholding Tax";
    primaryShare = tp.dividendTaxRate === 0 ? 1.0 : 0.62;
  }

  baseRate = Math.max(0, Math.min(0.75, baseRate));
  const totalTax = Math.round(gross * baseRate);
  const primaryTax = Math.round(totalTax * primaryShare);
  const secondaryTax = totalTax - primaryTax;

  return {
    gross,
    netTakeHome: gross - totalTax,
    totalTax,
    primaryTax,
    primaryLabel,
    secondaryTax,
    secondaryLabel,
    employerExtraCost,
    effectiveRatePct: Number(((totalTax / gross) * 100).toFixed(1)),
    regimeTitle,
    note: `${tp.pitHeadline} • VAT: ${tp.vatStandard}% • Authority: ${tp.taxAuthority}`
  };
}
