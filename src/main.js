/**
 * main.js — 入口：装配渲染器 / 场景 / 交互 / 主循环
 *
 * 装载顺序刻意拆成若干阶段，loading 进度条对应真实构建步骤，不是假动画。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWorld } from './scene.js';
import { createArmMatrix } from './robot-arm.js';
import { createConveyors } from './conveyor.js';
import { createAgvFleet } from './agv.js';
import { createPostFX } from './postfx.js';
import { createUI } from './ui.js';

/* ------------------------------------------------------------------ */
/* 设备分级                                                            */
/* ------------------------------------------------------------------ */
function detectQuality() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 820;
  const lowCores = (navigator.hardwareConcurrency || 8) <= 4;
  const mobile = coarse || smallScreen;

  if (mobile) {
    return {
      mobile: true,
      maxPixelRatio: 1.5,
      msaa: 0,
      bloom: false,
      bloomStrength: 0,
      particles: 0.35,
      rackLayers: 3,
      reflector: false,
      shadows: false,
      arms: 8
    };
  }
  const weak = lowCores;
  return {
    mobile: false,
    maxPixelRatio: weak ? 1.0 : 1.75,
    msaa: weak ? 0 : 4,
    bloom: true,
    bloomStrength: weak ? 0.55 : 0.8,
    particles: weak ? 0.6 : 1,
    rackLayers: weak ? 6 : 9,
    reflector: !weak,
    shadows: !weak,
    arms: 12
  };
}

const QUALITY = detectQuality();

/* ------------------------------------------------------------------ */
/* 渲染器                                                              */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('scene-canvas');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: QUALITY.mobile,   // 桌面端靠 composer 的 MSAA，移动端直接靠 canvas 自带
    powerPreference: 'high-performance',
    stencil: false,
    alpha: false
  });
} catch (err) {
  document.getElementById('loader-text').textContent = '浏览器不支持 WebGL2，无法运行本场景';
  throw err;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = QUALITY.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* ------------------------------------------------------------------ */
/* 场景 / 相机                                                         */
/* ------------------------------------------------------------------ */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 420);
camera.position.set(0, 13.5, 24);
camera.layers.enable(2);                 // 第 2 层：不进地面反射的粒子/光束
scene.userData.activeCamera = camera;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.6, -50);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.7;
controls.minDistance = 2.5;
controls.maxDistance = 120;
controls.maxPolarAngle = Math.PI * 0.495;   // 不许钻到地面以下
controls.screenSpacePanning = false;        // 平移贴着地面走，符合看厂房的直觉
controls.addEventListener('start', () => {
  // 用户一动手，脚本运镜立刻让位
  if (state.cruise) { state.cruise = false; ui.setCruiseActive(false); }
  if (state.cinematic) stopCinematic();
});

/* ------------------------------------------------------------------ */
/* 全局状态                                                            */
/* ------------------------------------------------------------------ */
const state = {
  speed: 1,
  armsRunning: true,
  light: 'cold',
  dayNight: false,
  section: false,
  cruise: false,
  cinematic: false,
  follow: null,
  activePreset: -1
};

let world = null;
let armMatrix = null;
let conveyors = null;
let agvFleet = null;
let postfx = null;
let ui = null;

/* ------------------------------------------------------------------ */
/* 机位预设                                                            */
/* ------------------------------------------------------------------ */
const CAM_PRESETS = [
  { name: '入口低角', pos: new THREE.Vector3(0.4, 1.05, 6.5), target: new THREE.Vector3(0, 0.62, -52), fov: 62 },
  { name: '中段侧视', pos: new THREE.Vector3(14.2, 4.4, -40), target: new THREE.Vector3(-0.6, 1.9, -74), fov: 48 },
  { name: '顶部全景', pos: new THREE.Vector3(1.5, 31, -30), target: new THREE.Vector3(0, 0, -94), fov: 56 }
];

const camTween = {
  active: false,
  t: 0,
  dur: 1.7,
  fromPos: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
  fromFov: 56,
  toFov: 56
};

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function flyTo(pos, target, fov, dur) {
  camTween.fromPos.copy(camera.position);
  camTween.toPos.copy(pos);
  camTween.fromTarget.copy(controls.target);
  camTween.toTarget.copy(target);
  camTween.fromFov = camera.fov;
  camTween.toFov = fov !== undefined ? fov : camera.fov;
  camTween.t = 0;
  camTween.dur = dur || 1.7;
  camTween.active = true;
}

function applyCamPreset(i) {
  const p = CAM_PRESETS[i];
  if (!p) return;
  state.activePreset = i;
  state.follow = null;
  state.cruise = false;
  ui.setCruiseActive(false);
  stopCinematic();
  flyTo(p.pos, p.target, p.fov, 1.7);
  ui.setActivePreset(i);
}

