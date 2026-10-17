// ============================================================================
// CORE CARTOGRAPHIC, GEOMETRIC & SPHERICAL MATH ENGINE (PURE ES MODULE)
// ============================================================================
export const EARTH_RADIUS_KM = 6371.0088;
export const DEG2RAD = Math.PI / 180;
export const KM2_TO_MI2 = 0.386102;
export const KM_TO_MI = 0.621371;

/**
 * Unwraps a ring of [lng, lat] vertices so consecutive longitudes never jump
 * across the ±180° antimeridian by more than 180°, anchored relative to lng0.
 */
export function unwrapRingLongitudes(ring, lng0 = 0) {
  if (!ring || ring.length === 0) return [];
  const out = new Array(ring.length);

  let prevLng = ring[0][0];
  while (prevLng - lng0 > 180) prevLng -= 360;
  while (prevLng - lng0 < -180) prevLng += 360;
  out[0] = [prevLng, ring[0][1]];

  for (let i = 1; i < ring.length; i++) {
    let lng = ring[i][0];
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    out[i] = [lng, ring[i][1]];
    prevLng = lng;
  }
  return out;
}

/**
 * Lambert Azimuthal Equal-Area projection in kilometers relative to (lng0, lat0).
 * Preserves 1:1 surface area everywhere on the sphere.
 */
export function lambertEqualAreaKm(lng, lat, lng0, lat0, preUnwrapped = false) {
  const lam = lng * DEG2RAD;
  const phi = Math.max(-89.999, Math.min(89.999, lat)) * DEG2RAD;
  const lam0 = lng0 * DEG2RAD;
  const phi0 = Math.max(-89.999, Math.min(89.999, lat0)) * DEG2RAD;

  let dLam = lam - lam0;
  if (!preUnwrapped) {
    while (dLam > Math.PI) dLam -= Math.PI * 2;
    while (dLam < -Math.PI) dLam += Math.PI * 2;
  } else {
    const maxDLam = Math.PI * 0.985;
    if (dLam > maxDLam) dLam = maxDLam;
    if (dLam < -maxDLam) dLam = -maxDLam;
  }

  const sinPhi0 = Math.sin(phi0), cosPhi0 = Math.cos(phi0);
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const cosDLam = Math.cos(dLam), sinDLam = Math.sin(dLam);

  const cosC = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDLam;
  if (cosC < -0.995) return [0, 0];
  const k = Math.sqrt(2 / Math.max(1e-7, 1 + cosC));
  const xKm = EARTH_RADIUS_KM * k * cosPhi * sinDLam;
  const yKm = -EARTH_RADIUS_KM * k * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDLam);
  return [xKm, yKm];
}

/**
 * Unsigned area of a 2D closed ring in km² using the Shoelace formula.
 */
export function ringSignedAreaKm2(ring) {
  if (!ring || ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    sum += (p1[0] * p2[1] - p2[0] * p1[1]);
  }
  return Math.abs(sum) * 0.5;
}

/**
 * Computes net area of a polygon [outerRing, ...holeRings] in km².
 */
export function polygonAreaKm2(rings) {
  if (!rings || rings.length === 0) return 0;
  let area = ringSignedAreaKm2(rings[0]);
  for (let i = 1; i < rings.length; i++) {
    area -= ringSignedAreaKm2(rings[i]);
  }
  return Math.max(0, area);
}

/**
 * Computes arithmetic centroid of an unwrapped [lng, lat] ring.
 */
export function ringCentroidLngLat(ring, anchorLng = 0) {
  if (!ring || ring.length === 0) return [0, 0];
  const unwrapped = unwrapRingLongitudes(ring, anchorLng);
  let sx = 0, sy = 0;
  for (let i = 0; i < unwrapped.length; i++) {
    sx += unwrapped[i][0];
    sy += unwrapped[i][1];
  }
  const n = unwrapped.length;
  let avgLng = sx / n;
  while (avgLng > 180) avgLng -= 360;
  while (avgLng < -180) avgLng += 360;
  return [avgLng, sy / n];
}

/**
 * Ray-casting point-in-ring test in 2D km coordinates.
 */
export function pointInRingKm(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Exact hit-test for whether canvas pixel (px, py) falls inside a projected country
 * (accounting for translation screenPos, scale pxPerKm, and rotation rotDeg).
 */
export function isPointInProjectedCountry(px, py, proj, screenPos, rotDeg = 0) {
  if (!proj || !screenPos) return false;
  const dxPx = px - screenPos.x;
  const dyPx = py - screenPos.y;

  if (Math.hypot(dxPx, dyPx) <= 26) return true;

  const pxPerKm = screenPos.pxPerKm || 1;
  const rad = -(rotDeg || 0) * DEG2RAD;
  const cosR = Math.cos(rad), sinR = Math.sin(rad);
  const localKmX = (dxPx * cosR - dyPx * sinR) / pxPerKm;
  const localKmY = (dxPx * sinR + dyPx * cosR) / pxPerKm;

  if (
    localKmX < proj.minX - 15 || localKmX > proj.maxX + 15 ||
    localKmY < proj.minY - 15 || localKmY > proj.maxY + 15
  ) {
    return false;
  }

  for (const poly of proj.polys) {
    if (pointInRingKm(localKmX, localKmY, poly.rings[0])) {
      let inHole = false;
      for (let h = 1; h < poly.rings.length; h++) {
        if (pointInRingKm(localKmX, localKmY, poly.rings[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/**
 * Great-circle Haversine distance in kilometers.
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Spherical linear interpolation (SLERP) along a great-circle arc.
 */
export function slerpLatLng(lat1, lng1, lat2, lng2, t) {
  const p1 = [
    Math.cos(lat1 * DEG2RAD) * Math.cos(lng1 * DEG2RAD),
    Math.cos(lat1 * DEG2RAD) * Math.sin(lng1 * DEG2RAD),
    Math.sin(lat1 * DEG2RAD)
  ];
  const p2 = [
    Math.cos(lat2 * DEG2RAD) * Math.cos(lng2 * DEG2RAD),
    Math.cos(lat2 * DEG2RAD) * Math.sin(lng2 * DEG2RAD),
    Math.sin(lat2 * DEG2RAD)
  ];
  const dot = Math.max(-1, Math.min(1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-5) return [lat1, lng1];
  const sinO = Math.sin(omega);
  const k1 = Math.sin((1 - t) * omega) / sinO;
  const k2 = Math.sin(t * omega) / sinO;
  const x = k1 * p1[0] + k2 * p2[0];
  const y = k1 * p1[1] + k2 * p2[1];
  const z = k1 * p1[2] + k2 * p2[2];
  const lat = Math.atan2(z, Math.hypot(x, y)) / DEG2RAD;
  const lng = Math.atan2(y, x) / DEG2RAD;
  return [lat, lng];
}

/**
 * Converts (lat, lng) in degrees to 3D Cartesian coordinates {x, y, z} on a Three.js sphere of radius R.
 */
export function latLngToVector3(lat, lng, radius = 1.0) {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lng + 180) * DEG2RAD;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const vec = [x, y, z];
  vec.x = x;
  vec.y = y;
  vec.z = z;
  return vec;
}

/**
 * Web Mercator area inflation factor 1 / cos²(lat) at a given latitude.
 */
export function mercatorInflationFactor(latDeg) {
  const clampedLat = Math.max(-85, Math.min(85, latDeg));
  return 1 / (Math.cos(clampedLat * DEG2RAD) ** 2);
}
