// ============================================================================
// TERRA // SCALE — Three.js 3D WebGL Globe & 3D Volumetric Prism Engine
// ============================================================================
import { slerpLatLng, latLngToVector3 } from "./core-math.mjs";
import { doesEntityContainFeature } from "./data-engine.mjs";

export class TerraThreeEngine {
  constructor(context) {
    this.ctx = context; // { state, getCountryA, getCountryB, getProjectedCountry, getBiosphereProfile, countryById, oceanPolygons, getThemeColors }
    this.globeScene = null;
    this.globeCamera = null;
    this.globeRenderer = null;
    this.globeGroup = null;
    this.earthMesh = null;
    this.atmosMesh = null;
    this.arcGroup = null;
    this.pulseOrb = null;
    this.starField = null;
    this.globeTextureCanvas = null;
    this.globeTexture = null;
    this.lastTextureSignature = "";
    this.arcCurvePoints = [];

    // 3D Volumetric Prism Stage
    this.prismScene = null;
    this.prismCamera = null;
    this.prismRenderer = null;
    this.prismGroup = null;
    this.prismYaw = -0.52;
    this.prismPitch = 0.62;
    this.prismZoom = 1.0;
    this.prismAutoRotate = true;
    this.prismHeightMetric = "density"; // 'density' | 'elevation' | 'gdp'
    this.lastPrismSignature = "";
  }

  hasWebGL() {
    return typeof window !== "undefined" && typeof window.THREE !== "undefined";
  }

  // ==========================================================================
  // 1. THREE.JS 3D WEBGL ORBITAL GLOBE STUDIO
  // ==========================================================================
  initGlobeWebGL(canvas) {
    if (!this.hasWebGL() || !canvas) return false;
    if (this.globeRenderer) return true;

    const THREE = window.THREE;
    try {
      this.globeRenderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
      });
      this.globeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch (e) {
      this.globeRenderer = null;
      return false;
    }

    this.globeScene = new THREE.Scene();
    this.globeCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.globeCamera.position.set(0, 0, 3.25);

