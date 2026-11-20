#!/usr/bin/env bash
# 逻辑自测：在临时目录里给裸包 'three' 建解析入口，然后跑 tools/logic-test.mjs
# 不需要浏览器、不需要 GPU，纯 Node 跑几何与运动逻辑。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/node_modules/three/build" "$TMP/node_modules/three/addons"
cp "$ROOT/vendor/three/build/three.module.js" "$TMP/node_modules/three/build/three.module.js"
cp -r "$ROOT/vendor/three/addons/." "$TMP/node_modules/three/addons/"
cat > "$TMP/node_modules/three/package.json" <<'JSON'
{
  "name": "three",
  "version": "0.160.1",
  "type": "module",
  "main": "./build/three.module.js",
  "exports": {
    ".": "./build/three.module.js",
    "./addons/*": "./addons/*"
  }
}
JSON

cp -r "$ROOT/src" "$TMP/src"
cp "$ROOT/tools/logic-test.mjs" "$TMP/logic-test.mjs"

cd "$TMP" && node logic-test.mjs