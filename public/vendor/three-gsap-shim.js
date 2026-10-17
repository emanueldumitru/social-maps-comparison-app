// ============================================================================
// TERRA // SCALE — Resilient GSAP Tween Shim & Offline Fallback
// ============================================================================
(function () {
  if (typeof window === "undefined") return;

  // Provide a lightweight, dependency-free GSAP-compatible tween engine if CDN is offline
  if (!window.gsap) {
    const activeTweens = new WeakMap();

    const eases = {
      "power2.out": t => 1 - (1 - t) * (1 - t),
      "power3.out": t => 1 - Math.pow(1 - t, 3),
      "expo.out": t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
      "back.out(1.4)": t => {
        const c1 = 1.4;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      },
      "sine.inOut": t => -(Math.cos(Math.PI * t) - 1) / 2
    };

    function tweenTo(target, vars) {
      if (!target || !vars) return;
      const durationMs = (vars.duration !== undefined ? vars.duration : 0.65) * 1000;
      const easeFn = eases[vars.ease] || eases["power3.out"];
      const onUpdate = vars.onUpdate;
      const onComplete = vars.onComplete;

      const reserved = new Set(["duration", "ease", "delay", "onUpdate", "onComplete", "overwrite"]);
      const keys = Object.keys(vars).filter(k => !reserved.has(k) && typeof vars[k] === "number");

      const startVals = {};
      for (const k of keys) {
        startVals[k] = Number(target[k]) || 0;
      }

      if (activeTweens.has(target)) {
        cancelAnimationFrame(activeTweens.get(target));
      }

      const startTime = performance.now() + (vars.delay ? vars.delay * 1000 : 0);

      function tick(now) {
        if (now < startTime) {
          activeTweens.set(target, requestAnimationFrame(tick));
          return;
        }
        const elapsed = now - startTime;
        const rawT = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs);
        const eT = easeFn(rawT);

        for (const k of keys) {
          target[k] = startVals[k] + (vars[k] - startVals[k]) * eT;
        }
        if (typeof onUpdate === "function") onUpdate();

        if (rawT < 1) {
          activeTweens.set(target, requestAnimationFrame(tick));
        } else {
          activeTweens.delete(target);
          if (typeof onComplete === "function") onComplete();
        }
      }

      activeTweens.set(target, requestAnimationFrame(tick));
    }

    window.gsap = {
      to: tweenTo,
      killTweensOf(target) {
        if (target && activeTweens.has(target)) {
          cancelAnimationFrame(activeTweens.get(target));
          activeTweens.delete(target);
        }
      }
    };
  }
})();
