// ============================================================================
// TERRA // SCALE — Main Application Controller (Three.js + GSAP + Equal-Area)
// ============================================================================
import {
  DEG2RAD,
  KM2_TO_MI2,
  KM_TO_MI,
  haversineKm,
  slerpLatLng,
  isPointInProjectedCountry,
  mercatorInflationFactor
} from "./core-math.mjs";

import {
  BENCHMARKS,
  FEATURED_PRESETS,
  findClosestBenchmark,
  decodeTopoJSON,
  getOrGenerateGeometry,
  getTargetAreaKm2,
  getProjectedCountry,
  getBiosphereProfile,
  getEncyclopediaProfile,
  getTaxProfile,
  calculateTaxScenario
} from "./data-engine.mjs";

import { TerraThreeEngine } from "./three-stage.mjs";

// Global Application State
export const state = {
  isoA: "ROU",
  isoB: "USA",
  unitSystem: "metric",          // 'metric' | 'imperial'
  territoryScope: "full",        // 'full' | 'mainland'
  theme: "dark",                 // 'dark' | 'light'
  stageMode: "overlay",          // 'overlay' | 'globe' | 'prism3d' | 'packing' | 'geom' | 'depth'
  overlayLayout: "superimposed", // 'superimposed' | 'split'
  compactInsets: true,
  topLayer: "A",                 // 'A' | 'B'
  rotationA: 0,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  offsetA: { x: 0, y: 0 },
  offsetB: { x: 0, y: 0 },
  draggingTarget: null,          // 'A' | 'B' | 'pan' | 'globe' | 'prism'
  dragStartMouse: { x: 0, y: 0 },
  dragStartOffset: { x: 0, y: 0 },
  packingMetric: "area",
  packingHoverIndex: -1,
  packingTileBoxes: [],
  geomShape: "circle",
  densitySimMode: "crowd",
  telemetryScale: "linear",
  globeRot: { lng: -25, lat: 36 },
  globeTargetRot: null,
  globeAutoSpin: true,
  arcPulseT: 0,
  depthProbeM: -850,
  pickerTargetSlot: "A",
  pickerRegion: "All",
  wikiCurrentIso: "ROU",
  wikiCurrentTab: "overview",
  wikiLiveCache: {},
  taxCalcGross: 100000,
  taxCalcRegime: "micro",        // 'employee' | 'freelancer' | 'micro' | 'corporate'
  taxesDb: {},
  countriesDb: [],
  countryByIso3: {},
  countryById: {},
  oceanPolygons: {},
  wikiDeepDb: {},
  geomsById: {},
  allWorldFeatures: [],
  projectedCache: {}
};

// Expose state on window for inline event handlers
if (typeof window !== "undefined") {
  window.state = state;
}

let threeEngine = null;
let particlesA = [];
let particlesB = [];
let renderRequested = false;

export function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtArea(km2, includeUnit = true) {
  const val = state.unitSystem === "imperial" ? km2 * KM2_TO_MI2 : km2;
  const unit = state.unitSystem === "imperial" ? "mi²" : "km²";
  let numStr;
  if (val < 10) numStr = val.toFixed(2);
  else if (val < 100) numStr = val.toFixed(1);
  else numStr = Math.round(val).toLocaleString("en-US");
  return includeUnit ? `${numStr} ${unit}` : numStr;
}

export function fmtDist(km, includeUnit = true) {
  const val = state.unitSystem === "imperial" ? km * KM_TO_MI : km;
  const unit = state.unitSystem === "imperial" ? "mi" : "km";
  const numStr = Math.round(val).toLocaleString("en-US");
  return includeUnit ? `${numStr} ${unit}` : numStr;
}

export function fmtPopShort(pop) {
  if (pop >= 1e9) return (pop / 1e9).toFixed(2) + "B";
  if (pop >= 1e6) return (pop / 1e6).toFixed(2) + "M";
  if (pop >= 1e3) return (pop / 1e3).toFixed(1) + "K";
  return String(pop);
}

export function getCountryA() {
  return state.countryByIso3[state.isoA] || state.countryByIso3["ROU"] || state.countriesDb[0];
}

export function getCountryB() {
  return state.countryByIso3[state.isoB] || state.countryByIso3["USA"] || state.countriesDb[1];
}

export function getThemeColors() {
  const isLight = state.theme === "light";
  return {
    water: isLight ? "#E6EEF6" : "#050911",
    graticule: isLight ? "rgba(15,23,42,0.07)" : "rgba(148,163,184,0.075)",
    landContext: isLight ? "#D7E0EA" : "#111A2E",
    landStroke: isLight ? "rgba(15,23,42,0.15)" : "rgba(255,255,255,0.10)",
    colorA: isLight ? "#0284C7" : "#00E5FF",
    fillA: isLight ? "rgba(2, 132, 199, 0.34)" : "rgba(0, 229, 255, 0.30)",
    colorB: isLight ? "#EA580C" : "#FF5E36",
    fillB: isLight ? "rgba(234, 88, 12, 0.28)" : "rgba(255, 94, 54, 0.24)",
    text: isLight ? "#0F172A" : "#F3F6FC",
    textMuted: isLight ? "#475569" : "#9BA8C2",
    hudBg: isLight ? "rgba(255,255,255,0.92)" : "rgba(10,16,28,0.88)"
  };
}

function projectEntity(country) {
  return getProjectedCountry(country, {
    territoryScope: state.territoryScope,
    compactInsets: state.compactInsets,
    geomsById: state.geomsById,
    oceanPolygons: state.oceanPolygons,
    countriesDb: state.countriesDb,
    projectedCache: state.projectedCache
  });
}

// ============================================================================
// DASHBOARD UI & CONTEXT-AWARE TELEMETRY (WITH BUG #5 OCEAN/POLAR FIX)
// ============================================================================
export function updateDashboardUI() {
  const cA = getCountryA();
  const cB = getCountryB();
  if (!cA || !cB) return;

  const areaA = getTargetAreaKm2(cA, state.territoryScope);
  const areaB = getTargetAreaKm2(cB, state.territoryScope);
  const popA = cA.pop;
  const popB = cB.pop;
  const isImp = state.unitSystem === "imperial";
  const areaUnit = isImp ? "mi²" : "km²";

  const areaRatio = areaB >= areaA ? (areaB / areaA) : (areaA / areaB);
  const popRatio = popB >= popA ? (popB / popA) : (popA / popB);
  document.getElementById("headerMatchupTag").textContent =
    `${cA.iso3} vs ${cB.iso3} • 1:${areaRatio.toFixed(1)} AREA • 1:${popRatio.toFixed(1)} POP`;

  // Entity Type Role Badges
  const roleName = c => c.entityType === "ocean" ? "OCEAN / SEA BASIN" : (c.entityType === "continent" ? "CONTINENT / REGION" : "SOVEREIGN COUNTRY");
  const popUnitShort = c => c.entityType === "ocean" ? "t biomass" : "pop";
  const popUnitLong = c => c.entityType === "ocean" ? "tonnes marine nekton" : (c.iso3 === "ATA" || c.iso3 === "ANTC" ? "research staff" : "residents");

  // Selector Card A
  document.getElementById("flagA").textContent = cA.flag;
  document.getElementById("nameA").textContent = cA.name;
  document.getElementById("isoA").textContent = cA.iso3;
  document.getElementById("roleLabelA").innerHTML = `<span class="dot-a"></span> ${roleName(cA)} A • DRAGGABLE`;
  document.getElementById("metaA").textContent = `${cA.subregion || cA.region} • ${cA.entityType === "ocean" ? "Deepest: " : "Capital: "}${cA.capital}`;
  document.getElementById("quickAreaA").textContent = fmtArea(areaA, true);
  document.getElementById("quickPopA").textContent = `${fmtPopShort(popA)} ${popUnitShort(cA)}`;

  // Selector Card B
  document.getElementById("flagB").textContent = cB.flag;
  document.getElementById("nameB").textContent = cB.name;
  document.getElementById("isoB").textContent = cB.iso3;
  document.getElementById("roleLabelB").innerHTML = `<span class="dot-b"></span> ${roleName(cB)} B • REFERENCE BASE`;
  document.getElementById("metaB").textContent = `${cB.subregion || cB.region} • ${cB.entityType === "ocean" ? "Deepest: " : "Capital: "}${cB.capital}`;
  document.getElementById("quickAreaB").textContent = fmtArea(areaB, true);
  document.getElementById("quickPopB").textContent = `${fmtPopShort(popB)} ${popUnitShort(cB)}`;

  // KPI 1: Surface Area
  document.getElementById("kpiAreaTitle").textContent = `SURFACE AREA (${areaUnit.toUpperCase()})`;
  const largerAreaCountry = areaB >= areaA ? cB : cA;
  const smallerAreaCountry = areaB >= areaA ? cA : cB;
  document.getElementById("kpiAreaRatioBadge").textContent =
    `${largerAreaCountry.iso3} is ${areaRatio >= 100 ? Math.round(areaRatio) : areaRatio.toFixed(2)}× larger`;
  document.getElementById("kpiAreaLabelA").textContent = cA.name;
  document.getElementById("kpiAreaLabelB").textContent = cB.name;
  document.getElementById("kpiAreaValA").textContent = fmtArea(areaA, false);
  document.getElementById("kpiAreaValB").textContent = fmtArea(areaB, false);
  document.getElementById("kpiAreaSubA").textContent = `${((areaA / areaB) * 100).toFixed(areaA / areaB < 0.1 ? 2 : 1)}% of ${cB.iso3}`;
  document.getElementById("kpiAreaSubB").textContent = `${((areaB / areaA) * 100).toFixed(areaB / areaA < 0.1 ? 2 : 1)}% of ${cA.iso3}`;
  const totArea = areaA + areaB;
  document.getElementById("barAreaA").style.width = `${Math.max(2, (areaA / totArea) * 100)}%`;
  document.getElementById("barAreaB").style.width = `${Math.max(2, (areaB / totArea) * 100)}%`;
  document.getElementById("kpiAreaFoot").innerHTML =
    `<span>Diff: ${fmtArea(Math.abs(areaB - areaA), true)}</span><span>${state.territoryScope === "mainland" ? "Contiguous Mainland" : "Full Sovereign Area"}</span>`;

  // KPI 2: Total Population / Marine Biomass (Bug Fix #5)
  const hasOcean = cA.entityType === "ocean" || cB.entityType === "ocean";
  const kpiPopTitle = document.getElementById("kpiPopTitle");
  if (kpiPopTitle) {
    kpiPopTitle.textContent = hasOcean ? "POPULATION / MARINE BIOMASS" : "TOTAL POPULATION";
  }
  const largerPopCountry = popB >= popA ? cB : cA;
  document.getElementById("kpiPopRatioBadge").textContent =
    `${largerPopCountry.iso3} is ${popRatio >= 100 ? Math.round(popRatio) : popRatio.toFixed(2)}× larger`;
  document.getElementById("kpiPopLabelA").textContent = cA.name;
  document.getElementById("kpiPopLabelB").textContent = cB.name;
  document.getElementById("kpiPopValA").textContent = fmtPopShort(popA);
  document.getElementById("kpiPopValB").textContent = fmtPopShort(popB);
  document.getElementById("kpiPopSubA").textContent = `${fmtInt(popA)} ${popUnitLong(cA)}`;
  document.getElementById("kpiPopSubB").textContent = `${fmtInt(popB)} ${popUnitLong(cB)}`;
  const totPop = popA + popB;
  document.getElementById("barPopA").style.width = `${Math.max(2, (popA / totPop) * 100)}%`;
  document.getElementById("barPopB").style.width = `${Math.max(2, (popB / totPop) * 100)}%`;
  document.getElementById("kpiPopFoot").innerHTML =
    `<span>Gap: ${fmtPopShort(Math.abs(popB - popA))}</span><span>${((popA / popB) * 100).toFixed(2)}% of ${cB.iso3}</span>`;

  // KPI 3: Population / Biomass Density
  const denFactor = isImp ? (1 / KM2_TO_MI2) : 1;
  const denA = (popA / areaA) * denFactor;
  const denB = (popB / areaB) * denFactor;
  const denRatio = denA >= denB ? denA / denB : denB / denA;
  const denserC = denA >= denB ? cA : cB;
  document.getElementById("kpiDensityTitle").textContent = `DENSITY (/${areaUnit.toUpperCase()})`;
  document.getElementById("kpiDensityRatioBadge").textContent = `${denserC.iso3} is ${denRatio.toFixed(2)}× denser`;
  document.getElementById("kpiDenLabelA").textContent = cA.name;
  document.getElementById("kpiDenLabelB").textContent = cB.name;
  document.getElementById("kpiDenValA").textContent = denA >= 100 ? Math.round(denA).toLocaleString() : denA.toFixed(1);
  document.getElementById("kpiDenValB").textContent = denB >= 100 ? Math.round(denB).toLocaleString() : denB.toFixed(1);
  document.getElementById("kpiDenSubA").textContent = `${cA.entityType === "ocean" ? "tonnes" : "people"} per ${areaUnit}`;
  document.getElementById("kpiDenSubB").textContent = `${cB.entityType === "ocean" ? "tonnes" : "people"} per ${areaUnit}`;
  document.getElementById("barDenA").style.width = `${Math.max(2, (denA / (denA + denB)) * 100)}%`;
  document.getElementById("barDenB").style.width = `${Math.max(2, (denB / (denA + denB)) * 100)}%`;
  const haPerPersonA = (areaA * 100 / Math.max(1, popA)).toFixed(2);
  const haPerPersonB = (areaB * 100 / Math.max(1, popB)).toFixed(2);
  document.getElementById("kpiDenFoot").innerHTML =
    `<span>${cA.entityType === "ocean" ? "Photic" : "Urban"}: ${cA.urban}% vs ${cB.urban}%</span><span>${haPerPersonA} vs ${haPerPersonB} ha/unit</span>`;

  // KPI 4: Geodesic Distance & GDP
  const distKm = haversineKm(cA.capLat, cA.capLng, cB.capLat, cB.capLng);
  document.getElementById("kpiDistBadge").textContent = `${fmtDist(distKm, true)} apart`;
  document.getElementById("kpiGdpLabelA").textContent = `${cA.iso3} ${cA.entityType === "ocean" ? "Blue Econ" : "GDP"}`;
  document.getElementById("kpiGdpLabelB").textContent = `${cB.iso3} ${cB.entityType === "ocean" ? "Blue Econ" : "GDP"}`;
  const fmtGdp = g => g >= 1000 ? `$${(g / 1000).toFixed(2)}T` : `$${Math.round(g)}B`;
  document.getElementById("kpiGdpValA").textContent = fmtGdp(cA.gdp);
  document.getElementById("kpiGdpValB").textContent = fmtGdp(cB.gdp);
  const capGdpA = Math.round((cA.gdp * 1e9) / Math.max(1, popA));
  const capGdpB = Math.round((cB.gdp * 1e9) / Math.max(1, popB));
  document.getElementById("kpiGdpCapA").textContent = cA.entityType === "ocean" ? "Maritime Trade & Fisheries" : `$${capGdpA.toLocaleString()} / capita`;
  document.getElementById("kpiGdpCapB").textContent = cB.entityType === "ocean" ? "Maritime Trade & Fisheries" : `$${capGdpB.toLocaleString()} / capita`;
  document.getElementById("barGdpA").style.width = `${Math.max(2, (cA.gdp / Math.max(1, cA.gdp + cB.gdp)) * 100)}%`;
  document.getElementById("barGdpB").style.width = `${Math.max(2, (cB.gdp / Math.max(1, cA.gdp + cB.gdp)) * 100)}%`;
  const flightHrs = (distKm / 850 + 0.35);
  const fh = Math.floor(flightHrs), fm = Math.round((flightHrs - fh) * 60);
  document.getElementById("kpiDistFoot").innerHTML =
    `<span>${cA.capital} ↔ ${cB.capital}</span><span>~${fh}h ${fm}m jet flight</span>`;

  // HUD labels
  document.getElementById("hudNameA").textContent = `${cA.flag} ${cA.name}`;
  document.getElementById("hudNameB").textContent = `${cB.flag} ${cB.name}`;
  const dragHint = document.getElementById("dragHintName");
  const baseHint = document.getElementById("baseHintName");
  if (dragHint) dragHint.textContent = cA.name;
  if (baseHint) baseHint.textContent = cB.name;
  document.getElementById("btnFocusGlobeA").textContent = `Focus ${cA.iso3}`;
  document.getElementById("btnFocusGlobeB").textContent = `Focus ${cB.iso3}`;

  // Smart Benchmark Insight Banner
  const smallerAreaVal = Math.min(areaA, areaB);
  const largerAreaVal = Math.max(areaA, areaB);
  const bmArea = findClosestBenchmark(smallerAreaVal, "area");
  const bmPop = findClosestBenchmark(cA.pop, "pop");
  const bmAreaPct = Math.round((smallerAreaVal / bmArea.area) * 100);
  const fitCount = (largerAreaVal / smallerAreaVal).toFixed(2);
  document.getElementById("smartInsightText").innerHTML =
    `<strong>Cartographic Scale Insight:</strong> You can fit <strong class="hl-a">${fitCount} × ${smallerAreaCountry.name}</strong> inside <strong class="hl-b">${largerAreaCountry.name}</strong>. ` +
    `By surface area, <strong class="hl-a">${smallerAreaCountry.name} (${fmtArea(smallerAreaVal, true)})</strong> is <strong>${bmAreaPct}%</strong> the size of <strong>${bmArea.name} (${fmtArea(bmArea.area, true)})</strong>, ` +
    `while <strong class="hl-a">${cA.name}'s ${cA.entityType === "ocean" ? "nekton biomass" : "population"} (${fmtPopShort(cA.pop)})</strong> is closest to <strong>${bmPop.name} (${fmtPopShort(bmPop.pop)})</strong>.`;

  // Density Simulator Headers
  document.getElementById("simNameA").textContent = cA.name;
  document.getElementById("simNameB").textContent = cB.name;
  document.getElementById("simStatA").textContent = `${denA >= 100 ? Math.round(denA) : denA.toFixed(1)} / ${areaUnit}`;
  document.getElementById("simStatB").textContent = `${denB >= 100 ? Math.round(denB) : denB.toFixed(1)} / ${areaUnit}`;
  document.getElementById("chamberScaleTagA").textContent = isImp ? "1 mi × 1 mi" : "1 km × 1 km";
  document.getElementById("chamberScaleTagB").textContent = isImp ? "1 mi × 1 mi" : "1 km × 1 km";
  document.getElementById("simUrbanA").textContent = `${cA.entityType === "ocean" ? "Photic" : "Urban"}: ${cA.urban}%`;
  document.getElementById("simUrbanB").textContent = `${cB.entityType === "ocean" ? "Photic" : "Urban"}: ${cB.urban}%`;
  document.getElementById("simSpaceA").textContent = `${haPerPersonA} ha/unit`;
  document.getElementById("simSpaceB").textContent = `${haPerPersonB} ha/unit`;

  // Update 3D Prism Headline if active
  updatePrismHUD(cA, cB);

  renderPresetsBar();
  renderTelemetryTable();
  initDensityParticles();
  renderPopMatrix();
  if (state.stageMode === "packing") renderPackingMatrix();
  if (state.stageMode === "geom") renderGeometricStage();
  if (state.stageMode === "depth") renderDepthCrossCanvas();
  if (state.stageMode === "tax") renderTaxCompareCanvas();
  renderTaxStudioSection();
  renderBiosphereSection();
  renderCivilizationSection();
}