    // Ambient + Key + Rim lighting
    const ambient = new THREE.AmbientLight(0xdbeafe, 1.35);
    this.globeScene.add(ambient);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.45);
    sunLight.position.set(4, 3, 5);
    this.globeScene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    rimLight.position.set(-4, -2, -3);
    this.globeScene.add(rimLight);

    // Starfield particles
    const starCount = 1200;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 12 + Math.random() * 18;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.055,
      transparent: true,
      opacity: 0.65
    });
    this.starField = new THREE.Points(starGeom, starMat);
    this.globeScene.add(this.starField);

    // Globe Group
    this.globeGroup = new THREE.Group();
    this.globeScene.add(this.globeGroup);

    // Offscreen 2048x1024 equirectangular canvas for ultra-crisp country/continent/ocean rendering
    this.globeTextureCanvas = document.createElement("canvas");
    this.globeTextureCanvas.width = 2048;
    this.globeTextureCanvas.height = 1024;
    this.globeTexture = new THREE.CanvasTexture(this.globeTextureCanvas);
    this.globeTexture.anisotropy = 4;

    const sphereGeom = new THREE.SphereGeometry(1.0, 72, 72);
    const sphereMat = new THREE.MeshStandardMaterial({
      map: this.globeTexture,
      roughness: 0.68,
      metalness: 0.12
    });
    this.earthMesh = new THREE.Mesh(sphereGeom, sphereMat);
    this.globeGroup.add(this.earthMesh);

    // Outer Atmospheric Halo Sphere
    const atmosGeom = new THREE.SphereGeometry(1.038, 64, 64);
    const atmosMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.11,
      side: THREE.BackSide
    });
    this.atmosMesh = new THREE.Mesh(atmosGeom, atmosMat);
    this.globeScene.add(this.atmosMesh);

    // Group for 3D Geodesic Flight Arc + Beacons
    this.arcGroup = new THREE.Group();
    this.globeGroup.add(this.arcGroup);

    return true;
  }

  updateGlobeTexture() {
    if (!this.globeTextureCanvas) return;
    const { state, getCountryA, getCountryB, countryById, oceanPolygons, getThemeColors } = this.ctx;
    const cA = getCountryA();
    const cB = getCountryB();
    const sig = `${cA.iso3}_${cB.iso3}_${state.theme}_${state.allWorldFeatures.length}`;
    if (sig === this.lastTextureSignature) return;
    this.lastTextureSignature = sig;

    const canvas = this.globeTextureCanvas;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const isLight = state.theme === "light";
    const colors = getThemeColors();

    // 1. Ocean Base Gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    if (isLight) {
      grad.addColorStop(0, "#CBE3FA");
      grad.addColorStop(0.5, "#DFEEFC");
      grad.addColorStop(1, "#B8D7F6");
    } else {
      grad.addColorStop(0, "#071124");
      grad.addColorStop(0.5, "#0B1B36");
      grad.addColorStop(1, "#060E1F");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Coordinate helper: Equirectangular [lng, lat] -> [x, y]
    const lngLatToXY = (lng, lat) => [
      ((lng + 180) / 360) * W,
      ((90 - lat) / 180) * H
    ];

    // 2. Graticule Grid (every 15 deg)
    ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(148, 163, 184, 0.11)";
    ctx.lineWidth = 1;
    for (let lng = -180; lng <= 180; lng += 15) {
      const [x] = lngLatToXY(lng, 0);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const [, y] = lngLatToXY(0, lat);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Helper to draw a GeoJSON Polygon/MultiPolygon onto the equirectangular map without antimeridian horizontal streaks
    const drawGeoJSON = (geom, fillStyle, strokeStyle, lineWidth = 1.2) => {
      if (!geom) return;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      ctx.fillStyle = fillStyle;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;

      for (const poly of polys) {
        const ring = poly[0];
        if (!ring || ring.length < 3) continue;
        ctx.beginPath();
        let prevX = null;
        for (let i = 0; i < ring.length; i++) {
          let lng = ring[i][0];
          if (lng > 180) lng -= 360;
          if (lng < -180) lng += 360;
          const [x, y] = lngLatToXY(lng, ring[i][1]);
          if (i === 0 || (prevX !== null && Math.abs(x - prevX) > W * 0.45)) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          prevX = x;
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    };

    // 3. Draw all background world landmasses
    for (const feat of state.allWorldFeatures) {
      const isA = doesEntityContainFeature(cA, feat.id, countryById);
      const isB = doesEntityContainFeature(cB, feat.id, countryById);
      if (isA || isB) continue; // Drawn on elevated pass
      drawGeoJSON(
        feat.geometry,
        isLight ? "#CBD5E1" : "#182640",
        isLight ? "rgba(71, 85, 105, 0.45)" : "rgba(100, 116, 139, 0.35)",
        1.0
      );
    }

    // 4. Draw Ocean Basin Polygons if Entity A or B is an Ocean
    if (cA.entityType === "ocean" && oceanPolygons[cA.id]) {
      drawGeoJSON(oceanPolygons[cA.id], "rgba(255, 90, 54, 0.48)", colors.colorA, 3.0);
    }
    if (cB.entityType === "ocean" && oceanPolygons[cB.id]) {
      drawGeoJSON(oceanPolygons[cB.id], "rgba(0, 212, 178, 0.48)", colors.colorB, 3.0);
    }

    // 5. Draw Highlighted Country / Continent / EU-27 Features
    for (const feat of state.allWorldFeatures) {
      const isA = doesEntityContainFeature(cA, feat.id, countryById);
      const isB = doesEntityContainFeature(cB, feat.id, countryById);
      if (!isA && !isB) continue;
      if (isA) {
        drawGeoJSON(feat.geometry, "rgba(255, 90, 54, 0.78)", "#FFFFFF", 2.2);
      }
      if (isB) {
        drawGeoJSON(feat.geometry, "rgba(0, 212, 178, 0.78)", "#FFFFFF", 2.2);
      }
    }

    if (this.globeTexture) {
      this.globeTexture.needsUpdate = true;
    }

    this.rebuild3DArcAndBeacons(cA, cB, colors);
  }

  rebuild3DArcAndBeacons(cA, cB, colors) {
    if (!this.arcGroup || !this.hasWebGL()) return;
    const THREE = window.THREE;

    while (this.arcGroup.children.length > 0) {
      const child = this.arcGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.arcGroup.remove(child);
    }

    // Build 3D Geodesic Flight Curve elevated above sphere radius=1.0
    const steps = 64;
    const curvePts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const [lat, lng] = slerpLatLng(cA.capLat, cA.capLng, cB.capLat, cB.capLng, t);
      const lift = 1.006 + Math.sin(t * Math.PI) * 0.16;
      const [vx, vy, vz] = latLngToVector3(lat, lng, lift);
      curvePts.push(new THREE.Vector3(vx, vy, vz));
    }
    this.arcCurvePoints = curvePts;

    const curve = new THREE.CatmullRomCurve3(curvePts);
    const tubeGeom = new THREE.TubeGeometry(curve, 64, 0.0085, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9
    });
    const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
    this.arcGroup.add(tubeMesh);

    // Capital A & B 3D Beacons
    const addBeacon = (lat, lng, hexColor) => {
      const [bx, by, bz] = latLngToVector3(lat, lng, 1.012);
      const pinGeom = new THREE.SphereGeometry(0.024, 16, 16);
      const pinMat = new THREE.MeshBasicMaterial({ color: hexColor });
      const pin = new THREE.Mesh(pinGeom, pinMat);
      pin.position.set(bx, by, bz);
      this.arcGroup.add(pin);

      const haloGeom = new THREE.SphereGeometry(0.042, 16, 16);
      const haloMat = new THREE.MeshBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.35
      });
      const halo = new THREE.Mesh(haloGeom, haloMat);
      halo.position.set(bx, by, bz);
      this.arcGroup.add(halo);
    };

    addBeacon(cA.capLat, cA.capLng, colors.colorA);
    addBeacon(cB.capLat, cB.capLng, colors.colorB);

    // Animated Pulse Orb traveling along the geodesic flight path
    const orbGeom = new THREE.SphereGeometry(0.022, 16, 16);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.pulseOrb = new THREE.Mesh(orbGeom, orbMat);
    this.arcGroup.add(this.pulseOrb);
  }

  renderGlobe(canvas) {
    if (!canvas || canvas.offsetParent === null) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const { state } = this.ctx;

    if (this.initGlobeWebGL(canvas)) {
      this.globeRenderer.setSize(rect.width, rect.height, false);
      this.globeCamera.aspect = rect.width / rect.height;
      this.globeCamera.updateProjectionMatrix();

      this.updateGlobeTexture();

      // Convert state.globeRot { lng, lat } to Three.js globeGroup Euler angles
      // Note: latLngToVector3 places lng=0, lat=0 at [0, 0, +R] facing the camera at [0, 0, 3.25].
      const targetRotY = -state.globeRot.lng * (Math.PI / 180);
      const targetRotX = state.globeRot.lat * (Math.PI / 180);
      this.globeGroup.rotation.y = targetRotY;
      this.globeGroup.rotation.x = targetRotX;

      if (this.pulseOrb && this.arcCurvePoints.length > 0) {
        const idx = Math.min(
          this.arcCurvePoints.length - 1,
          Math.floor((state.arcPulseT || 0) * (this.arcCurvePoints.length - 1))
        );
        this.pulseOrb.position.copy(this.arcCurvePoints[idx]);
      }

      if (this.starField) {
        this.starField.rotation.y += 0.0003;
      }

      this.globeRenderer.render(this.globeScene, this.globeCamera);
      return;
    }

    // Fallback 2D Orthographic Canvas if WebGL is disabled
    this.renderGlobeFallback2D(canvas, rect);
  }

  renderGlobeFallback2D(canvas, rect) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const cx = W * 0.5, cy = H * 0.5;
    const R = Math.min(W, H) * 0.4;
    const { state, getCountryA, getCountryB, countryById, getThemeColors } = this.ctx;
    const colors = getThemeColors();
    const cA = getCountryA(), cB = getCountryB();

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = state.theme === "light" ? "#D8E8F8" : "#0A1426";
    ctx.fill();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const deg2rad = Math.PI / 180;
    const ortho = (lng, lat) => {
      const lam = (lng - state.globeRot.lng) * deg2rad;
      const phi = lat * deg2rad;
      const phi0 = state.globeRot.lat * deg2rad;
      const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam);
      if (cosC < 0) return null;
      return [
        cx + R * Math.cos(phi) * Math.sin(lam),
        cy - R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam))
      ];
    };

    for (const feat of state.allWorldFeatures) {
      const isA = doesEntityContainFeature(cA, feat.id, countryById);
      const isB = doesEntityContainFeature(cB, feat.id, countryById);
      const polys = feat.geometry.type === "Polygon" ? [feat.geometry.coordinates] : feat.geometry.coordinates;
      ctx.beginPath();
      for (const poly of polys) {
        const ring = poly[0];
        let started = false;
        for (let i = 0; i < ring.length; i++) {
          const pt = ortho(ring[i][0], ring[i][1]);
          if (!pt) { started = false; continue; }
          if (!started) { ctx.moveTo(pt[0], pt[1]); started = true; }
          else ctx.lineTo(pt[0], pt[1]);
        }
      }
      ctx.fillStyle = isA ? colors.fillA : (isB ? colors.fillB : "rgba(148,163,184,0.22)");
      ctx.fill();
    }
    ctx.restore();
  }

  // ==========================================================================
  // 2. THREE.JS 3D VOLUMETRIC EXTRUDED COUNTRY PRISMS & DENSITY DIORAMA
  // ==========================================================================
  initPrismWebGL(canvas) {
    if (!this.hasWebGL() || !canvas) return false;
    if (this.prismRenderer) return true;

    const THREE = window.THREE;
    try {
      this.prismRenderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
      });
      this.prismRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch (e) {
      this.prismRenderer = null;
      return false;
    }

    this.prismScene = new THREE.Scene();
    this.prismCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

    const ambient = new THREE.AmbientLight(0xe2e8f0, 1.15);
    this.prismScene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(8, 14, 10);
    this.prismScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.8);
    fillLight.position.set(-10, 6, -8);
    this.prismScene.add(fillLight);

    // Cyber Cartographic Grid Floor
    const grid = new THREE.GridHelper(16, 32, 0x38bdf8, 0x1e293b);
    grid.position.y = -0.02;
    this.prismScene.add(grid);

    this.prismGroup = new THREE.Group();
    this.prismScene.add(this.prismGroup);
    return true;
  }

  computePrismHeights(cA, cB) {
    const { getBiosphereProfile } = this.ctx;
    const bioA = getBiosphereProfile(cA);
    const bioB = getBiosphereProfile(cB);

    let valA = 1, valB = 1, unitLabel = "/km²";
    if (this.prismHeightMetric === "elevation") {
      valA = cA.entityType === "ocean" ? bioA.maxDepthM : Math.max(50, bioA.maxElevM);
      valB = cB.entityType === "ocean" ? bioB.maxDepthM : Math.max(50, bioB.maxElevM);
      unitLabel = "m Peak/Depth";
    } else if (this.prismHeightMetric === "gdp") {
      valA = cA.entityType === "ocean" ? cA.gdp * 10 : Math.max(200, Math.round((cA.gdp * 1e9) / Math.max(1, cA.pop)));
      valB = cB.entityType === "ocean" ? cB.gdp * 10 : Math.max(200, Math.round((cB.gdp * 1e9) / Math.max(1, cB.pop)));
      unitLabel = "$ GDP/cap";
    } else {
      // Population Density: Base Area * Height = Total Population!
      valA = Math.max(0.5, cA.pop / Math.max(1, cA.area));
      valB = Math.max(0.5, cB.pop / Math.max(1, cB.area));
      unitLabel = "people/km²";
    }

    const maxVal = Math.max(valA, valB, 1);
    const hA = Math.max(0.18, (valA / maxVal) * 2.6);
    const hB = Math.max(0.18, (valB / maxVal) * 2.6);
    return { valA, valB, hA, hB, unitLabel };
  }

  rebuildPrismMeshes() {
    if (!this.prismGroup || !this.hasWebGL()) return;
    const THREE = window.THREE;
    const { state, getCountryA, getCountryB, getProjectedCountry, getThemeColors } = this.ctx;
    const cA = getCountryA();
    const cB = getCountryB();
    const sig = `${cA.iso3}_${cB.iso3}_${state.territoryScope}_${this.prismHeightMetric}_${state.theme}`;
    if (sig === this.lastPrismSignature) return;
    this.lastPrismSignature = sig;

    while (this.prismGroup.children.length > 0) {
      const child = this.prismGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.prismGroup.remove(child);
    }

    const projA = getProjectedCountry(cA);
    const projB = getProjectedCountry(cB);
    const colors = getThemeColors();
    const { hA, hB } = this.computePrismHeights(cA, cB);

    const maxSpanKm = Math.max(projA.widthKm, projA.heightKm, projB.widthKm, projB.heightKm, 100);
    const kmToWorld = 4.2 / maxSpanKm;

    const buildEntityPrism = (proj, heightWorld, hexColor, xOffsetWorld) => {
      const entityGroup = new THREE.Group();
      for (const poly of proj.polys) {
        const ring = poly.rings[0];
        if (!ring || ring.length < 3) continue;
        const shape = new THREE.Shape();
        const step = Math.max(1, Math.floor(ring.length / 180));
        let started = false;
        for (let i = 0; i < ring.length; i += step) {
          const wx = ring[i][0] * kmToWorld;
          const wy = -ring[i][1] * kmToWorld;
          if (!started) {
            shape.moveTo(wx, wy);
            started = true;
          } else {
            shape.lineTo(wx, wy);
          }
        }
        const extrudeGeom = new THREE.ExtrudeGeometry(shape, {
          depth: heightWorld,
          bevelEnabled: true,
          bevelThickness: 0.03,
          bevelSize: 0.02,
          bevelSegments: 2
        });
        // Rotate so extrusion rises along +Y axis
        extrudeGeom.rotateX(-Math.PI / 2);

        const mat = new THREE.MeshStandardMaterial({
          color: hexColor,
          roughness: 0.32,
          metalness: 0.18,
          transparent: true,
          opacity: 0.88
        });
        const mesh = new THREE.Mesh(extrudeGeom, mat);
        entityGroup.add(mesh);

        const edges = new THREE.EdgesGeometry(extrudeGeom, 24);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
        const wire = new THREE.LineSegments(edges, lineMat);
        entityGroup.add(wire);
      }
      entityGroup.position.set(xOffsetWorld, 0, 0);
      this.prismGroup.add(entityGroup);
    };

    buildEntityPrism(projA, hA, colors.colorA, -2.55);
    buildEntityPrism(projB, hB, colors.colorB, 2.55);
  }

  renderPrismStage(canvas) {
    if (!canvas || canvas.offsetParent === null) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    if (this.initPrismWebGL(canvas)) {
      this.prismRenderer.setSize(rect.width, rect.height, false);
      this.prismCamera.aspect = rect.width / rect.height;
      this.prismCamera.updateProjectionMatrix();

      this.rebuildPrismMeshes();

      if (this.prismAutoRotate) {
        this.prismYaw += 0.0035;
      }

      const dist = 9.2 / Math.max(0.35, this.prismZoom);
      const camX = dist * Math.cos(this.prismPitch) * Math.sin(this.prismYaw);
      const camY = Math.max(1.2, dist * Math.sin(this.prismPitch));
      const camZ = dist * Math.cos(this.prismPitch) * Math.cos(this.prismYaw);
      this.prismCamera.position.set(camX, camY, camZ);
      this.prismCamera.lookAt(0, 0.65, 0);

      this.prismRenderer.render(this.prismScene, this.prismCamera);
      return;
    }

    // 2D Isometric Fallback if WebGL is unavailable
    this.renderPrismFallback2D(canvas, rect);
  }

  renderPrismFallback2D(canvas, rect) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const { getCountryA, getCountryB, getProjectedCountry, getThemeColors } = this.ctx;
    const cA = getCountryA(), cB = getCountryB();
    const projA = getProjectedCountry(cA), projB = getProjectedCountry(cB);
    const colors = getThemeColors();
    const { hA, hB } = this.computePrismHeights(cA, cB);

    const maxSpan = Math.max(projA.widthKm, projA.heightKm, projB.widthKm, projB.heightKm, 100);
    const scale = (Math.min(W * 0.36, H * 0.55) / maxSpan) * this.prismZoom;

    const drawIsoPrism = (proj, cx, cy, extrudePx, fill, stroke) => {
      for (const p of proj.polys) {
        const ring = p.rings[0];
        if (!ring || ring.length < 3) continue;
        // Top cap shifted up by extrudePx
        ctx.beginPath();
        for (let i = 0; i < ring.length; i++) {
          const x = cx + ring[i][0] * scale;
          const y = cy + ring[i][1] * scale * 0.58 - extrudePx;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    drawIsoPrism(projA, W * 0.28, H * 0.62, hA * 48, colors.fillA, colors.colorA);
    drawIsoPrism(projB, W * 0.72, H * 0.62, hB * 48, colors.fillB, colors.colorB);
    ctx.restore();
  }
}
