#!/usr/bin/env bash
# ==============================================================================
# TERRA // SCALE — 3D WebGL Cartographic, Biosphere & Encyclopedia Studio
# Launch Script: ./start.sh [--port 3000] [--skip-tests] [--no-open]
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-3000}"
SKIP_TESTS=0
NO_OPEN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|-p)
      PORT="$2"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS=1
      shift
      ;;
    --no-open)
      NO_OPEN=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Error: Node.js is required to run TERRA // SCALE."
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 🌍 TERRA // SCALE v3.0 — Three.js 3D WebGL & Equal-Area Studio"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Cache Three.js and GSAP locally into public/vendor/ if online and not yet cached
mkdir -p public/vendor
if [[ ! -s "public/vendor/three.min.js" ]] && command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 3 "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js" -o "public/vendor/three.min.js" 2>/dev/null || rm -f "public/vendor/three.min.js"
fi
if [[ ! -s "public/vendor/gsap.min.js" ]] && command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 3 "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js" -o "public/vendor/gsap.min.js" 2>/dev/null || rm -f "public/vendor/gsap.min.js"
fi

# 2. Run Automated JS Test Suite
if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo "🧪 Running automated JavaScript verification suite (tests/app.test.mjs)..."
  node --test tests/app.test.mjs
  echo "✅ All automated tests passed!"
fi

# 3. Auto-select next available port if $PORT is already in use
while lsof -Pi :"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; do
  echo "⚠️  Port $PORT is in use, trying $((PORT + 1))..."
  PORT=$((PORT + 1))
done

# 4. Open browser on macOS if interactive
if [[ "$NO_OPEN" -eq 0 ]] && command -v open >/dev/null 2>&1; then
  (sleep 0.8 && open "http://localhost:${PORT}") &
fi

export PORT
exec node server.mjs