/* ------------------------------------------------------------------ */
/* 电影运镜                                                            */
/* ------------------------------------------------------------------ */
const cinePath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 1.1, 10),
  new THREE.Vector3(-1.6, 1.5, -4),
  new THREE.Vector3(-2.4, 2.2, -26),
  new THREE.Vector3(-1.2, 1.4, -50),
  new THREE.Vector3(2.0, 3.6, -74),
  new THREE.Vector3(1.2, 8.5, -100),
  new THREE.Vector3(-3.0, 12.0, -122),
  new THREE.Vector3(0, 16.0, -150)
], false, 'catmullrom', 0.35);

const cineLook = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 2.4, -40),
  new THREE.Vector3(0, 1.6, -50),
  new THREE.Vector3(0, 1.4, -62),
  new THREE.Vector3(0.5, 1.8, -70),
  new THREE.Vector3(0, 2.4, -88),
  new THREE.Vector3(0, 2.0, -110),
  new THREE.Vector3(0, 1.6, -130),
  new THREE.Vector3(0, 1.2, -150)
], false, 'catmullrom', 0.35);

const cine = { t: 0, dur: 19, savedPos: new THREE.Vector3(), savedTarget: new THREE.Vector3(), savedFov: 56 };

function startCinematic() {
  if (state.cinematic) return;
  state.cinematic = true;
  state.cruise = false;
  state.follow = null;
  ui.setCruiseActive(false);
  cine.t = 0;
  cine.savedPos.copy(camera.position);
  cine.savedTarget.copy(controls.target);
  cine.savedFov = camera.fov;
  ui.showQualityNote('电影运镜中 · 按空格或拖动可中断');
}

function stopCinematic() {
  if (!state.cinematic) return;
  state.cinematic = false;
  flyTo(cine.savedPos, cine.savedTarget, cine.savedFov, 1.4);
}

/* ------------------------------------------------------------------ */
/* UI 回调                                                             */
/* ------------------------------------------------------------------ */
ui = createUI({
  onSpeed(v) {
    if (conveyors) conveyors.setSpeed(v);
    // AGV 速度由主循环里的 state.speed 统一驱动，这里不再重复缩放
  },
  onArmRun(run) {
    if (armMatrix) armMatrix.setRunning(run);
    state.armsRunning = !!run;
    if (world) {
      world.stations.forEach((s, i) => {
        if (s.status === 'alarm') return;
        world.setStationStatus(i, run ? 'run' : 'idle');
      });
    }
  },
  onLight(name) {
    state.light = name;
    if (world) world.setPreset(name);
  },
  onParticleDensity(v) {
    if (world) world.setParticleDensity(v);
  },
  onSection(on) {
    state.section = !!on;
    if (world) world.setSection(on);
  },
  onDayNight(isDay) {
    state.dayNight = !!isDay;
    if (world) world.setPreset(isDay ? 'day' : 'night');
  },
  onCameraPreset(i) {
    applyCamPreset(i);
  },
  onCruise() {
    state.cruise = !state.cruise;
    if (state.cruise) {
      state.follow = null;
      stopCinematic();
    }
    return state.cruise;
  },
  onCinematic() {
    if (state.cinematic) stopCinematic();
    else startCinematic();
  }
});

/* ------------------------------------------------------------------ */
/* 装载流程（进度条 = 真实步骤）                                        */
/* ------------------------------------------------------------------ */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  ui.setLoader(4, '初始化渲染器…');
  await nextFrame();

  ui.setLoader(12, '编译后期处理管线…');
  postfx = createPostFX(renderer, scene, camera, QUALITY);
  await nextFrame();

  ui.setLoader(26, '构建厂房：地面 / 桁架 / 天窗…');
  world = createWorld(scene, renderer, QUALITY);
  // 灯光预设里的 bloom 强度要真的作用到后期管线
  world.onBloomChange = (s) => {
    if (postfx && postfx.isEnabled()) postfx.setBloom(s);
  };
  await nextFrame();

  ui.setLoader(48, '装配工位与立体仓库…');
  await nextFrame();

  ui.setLoader(58, '部署机械臂矩阵…');
  armMatrix = createArmMatrix(scene, QUALITY);
  armMatrix.arms.forEach((a) => {
    a.root.userData.isArmRoot = true;
    a.root.userData.arm = a;
  });
  await nextFrame();

  ui.setLoader(72, '铺设传送带支线…');
  conveyors = createConveyors(scene, QUALITY, {
    onItemPassGate() {
      if (world && world.gate) world.gate.pulse();
    }
  });
  await nextFrame();

  ui.setLoader(84, '调度 AGV 车队…');
  agvFleet = createAgvFleet(scene, QUALITY);
  await nextFrame();

  ui.setLoader(92, '预编译材质与灯光…');
  // 先渲染一帧，把着色器编译摊到装载阶段，避免进场卡顿
  renderer.compile(scene, camera);
  postfx.render(0.016);
  await nextFrame();

  ui.setLoader(100, '就绪');
  await nextFrame();

  // 入场镜头：从高处落到入口低角度
  const p = CAM_PRESETS[0];
  camera.position.set(0, 14, 26);
  controls.target.set(0, 3, -58);
  flyTo(p.pos, p.target, p.fov, 3.2);
  ui.setActivePreset(0);
  state.activePreset = 0;

  ui.hideLoader();
  if (QUALITY.mobile) {
    ui.showQualityNote('已启用移动端降级：关闭 Bloom / 减少粒子 / 降低货架层数', true);
  }
  clock.start();
  animate();
}