function updatePrismHUD(cA, cB) {
  if (!threeEngine) return;
  const { valA, valB, unitLabel } = threeEngine.computePrismHeights(cA, cB);
  const hl = document.getElementById("prismHeadline");
  const sub = document.getElementById("prismSubline");
  if (!hl || !sub) return;
  hl.textContent = `Three.js 3D Volumetric Prisms: ${cA.flag} ${cA.name} (${valA.toFixed(1)} ${unitLabel}) vs ${cB.flag} ${cB.name} (${valB.toFixed(1)} ${unitLabel})`;
  if (threeEngine.prismHeightMetric === "density") {
    sub.textContent = `Base Footprint Area = True Surface km² • Z-Extrusion Height = Density (${unitLabel}) → 3D Prism Volume = Total Population!`;
  } else if (threeEngine.prismHeightMetric === "elevation") {
    sub.textContent = `Base Footprint Area = True Surface km² • Z-Extrusion Height = Highest Mountain Peak / Max Ocean Trench Depth (meters).`;
  } else if (threeEngine.prismHeightMetric === "tax") {
    sub.textContent = `Base Footprint Area = True Surface km² • Z-Extrusion Height = Effective Tax Burden % ($${state.taxCalcGross.toLocaleString()} • ${state.taxCalcRegime.toUpperCase()}).`;
  } else {
    sub.textContent = `Base Footprint Area = True Surface km² • Z-Extrusion Height = Economic Output per Capita (USD).`;
  }
}

function renderPresetsBar() {
  const bar = document.getElementById("presetsBar");
  if (!bar) return;
  let html = `<span class="preset-label">Quick Compare:</span>`;
  for (const p of FEATURED_PRESETS) {
    const active = (state.isoA === p.a && state.isoB === p.b) || (state.isoA === p.b && state.isoB === p.a);
    html += `<button type="button" class="preset-chip ${active ? "active" : ""}" onclick="selectPreset('${p.a}','${p.b}')">${p.label}</button>`;
  }
  bar.innerHTML = html;
}

function renderTelemetryTable() {
  const cA = getCountryA();
  const cB = getCountryB();
  const areaA = getTargetAreaKm2(cA, state.territoryScope);
  const areaB = getTargetAreaKm2(cB, state.territoryScope);
  const isImp = state.unitSystem === "imperial";
  const areaUnit = isImp ? "mi²" : "km²";
  const denFactor = isImp ? (1 / KM2_TO_MI2) : 1;

  const metrics = [
    {
      label: `Surface Area (${areaUnit})`,
      valA: areaA, valB: areaB,
      fmtA: fmtArea(areaA, true), fmtB: fmtArea(areaB, true)
    },
    {
      label: "Population / Biomass",
      valA: cA.pop, valB: cB.pop,
      fmtA: fmtInt(cA.pop), fmtB: fmtInt(cB.pop)
    },
    {
      label: `Density (/${areaUnit})`,
      valA: (cA.pop / areaA) * denFactor,
      valB: (cB.pop / areaB) * denFactor,
      fmtA: `${((cA.pop / areaA) * denFactor).toFixed(1)} /${areaUnit}`,
      fmtB: `${((cB.pop / areaB) * denFactor).toFixed(1)} /${areaUnit}`
    },
    {
      label: "Urban / Photic Share",
      valA: cA.urban, valB: cB.urban,
      fmtA: `${cA.urban.toFixed(1)}% (${fmtPopShort(cA.pop * cA.urban / 100)})`,
      fmtB: `${cB.urban.toFixed(1)}% (${fmtPopShort(cB.pop * cB.urban / 100)})`
    },
    {
      label: "Nominal GDP / Blue Economy",
      valA: cA.gdp, valB: cB.gdp,
      fmtA: cA.gdp >= 1000 ? `$${(cA.gdp / 1000).toFixed(2)} Trillion` : `$${cA.gdp.toFixed(1)} Billion`,
      fmtB: cB.gdp >= 1000 ? `$${(cB.gdp / 1000).toFixed(2)} Trillion` : `$${cB.gdp.toFixed(1)} Billion`
    },
    {
      label: "Output Per Capita (USD)",
      valA: cA.entityType === "ocean" ? 0 : (cA.gdp * 1e9) / Math.max(1, cA.pop),
      valB: cB.entityType === "ocean" ? 0 : (cB.gdp * 1e9) / Math.max(1, cB.pop),
      fmtA: cA.entityType === "ocean" ? "Maritime Basin" : `$${Math.round((cA.gdp * 1e9) / Math.max(1, cA.pop)).toLocaleString()}`,
      fmtB: cB.entityType === "ocean" ? "Maritime Basin" : `$${Math.round((cB.gdp * 1e9) / Math.max(1, cB.pop)).toLocaleString()}`
    },
    {
      label: `Coastline / Rim Length (${isImp ? "mi" : "km"})`,
      valA: Math.max(0.1, cA.coast),
      valB: Math.max(0.1, cB.coast),
      fmtA: cA.coast === 0 ? "Landlocked (0)" : fmtDist(cA.coast, true),
      fmtB: cB.coast === 0 ? "Landlocked (0)" : fmtDist(cB.coast, true)
    },
    {
      label: `Effective Tax (${state.taxCalcRegime.toUpperCase()} @ $${Math.round(state.taxCalcGross / 1000)}k)`,
      valA: Math.max(0.2, calculateTaxScenario(cA, getTaxProfile(cA, state.taxesDb), state.taxCalcGross, state.taxCalcRegime).effectiveRatePct),
      valB: Math.max(0.2, calculateTaxScenario(cB, getTaxProfile(cB, state.taxesDb), state.taxCalcGross, state.taxCalcRegime).effectiveRatePct),
      fmtA: `${calculateTaxScenario(cA, getTaxProfile(cA, state.taxesDb), state.taxCalcGross, state.taxCalcRegime).effectiveRatePct}%`,
      fmtB: `${calculateTaxScenario(cB, getTaxProfile(cB, state.taxesDb), state.taxCalcGross, state.taxCalcRegime).effectiveRatePct}%`
    }
  ];

  const container = document.getElementById("telemetryList");
  if (!container) return;
  let html = "";
  for (const m of metrics) {
    let wA, wB;
    if (state.telemetryScale === "log") {
      const lA = Math.log10(Math.max(1, m.valA) + 1);
      const lB = Math.log10(Math.max(1, m.valB) + 1);
      const maxL = Math.max(lA, lB, 0.001);
      wA = (lA / maxL) * 100;
      wB = (lB / maxL) * 100;
    } else {
      const maxV = Math.max(m.valA, m.valB, 0.0001);
      wA = (m.valA / maxV) * 100;
      wB = (m.valB / maxV) * 100;
    }
    html += `
      <div class="t-row">
        <div class="t-row-top">
          <span class="t-val-a">${m.fmtA}</span>
          <span class="t-label">${m.label}</span>
          <span class="t-val-b">${m.fmtB}</span>
        </div>
        <div class="t-bars">
          <div class="t-track-left"><div class="t-fill-a" style="width:${Math.max(2, wA)}%"></div></div>
          <div class="t-track-right"><div class="t-fill-b" style="width:${Math.max(2, wB)}%"></div></div>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

// ============================================================================
// BIOSPHERE & ENCYCLOPEDIA DOM BUILDERS
// ============================================================================
function buildBioColumnHTML(c, bio, slot) {
  const badgeClass = c.entityType === "continent" ? "type-continent" : (c.entityType === "ocean" ? "type-ocean" : "type-country");
  const badgeLabel = c.entityType === "continent" ? "CONTINENT" : (c.entityType === "ocean" ? "OCEAN / SEA" : "COUNTRY");
  const elevOrDepthLabel = c.entityType === "ocean" ? "MAX TRENCH DEPTH" : "HIGHEST PEAK";
  const elevOrDepthVal = c.entityType === "ocean" ? `−${bio.maxDepthM.toLocaleString()} m` : `+${bio.maxElevM.toLocaleString()} m`;

  return `
    <div class="bio-col-head">
      <div>
        <div class="bio-col-title">
          <span>${c.flag} ${c.name}</span>
          <span class="entity-badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <div class="bio-biome-tag">🌿 <strong>Primary Biome:</strong> ${bio.biome}</div>
      </div>
      <span class="kpi-badge">${bio.protectedPct}% Protected</span>
    </div>

    <div class="bio-mini-kpis">
      <div class="bio-mini-kpi">
        <span class="bio-mini-label">${elevOrDepthLabel}</span>
        <span class="bio-mini-val">${elevOrDepthVal}</span>
        <span style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.entityType === "ocean" ? bio.maxDepthName : bio.maxElevName}</span>
      </div>
      <div class="bio-mini-kpi">
        <span class="bio-mini-label">MAMMAL SPECIES</span>
        <span class="bio-mini-val">${bio.mammalCount} taxa</span>
        <span style="font-size:10px;color:var(--text-muted);">Documented native</span>
      </div>
      <div class="bio-mini-kpi">
        <span class="bio-mini-label">BIRD SPECIES</span>
        <span class="bio-mini-val">${bio.birdCount.toLocaleString()} taxa</span>
        <span style="font-size:10px;color:var(--text-muted);">Resident &amp; migratory</span>
      </div>
      <div class="bio-mini-kpi">
        <span class="bio-mini-label">FISH &amp; MARINE</span>
        <span class="bio-mini-val">${bio.fishCount.toLocaleString()} taxa</span>
        <span style="font-size:10px;color:var(--text-muted);">Freshwater &amp; pelagic</span>
      </div>
    </div>

    <div style="font-size:12px;font-weight:600;color:var(--text-secondary);padding:6px 10px;background:var(--bg-surface);border-radius:6px;border-left:3px solid var(--country-${slot.toLowerCase()});">
      🔬 ${bio.biomassHeadline}
    </div>

    <div class="creature-list">
      ${bio.creatures.map(cr => `
        <div class="creature-card">
          <div class="creature-emoji">${cr.emoji}</div>
          <div class="creature-body">
            <div class="creature-top">
              <div>
                <span class="creature-name">${cr.name}</span>
                <span class="creature-sci">(${cr.sci})</span>
              </div>
              <div class="creature-badges">
                <span class="c-pill pop-pill">${cr.pop}</span>
                <span class="c-pill">${cr.stratum}</span>
              </div>
            </div>
            <div class="creature-desc">${cr.desc}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderBiosphereSection() {
  const cA = getCountryA();
  const cB = getCountryB();
  const bioA = getBiosphereProfile(cA);
  const bioB = getBiosphereProfile(cB);

  const tag = document.getElementById("bioMatchupTag");
  if (tag) tag.textContent = `${cA.name.toUpperCase()} VS ${cB.name.toUpperCase()} BIOSPHERE`;
  const colA = document.getElementById("bioColA");
  const colB = document.getElementById("bioColB");
  if (colA) colA.innerHTML = buildBioColumnHTML(cA, bioA, "A");
  if (colB) colB.innerHTML = buildBioColumnHTML(cB, bioB, "B");
}

function buildCivColumnHTML(c, slot) {
  const w = getEncyclopediaProfile(c, state.wikiDeepDb);
  const colVar = slot === "A" ? "var(--country-a)" : "var(--country-b)";

  const neighborsHTML = (c.borders && c.borders.length > 0)
    ? c.borders.map(bIso => {
        const nb = state.countryByIso3[bIso];
        return nb ? `<button type="button" class="neighbor-chip" onclick="openWikiModal('${nb.iso3}')" title="Open ${nb.name} Wiki">${nb.flag} ${nb.name}</button>` : "";
      }).join(" ")
    : `<span style="font-size:12px;color:var(--text-muted);">No land borders (Island / Basin / Polar Continent)</span>`;

  return `
    <div class="bio-col-head">
      <div>
        <div class="bio-col-title">
          <span>${c.flag} ${c.name}</span>
          <span class="selector-iso">${c.iso3}</span>
        </div>
        <div class="bio-biome-tag">🏛️ <strong>${w.govType}</strong></div>
      </div>
      <button type="button" class="wiki-btn-inline" onclick="openWikiModal('${c.iso3}')">📖 Open Full Wiki Modal ↗</button>
    </div>

    <div class="wiki-card">
      <div class="wiki-card-label">👑 STATE LEADERSHIP &amp; HOW THE ENTITY IS LED</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div style="background:var(--bg-surface);padding:9px 11px;border-radius:8px;border:1px solid var(--border-hairline);">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">HEAD OF STATE (PRESIDENT / MONARCH)</div>
          <div style="font-weight:700;font-size:12.5px;margin-top:2px;color:var(--text-primary);">${w.headOfState}</div>
        </div>
        <div style="background:var(--bg-surface);padding:9px 11px;border-radius:8px;border:1px solid var(--border-hairline);">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">HEAD OF GOVERNMENT (PM / CHANCELLOR)</div>
          <div style="font-weight:700;font-size:12.5px;margin-top:2px;color:var(--text-primary);">${w.headOfGov}</div>
        </div>
      </div>
      <div class="wiki-card-text" style="font-size:12px;">${w.howLed}</div>
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);padding-top:4px;border-top:1px solid var(--border-hairline);">
        🤝 <strong>Alliances:</strong> ${w.alliances}
      </div>
    </div>

    <div class="wiki-card">
      <div class="wiki-card-label">💰 FINANCES, CURRENCY &amp; ECONOMIC ENGINE</div>
      <div class="bio-mini-kpis">
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">NOMINAL GDP</span>
          <span class="bio-mini-val" style="color:${colVar}">${c.gdp >= 1000 ? "$" + (c.gdp / 1000).toFixed(2) + "T" : "$" + c.gdp.toFixed(1) + "B"}</span>
          <span style="font-size:10px;color:var(--text-muted);">~$${w.pppGdp}B PPP</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">GDP / CAPITA</span>
          <span class="bio-mini-val">${c.entityType === "ocean" ? "Maritime" : "$" + w.capGdp.toLocaleString()}</span>
          <span style="font-size:10px;color:var(--text-muted);">Annual output</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">HDI &amp; LIFE EXP</span>
          <span class="bio-mini-val">${w.hdi.split(" ")[0]}</span>
          <span style="font-size:10px;color:var(--text-muted);">Life: ${w.lifeExp}</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">CALL / DOMAIN</span>
          <span class="bio-mini-val">${c.callingCode || "N/A"} • ${c.tld || ""}</span>
          <span style="font-size:10px;color:var(--text-muted);">${c.languages ? c.languages.split(",")[0] : ""}</span>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-primary);"><strong>Currency:</strong> ${c.currency || "USD"} • <strong>Central Bank:</strong> ${w.centralBank}</div>
      <div class="wiki-card-text" style="font-size:12px;">${w.financeOverview}</div>
    </div>

    <div class="wiki-card">
      <div class="wiki-card-label">🍲 ICONIC FOOD &amp; DISHES TO TRY</div>
      <div class="creature-list">
        ${w.food.slice(0, 4).map(fd => `
          <div class="creature-card" style="padding:9px 11px;">
            <div class="creature-emoji" style="width:34px;height:34px;font-size:18px;">${fd.emoji}</div>
            <div class="creature-body">
              <div class="creature-name" style="font-size:12.5px;">${fd.name}</div>
              <div class="creature-desc" style="font-size:11.5px;margin-top:2px;">${fd.desc}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="wiki-card">
      <div class="wiki-card-label">🏰 TOP ATTRACTIONS, LANDMARKS &amp; PLACES TO VISIT</div>
      <div class="creature-list">
        ${w.attractions.slice(0, 4).map(at => `
          <div class="creature-card" style="padding:9px 11px;">
            <div class="creature-emoji" style="width:34px;height:34px;font-size:18px;">${at.emoji}</div>
            <div class="creature-body">
              <div class="creature-top">
                <span class="creature-name" style="font-size:12.5px;">${at.name}</span>
                <span class="c-pill">${at.loc}</span>
              </div>
              <div class="creature-desc" style="font-size:11.5px;margin-top:2px;">${at.desc}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="wiki-card">
      <div class="wiki-card-label">📜 HISTORY HIGHLIGHTS &amp; THINGS TO DO</div>
      <div class="wiki-card-text" style="font-size:12px;">${w.historySummary}</div>
      <div style="margin-top:6px;">
        <div style="font-family:var(--font-mono);font-size:10.5px;font-weight:700;color:var(--text-secondary);margin-bottom:5px;">🎒 TOP ACTIVITIES TO DO:</div>
        <ul style="padding-left:18px;font-size:12px;color:var(--text-secondary);display:flex;flex-direction:column;gap:4px;">
          ${w.activities.slice(0, 4).map(act => `<li>${act}</li>`).join("")}
        </ul>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-hairline);">
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:6px;">🗺️ CLICK ANY BORDERING NEIGHBOR TO INSPECT ITS WIKI:</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${neighborsHTML}</div>
      </div>
    </div>
  `;
}

function renderCivilizationSection() {
  const cA = getCountryA();
  const cB = getCountryB();
  const tag = document.getElementById("civMatchupTag");
  if (tag) tag.textContent = `${cA.iso3} VS ${cB.iso3} ENCYCLOPEDIA`;
  const btnA = document.getElementById("btnOpenWikiA");
  const btnB = document.getElementById("btnOpenWikiB");
  if (btnA) btnA.innerHTML = `📖 ${cA.flag} ${cA.name} Wiki Page`;
  if (btnB) btnB.innerHTML = `📖 ${cB.flag} ${cB.name} Wiki Page`;

  const colA = document.getElementById("civColA");
  const colB = document.getElementById("civColB");
  if (colA) colA.innerHTML = buildCivColumnHTML(cA, "A");
  if (colB) colB.innerHTML = buildCivColumnHTML(cB, "B");
}

// ============================================================================
// GLOBAL TAXATION, BUSINESS ENTITIES (PFA / MICRO / SRL / LLC) & NET STUDIO
// ============================================================================
function buildTaxColumnHTML(c, slot, isModal = false) {
  const tp = getTaxProfile(c, state.taxesDb);
  const sc = calculateTaxScenario(c, tp, state.taxCalcGross, state.taxCalcRegime);
  const colVar = slot === "A" ? "var(--country-a)" : "var(--country-b)";

  const netPct = Math.max(2, (sc.netTakeHome / sc.gross) * 100);
  const primPct = Math.max(0, (sc.primaryTax / sc.gross) * 100);
  const secPct = Math.max(0, (sc.secondaryTax / sc.gross) * 100);

  const effBadgeClass = r => r <= 18.0 ? "eff-low" : (r <= 28.5 ? "eff-mid" : "eff-high");

  return `
    ${!isModal ? `
    <div class="bio-col-head">
      <div>
        <div class="bio-col-title">
          <span>${c.flag} ${c.name}</span>
          <span class="selector-iso">${c.iso3}</span>
        </div>
        <div class="bio-biome-tag">🏛️ <strong>Tax Authority:</strong> ${tp.taxAuthority}</div>
      </div>
      <button type="button" class="wiki-btn-inline" onclick="openWikiModal('${c.iso3}', 'taxes')">💳 Tax Wiki Tab ↗</button>
    </div>
    ` : ""}

    <div class="tax-takehome-card" style="border-top: 3px solid ${colVar};">
      <div class="tax-takehome-top">
        <div>
          <div style="font-family:var(--font-mono);font-size:10.5px;font-weight:700;color:${colVar};text-transform:uppercase;">
            LIVE NET TAKE-HOME @ $${sc.gross.toLocaleString()}/YR • ${sc.regimeTitle}
          </div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:4px;flex-wrap:wrap;">
            <span class="tax-net-amount" style="color:#34D399;">$${sc.netTakeHome.toLocaleString()}</span>
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">net / yr ($${Math.round(sc.netTakeHome / 12).toLocaleString()} / mo)</span>
          </div>
        </div>
        <div style="text-align:right;">
          <span class="rate-pill ${effBadgeClass(sc.effectiveRatePct)}" style="font-size:12px;padding:4px 10px;">
            ${sc.effectiveRatePct}% Effective Tax
          </span>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:3px;">
            Total Tax: $${sc.totalTax.toLocaleString()}${sc.employerExtraCost > 0 ? ` (+$${sc.employerExtraCost.toLocaleString()} Employer)` : ""}
          </div>
        </div>
      </div>

      <div class="tax-stacked-bar" title="Green = Net Take-Home • Amber = ${sc.primaryLabel} • Coral = ${sc.secondaryLabel}">
        <div class="tax-seg-net" style="width:${netPct.toFixed(1)}%"></div>
        <div class="tax-seg-primary" style="width:${primPct.toFixed(1)}%"></div>
        <div class="tax-seg-secondary" style="width:${secPct.toFixed(1)}%"></div>
      </div>

      <div class="tax-legend-row">
        <span><strong style="color:#34D399;">● Net Pocket:</strong> ${(100 - sc.effectiveRatePct).toFixed(1)}% ($${sc.netTakeHome.toLocaleString()})</span>
        <span><strong style="color:#FBBF24;">● ${sc.primaryLabel}:</strong> $${sc.primaryTax.toLocaleString()}</span>
        <span><strong style="color:#F87171;">● ${sc.secondaryLabel}:</strong> $${sc.secondaryTax.toLocaleString()}</span>
      </div>
      <div style="font-size:11.5px;color:var(--text-secondary);border-top:1px solid var(--border-hairline);padding-top:6px;">
        📌 ${sc.note}
      </div>
    </div>

    <div class="wiki-card">
      <div class="wiki-card-label">👤 PERSONAL, PAYROLL (CAS / CASS / FICA), VAT &amp; INVESTMENT TAXES</div>
      <div class="bio-mini-kpis">
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">PERSONAL INCOME (PIT)</span>
          <span class="bio-mini-val" style="color:${colVar}">${tp.pitRate}% ${tp.pitRate === 0 ? "Tax-Free" : ((tp.pitSystem || "").toLowerCase().includes("flat") ? "Flat" : "Top")}</span>
          <span style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${tp.pitHeadline}">${tp.pitHeadline}</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">EMPLOYEE SOCIAL</span>
          <span class="bio-mini-val">${tp.employeeSocialRate}%</span>
          <span style="font-size:10px;color:var(--text-muted);">Employer: +${tp.employerPayrollRate}%</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">STANDARD VAT / GST</span>
          <span class="bio-mini-val">${tp.vatStandard}%</span>
          <span style="font-size:10px;color:var(--text-muted);">${tp.vatStandard === 0 ? "0% Federal VAT" : "Consumption tax"}</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">DIVIDEND WHT TAX</span>
          <span class="bio-mini-val">${tp.dividendTaxRate}%</span>
          <span style="font-size:10px;color:var(--text-muted);">Profit distribution</span>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary);margin-top:4px;">
        <div><strong>• PIT &amp; Social System:</strong> ${tp.pitSystem} — <em>${tp.employeeSocialBreakdown}</em></div>
        <div><strong>• Employer Payroll Levy:</strong> ${tp.employerPayrollBreakdown}</div>
        <div><strong>• VAT &amp; Reduced Tiers:</strong> ${tp.vatReduced}</div>
        <div><strong>• Dividends:</strong> ${tp.dividendNotes}</div>
        <div><strong>• Capital Gains &amp; Crypto:</strong> ${tp.capitalGainsRate}</div>
        <div><strong>• Property / Wealth Tax:</strong> ${tp.propertyTax}</div>
      </div>
    </div>

    <div class="wiki-card">
      <div class="wiki-card-label">🏢 ALL COMPANY &amp; LEGAL ENTITY STRUCTURES (${tp.entities.length} REGIMES: PFA / MICRO / SRL / LLC / CORP)</div>
      <div class="legal-entity-list">
        ${tp.entities.map(ent => `
          <div class="legal-entity-card">
            <div class="legal-entity-head">
              <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
                <span class="legal-entity-name">${ent.name}</span>
                <span class="entity-badge type-country">${ent.badge}</span>
              </div>
              <div class="legal-rate-pills">
                <span class="rate-pill">Entity Tax: ${ent.corporateTaxRate}%</span>
                <span class="rate-pill">Div: ${ent.dividendRate}%</span>
                <span class="rate-pill ${effBadgeClass(ent.effectiveAt100k)}">~${ent.effectiveAt100k}% Eff. @ $100k</span>
              </div>
            </div>
            <div class="legal-entity-meta">⚖️ Threshold / Capital: ${ent.turnoverCap}</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.45;">${ent.summary}</div>
            <div class="legal-entity-best"><strong>Best For:</strong> ${ent.bestFor}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

export function renderTaxStudioSection() {
  const cA = getCountryA();
  const cB = getCountryB();
  if (!cA || !cB) return;

  const tpA = getTaxProfile(cA, state.taxesDb);
  const tpB = getTaxProfile(cB, state.taxesDb);
  const scA = calculateTaxScenario(cA, tpA, state.taxCalcGross, state.taxCalcRegime);
  const scB = calculateTaxScenario(cB, tpB, state.taxCalcGross, state.taxCalcRegime);

  const readout = document.getElementById("taxGrossReadout");
  if (readout) readout.textContent = `$${state.taxCalcGross.toLocaleString()} / yr`;

  const slider = document.getElementById("taxGrossSlider");
  if (slider && Number(slider.value) !== state.taxCalcGross) {
    slider.value = state.taxCalcGross;
  }

  document.querySelectorAll(".tax-preset-amt").forEach(btn => {
    btn.classList.toggle("active", Number(btn.getAttribute("data-amt")) === state.taxCalcGross);
  });

  const regButtons = [
    ["employee", "btnRegimeEmp", "btnStageTaxEmp"],
    ["freelancer", "btnRegimeFree", "btnStageTaxFree"],
    ["micro", "btnRegimeMicro", "btnStageTaxMicro"],
    ["corporate", "btnRegimeCorp", "btnStageTaxCorp"]
  ];
  for (const [key, id1, id2] of regButtons) {
    const b1 = document.getElementById(id1);
    const b2 = document.getElementById(id2);
    if (b1) b1.classList.toggle("active", state.taxCalcRegime === key);
    if (b2) b2.classList.toggle("active", state.taxCalcRegime === key);
  }

  const badge = document.getElementById("taxWinnerBadge");
  if (badge) {
    const diff = Math.abs(scA.netTakeHome - scB.netTakeHome);
    if (diff < 100) {
      badge.textContent = `EQUAL NET TAKE-HOME ($${scA.netTakeHome.toLocaleString()}/YR)`;
    } else {
      const winner = scA.netTakeHome > scB.netTakeHome ? cA : cB;
      const loser = scA.netTakeHome > scB.netTakeHome ? cB : cA;
      badge.textContent = `${winner.flag} ${winner.iso3} KEEPS +$${diff.toLocaleString()}/YR MORE NET THAN ${loser.iso3}`;
    }
  }

  const colA = document.getElementById("taxColA");
  const colB = document.getElementById("taxColB");
  if (colA) colA.innerHTML = buildTaxColumnHTML(cA, "A", false);
  if (colB) colB.innerHTML = buildTaxColumnHTML(cB, "B", false);
}

export function setTaxCalcGross(val) {
  state.taxCalcGross = Math.max(10000, Math.min(500000, Math.round(Number(val) || 100000)));
  renderTaxStudioSection();
  renderTelemetryTable();
  if (state.stageMode === "tax") renderTaxCompareCanvas();
  if (threeEngine && threeEngine.prismHeightMetric === "tax") {
    updatePrismHUD(getCountryA(), getCountryB());
    requestRenderAll();
  }
}

export function setTaxCalcRegime(regime) {
  state.taxCalcRegime = regime;
  renderTaxStudioSection();
  renderTelemetryTable();
  if (state.stageMode === "tax") renderTaxCompareCanvas();
  if (threeEngine && threeEngine.prismHeightMetric === "tax") {
    updatePrismHUD(getCountryA(), getCountryB());
    requestRenderAll();
  }
}

export function renderTaxCompareCanvas() {
  const canvas = document.getElementById("taxCompareCanvas");
  if (!canvas || canvas.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const colors = getThemeColors();
  const cA = getCountryA();
  const cB = getCountryB();
  const tpA = getTaxProfile(cA, state.taxesDb);
  const tpB = getTaxProfile(cB, state.taxesDb);

  const hl = document.getElementById("taxStageHeadline");
  if (hl) {
    hl.textContent = `Fiscal Take-Home & Effective Tax Curves: ${cA.flag} ${cA.name} vs ${cB.flag} ${cB.name} ($${state.taxCalcGross.toLocaleString()} Gross)`;
  }

  ctx.fillStyle = colors.water;
  ctx.fillRect(0, 0, W, H);

  // Split: Left 47% = 4-Regime Net Take-Home Bar Comparison; Right 53% = Effective Tax % Curve ($15k -> $500k)
  const splitX = Math.round(W * 0.48);

  ctx.strokeStyle = colors.landStroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(splitX, 16);
  ctx.lineTo(splitX, H - 16);
  ctx.stroke();

  // LEFT PANEL: 4-Regime Net Take-Home Comparison
  ctx.font = "700 12px 'Space Grotesk', sans-serif";
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.fillText(`NET TAKE-HOME BY ENTITY REGIME (@ $${state.taxCalcGross.toLocaleString()}/YR)`, 18, 26);

  const regimes = [
    { key: "employee", label: "👔 Employee Salary" },
    { key: "freelancer", label: "🧑‍💻 PFA / Freelance / 1099" },
    { key: "micro", label: "🚀 Micro-SRL / S-Corp / SME" },
    { key: "corporate", label: "🏢 Standard SRL / C-Corp" }
  ];

  const rowStartY = 48;
  const rowGap = (H - 68) / 4;
  const barMaxW = Math.max(80, splitX - 185);

  regimes.forEach((rg, idx) => {
    const yTop = rowStartY + idx * rowGap;
    const sA = calculateTaxScenario(cA, tpA, state.taxCalcGross, rg.key);
    const sB = calculateTaxScenario(cB, tpB, state.taxCalcGross, rg.key);
    const isSelected = state.taxCalcRegime === rg.key;

    if (isSelected) {
      ctx.fillStyle = state.theme === "light" ? "rgba(2,132,199,0.08)" : "rgba(0,229,255,0.07)";
      ctx.beginPath();
      ctx.roundRect(10, yTop - 6, splitX - 22, rowGap - 6, 8);
      ctx.fill();
      ctx.strokeStyle = colors.colorA;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.font = "700 11.5px 'Inter', sans-serif";
    ctx.fillStyle = isSelected ? colors.text : colors.textMuted;
    ctx.textAlign = "left";
    ctx.fillText(rg.label, 18, yTop + 11);

    // Bar A
    const wA = Math.max(8, (sA.netTakeHome / state.taxCalcGross) * barMaxW);
    ctx.fillStyle = colors.colorA;
    ctx.beginPath();
    ctx.roundRect(18, yTop + 18, wA, 15, 4);
    ctx.fill();
    ctx.font = "600 10.5px 'JetBrains Mono', monospace";
    ctx.fillStyle = colors.text;
    ctx.fillText(`${cA.iso3}: $${Math.round(sA.netTakeHome / 1000)}k (${sA.effectiveRatePct}% tax)`, 24 + wA, yTop + 29);

    // Bar B
    const wB = Math.max(8, (sB.netTakeHome / state.taxCalcGross) * barMaxW);
    ctx.fillStyle = colors.colorB;
    ctx.beginPath();
    ctx.roundRect(18, yTop + 38, wB, 15, 4);
    ctx.fill();
    ctx.fillStyle = colors.text;
    ctx.fillText(`${cB.iso3}: $${Math.round(sB.netTakeHome / 1000)}k (${sB.effectiveRatePct}% tax)`, 24 + wB, yTop + 49);
  });

  // RIGHT PANEL: Effective Tax Rate Curve ($15k -> $500k)
  const padL = splitX + 46;
  const padR = W - 24;
  const padT = 50;
  const padB = H - 38;
  const plotW = Math.max(60, padR - padL);
  const plotH = Math.max(60, padB - padT);

  ctx.font = "700 12px 'Space Grotesk', sans-serif";
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.fillText(`EFFECTIVE TAX BURDEN CURVE ($15K → $500K • ${state.taxCalcRegime.toUpperCase()})`, splitX + 18, 26);

  const maxPct = 60;
  ctx.font = "500 10px 'JetBrains Mono', monospace";
  for (let pct = 0; pct <= maxPct; pct += 15) {
    const y = padB - (pct / maxPct) * plotH;
    ctx.strokeStyle = colors.graticule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padR, y);
    ctx.stroke();

    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "right";
    ctx.fillText(`${pct}%`, padL - 7, y + 3);
  }

  const checkpoints = [15000, 30000, 50000, 65000, 85000, 100000, 140000, 180000, 220000, 265000, 280000, 350000, 425000, 500000];
  const amtToX = amt => padL + ((amt - 15000) / (500000 - 15000)) * plotW;
  const pctToY = pct => padB - (Math.min(maxPct, Math.max(0, pct)) / maxPct) * plotH;

  for (const tickAmt of [25000, 100000, 250000, 500000]) {
    const tx = amtToX(tickAmt);
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "center";
    ctx.fillText(`$${tickAmt / 1000}k`, tx, padB + 16);
  }

  // Active Gross Marker Line
  const curX = amtToX(Math.max(15000, Math.min(500000, state.taxCalcGross)));
  ctx.save();
  ctx.strokeStyle = "#10B981";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(curX, padT);
  ctx.lineTo(curX, padB);
  ctx.stroke();
  ctx.restore();

  const drawCurve = (country, tp, hexColor) => {
    ctx.beginPath();
    checkpoints.forEach((amt, i) => {
      const sc = calculateTaxScenario(country, tp, amt, state.taxCalcRegime);
      const x = amtToX(amt);
      const y = pctToY(sc.effectiveRatePct);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = hexColor;
    ctx.lineWidth = 2.6;
    ctx.stroke();

    const curSc = calculateTaxScenario(country, tp, state.taxCalcGross, state.taxCalcRegime);
    const cy = pctToY(curSc.effectiveRatePct);
    ctx.beginPath();
    ctx.arc(curX, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = hexColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke();
  };

  drawCurve(cA, tpA, colors.colorA);
  drawCurve(cB, tpB, colors.colorB);

  ctx.restore();
}

// ============================================================================
// MINI-WIKIPEDIA POP-UP MODAL CONTROLLER
// ============================================================================
export function openWikiModal(iso3, initialTab = "overview") {
  const c = state.countryByIso3[iso3] || getCountryA();
  state.wikiCurrentIso = c.iso3;
  state.wikiCurrentTab = initialTab;
  document.getElementById("wikiModalBackdrop").classList.add("open");
  renderWikiModalContent();

  const wikiSlug = encodeURIComponent(c.name.replace(" (Continent)", "").replace(" (Full Continent)", "").replace(" (Pontus Euxinus)", ""));
  if (!state.wikiLiveCache[c.iso3]) {
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${wikiSlug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.extract) {
          state.wikiLiveCache[c.iso3] = {
            extract: data.extract,
            thumb: data.thumbnail ? data.thumbnail.source : null,
            url: (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : `https://en.wikipedia.org/wiki/${wikiSlug}`
          };
          if (document.getElementById("wikiModalBackdrop").classList.contains("open") && state.wikiCurrentIso === c.iso3) {
            renderWikiModalContent();
          }
        }
      })
      .catch(() => {});
  }
}