/* ------------------------------------------------------------------ */
/* 交互：悬停 / 点击                                                   */
/* ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const pointerScreen = { x: 0, y: 0 };
const downPos = { x: 0, y: 0, t: 0 };
let pointerInside = false;
let hoveredArm = null;
let followStartTime = 0;

function pickAt(clientX, clientY) {
  if (!armMatrix) return null;
  pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);

  const roots = armMatrix.arms.map((a) => a.root);
  const hits = raycaster.intersectObjects(roots, true);
  if (hits.length > 0) {
    let o = hits[0].object;
    while (o && !o.userData.isArmRoot) o = o.parent;
    if (o && o.userData.arm) return { type: 'arm', arm: o.userData.arm };
  }

  if (world) {
    const lampHits = raycaster.intersectObjects(world.pickables, false);
    if (lampHits.length > 0) {
      const idx = lampHits[0].object.userData.index;
      return { type: 'station', station: world.stations[idx] };
    }
  }
  return null;
}

const _proj = new THREE.Vector3();
function projectToScreen(worldPos) {
  _proj.copy(worldPos);
  _proj.project(camera);
  return {
    x: (_proj.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_proj.y * 0.5 + 0.5) * window.innerHeight,
    visible: _proj.z < 1
  };
}

canvas.addEventListener('pointermove', (e) => {
  pointerInside = true;
  pointerScreen.x = e.clientX;
  pointerScreen.y = e.clientY;
});

canvas.addEventListener('pointerleave', () => {
  pointerInside = false;
  if (hoveredArm) { hoveredArm.setHighlight(false); hoveredArm = null; }
  ui.hideHover();
});

canvas.addEventListener('pointerdown', (e) => {
  downPos.x = e.clientX;
  downPos.y = e.clientY;
  downPos.t = performance.now();
});

canvas.addEventListener('pointerup', (e) => {
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  const dt = performance.now() - downPos.t;
  if (moved > 6 || dt > 700) return;      // 拖动过，不算点击

  const hit = pickAt(e.clientX, e.clientY);
  if (!hit) {
    if (state.follow) exitFollow();
    return;
  }

  if (hit.type === 'arm') {
    if (state.follow === hit.arm) exitFollow();
    else enterFollow(hit.arm);
  } else if (hit.type === 'station') {
    if (hit.station.status === 'alarm') ui.showFault(hit.station);
    else ui.showQualityNote(`工位 ${hit.station.id} · ${hit.station.name} · 运行正常`);
  }
});

function enterFollow(arm) {
  state.follow = arm;
  followStartTime = performance.now();
  state.cruise = false;
  ui.setCruiseActive(false);
  stopCinematic();
  ui.showQualityNote(`跟随视角：${arm.model} · 再次点击该机械臂退出`);
}

function exitFollow() {
  state.follow = null;
  const i = state.activePreset >= 0 ? state.activePreset : 0;
  const p = CAM_PRESETS[i];
  flyTo(p.pos, p.target, p.fov, 1.5);
  ui.setActivePreset(i);
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let elapsed = 0;
let fpsAccum = 0;
let fpsFrames = 0;
let fpsTimer = 0;
let currentFps = 60;
let statTimer = 0;
let lowFpsTime = 0;
let degradedOnce = false;

const stats = { yield: 0, cycle: 8.4, online: 0, oee: 92.4 };
const _tcp = new THREE.Vector3();
const _followOffset = new THREE.Vector3(2.9, 1.9, 3.4);

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  /* ---- 相机装置 ---- */
  if (state.cinematic) {
    cine.t += dt / cine.dur;
    if (cine.t >= 1) {
      cine.t = 1;
      stopCinematic();
    } else {
      const u = easeInOutCubic(cine.t);
      camera.position.copy(cinePath.getPointAt(u));
      controls.target.copy(cineLook.getPointAt(u));
      camera.fov = THREE.MathUtils.lerp(cine.savedFov, 44, Math.sin(cine.t * Math.PI));
      camera.updateProjectionMatrix();
    }
  } else if (camTween.active) {
    camTween.t += dt / camTween.dur;
    const k = easeInOutCubic(Math.min(1, camTween.t));
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
    camera.fov = THREE.MathUtils.lerp(camTween.fromFov, camTween.toFov, k);
    camera.updateProjectionMatrix();
    if (camTween.t >= 1) camTween.active = false;
  } else if (state.cruise) {
    const cyc = (elapsed * 0.045) % 1;
    const z = -10 - cyc * 128;
    const sway = Math.sin(elapsed * 0.5) * 0.8;
    camera.position.set(Math.sin(elapsed * 0.22) * 6.4 + sway, 3.2 + Math.sin(elapsed * 0.34) * 0.5, z + 9);
    controls.target.set(0, 1.5, z - 12);
  } else if (state.follow) {
    state.follow.getTCP(_tcp);
    controls.target.lerp(_tcp, 0.14);
    if (performance.now() - followStartTime < 1300) {
      const want = _tcp.clone().add(_followOffset);
      camera.position.lerp(want, 0.08);
    }
  }

  /* ---- 脚本运镜期间用 lookAt，交还给 OrbitControls 时再 update ---- */
  const followIntro = state.follow && (performance.now() - followStartTime < 1300);
  const scripted = state.cinematic || camTween.active || state.cruise || followIntro;
  if (scripted) camera.lookAt(controls.target);
  else controls.update();

  /* ---- 悬停拾取（每帧最多一次，够用且不抖） ---- */
  if (pointerInside && !state.cinematic) {
    const hit = pickAt(pointerScreen.x, pointerScreen.y);
    const arm = hit && hit.type === 'arm' ? hit.arm : null;
    if (arm !== hoveredArm) {
      if (hoveredArm) hoveredArm.setHighlight(false);
      hoveredArm = arm;
      if (hoveredArm) hoveredArm.setHighlight(true);
      if (!hoveredArm) ui.hideHover();
    }
    if (hoveredArm) {
      const sc = projectToScreen(hoveredArm.getTCP(_tcp));
      if (sc.visible) ui.showHover(hoveredArm, sc.x, sc.y);
      else ui.hideHover();
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = 'grab';
    }
  }

  /* ---- 场景动画 ---- */
  if (armMatrix) armMatrix.update(dt, elapsed);
  if (conveyors) conveyors.update(dt);
  if (agvFleet) agvFleet.update(dt, elapsed, state.speed);
  if (world) world.update(dt, elapsed);

  /* ---- 渲染 ---- */
  postfx.render(dt);

  /* ---- 数据面板 ---- */
  statTimer += dt;
  if (statTimer > 0.35) {
    statTimer = 0;
    const passed = conveyors ? conveyors.stats.gatePass : 0;
    stats.yield = passed + Math.floor(elapsed * 0.24);
    stats.cycle = 8.3 + Math.sin(elapsed * 0.55) * 0.35 + Math.sin(elapsed * 2.1) * 0.08;
    stats.online = (armMatrix ? armMatrix.arms.length : 12)
      + (agvFleet ? agvFleet.agvs.length : 4)
      + (world ? world.stations.length : 7)
      + 6;
    stats.oee = 91.2 + Math.sin(elapsed * 0.31) * 2.4 + Math.sin(elapsed * 1.7) * 0.6;
    ui.updateStats(stats);
  }

  /* ---- FPS + 自适应降级 ---- */
  fpsAccum += dt;
  fpsFrames += 1;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    currentFps = fpsFrames / fpsAccum;
    ui.setFps(currentFps);
    fpsAccum = 0;
    fpsFrames = 0;
    fpsTimer = 0;

    if (!QUALITY.mobile && currentFps < 42) {
      lowFpsTime += 0.5;
      if (lowFpsTime > 3 && !degradedOnce) {
        degradedOnce = true;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
        if (postfx) postfx.setBloom(0.45);
        ui.showQualityNote('检测到帧率偏低：已自动降低渲染分辨率与 Bloom 强度');
      }
    } else {
      lowFpsTime = 0;
    }
  }
}

/* ------------------------------------------------------------------ */
/* resize                                                              */
/* ------------------------------------------------------------------ */
let resizeTimer = null;
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.maxPixelRatio));
  renderer.setSize(w, h, false);
  if (postfx) postfx.setSize(w, h);
  if (world) world.resize(w, h);
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 120);
});
window.addEventListener('orientationchange', () => setTimeout(onResize, 300));

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */
boot().catch((err) => {
  console.error('[ND-3D-001] 启动失败', err);
  const t = document.getElementById('loader-text');
  if (t) t.textContent = '启动失败：' + (err && err.message ? err.message : '未知错误');
});