export function closeWikiModal() {
  document.getElementById("wikiModalBackdrop").classList.remove("open");
}

export function switchWikiTab(tab) {
  state.wikiCurrentTab = tab;
  renderWikiModalContent();
}

export function setCountryFromWiki(slot, iso3) {
  if (slot === "A") state.isoA = iso3;
  else state.isoB = iso3;
  closeWikiModal();
  resetOverlayPositions(false);
  updateDashboardUI();
  requestRenderAll();
}

function renderWikiModalContent() {
  const c = state.countryByIso3[state.wikiCurrentIso] || getCountryA();
  const w = getEncyclopediaProfile(c, state.wikiDeepDb);
  const bio = getBiosphereProfile(c);
  const liveWiki = state.wikiLiveCache[c.iso3];

  document.getElementById("wikiModalFlag").textContent = c.flag;
  document.getElementById("wikiModalHeroTitle").textContent = c.name;
  document.getElementById("wikiModalIsoBadge").textContent = c.iso3;
  const typeBadge = document.getElementById("wikiModalTypeBadge");
  typeBadge.textContent = c.entityType.toUpperCase();
  typeBadge.className = `entity-badge type-${c.entityType}`;

  document.getElementById("wikiModalOfficialSub").innerHTML =
    `<strong>Official:</strong> ${c.officialName || c.name} &nbsp;•&nbsp; <strong>Native:</strong> ${c.nativeName || c.name} &nbsp;•&nbsp; <strong>Capital / Hub:</strong> ${c.capital}`;

  const wikiUrl = liveWiki ? liveWiki.url : `https://en.wikipedia.org/wiki/${encodeURIComponent(c.name.replace(" (Continent)", ""))}`;
  document.getElementById("wikiExternalLink").href = wikiUrl;

  const cA = getCountryA(), cB = getCountryB();
  document.getElementById("wikiModalQuickSwitch").innerHTML = `
    <button type="button" class="hud-btn ${c.iso3 === cA.iso3 ? "active" : ""}" onclick="openWikiModal('${cA.iso3}', state.wikiCurrentTab)">${cA.flag} ${cA.name}</button>
    <button type="button" class="hud-btn ${c.iso3 === cB.iso3 ? "active" : ""}" onclick="openWikiModal('${cB.iso3}', state.wikiCurrentTab)">${cB.flag} ${cB.name}</button>
    ${c.iso3 !== cA.iso3 && c.iso3 !== cB.iso3 ? `
      <button type="button" class="hud-btn" onclick="setCountryFromWiki('A','${c.iso3}')">Set as Entity A</button>
      <button type="button" class="hud-btn" onclick="setCountryFromWiki('B','${c.iso3}')">Set as Entity B</button>
    ` : ""}
  `;

  const tabIds = {
    overview: "wTabOverview",
    politics: "wTabPolitics",
    economy: "wTabEconomy",
    taxes: "wTabTaxes",
    history: "wTabHistory",
    culture: "wTabCulture",
    bio: "wTabBio"
  };
  for (const [k, id] of Object.entries(tabIds)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", state.wikiCurrentTab === k);
  }

  const body = document.getElementById("wikiModalBody");
  const tab = state.wikiCurrentTab;

  if (tab === "overview") {
    const neighborsHTML = (c.borders && c.borders.length > 0)
      ? c.borders.map(bIso => {
          const nb = state.countryByIso3[bIso];
          return nb ? `<button type="button" class="neighbor-chip" onclick="openWikiModal('${nb.iso3}', 'overview')">${nb.flag} ${nb.name}</button>` : "";
        }).join(" ")
      : "None (Island / Basin / Polar Continent)";

    body.innerHTML = `
      <div class="wiki-grid-2">
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="wiki-card">
            <div class="wiki-card-label">📖 ENCYCLOPEDIA EXECUTIVE SUMMARY</div>
            ${liveWiki && liveWiki.thumb ? `<img src="${liveWiki.thumb}" alt="${c.name}" style="width:100%;max-height:190px;object-fit:cover;border-radius:8px;border:1px solid var(--border-hairline);margin-bottom:6px;" />` : ""}
            <div class="wiki-card-text">${liveWiki ? liveWiki.extract : w.historySummary}</div>
          </div>

          <div class="wiki-card">
            <div class="wiki-card-label">👑 LEADERSHIP &amp; GOVERNMENT AT A GLANCE</div>
            <div class="wiki-card-headline">${w.govType}</div>
            <div class="wiki-card-text">
              <strong>• Head of State:</strong> ${w.headOfState}<br/>
              <strong>• Head of Government:</strong> ${w.headOfGov}<br/>
              <strong>• Alliances:</strong> ${w.alliances}
            </div>
          </div>

          <div class="wiki-card">
            <div class="wiki-card-label">💡 DID YOU KNOW? (CURIOSITIES &amp; RECORDS)</div>
            <ul style="padding-left:18px;font-size:13px;color:var(--text-secondary);display:flex;flex-direction:column;gap:6px;">
              ${w.curiosities.map(cu => `<li>${cu}</li>`).join("")}
            </ul>
          </div>
        </div>

        <div class="wiki-card">
          <div class="wiki-card-label">📊 SOVEREIGN INFOBOX TELEMETRY</div>
          <table class="infobox-table">
            <tr><th>Official Name</th><td>${c.officialName || c.name}</td></tr>
            <tr><th>Native Name</th><td>${c.nativeName || c.name}</td></tr>
            <tr><th>Capital / Hub</th><td>${c.capital} (${c.capLat}°, ${c.capLng}°)</td></tr>
            <tr><th>Region</th><td>${c.region} • ${c.subregion}</td></tr>
            <tr><th>Surface Area</th><td>${fmtArea(c.area, true)} (${Math.round(c.area * 0.386102).toLocaleString()} mi²)</td></tr>
            <tr><th>Population / Biomass</th><td>${fmtInt(c.pop)} (${fmtPopShort(c.pop)})</td></tr>
            <tr><th>Density</th><td>${(c.pop / c.area).toFixed(1)} / km² (${c.urban}% Urban/Photic)</td></tr>
            <tr><th>Languages</th><td>${c.languages || "Official National Languages"}</td></tr>
            <tr><th>Currency</th><td>${c.currency || "USD"}</td></tr>
            <tr><th>Nominal GDP</th><td>$${c.gdp >= 1000 ? (c.gdp / 1000).toFixed(2) + " Trillion" : c.gdp.toFixed(1) + " Billion"}</td></tr>
            <tr><th>HDI &amp; Life Exp.</th><td>${w.hdi} • Life Exp: ${w.lifeExp}</td></tr>
            <tr><th>Coastline</th><td>${c.coast === 0 ? "Landlocked (0 km)" : c.coast.toLocaleString() + " km"}</td></tr>
            <tr><th>Highest Point</th><td>+${bio.maxElevM.toLocaleString()} m (${bio.maxElevName})</td></tr>
            <tr><th>Calling / TLD</th><td>${c.callingCode || "N/A"} &nbsp;•&nbsp; Domain: <code>${c.tld || "N/A"}</code></td></tr>
          </table>

          <div style="margin-top:10px;">
            <div class="wiki-card-label" style="margin-bottom:6px;">🗺️ BORDERING COUNTRIES (CLICK TO EXPLORE)</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${neighborsHTML}</div>
          </div>
        </div>
      </div>
    `;
  } else if (tab === "politics") {
    body.innerHTML = `
      <div class="wiki-grid-2">
        <div class="wiki-card">
          <div class="wiki-card-label">👑 HEAD OF STATE (PRESIDENT / MONARCH)</div>
          <div class="wiki-card-headline">${w.headOfState}</div>
          <div class="wiki-card-text">Represents the constitutional unity, sovereignty, armed forces command, and international treaty authority of ${c.name}.</div>
        </div>
        <div class="wiki-card">
          <div class="wiki-card-label">🏛️ HEAD OF GOVERNMENT (PRIME MINISTER / CHANCELLOR)</div>
          <div class="wiki-card-headline">${w.headOfGov}</div>
          <div class="wiki-card-text">Directs the executive cabinet, domestic public policy, national budget, and ministerial administration from ${c.capital}.</div>
        </div>
      </div>

      <div class="wiki-card">
        <div class="wiki-card-label">⚖️ CONSTITUTIONAL SYSTEM &amp; HOW ${c.name.toUpperCase()} IS GOVERNED</div>
        <div class="wiki-card-headline">${w.govType}</div>
        <div class="wiki-card-text">${w.howLed}</div>
      </div>

      <div class="wiki-card">
        <div class="wiki-card-label">🌐 GEOPOLITICAL ALLIANCES, TREATIES &amp; DIPLOMATIC MEMBERSHIP</div>
        <div class="wiki-card-headline">${w.alliances}</div>
        <div class="wiki-card-text">Seat of Governance: <strong>${c.capital}</strong> • Demonym: <strong>${c.demonym || c.name}</strong> • Official Languages: <strong>${c.languages || "National"}</strong>.</div>
      </div>
    `;
  } else if (tab === "economy") {
    body.innerHTML = `
      <div class="bio-mini-kpis">
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">NOMINAL GDP (USD)</span>
          <span class="bio-mini-val" style="color:var(--country-a);font-size:17px;">$${c.gdp >= 1000 ? (c.gdp / 1000).toFixed(2) + " Trillion" : c.gdp.toFixed(1) + " Billion"}</span>
          <span style="font-size:11px;color:var(--text-muted);">PPP Estimate: ~$${w.pppGdp}B</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">GDP PER CAPITA</span>
          <span class="bio-mini-val" style="font-size:17px;">${c.entityType === "ocean" ? "Maritime Basin" : "$" + w.capGdp.toLocaleString()}</span>
          <span style="font-size:11px;color:var(--text-muted);">Nominal output</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">HUMAN DEVELOPMENT (HDI)</span>
          <span class="bio-mini-val" style="font-size:17px;">${w.hdi}</span>
          <span style="font-size:11px;color:var(--text-muted);">Life Expectancy: ${w.lifeExp}</span>
        </div>
        <div class="bio-mini-kpi">
          <span class="bio-mini-label">URBANIZATION RATE</span>
          <span class="bio-mini-val" style="font-size:17px;">${c.urban}%</span>
          <span style="font-size:11px;color:var(--text-muted);">Median Age: ${w.medianAge}</span>
        </div>
      </div>

      <div class="wiki-grid-2">
        <div class="wiki-card">
          <div class="wiki-card-label">🏦 CURRENCY &amp; CENTRAL BANKING AUTHORITY</div>
          <div class="wiki-card-headline">${c.currency || "US Dollar (USD)"}</div>
          <div class="wiki-card-text"><strong>Monetary Institution:</strong> ${w.centralBank}</div>
        </div>
        <div class="wiki-card">
          <div class="wiki-card-label">📈 MACROECONOMIC STRUCTURE &amp; KEY INDUSTRIES</div>
          <div class="wiki-card-text">${w.financeOverview}</div>
        </div>
      </div>
    `;
  } else if (tab === "history") {
    body.innerHTML = `
      <div class="wiki-card">
        <div class="wiki-card-label">📜 HISTORICAL NARRATIVE OF ${c.name.toUpperCase()}</div>
        <div class="wiki-card-text">${w.historySummary}</div>
      </div>

      <div class="wiki-card">
        <div class="wiki-card-label">⏳ CHRONOLOGICAL HISTORICAL TIMELINE</div>
        <div class="timeline-stack">
          ${w.timeline.map(t => `
            <div class="timeline-item">
              <div class="timeline-era">${t.era}</div>
              <div class="timeline-title">${t.title}</div>
              <div class="timeline-desc">${t.desc}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  } else if (tab === "culture") {
    body.innerHTML = `
      <div class="wiki-grid-2">
        <div class="wiki-card">
          <div class="wiki-card-label">🍲 MUST-TRY FOOD, NATIONAL DISHES &amp; DRINKS</div>
          <div class="creature-list">
            ${w.food.map(fd => `
              <div class="creature-card">
                <div class="creature-emoji">${fd.emoji}</div>
                <div class="creature-body">
                  <div class="creature-name">${fd.name}</div>
                  <div class="creature-desc">${fd.desc}</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="wiki-card">
          <div class="wiki-card-label">🏰 ICONIC ATTRACTIONS, UNESCO SITES &amp; LANDMARKS</div>
          <div class="creature-list">
            ${w.attractions.map(at => `
              <div class="creature-card">
                <div class="creature-emoji">${at.emoji}</div>
                <div class="creature-body">
                  <div class="creature-top">
                    <span class="creature-name">${at.name}</span>
                    <span class="c-pill">${at.loc}</span>
                  </div>
                  <div class="creature-desc">${at.desc}</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>

      <div class="wiki-card">
        <div class="wiki-card-label">🎒 TOP ACTIVITIES &amp; CULTURAL EXPERIENCES TO DO IN ${c.name.toUpperCase()}</div>
        <ul style="padding-left:20px;font-size:13px;color:var(--text-primary);display:flex;flex-direction:column;gap:7px;">
          ${w.activities.map(act => `<li>${act}</li>`).join("")}
        </ul>
      </div>
    `;
  } else if (tab === "taxes") {
    body.innerHTML = buildTaxColumnHTML(c, "A", true);
  } else if (tab === "bio") {
    body.innerHTML = buildBioColumnHTML(c, bio, "A");
  }
}

// ============================================================================
// 2D LAMBERT EQUAL-AREA OVERLAY CANVAS RENDERER
// ============================================================================
function computeBasePxPerKm(W, H, projA, projB) {
  if (state.overlayLayout === "split") {
    const maxW = Math.max(projA.widthKm, projB.widthKm) * 2.35;
    const maxH = Math.max(projA.heightKm, projB.heightKm) * 1.35;
    return Math.min(W / maxW, H / maxH);
  }
  const maxW = Math.max(projA.widthKm, projB.widthKm) * 1.28;
  const maxH = Math.max(projA.heightKm, projB.heightKm) * 1.28;
  return Math.min(W / maxW, H / maxH);
}

function drawProjectedCountry(ctx, proj, centerPxX, centerPxY, pxPerKm, rotDeg, strokeColor, fillColor, country, isDraggable) {
  ctx.save();
  ctx.translate(centerPxX, centerPxY);
  if (rotDeg) ctx.rotate(rotDeg * DEG2RAD);

  if (proj.insetBoxes && proj.insetBoxes.length > 0) {
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    for (const box of proj.insetBoxes) {
      const bx = (box.minX - 60) * pxPerKm;
      const by = (box.minY - 60) * pxPerKm;
      const bw = (box.maxX - box.minX + 120) * pxPerKm;
      const bh = (box.maxY - box.minY + 120) * pxPerKm;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = strokeColor;
      ctx.fillText(box.label, bx + 6, by - 4);
    }
    ctx.restore();
  }

  ctx.beginPath();
  for (const poly of proj.polys) {
    for (const ring of poly.rings) {
      for (let i = 0; i < ring.length; i++) {
        const x = ring[i][0] * pxPerKm;
        const y = ring[i][1] * pxPerKm;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }

  ctx.fillStyle = fillColor;
  ctx.shadowColor = strokeColor;
  ctx.shadowBlur = isDraggable ? 18 : 10;
  ctx.fill("evenodd");

  ctx.shadowBlur = 0;
  ctx.lineWidth = isDraggable ? 2.2 : 1.75;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  const capX = proj.capKm[0] * pxPerKm;
  const capY = proj.capKm[1] * pxPerKm;
  if (Math.hypot(capX, capY) < 4000) {
    ctx.beginPath();
    ctx.arc(capX, capY, 3.8, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
  }

  ctx.rotate(-(rotDeg || 0) * DEG2RAD);
  ctx.font = "700 13px 'Space Grotesk', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 6;
  ctx.fillText(`${country.flag} ${country.name.toUpperCase()}`, 0, -4);
  ctx.font = "600 11px 'JetBrains Mono', monospace";
  ctx.fillStyle = strokeColor;
  ctx.fillText(fmtArea(proj.areaKm2, true), 0, 12);

  ctx.restore();
}

function renderOverlayCanvas(ctx, W, H, colors) {
  const cA = getCountryA();
  const cB = getCountryB();
  const projA = projectEntity(cA);
  const projB = projectEntity(cB);

  const baseScale = computeBasePxPerKm(W, H, projA, projB);
  const pxPerKm = baseScale * state.zoom;

  ctx.fillStyle = colors.water;
  ctx.fillRect(0, 0, W, H);

  const targetGridPx = 90;
  const rawGridKm = targetGridPx / pxPerKm;
  const niceSteps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000];
  let gridStepKm = 500;
  for (const s of niceSteps) {
    if (s >= rawGridKm) { gridStepKm = s; break; }
  }
  const gridStepPx = gridStepKm * pxPerKm;

  ctx.strokeStyle = colors.graticule;
  ctx.lineWidth = 1;
  const originX = (W * 0.5 + state.panX) % gridStepPx;
  const originY = (H * 0.5 + state.panY) % gridStepPx;
  ctx.beginPath();
  for (let x = originX; x < W; x += gridStepPx) {
    ctx.moveTo(x, 0); ctx.lineTo(x, H);
  }
  for (let y = originY; y < H; y += gridStepPx) {
    ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  ctx.stroke();

  let posB_x = W * 0.5 + state.panX + state.offsetB.x * pxPerKm;
  let posB_y = H * 0.5 + state.panY + state.offsetB.y * pxPerKm;
  let posA_x = W * 0.5 + state.panX + state.offsetA.x * pxPerKm;
  let posA_y = H * 0.5 + state.panY + state.offsetA.y * pxPerKm;

  if (state.overlayLayout === "split") {
    posA_x = W * 0.28 + state.panX + state.offsetA.x * pxPerKm;
    posB_x = W * 0.70 + state.panX + state.offsetB.x * pxPerKm;
  }

  state._screenPosA = { x: posA_x, y: posA_y, pxPerKm };
  state._screenPosB = { x: posB_x, y: posB_y, pxPerKm };

  if (state.topLayer === "A") {
    drawProjectedCountry(ctx, projB, posB_x, posB_y, pxPerKm, 0, colors.colorB, colors.fillB, cB, false);
    drawProjectedCountry(ctx, projA, posA_x, posA_y, pxPerKm, state.rotationA, colors.colorA, colors.fillA, cA, true);
  } else {
    drawProjectedCountry(ctx, projA, posA_x, posA_y, pxPerKm, state.rotationA, colors.colorA, colors.fillA, cA, false);
    drawProjectedCountry(ctx, projB, posB_x, posB_y, pxPerKm, 0, colors.colorB, colors.fillB, cB, true);
  }

  const scaleBarPx = gridStepKm * pxPerKm;
  const sbX = 18, sbY = H - 62;
  ctx.save();
  ctx.fillStyle = colors.hudBg;
  ctx.strokeStyle = colors.landStroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(sbX - 8, sbY - 22, Math.max(125, scaleBarPx + 24), 36, 6);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(sbX, sbY - 5);
  ctx.lineTo(sbX, sbY);
  ctx.lineTo(sbX + scaleBarPx, sbY);
  ctx.lineTo(sbX + scaleBarPx, sbY - 5);
  ctx.stroke();

  ctx.fillStyle = colors.text;
  ctx.font = "600 11px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText(`Scale Grid: ${fmtDist(gridStepKm, true)}`, sbX, sbY - 8);
  ctx.restore();

  const ratio = Math.max(projA.areaKm2, projB.areaKm2) / Math.min(projA.areaKm2, projB.areaKm2);
  if (ratio >= 8 && W > 540) {
    const smallC = projA.areaKm2 <= projB.areaKm2 ? cA : cB;
    const smallProj = projA.areaKm2 <= projB.areaKm2 ? projA : projB;
    const smallColor = projA.areaKm2 <= projB.areaKm2 ? colors.colorA : colors.colorB;
    const smallFill = projA.areaKm2 <= projB.areaKm2 ? colors.fillA : colors.fillB;

    const boxW = 175, boxH = 148;
    const bx = W - boxW - 14;
    const by = H - boxH - 58;

    ctx.save();
    ctx.fillStyle = colors.hudBg;
    ctx.strokeStyle = smallColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.font = "700 10px 'JetBrains Mono', monospace";
    ctx.fillStyle = smallColor;
    ctx.textAlign = "left";
    ctx.fillText(`🔍 ${smallC.iso3} DETAIL LOUPE`, bx + 10, by + 16);

    const loupeScale = Math.min((boxW - 36) / smallProj.widthKm, (boxH - 54) / smallProj.heightKm);
    const lcx = bx + boxW * 0.5;
    const lcy = by + boxH * 0.52;

    ctx.save();
    ctx.translate(lcx, lcy);
    if (smallC.iso3 === cA.iso3 && state.rotationA) ctx.rotate(state.rotationA * DEG2RAD);
    ctx.beginPath();
    for (const poly of smallProj.polys) {
      for (const ring of poly.rings) {
        for (let i = 0; i < ring.length; i++) {
          const x = ring[i][0] * loupeScale;
          const y = ring[i][1] * loupeScale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    }
    ctx.fillStyle = smallFill;
    ctx.fill("evenodd");
    ctx.strokeStyle = smallColor;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    ctx.font = "500 10px 'JetBrains Mono', monospace";
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "center";
    ctx.fillText(`Span: ${fmtDist(smallProj.widthKm, false)} × ${fmtDist(smallProj.heightKm, true)}`, bx + boxW * 0.5, by + boxH - 8);
    ctx.restore();
  }
}

export function renderMainCanvas() {
  if (state.stageMode === "globe") {
    const globeCanvas = document.getElementById("globeWebGLCanvas");
    if (threeEngine && globeCanvas) {
      threeEngine.renderGlobe(globeCanvas);
    }
    return;
  }
  if (state.stageMode === "prism3d") {
    const prismCanvas = document.getElementById("prism3dCanvas");
    if (threeEngine && prismCanvas) {
      threeEngine.renderPrismStage(prismCanvas);
    }
    return;
  }

  const canvas = document.getElementById("mainMapCanvas");
  if (!canvas || canvas.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);
  renderOverlayCanvas(ctx, rect.width, rect.height, getThemeColors());
  ctx.restore();
}

// ============================================================================
// PACKING MATRIX, GEOMETRIC & DEPTH CROSS-SECTION RENDERERS
// ============================================================================
export function renderPackingMatrix() {
  const canvas = document.getElementById("packingCanvas");
  if (!canvas || canvas.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const colors = getThemeColors();

  const cA = getCountryA();
  const cB = getCountryB();
  const isArea = state.packingMetric === "area";
  const valA = isArea ? getTargetAreaKm2(cA, state.territoryScope) : cA.pop;
  const valB = isArea ? getTargetAreaKm2(cB, state.territoryScope) : cB.pop;

  const smallC = valA <= valB ? cA : cB;
  const largeC = valA <= valB ? cB : cA;
  const smallVal = Math.min(valA, valB);
  const largeVal = Math.max(valA, valB);
  const smallColor = valA <= valB ? colors.colorA : colors.colorB;
  const smallFill = valA <= valB ? colors.fillA : colors.fillB;
  const largeColor = valA <= valB ? colors.colorB : colors.colorA;
  const largeFill = valA <= valB ? colors.fillB : colors.fillA;

  const exactMult = largeVal / Math.max(1, smallVal);
  const multStr = exactMult >= 100 ? Math.round(exactMult).toLocaleString() : exactMult.toFixed(2);

  document.getElementById("packingHeadline").textContent =
    `${multStr} × ${smallC.name} = 1 × ${largeC.name} (${isArea ? "Surface Area" : "Total Population"})`;
  document.getElementById("packingSubline").textContent = isArea
    ? `Each miniature ${smallC.name} silhouette below represents ${fmtArea(smallVal, true)}. Together they equal ${largeC.name}'s ${fmtArea(largeVal, true)}.`
    : `Each miniature ${smallC.name} silhouette below represents ${fmtPopShort(smallVal)}. Together they equal ${largeC.name}'s ${fmtPopShort(largeVal)}.`;
  document.getElementById("packingExactMult").textContent = `${multStr}×`;

  let unitsPerTile = 1;
  if (exactMult > 12000) unitsPerTile = 500;
  else if (exactMult > 2400) unitsPerTile = 100;
  else if (exactMult > 600) unitsPerTile = 25;
  else if (exactMult > 200) unitsPerTile = 5;

  const totalTilesFloat = exactMult / unitsPerTile;
  const fullTiles = Math.floor(totalTilesFloat);
  const fracTile = totalTilesFloat - fullTiles;
  const drawTileCount = Math.min(220, fullTiles + (fracTile > 0.03 ? 1 : 0));

  const gridW = W * 0.65;
  const refW = W * 0.35;

  const aspect = gridW / H;
  const cols = Math.max(2, Math.ceil(Math.sqrt(drawTileCount * aspect)));
  const rows = Math.max(1, Math.ceil(drawTileCount / cols));
  const pad = 14;
  const cellW = (gridW - pad * 2) / cols;
  const cellH = (H - pad * 2) / rows;

  const smallProj = projectEntity(smallC);
  const tileScale = Math.min((cellW * 0.80) / smallProj.widthKm, (cellH * 0.78) / smallProj.heightKm);

  state.packingTileBoxes = [];

  for (let idx = 0; idx < drawTileCount; idx++) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const cx = pad + c * cellW + cellW * 0.5;
    const cy = pad + r * cellH + cellH * 0.5;
    const isLastPartial = (idx === fullTiles && fracTile > 0.03);
    const fillFraction = isLastPartial ? fracTile : 1.0;
    const isHovered = (idx === state.packingHoverIndex);

    state.packingTileBoxes.push({
      idx,
      x: pad + c * cellW,
      y: pad + r * cellH,
      w: cellW,
      h: cellH,
      cumUnits: Math.min(exactMult, (idx + fillFraction) * unitsPerTile),
      smallC,
      smallVal
    });

    ctx.save();
    if (fillFraction < 0.999) {
      ctx.beginPath();
      ctx.rect(pad + c * cellW, pad + r * cellH, cellW * fillFraction, cellH);
      ctx.clip();
    }

    ctx.translate(cx, cy);
    ctx.beginPath();
    for (const poly of smallProj.polys) {
      for (const ring of poly.rings) {
        for (let i = 0; i < ring.length; i++) {
          const x = ring[i][0] * tileScale;
          const y = ring[i][1] * tileScale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    }
    ctx.fillStyle = isHovered ? smallColor : smallFill;
    ctx.fill("evenodd");
    ctx.strokeStyle = smallColor;
    ctx.lineWidth = isHovered ? 2.0 : 1.1;
    ctx.stroke();
    ctx.restore();

    if (drawTileCount <= 64) {
      ctx.font = "600 9.5px 'JetBrains Mono', monospace";
      ctx.fillStyle = colors.textMuted;
      ctx.textAlign = "center";
      const labelNum = isLastPartial ? `${exactMult.toFixed(1)}×` : `#${(idx + 1) * unitsPerTile}`;
      ctx.fillText(labelNum, cx, pad + (r + 1) * cellH - 3);
    }
  }

  ctx.strokeStyle = colors.landStroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gridW, 12);
  ctx.lineTo(gridW, H - 12);
  ctx.stroke();

  const largeProj = projectEntity(largeC);
  const refScale = Math.min((refW - 44) / largeProj.widthKm, (H - 85) / largeProj.heightKm);
  const refCx = gridW + refW * 0.5;
  const refCy = H * 0.48;

  drawProjectedCountry(ctx, largeProj, refCx, refCy, refScale, 0, largeColor, largeFill, largeC, false);

  ctx.font = "600 11px 'JetBrains Mono', monospace";
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "center";
  ctx.fillText(
    unitsPerTile > 1 ? `(Each miniature silhouette = ${unitsPerTile} × ${smallC.iso3})` : `(Each silhouette = 1 × ${smallC.iso3})`,
    refCx, H - 14
  );

  ctx.restore();
}

function drawProportionalPair(canvasId, valA, valB, fmtFn, cA, cB, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;

  const maxVal = Math.max(valA, valB, 1);
  const maxR = Math.min(W * 0.28, H * 0.40);
  const rA = Math.max(3, maxR * Math.sqrt(valA / maxVal));
  const rB = Math.max(3, maxR * Math.sqrt(valB / maxVal));

  const cxA = W * 0.28, cy = H * 0.50;
  const cxB = W * 0.72;

  function drawShape(cx, cy, r, stroke, fill, label, sub) {
    ctx.save();
    ctx.beginPath();
    if (state.geomShape === "square") {
      const side = r * Math.sqrt(Math.PI);
      ctx.roundRect(cx - side * 0.5, cy - side * 0.5, side, side, 4);
    } else {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = fill;
    ctx.shadowColor = stroke;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    ctx.font = "700 12px 'Space Grotesk', sans-serif";
    ctx.fillStyle = colors.text;
    ctx.textAlign = "center";
    ctx.fillText(label, cx, H - 22);
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.fillStyle = stroke;
    ctx.fillText(sub, cx, H - 7);
    ctx.restore();
  }

  drawShape(cxA, cy, rA, colors.colorA, colors.fillA, `${cA.flag} ${cA.name}`, fmtFn(valA));
  drawShape(cxB, cy, rB, colors.colorB, colors.fillB, `${cB.flag} ${cB.name}`, fmtFn(valB));

  ctx.restore();
}

export function renderGeometricStage() {
  const cA = getCountryA();
  const cB = getCountryB();
  const areaA = getTargetAreaKm2(cA, state.territoryScope);
  const areaB = getTargetAreaKm2(cB, state.territoryScope);
  const colors = getThemeColors();

  const areaRatio = areaB >= areaA ? (areaB / areaA).toFixed(2) : (areaA / areaB).toFixed(2);
  const popRatio = cB.pop >= cA.pop ? (cB.pop / cA.pop).toFixed(2) : (cA.pop / cB.pop).toFixed(2);
  document.getElementById("geomAreaBadge").textContent = `Ratio 1 : ${areaRatio}`;
  document.getElementById("geomPopBadge").textContent = `Ratio 1 : ${popRatio}`;

  drawProportionalPair("geomAreaCanvas", areaA, areaB, v => fmtArea(v, true), cA, cB, colors);
  drawProportionalPair("geomPopCanvas", cA.pop, cB.pop, v => `${fmtPopShort(v)}`, cA, cB, colors);

  const infA = mercatorInflationFactor(cA.lat);
  const infB = mercatorInflationFactor(cB.lat);
  const apparentMercatorRatio = (areaB * infB) / Math.max(1, areaA * infA);
  const trueRatio = areaB / Math.max(1, areaA);

  document.getElementById("mercatorVerdictBadge").textContent =
    `${cA.iso3} (${infA.toFixed(2)}×) vs ${cB.iso3} (${infB.toFixed(2)}×) Mercator Inflation`;
  document.getElementById("mercatorExplanation").innerHTML =
    `At latitude <strong>${Math.abs(cA.lat).toFixed(1)}°${cA.lat >= 0 ? "N" : "S"}</strong>, standard Web Mercator maps inflate <strong style="color:var(--country-a)">${cA.name}'s</strong> visual area by <strong>${infA.toFixed(2)}×</strong> ` +
    `(apparent ${fmtArea(areaA * infA, true)}), while at <strong>${Math.abs(cB.lat).toFixed(1)}°${cB.lat >= 0 ? "N" : "S"}</strong>, <strong style="color:var(--country-b)">${cB.name}</strong> is inflated by <strong>${infB.toFixed(2)}×</strong>. ` +
    `Our <strong>Lambert Azimuthal Equal-Area</strong> studio eliminates this distortion completely (true ratio <strong>1 : ${trueRatio.toFixed(2)}</strong> vs Mercator's distorted <strong>1 : ${apparentMercatorRatio.toFixed(2)}</strong>).`;
}

export function setDepthProbe(valM) {
  state.depthProbeM = Number(valM);
  const slider = document.getElementById("depthProbeSlider");
  if (slider) slider.value = state.depthProbeM;
  const lbl = document.getElementById("depthProbeLabel");
  if (lbl) lbl.textContent = `${state.depthProbeM > 0 ? "+" : ""}${state.depthProbeM.toLocaleString()} m`;

  const m = state.depthProbeM;
  let zoneName, pressureStr, tempStr, lifeStr;
  if (m > 3000) {
    zoneName = "🏔️ High Alpine / Nival Zone";
    pressureStr = `${(Math.exp(-m / 8400)).toFixed(2)} atm`;
    tempStr = `${(15 - m * 0.0065).toFixed(1)}°C`;
    lifeStr = "Snow Leopards, Andean Condors, Alpine Ibex, Emperor Penguin Ice Sheet";
  } else if (m > 0) {
    zoneName = "🌲 Terrestrial Montane & Lowland Biosphere";
    pressureStr = `${(Math.exp(-m / 8400)).toFixed(2)} atm`;
    tempStr = `${(15 - m * 0.0065).toFixed(1)}°C`;
    lifeStr = "Carpathian Brown Bears, Wolves, Bison, Sequoia & Tropical Canopy";
  } else if (m >= -200) {
    zoneName = "☀️ Sunlight (Epipelagic) Photic Zone (0 – 200 m)";
    pressureStr = `${(1 + Math.abs(m) / 10).toFixed(1)} atm`;
    tempStr = "12°C – 26°C";
    lifeStr = "Phytoplankton (50% of Earth O₂), Coral Reefs, Dolphins, Sea Turtles, Krill, Sturgeons";
  } else if (m >= -1000) {
    zoneName = "🌆 Twilight (Mesopelagic) Zone (200 – 1,000 m)";
    pressureStr = `${(1 + Math.abs(m) / 10).toFixed(0)} atm`;
    tempStr = "4°C – 11°C";
    lifeStr = "Bioluminescent Lanternfish (600M tonnes!), Diving Emperor Penguins (−565m), Giant Squid";
  } else if (m >= -4000) {
    zoneName = "🌑 Midnight (Bathypelagic) Zone (1,000 – 4,000 m)";
    pressureStr = `${(1 + Math.abs(m) / 10).toFixed(0)} atm`;
    tempStr = "2°C – 4°C (Pitch Black)";
    lifeStr = "Sperm Whales (−2,250m), Black Seadevil Anglerfish, Vampire Squid, Black Sea Anoxic Floor (−2,212m)";
  } else if (m >= -6000) {
    zoneName = "❄️ Abyssal (Abyssopelagic) Zone (4,000 – 6,000 m)";
    pressureStr = `${(1 + Math.abs(m) / 10).toFixed(0)} atm`;
    tempStr = "1.5°C – 2.5°C";
    lifeStr = "Abyssal Tripod Fish, Dumbo Octopus, Hydrothermal Vent Tube Worms & Blind Shrimp";
  } else {
    zoneName = "⚡ Hadal Trench (Hadopelagic) Zone (6,000 – 10,935 m)";
    pressureStr = `${(1 + Math.abs(m) / 10).toFixed(0)} atm (Crushing)`;
    tempStr = "1.0°C – 1.8°C";
    lifeStr = "Mariana Hadal Snailfish (−8,178m), Supergiant Amphipods (−10,935m Challenger Deep)";
  }

  const telem = document.getElementById("depthProbeTelemetry");
  if (telem) {
    telem.innerHTML = `<strong>${zoneName}</strong> • Pressure: <strong>${pressureStr}</strong> • Temp: <strong>${tempStr}</strong> • <em>${lifeStr}</em>`;
  }
  renderDepthCrossCanvas();
}

export function renderDepthCrossCanvas() {
  const canvas = document.getElementById("depthCrossCanvas");
  if (!canvas || canvas.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;

  const cA = getCountryA();
  const cB = getCountryB();
  const bioA = getBiosphereProfile(cA);
  const bioB = getBiosphereProfile(cB);
  const colors = getThemeColors();

  const maxM = 6500, minM = -11200;
  const mToY = m => 18 + ((maxM - m) / (maxM - minM)) * (H - 36);
  const ySea = mToY(0);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, ySea);
  skyGrad.addColorStop(0, "#0B1528");
  skyGrad.addColorStop(1, "#162B4D");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, ySea);

  const oceanGrad = ctx.createLinearGradient(0, ySea, 0, H);
  oceanGrad.addColorStop(0, "#0284C7");
  oceanGrad.addColorStop(0.08, "#0369A1");
  oceanGrad.addColorStop(0.28, "#0C2D57");
  oceanGrad.addColorStop(0.55, "#06152D");
  oceanGrad.addColorStop(1, "#020610");
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, ySea, W, H - ySea);

  const strata = [
    { m: 5000, label: "+5,000 m • High Alpine & Glacial Peaks" },
    { m: 2500, label: "+2,500 m • Montane Forest & Carpathian / Rocky Peaks" },
    { m: 0, label: "0 m • SEA LEVEL (Epipelagic Sunlight Zone 0–200m)" },
    { m: -1000, label: "−1,000 m • Mesopelagic Twilight Boundary (Zero Sunlight Below)" },
    { m: -2212, label: "−2,212 m • Black Sea Maximum Depth (Anoxic H₂S Basin)" },
    { m: -4000, label: "−4,000 m • Abyssal Plain Boundary (400 atm)" },
    { m: -6000, label: "−6,000 m • Hadal Trench Zone Boundary" },
    { m: -8376, label: "−8,376 m • Atlantic Ocean Max (Puerto Rico Trench)" },
    { m: -10935, label: "−10,935 m • Challenger Deep (Mariana Trench • Pacific)" }
  ];

  ctx.font = "500 10px 'JetBrains Mono', monospace";
  for (const s of strata) {
    const y = mToY(s.m);
    ctx.strokeStyle = s.m === 0 ? "rgba(56, 189, 248, 0.75)" : "rgba(255, 255, 255, 0.10)";
    ctx.lineWidth = s.m === 0 ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(W, y);
    ctx.stroke();

    ctx.fillStyle = s.m === 0 ? "#38BDF8" : "rgba(255,255,255,0.48)";
    ctx.textAlign = "right";
    ctx.fillText(s.label, W - 10, y - 4);
  }

  function drawProfileColumn(xCenter, c, bio, colHex) {
    const colW = 86;
    if (c.entityType === "ocean") {
      const yBot = mToY(-bio.maxDepthM);
      ctx.fillStyle = colHex;
      ctx.globalAlpha = 0.28;
      ctx.fillRect(xCenter - colW * 0.5, ySea, colW, yBot - ySea);
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = colHex;
      ctx.lineWidth = 2;
      ctx.strokeRect(xCenter - colW * 0.5, ySea, colW, yBot - ySea);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "700 11px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${c.flag} ${c.iso3}`, xCenter, yBot + 14);
      ctx.fillStyle = colHex;
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.fillText(`−${bio.maxDepthM.toLocaleString()}m`, xCenter, yBot + 26);
    } else {
      const peakM = Math.max(80, bio.maxElevM);
      const yPeak = mToY(peakM);
      ctx.beginPath();
      ctx.moveTo(xCenter - colW * 0.55, ySea);
      ctx.lineTo(xCenter, yPeak);
      ctx.lineTo(xCenter + colW * 0.55, ySea);
      ctx.closePath();
      ctx.fillStyle = colHex;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = colHex;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#FFFFFF";
      ctx.font = "700 11px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${c.flag} ${c.iso3}`, xCenter, yPeak - 16);
      ctx.fillStyle = colHex;
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.fillText(`+${bio.maxElevM.toLocaleString()}m`, xCenter, yPeak - 4);

      if (bio.maxDepthM > 0) {
        const yD = mToY(-bio.maxDepthM);
        ctx.strokeStyle = colHex;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(xCenter - colW * 0.35, ySea, colW * 0.7, yD - ySea);
        ctx.setLineDash([]);
        ctx.fillText(`−${bio.maxDepthM.toLocaleString()}m`, xCenter, yD + 12);
      }
    }
  }

  drawProfileColumn(75, cA, bioA, colors.colorA);
  drawProfileColumn(185, cB, bioB, colors.colorB);

  const depthCreatures = [
    { m: 4200, text: "🦅 Andean Condor / Snow Leopard (+4,200m)", x: 0.42 },
    { m: 1600, text: "🐻 Carpathian Brown Bear / Bison / Wolf (+1,600m)", x: 0.46 },
    { m: -80, text: "🐬 Dolphins, Beluga Sturgeon & Krill Swarms (−80m)", x: 0.40 },
    { m: -565, text: "🐧 Emperor Penguin Max Dive & Lanternfish (−565m)", x: 0.48 },
    { m: -1400, text: "🦑 Giant Squid & Greenland Shark (−1,400m)", x: 0.42 },
    { m: -2250, text: "🐋 Sperm Whale & Cuvier's Beaked Whale Dive (−2,250m)", x: 0.49 },
    { m: -3400, text: "🏮 Black Seadevil Anglerfish & Vent Shrimp (−3,400m)", x: 0.43 },
    { m: -5000, text: "🐙 Dumbo Octopus & Abyssal Tripod Fish (−5,000m)", x: 0.46 },
    { m: -8178, text: "🫧 Mariana Hadal Snailfish Deepest Fish (−8,178m)", x: 0.44 },
    { m: -10900, text: "🦐 Hadal Supergiant Amphipods (−10,900m)", x: 0.48 }
  ];

  ctx.textAlign = "left";
  for (const dc of depthCreatures) {
    const y = mToY(dc.m);
    const x = W * dc.x;
    ctx.fillStyle = "rgba(10, 18, 34, 0.78)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 6, y - 10, 295, 19, 9);
    ctx.fill();
    ctx.stroke();

    ctx.font = "600 10.5px 'Inter', sans-serif";
    ctx.fillStyle = "#F3F6FC";
    ctx.fillText(dc.text, x + 2, y + 3);
  }

  const yProbe = mToY(state.depthProbeM);
  ctx.strokeStyle = "#10B981";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(0, yProbe);
  ctx.lineTo(W, yProbe);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#10B981";
  ctx.beginPath();
  ctx.roundRect(245, yProbe - 11, 128, 22, 6);
  ctx.fill();
  ctx.fillStyle = "#040812";
  ctx.font = "700 11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText(`🤿 PROBE: ${state.depthProbeM > 0 ? "+" : ""}${state.depthProbeM}m`, 309, yProbe + 4);

  ctx.restore();
}

// ============================================================================
// RIGHT COLUMN: 1 KM² DENSITY SIMULATOR & DOT-MATRIX
// ============================================================================
function buildChamberParticles(densityVal, urbanPct) {
  const count = Math.max(1, Math.min(240, Math.round(densityVal)));
  const urbanCount = Math.round(count * (urbanPct / 100));
  const pts = [];
  const cols = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const isUrban = i < urbanCount;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const gx = (c + 0.5) / cols;
    const gy = (r + 0.5) / cols;

    const angle = (i * 2.39996) % (Math.PI * 2);
    const rad = isUrban ? (0.04 + 0.22 * Math.sqrt(i / Math.max(1, urbanCount))) : (0.30 + 0.17 * ((i * 7) % 13) / 13);
    const ux = 0.5 + Math.cos(angle) * rad;
    const uy = 0.5 + Math.sin(angle) * rad;

    pts.push({
      x: Math.random() * 0.86 + 0.07,
      y: Math.random() * 0.86 + 0.07,
      vx: (Math.random() - 0.5) * 0.0028,
      vy: (Math.random() - 0.5) * 0.0028,
      gx, gy, ux, uy,
      isUrban
    });
  }
  return pts;
}

function initDensityParticles() {
  const cA = getCountryA();
  const cB = getCountryB();
  const factor = state.unitSystem === "imperial" ? (1 / KM2_TO_MI2) : 1;
  const denA = (cA.pop / getTargetAreaKm2(cA, state.territoryScope)) * factor;
  const denB = (cB.pop / getTargetAreaKm2(cB, state.territoryScope)) * factor;
  particlesA = buildChamberParticles(denA, cA.urban);
  particlesB = buildChamberParticles(denB, cB.urban);
}

function renderChamberCanvas(canvasId, particles, colorHex) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(148,163,184,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.5, 0); ctx.lineTo(W * 0.5, H);
  ctx.moveTo(0, H * 0.5); ctx.lineTo(W, H * 0.5);
  ctx.stroke();

  if (state.densitySimMode === "urban") {
    ctx.beginPath();
    ctx.arc(W * 0.5, H * 0.5, Math.min(W, H) * 0.28, 0, Math.PI * 2);
    ctx.strokeStyle = colorHex;
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;
  }

  for (const p of particles) {
    if (state.densitySimMode === "grid") {
      p.x += (p.gx - p.x) * 0.14;
      p.y += (p.gy - p.y) * 0.14;
    } else if (state.densitySimMode === "urban") {
      p.x += (p.ux - p.x) * 0.10 + (Math.random() - 0.5) * 0.002;
      p.y += (p.uy - p.y) * 0.10 + (Math.random() - 0.5) * 0.002;
    } else {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0.05 || p.x > 0.95) p.vx *= -1;
      if (p.y < 0.05 || p.y > 0.95) p.vy *= -1;
    }

    const px = p.x * W;
    const py = p.y * H;
    ctx.beginPath();
    ctx.arc(px, py, p.isUrban ? 3.1 : 2.3, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.globalAlpha = p.isUrban ? 0.95 : 0.48;
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

function renderPopMatrix() {
  const canvas = document.getElementById("popMatrixCanvas");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const colors = getThemeColors();

  const cA = getCountryA();
  const cB = getCountryB();
  const maxPop = Math.max(cA.pop, cB.pop, 1);

  const rawUnit = maxPop / 110;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, rawUnit)));
  let unitPop = magnitude;
  if (rawUnit / magnitude > 5) unitPop = magnitude * 5;
  else if (rawUnit / magnitude > 2) unitPop = magnitude * 2;

  document.getElementById("matrixUnitBadge").textContent = `1 Dot = ${fmtPopShort(unitPop)}`;
  document.getElementById("matrixPctReadout").textContent =
    `${cA.iso3} = ${((cA.pop / Math.max(1, cB.pop)) * 100).toFixed(1)}% of ${cB.iso3}`;

  function drawDotRow(country, yTop, rowH, colHex) {
    const totalDots = Math.max(1, Math.round(country.pop / unitPop));
    const urbanDots = Math.round(totalDots * (country.urban / 100));

    ctx.font = "700 11.5px 'Space Grotesk', sans-serif";
    ctx.fillStyle = colors.text;
    ctx.textAlign = "left";
    ctx.fillText(`${country.flag} ${country.iso3}`, 10, yTop + rowH * 0.55);

    const startX = 72;
    const availW = W - startX - 14;
    const cols = Math.max(20, Math.floor(availW / 9.5));
    const rDot = 3.1;

    for (let i = 0; i < totalDots; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = startX + c * 9.5;
      const y = yTop + 12 + r * 9.5;
      if (y > yTop + rowH - 4) break;
      ctx.beginPath();
      ctx.arc(x, y, rDot, 0, Math.PI * 2);
      ctx.fillStyle = colHex;
      ctx.globalAlpha = i < urbanDots ? 0.95 : 0.30;
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  drawDotRow(cA, 6, H * 0.44, colors.colorA);
  ctx.strokeStyle = colors.graticule;
  ctx.beginPath();
  ctx.moveTo(10, H * 0.48); ctx.lineTo(W - 10, H * 0.48);
  ctx.stroke();
  drawDotRow(cB, H * 0.50, H * 0.48, colors.colorB);

  ctx.restore();
}

// ============================================================================
// INTERACTIVE CONTROLS & GSAP TRANSITIONS
// ============================================================================
export function selectPreset(isoA, isoB) {
  state.isoA = isoA;
  state.isoB = isoB;
  resetOverlayPositions(false);
  updateDashboardUI();
  if (state.stageMode === "globe") focusGlobeOn("mid");
  requestRenderAll();
}

export function swapCountries() {
  const tmp = state.isoA;
  state.isoA = state.isoB;
  state.isoB = tmp;
  const tmpOff = state.offsetA;
  state.offsetA = state.offsetB;
  state.offsetB = tmpOff;
  updateDashboardUI();
  requestRenderAll();
}

export function setUnitSystem(sys) {
  state.unitSystem = sys;
  document.getElementById("btnUnitMetric").classList.toggle("active", sys === "metric");
  document.getElementById("btnUnitImperial").classList.toggle("active", sys === "imperial");
  updateDashboardUI();
  requestRenderAll();
}

export function setTerritoryScope(scope) {
  state.territoryScope = scope;
  document.getElementById("btnScopeFull").classList.toggle("active", scope === "full");
  document.getElementById("btnScopeMainland").classList.toggle("active", scope === "mainland");
  updateDashboardUI();
  requestRenderAll();
}

export function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  document.getElementById("themeIcon").textContent = state.theme === "dark" ? "☀️" : "🌙";
  document.getElementById("themeLabel").textContent = state.theme === "dark" ? "Paper Mode" : "Obsidian Mode";
  updateDashboardUI();
  requestRenderAll();
}

export function switchStageMode(mode) {
  state.stageMode = mode;
  document.getElementById("tabModeOverlay").classList.toggle("active", mode === "overlay");
  document.getElementById("tabModeGlobe").classList.toggle("active", mode === "globe");
  const tabPrism = document.getElementById("tabModePrism3d");
  if (tabPrism) tabPrism.classList.toggle("active", mode === "prism3d");
  document.getElementById("tabModePacking").classList.toggle("active", mode === "packing");
  document.getElementById("tabModeGeom").classList.toggle("active", mode === "geom");
  const tabDepth = document.getElementById("tabModeDepth");
  if (tabDepth) tabDepth.classList.toggle("active", mode === "depth");
  const tabTax = document.getElementById("tabModeTax");
  if (tabTax) tabTax.classList.toggle("active", mode === "tax");

  const mainWrap = document.getElementById("mainCanvasWrap");
  const map2dCanvas = document.getElementById("mainMapCanvas");
  const globeWebGLCanvas = document.getElementById("globeWebGLCanvas");
  const prismView = document.getElementById("prism3dStageView");
  const packView = document.getElementById("packingStageView");
  const geomView = document.getElementById("geomStageView");
  const depthView = document.getElementById("depthStageView");
  const taxView = document.getElementById("taxStageView");

  mainWrap.style.display = (mode === "overlay" || mode === "globe") ? "block" : "none";
  if (map2dCanvas) map2dCanvas.style.display = mode === "overlay" ? "block" : "none";
  if (globeWebGLCanvas) globeWebGLCanvas.style.display = mode === "globe" ? "block" : "none";

  if (prismView) prismView.classList.toggle("active", mode === "prism3d");
  packView.classList.toggle("active", mode === "packing");
  geomView.classList.toggle("active", mode === "geom");
  if (depthView) depthView.classList.toggle("active", mode === "depth");
  if (taxView) taxView.classList.toggle("active", mode === "tax");

  document.getElementById("overlayLayoutSwitch").style.display = mode === "overlay" ? "inline-flex" : "none";
  document.getElementById("hudOverlayControls").style.display = mode === "overlay" ? "flex" : "none";
  document.getElementById("hudGlobeControls").style.display = mode === "globe" ? "flex" : "none";

  document.getElementById("hudProjectionBadge").textContent =
    mode === "globe" ? "Three.js 3D WebGL Geodesic Globe" : "1:1 Lambert Equal-Area";
  document.getElementById("hudInstructionChip").innerHTML =
    mode === "globe"
      ? `<span>🌐 Drag 3D WebGL Globe to Orbit • Flight Arc: <strong>${getCountryA().capital} ↔ ${getCountryB().capital}</strong></span>`
      : `<span>✋ Drag <strong style="color:var(--country-a)">${getCountryA().name}</strong> anywhere over <strong style="color:var(--country-b)">${getCountryB().name}</strong> • Scroll to Zoom</span>`;

  if (mode === "globe") focusGlobeOn("mid");
  if (mode === "prism3d") updatePrismHUD(getCountryA(), getCountryB());
  if (mode === "packing") renderPackingMatrix();
  if (mode === "geom") renderGeometricStage();
  if (mode === "depth") setDepthProbe(state.depthProbeM);
  if (mode === "tax") renderTaxCompareCanvas();
  requestRenderAll();
}

export function setPrismHeightMetric(metric) {
  if (!threeEngine) return;
  threeEngine.prismHeightMetric = metric;
  document.getElementById("btnPrismDensity").classList.toggle("active", metric === "density");
  document.getElementById("btnPrismElev").classList.toggle("active", metric === "elevation");
  document.getElementById("btnPrismGdp").classList.toggle("active", metric === "gdp");
  const btnTax = document.getElementById("btnPrismTax");
  if (btnTax) btnTax.classList.toggle("active", metric === "tax");
  updatePrismHUD(getCountryA(), getCountryB());
  requestRenderAll();
}

export function togglePrismAutoRotate() {
  if (!threeEngine) return;
  threeEngine.prismAutoRotate = !threeEngine.prismAutoRotate;
  document.getElementById("btnPrismSpin").classList.toggle("active", threeEngine.prismAutoRotate);
}

export function setOverlayLayout(layout) {
  state.overlayLayout = layout;
  document.getElementById("btnLayoutSuper").classList.toggle("active", layout === "superimposed");
  document.getElementById("btnLayoutSplit").classList.toggle("active", layout === "split");
  resetOverlayPositions(false);
  requestRenderAll();
}

export function zoomCanvas(factor) {
  const targetZoom = Math.max(0.35, Math.min(18, state.zoom * factor));
  if (window.gsap) {
    window.gsap.to(state, {
      zoom: targetZoom,
      duration: 0.25,
      ease: "power2.out",
      onUpdate: () => requestRenderAll()
    });
  } else {
    state.zoom = targetZoom;
    requestRenderAll();
  }
}

export function resetOverlayPositions(render = true) {
  state.zoom = 1.0;
  state.panX = 0;
  state.panY = 0;
  state.offsetA = { x: 0, y: 0 };
  state.offsetB = { x: 0, y: 0 };
  setRotationA(0);
  if (render) requestRenderAll();
}

export function toggleTopLayer() {
  state.topLayer = state.topLayer === "A" ? "B" : "A";
  requestRenderAll();
}

export function toggleCompactInsets() {
  state.compactInsets = !state.compactInsets;
  document.getElementById("btnCompactInsets").classList.toggle("active", state.compactInsets);
  requestRenderAll();
}

export function setRotationA(deg) {
  state.rotationA = Number(deg);
  const slider = document.getElementById("rotateSliderA");
  const lbl = document.getElementById("rotateValLabel");
  if (slider) slider.value = state.rotationA;
  if (lbl) lbl.textContent = `${state.rotationA}°`;
  requestRenderAll();
}

export function focusGlobeOn(target) {
  const cA = getCountryA();
  const cB = getCountryB();
  state.globeAutoSpin = false;
  const spinBtn = document.getElementById("btnGlobeSpin");
  if (spinBtn) spinBtn.classList.remove("active");

  let targetLng = cA.lng, targetLat = cA.lat;
  if (target === "B") {
    targetLng = cB.lng;
    targetLat = cB.lat;
  } else if (target === "mid") {
    const [mLat, mLng] = slerpLatLng(cA.capLat, cA.capLng, cB.capLat, cB.capLng, 0.5);
    targetLng = mLng;
    targetLat = mLat;
  }

  if (window.gsap) {
    window.gsap.to(state.globeRot, {
      lng: targetLng,
      lat: targetLat,
      duration: 0.85,
      ease: "power3.out",
      onUpdate: () => requestRenderAll()
    });
  } else {
    state.globeRot.lng = targetLng;
    state.globeRot.lat = targetLat;
    requestRenderAll();
  }
}

export function toggleGlobeSpin() {
  state.globeAutoSpin = !state.globeAutoSpin;
  document.getElementById("btnGlobeSpin").classList.toggle("active", state.globeAutoSpin);
}

export function setPackingMetric(metric) {
  state.packingMetric = metric;
  document.getElementById("btnPackArea").classList.toggle("active", metric === "area");
  document.getElementById("btnPackPop").classList.toggle("active", metric === "pop");
  renderPackingMatrix();
}

export function setGeomShape(shape) {
  state.geomShape = shape;
  document.getElementById("btnShapeCircle").classList.toggle("active", shape === "circle");
  document.getElementById("btnShapeSquare").classList.toggle("active", shape === "square");
  renderGeometricStage();
}

export function setDensitySimMode(mode) {
  state.densitySimMode = mode;
  document.getElementById("btnSimCrowd").classList.toggle("active", mode === "crowd");
  document.getElementById("btnSimUrban").classList.toggle("active", mode === "urban");
  document.getElementById("btnSimGrid").classList.toggle("active", mode === "grid");
}

export function setTelemetryScale(sc) {
  state.telemetryScale = sc;
  document.getElementById("btnScaleLinear").classList.toggle("active", sc === "linear");
  document.getElementById("btnScaleLog").classList.toggle("active", sc === "log");
  renderTelemetryTable();
}

export function pickRandomMatchup() {
  const pool = state.countriesDb.filter(c => c.area > 5000);
  if (pool.length < 2) return;
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b = pool[Math.floor(Math.random() * pool.length)];
  if (b.iso3 === a.iso3) b = state.countryByIso3["USA"] || pool[0];
  selectPreset(a.iso3, b.iso3);
}

// ============================================================================
// COUNTRY PICKER MODAL
// ============================================================================
export function openCountryPicker(slot) {
  state.pickerTargetSlot = slot;
  document.getElementById("pickerModalTitle").textContent =
    slot === "A" ? "Select Primary Entity A (Draggable Overlay)" : "Select Reference Entity B (Base Comparison)";
  document.getElementById("pickerSearchInput").value = "";
  document.getElementById("pickerModalBackdrop").classList.add("open");
  renderPickerList();
  setTimeout(() => document.getElementById("pickerSearchInput").focus(), 40);
}

export function closeCountryPicker() {
  document.getElementById("pickerModalBackdrop").classList.remove("open");
}

export function setPickerRegion(reg) {
  state.pickerRegion = reg;
  const tabs = document.querySelectorAll("#pickerRegionTabs .region-tab");
  tabs.forEach(t => t.classList.toggle("active", t.textContent.includes(reg) || (reg === "All" && t.textContent.startsWith("All"))));
  renderPickerList();
}

export function renderPickerList() {
  const q = (document.getElementById("pickerSearchInput").value || "").trim().toLowerCase();
  const filtered = state.countriesDb.filter(c => {
    if (state.pickerRegion !== "All" && c.region !== state.pickerRegion) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.iso3.toLowerCase().includes(q) ||
      c.capital.toLowerCase().includes(q)
    );
  });

  const container = document.getElementById("pickerListContainer");
  container.innerHTML = filtered.map(c => `
    <div class="picker-item" onclick="chooseCountryFromPicker('${c.iso3}')">
      <div class="picker-item-left">
        <span class="picker-flag">${c.flag}</span>
        <div>
          <div class="picker-item-name">${c.name}</div>
          <div class="picker-item-sub">${c.iso3} • ${c.capital}</div>
        </div>
      </div>
      <div class="picker-item-right" style="display:flex;align-items:center;gap:8px;">
        <div>
          <div>${fmtArea(c.area, true)}</div>
          <div style="color:var(--text-muted)">${fmtPopShort(c.pop)} ${c.entityType === "ocean" ? "t" : "pop"}</div>
        </div>
        <button type="button" class="hud-btn" onclick="event.stopPropagation();closeCountryPicker();openWikiModal('${c.iso3}')" title="Open Mini-Wikipedia Page for ${c.name}">📖</button>
      </div>
    </div>
  `).join("");
}

export function chooseCountryFromPicker(iso3) {
  if (state.pickerTargetSlot === "A") state.isoA = iso3;
  else state.isoB = iso3;
  closeCountryPicker();
  resetOverlayPositions(false);
  updateDashboardUI();
  requestRenderAll();
}

// ============================================================================
// POINTER / DRAG / ZOOM INTERACTIONS (WITH BUG #3 EXACT RAY-CASTING FIX)
// ============================================================================
function setupCanvasInteractions() {
  const mainCanvas = document.getElementById("mainMapCanvas");
  const globeCanvas = document.getElementById("globeWebGLCanvas");
  const prismCanvas = document.getElementById("prism3dCanvas");

  function getRelXY(el, e) {
    const rect = el.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // 1. 2D True-Scale Overlay Canvas Interactions (with exact Ray-Casting Hit-Testing)
  if (mainCanvas) {
    mainCanvas.addEventListener("pointerdown", e => {
      const pt = getRelXY(mainCanvas, e);
      state.dragStartMouse = pt;

      const posA = state._screenPosA || { x: 0, y: 0, pxPerKm: 1 };
      const posB = state._screenPosB || { x: 0, y: 0, pxPerKm: 1 };
      const projA = projectEntity(getCountryA());
      const projB = projectEntity(getCountryB());

      const hitA = isPointInProjectedCountry(pt.x, pt.y, projA, posA, state.rotationA);
      const hitB = isPointInProjectedCountry(pt.x, pt.y, projB, posB, 0);

      // Respect state.topLayer priority when both polygons overlap under cursor
      if (state.topLayer === "A") {
        if (hitA) {
          state.draggingTarget = "A";
          state.dragStartOffset = { ...state.offsetA };
        } else if (hitB) {
          state.draggingTarget = "B";
          state.dragStartOffset = { ...state.offsetB };
        } else {
          state.draggingTarget = "pan";
          state.dragStartOffset = { x: state.panX, y: state.panY };
        }
      } else {
        if (hitB) {
          state.draggingTarget = "B";
          state.dragStartOffset = { ...state.offsetB };
        } else if (hitA) {
          state.draggingTarget = "A";
          state.dragStartOffset = { ...state.offsetA };
        } else {
          state.draggingTarget = "pan";
          state.dragStartOffset = { x: state.panX, y: state.panY };
        }
      }
      mainCanvas.setPointerCapture(e.pointerId);
    });

    mainCanvas.addEventListener("pointermove", e => {
      if (!state.draggingTarget) return;
      const pt = getRelXY(mainCanvas, e);
      const dx = pt.x - state.dragStartMouse.x;
      const dy = pt.y - state.dragStartMouse.y;
      const pxPerKm = (state._screenPosA && state._screenPosA.pxPerKm) || 1;

      if (state.draggingTarget === "A") {
        state.offsetA.x = state.dragStartOffset.x + dx / pxPerKm;
        state.offsetA.y = state.dragStartOffset.y + dy / pxPerKm;
      } else if (state.draggingTarget === "B") {
        state.offsetB.x = state.dragStartOffset.x + dx / pxPerKm;
        state.offsetB.y = state.dragStartOffset.y + dy / pxPerKm;
      } else if (state.draggingTarget === "pan") {
        state.panX = state.dragStartOffset.x + dx;
        state.panY = state.dragStartOffset.y + dy;
      }
      requestRenderAll();
    });

    mainCanvas.addEventListener("pointerup", () => { state.draggingTarget = null; });
    mainCanvas.addEventListener("wheel", e => {
      e.preventDefault();
      zoomCanvas(e.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });
  }

  // 2. Three.js 3D WebGL Globe Interactions
  if (globeCanvas) {
    globeCanvas.addEventListener("pointerdown", e => {
      const pt = getRelXY(globeCanvas, e);
      state.dragStartMouse = pt;
      state.draggingTarget = "globe";
      state.globeAutoSpin = false;
      const spinBtn = document.getElementById("btnGlobeSpin");
      if (spinBtn) spinBtn.classList.remove("active");
      state.dragStartOffset = { lng: state.globeRot.lng, lat: state.globeRot.lat };
      globeCanvas.setPointerCapture(e.pointerId);
    });

    globeCanvas.addEventListener("pointermove", e => {
      if (state.draggingTarget !== "globe") return;
      const pt = getRelXY(globeCanvas, e);
      const dx = pt.x - state.dragStartMouse.x;
      const dy = pt.y - state.dragStartMouse.y;
      state.globeRot.lng = state.dragStartOffset.lng - dx * 0.35;
      state.globeRot.lat = Math.max(-80, Math.min(80, state.dragStartOffset.lat + dy * 0.35));
      requestRenderAll();
    });

    globeCanvas.addEventListener("pointerup", () => { state.draggingTarget = null; });
  }

  // 3. Three.js 3D Volumetric Prisms Stage Interactions
  if (prismCanvas) {
    prismCanvas.addEventListener("pointerdown", e => {
      if (!threeEngine) return;
      const pt = getRelXY(prismCanvas, e);
      state.dragStartMouse = pt;
      state.draggingTarget = "prism";
      threeEngine.prismAutoRotate = false;
      const spinBtn = document.getElementById("btnPrismSpin");
      if (spinBtn) spinBtn.classList.remove("active");
      state.dragStartOffset = { yaw: threeEngine.prismYaw, pitch: threeEngine.prismPitch };
      prismCanvas.setPointerCapture(e.pointerId);
    });

    prismCanvas.addEventListener("pointermove", e => {
      if (state.draggingTarget !== "prism" || !threeEngine) return;
      const pt = getRelXY(prismCanvas, e);
      const dx = pt.x - state.dragStartMouse.x;
      const dy = pt.y - state.dragStartMouse.y;
      threeEngine.prismYaw = state.dragStartOffset.yaw - dx * 0.008;
      threeEngine.prismPitch = Math.max(0.15, Math.min(1.38, state.dragStartOffset.pitch + dy * 0.006));
      requestRenderAll();
    });

    prismCanvas.addEventListener("pointerup", () => { state.draggingTarget = null; });
    prismCanvas.addEventListener("wheel", e => {
      if (!threeEngine) return;
      e.preventDefault();
      threeEngine.prismZoom = Math.max(0.45, Math.min(3.0, threeEngine.prismZoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      requestRenderAll();
    }, { passive: false });
  }

  // 4. Packing Matrix Hover Inspector
  const packCanvas = document.getElementById("packingCanvas");
  if (packCanvas) {
    packCanvas.addEventListener("pointermove", e => {
      const rect = packCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let found = -1;
      for (const b of state.packingTileBoxes) {
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          found = b.idx;
          const cumVal = b.cumUnits * b.smallVal;
          const valFmt = state.packingMetric === "area" ? fmtArea(cumVal, true) : `${fmtInt(cumVal)} people`;
          document.getElementById("packingHoverReadout").innerHTML =
            `Tile <strong>#${b.idx + 1}</strong> (${b.cumUnits.toFixed(2)} × ${b.smallC.name}) → Cumulative: <strong style="color:var(--country-a)">${valFmt}</strong>`;
          break;
        }
      }
      if (found !== state.packingHoverIndex) {
        state.packingHoverIndex = found;
        renderPackingMatrix();
      }
    });
  }

  const depthCanvas = document.getElementById("depthCrossCanvas");
  if (depthCanvas) {
    depthCanvas.addEventListener("pointerdown", e => {
      const rect = depthCanvas.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientY - rect.top - 18) / (rect.height - 36)));
      const m = Math.round((6500 - frac * (6500 - (-11200))) / 25) * 25;
      setDepthProbe(Math.max(-11000, Math.min(6500, m)));
    });
  }

  window.addEventListener("resize", () => {
    requestRenderAll();
    renderPopMatrix();
    if (state.stageMode === "packing") renderPackingMatrix();
    if (state.stageMode === "geom") renderGeometricStage();
    if (state.stageMode === "depth") renderDepthCrossCanvas();
    if (state.stageMode === "tax") renderTaxCompareCanvas();
  });

  window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeCountryPicker();
      closeWikiModal();
    }
  });
}

// ============================================================================
// HIGH-RESOLUTION PNG POSTER EXPORT
// ============================================================================
export function exportComparisonPoster() {
  const cA = getCountryA();
  const cB = getCountryB();
  const areaA = getTargetAreaKm2(cA, state.territoryScope);
  const areaB = getTargetAreaKm2(cB, state.territoryScope);
  const projA = projectEntity(cA);
  const projB = projectEntity(cB);

  const off = document.createElement("canvas");
  off.width = 1600;
  off.height = 920;
  const ctx = off.getContext("2d");

  ctx.fillStyle = "#070B12";
  ctx.fillRect(0, 0, 1600, 920);

  ctx.fillStyle = "#0E1524";
  ctx.fillRect(0, 0, 1600, 110);
  ctx.font = "700 30px 'Space Grotesk', sans-serif";
  ctx.fillStyle = "#F3F6FC";
  ctx.fillText(`TERRA // SCALE — ${cA.flag} ${cA.name} vs ${cB.flag} ${cB.name}`, 44, 54);
  ctx.font = "500 17px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#9BA8C2";
  const areaRatio = (Math.max(areaA, areaB) / Math.min(areaA, areaB)).toFixed(2);
  const popRatio = (Math.max(cA.pop, cB.pop) / Math.min(cA.pop, cB.pop)).toFixed(2);
  ctx.fillText(`Surface Ratio: 1 : ${areaRatio}   |   Population Ratio: 1 : ${popRatio}   |   1:1 Lambert Azimuthal Equal-Area`, 44, 86);

  const scale = Math.min(620 / Math.max(projA.widthKm, projB.widthKm), 480 / Math.max(projA.heightKm, projB.heightKm));
  drawProjectedCountry(ctx, projB, 800, 430, scale, 0, "#FF5E36", "rgba(255,94,54,0.24)", cB, false);
  drawProjectedCountry(ctx, projA, 800, 430, scale, state.rotationA, "#00E5FF", "rgba(0,229,255,0.34)", cA, true);

  ctx.fillStyle = "#0E1524";
  ctx.fillRect(44, 730, 730, 145);
  ctx.strokeStyle = "#00E5FF";
  ctx.lineWidth = 2;
  ctx.strokeRect(44, 730, 730, 145);

  ctx.fillStyle = "#00E5FF";
  ctx.font = "700 24px 'Space Grotesk', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${cA.flag} ${cA.name} (${cA.iso3})`, 68, 772);
  ctx.fillStyle = "#F3F6FC";
  ctx.font = "600 18px 'JetBrains Mono', monospace";
  ctx.fillText(`Surface: ${fmtArea(areaA, true)}   |   Pop: ${fmtInt(cA.pop)}`, 68, 812);
  ctx.fillStyle = "#9BA8C2";
  ctx.fillText(`Density: ${(cA.pop / areaA).toFixed(1)} /km²   |   Capital: ${cA.capital}`, 68, 848);

  ctx.fillStyle = "#0E1524";
  ctx.fillRect(826, 730, 730, 145);
  ctx.strokeStyle = "#FF5E36";
  ctx.strokeRect(826, 730, 730, 145);

  ctx.fillStyle = "#FF5E36";
  ctx.font = "700 24px 'Space Grotesk', sans-serif";
  ctx.fillText(`${cB.flag} ${cB.name} (${cB.iso3})`, 850, 772);
  ctx.fillStyle = "#F3F6FC";
  ctx.font = "600 18px 'JetBrains Mono', monospace";
  ctx.fillText(`Surface: ${fmtArea(areaB, true)}   |   Pop: ${fmtInt(cB.pop)}`, 850, 812);
  ctx.fillStyle = "#9BA8C2";
  ctx.fillText(`Density: ${(cB.pop / areaB).toFixed(1)} /km²   |   Capital: ${cB.capital}`, 850, 848);

  const link = document.createElement("a");
  link.download = `terra-scale-${cA.iso3.toLowerCase()}-vs-${cB.iso3.toLowerCase()}.png`;
  link.href = off.toDataURL("image/png");
  link.click();
}

export function requestRenderAll() {
  renderRequested = true;
}

function tickAnimation() {
  const colors = getThemeColors();
  renderChamberCanvas("densityCanvasA", particlesA, colors.colorA);
  renderChamberCanvas("densityCanvasB", particlesB, colors.colorB);

  if (state.stageMode === "globe") {
    state.arcPulseT = (state.arcPulseT + 0.007) % 1;
    if (state.globeAutoSpin && !state.draggingTarget) {
      state.globeRot.lng += 0.16;
    }
    renderRequested = true;
  } else if (state.stageMode === "prism3d") {
    if (threeEngine && threeEngine.prismAutoRotate && !state.draggingTarget) {
      renderRequested = true;
    }
  }

  if (renderRequested) {
    renderRequested = false;
    renderMainCanvas();
  }
  requestAnimationFrame(tickAnimation);
}

// ============================================================================
// BOOTLOADER & WINDOW EXPORTS
// ============================================================================
async function bootApp() {
  try {
    const [countriesDb, oceanPolygons, wikiDeepDb, taxesDb, worldTopo, extra50m] = await Promise.all([
      fetch("/data/countries-db.json").then(r => r.json()),
      fetch("/data/ocean-polygons.json").then(r => r.json()),
      fetch("/data/wiki-deep.json").then(r => r.json()),
      fetch("/data/taxes-db.json").then(r => r.json()),
      fetch("/data/world-110m.json").then(r => r.json()),
      fetch("/data/extra-50m.json").then(r => r.json())
    ]);

    state.countriesDb = countriesDb;
    state.oceanPolygons = oceanPolygons;
    state.wikiDeepDb = wikiDeepDb;
    state.taxesDb = taxesDb;

    for (const c of countriesDb) {
      state.countryByIso3[c.iso3] = c;
      if (c.id) state.countryById[String(c.id).padStart(3, "0")] = c;
    }

    const decoded = decodeTopoJSON(worldTopo);
    state.geomsById = decoded.outMap;
    state.allWorldFeatures = decoded.features;

    if (extra50m) {
      for (const [id, geom] of Object.entries(extra50m)) {
        const padId = String(id).padStart(3, "0");
        state.geomsById[padId] = geom;
      }
    }

    threeEngine = new TerraThreeEngine({
      state,
      getCountryA,
      getCountryB,
      getProjectedCountry: projectEntity,
      getBiosphereProfile,
      countryById: state.countryById,
      oceanPolygons: state.oceanPolygons,
      getThemeColors
    });

    const badge = document.getElementById("webglStatusBadge");
    if (badge) {
      badge.textContent = typeof window.THREE !== "undefined" ? "THREE.JS 3D WEBGL ACTIVE" : "2D CANVAS ENGINE";
    }

    setupCanvasInteractions();
    updateDashboardUI();
    requestRenderAll();
    requestAnimationFrame(tickAnimation);
  } catch (err) {
    console.error("Failed to boot TERRA // SCALE:", err);
  }
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    selectPreset,
    swapCountries,
    setUnitSystem,
    setTerritoryScope,
    toggleTheme,
    switchStageMode,
    setPrismHeightMetric,
    togglePrismAutoRotate,
    setOverlayLayout,
    zoomCanvas,
    resetOverlayPositions,
    toggleTopLayer,
    toggleCompactInsets,
    setRotationA,
    focusGlobeOn,
    toggleGlobeSpin,
    setPackingMetric,
    setGeomShape,
    setDensitySimMode,
    setTelemetryScale,
    pickRandomMatchup,
    openCountryPicker,
    closeCountryPicker,
    setPickerRegion,
    renderPickerList,
    chooseCountryFromPicker,
    setDepthProbe,
    setTaxCalcGross,
    setTaxCalcRegime,
    openWikiModal,
    closeWikiModal,
    switchWikiTab,
    setCountryFromWiki,
    exportComparisonPoster
  });

  window.addEventListener("DOMContentLoaded", bootApp);
}
