/**
 * scene.js — 车间环境、产线工位、立体仓库、检测隧道、灯光与粒子
 *
 * 所有几何体都是程序化生成（Box/Cylinder/Plane + Canvas 贴图），不加载任何外部模型。
 * 尺度按真实工业标准：货架 12m、机械臂 2.5m、人行道标线 1.2m、传送带高度 0.95m。
 */
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ */
/* 尺度常量（单位：米）                                                 */
/* ------------------------------------------------------------------ */
export const SCALE = {
  rackHeight: 12,        // 立体仓库货架高
  rackDepth: 3.2,
  rackBay: 3.6,
  beltHeight: 0.95,      // 主线传送带台面高
  beltWidth: 1.2,
  walkwayWidth: 1.2,     // 人行道标线宽
  armHeight: 2.5,        // 六轴机械臂总高
  lineStartZ: -6,
  lineEndZ: -150,
  gateZ: -128,
  hallWidth: 52,         // 厂房宽 x
  hallDepth: 200,        // 厂房长 z
  roofY: 11
};

/* 工位定义：主产线 7 个工位，编号 01~07 */
export const STATIONS = [
  { id: '01', z: -18, name: '上料' },
  { id: '02', z: -34, name: '装配' },
  { id: '03', z: -50, name: '焊接' },
  { id: '04', z: -66, name: '压装' },
  { id: '05', z: -82, name: '焊接' },
  { id: '06', z: -98, name: '检测' },
  { id: '07', z: -114, name: '下料' }
];

/* 灯光预设                                                        */
/* 颜色统一写成 hex，内部转 THREE.Color 做插值                       */
const LIGHT_PRESETS = {
  cold: {
    label: '冷蓝',
    bg: 0x04080f, fog: 0x050a12, fogDensity: 0.0125,
    hemiSky: 0x2a4c72, hemiGround: 0x03060a, hemiI: 0.55,
    key: 0xa9cdff, keyI: 1.35,
    amber: 0xffa040, amberI: 38,
    tube: 0xbfe4ff, tubeI: 1.0,
    accent: 0x38e8ff,
    exposure: 1.0, bloom: 0.82
  },
  amber: {
    label: '琥珀',
    bg: 0x0d0703, fog: 0x120b04, fogDensity: 0.0115,
    hemiSky: 0x4a2f14, hemiGround: 0x07040a, hemiI: 0.5,
    key: 0xffc076, keyI: 1.15,
    amber: 0xffb040, amberI: 62,
    tube: 0xffd0a0, tubeI: 0.85,
    accent: 0xff9a2e,
    exposure: 1.05, bloom: 0.95
  },
  emergency: {
    label: '应急红',
    bg: 0x0b0202, fog: 0x120303, fogDensity: 0.0155,
    hemiSky: 0x511414, hemiGround: 0x060001, hemiI: 0.62,
    key: 0xff4436, keyI: 1.1,
    amber: 0xff2a1a, amberI: 46,
    tube: 0xff5a4a, tubeI: 0.75,
    accent: 0xff2a1a,
    exposure: 1.1, bloom: 1.15
  },
  moon: {
    label: '熄灯月色',
    bg: 0x02040a, fog: 0x03060c, fogDensity: 0.0135,
    hemiSky: 0x14243c, hemiGround: 0x020306, hemiI: 0.3,
    key: 0x5f83b6, keyI: 0.42,
    amber: 0x8a6a3a, amberI: 10,
    tube: 0x3d5c78, tubeI: 0.2,
    accent: 0x2a6f8f,
    exposure: 0.92, bloom: 0.5
  },
  day: {
    label: '白班冷光',
    bg: 0x6d8698, fog: 0x8ea6b6, fogDensity: 0.0068,
    hemiSky: 0xbcd5e8, hemiGround: 0x3a4147, hemiI: 1.25,
    key: 0xdce9f4, keyI: 2.0,
    amber: 0xffd8a0, amberI: 16,
    tube: 0xf0f6ff, tubeI: 0.35,
    accent: 0x8fd8ff,
    exposure: 1.0, bloom: 0.28
  },
  night: null // 运行时指向 cold（夜班默认）
};
LIGHT_PRESETS.night = LIGHT_PRESETS.cold;

/* ------------------------------------------------------------------ */
/* 小工具                                                             */
/* ------------------------------------------------------------------ */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasTexture(canvas, opts = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  t.anisotropy = opts.anisotropy || 4;
  t.needsUpdate = true;
  return t;
}

/** 两侧黄黑警示条纹理 */
function hazardTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a1c'; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#c8a22a';
  ctx.save();
  ctx.translate(64, 64); ctx.rotate(-Math.PI / 4);
  for (let i = -160; i < 160; i += 32) ctx.fillRect(i, -160, 16, 320);
  ctx.restore();
  return canvasTexture(c, { repeat: [1, 1] });
}

/** 地面环氧地坪粗糙度噪声（让镜面反射有脏感和斑驳） */
function epoxyRoughnessTexture() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a5a5a'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 2 + Math.random() * 22;
    const g = 40 + Math.random() * 90;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${g},${g},${g},0.35)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return canvasTexture(c, { srgb: false, repeat: [26, 46] });
}

/** 文字贴图（中文标签 / 工位编号） */
function labelTexture(text, sub, opts = {}) {
  const w = opts.w || 512, h = opts.h || 128;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = opts.bg || '#0a1119';
  ctx.fillRect(0, 0, w, h);

  // 边框
  ctx.strokeStyle = opts.border || '#3d8fa8';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, w - 12, h - 12);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.color || '#d8f2ff';
  ctx.font = `bold ${Math.floor(h * 0.42)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  ctx.fillText(text, w / 2, sub ? h * 0.42 : h * 0.5);
  if (sub) {
    ctx.fillStyle = opts.subColor || '#5b8296';
    ctx.font = `${Math.floor(h * 0.2)}px "Microsoft YaHei", "PingFang SC", monospace`;
    ctx.fillText(sub, w / 2, h * 0.74);
  }
  return canvasTexture(c);
}

/** 人行道标线贴图（1.2m 宽，沿 z 重复） */
function walkwayTexture() {
  const w = 128, h = 256;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(18, 26, 30, 1)';
  ctx.fillRect(0, 0, w, h);
  // 两侧绿色实线
  ctx.fillStyle = '#2e6b52';
  ctx.fillRect(4, 0, 10, h);
  ctx.fillRect(w - 14, 0, 10, h);
  // 中间虚线
  ctx.fillStyle = '#3c7a5e';
  for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 4, y, 8, 34);
  // 脚印提示
  ctx.fillStyle = 'rgba(120,180,150,0.35)';
  ctx.beginPath(); ctx.ellipse(w / 2 - 16, 96, 8, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(w / 2 + 16, 160, 8, 14, 0, 0, Math.PI * 2); ctx.fill();
  return canvasTexture(c, { repeat: [1, 34] });
}

/** 软圆点粒子贴图（烟尘/火星共用） */
function particleTexture(soft) {
  const s = 64;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  if (soft) {
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,220,150,0.85)');
    g.addColorStop(1, 'rgba(255,140,40,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return canvasTexture(c);
}

/** 程序化环境贴图：给金属一点反射信息，避免全黑 */
function buildEnvMap(renderer) {
  const c = makeCanvas(256, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.00, '#0a1524');
  g.addColorStop(0.42, '#16232f');
  g.addColorStop(0.52, '#2c4050');
  g.addColorStop(0.60, '#101a22');
  g.addColorStop(1.00, '#03060a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);

  // 顶部灯带（冷）+ 侧向琥珀点光，让金属出现高光条
  ctx.fillStyle = 'rgba(150, 210, 255, 0.85)';
  ctx.fillRect(0, 18, 256, 6);
  ctx.fillStyle = 'rgba(255, 170, 80, 0.55)';
  ctx.fillRect(0, 58, 256, 3);
  ctx.fillStyle = 'rgba(90, 150, 200, 0.25)';
  ctx.fillRect(0, 70, 256, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return rt.texture;
}

/* ------------------------------------------------------------------ */
/* 主构建函数                                                          */
/* ------------------------------------------------------------------ */
export function createWorld(scene, renderer, quality) {
  const root = new THREE.Group();
  root.name = 'factory';
  scene.add(root);

  const world = {
    root,
    quality,
    stations: [],
    gate: null,
    racks: [],
    particleSystems: [],
    pickables: [],      // 可被射线拾取的网格
    onBloomChange: null,
    setPreset: null,
    setSection: null,
    setParticleDensity: null,
    setStationStatus: null,
    resize: null,
    update: null,
    dispose: null
  };

  /* ---------------- 环境贴图 + 雾 ---------------- */
  scene.environment = buildEnvMap(renderer);
  scene.fog = new THREE.FogExp2(0x050a12, 0.0125);
  scene.background = new THREE.Color(0x04080f);

  /* ---------------- 地面 ---------------- */
  const floorGroup = new THREE.Group();
  root.add(floorGroup);

  const rough = epoxyRoughnessTexture();
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0a1017,
    roughness: 0.34,
    metalness: 0.82,
    roughnessMap: rough,
    envMapIntensity: 0.7
  });
  const floorGeo = new THREE.PlaneGeometry(SCALE.hallWidth, SCALE.hallDepth);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (SCALE.lineStartZ + SCALE.lineEndZ) / 2);
  floor.receiveShadow = true;
  floorGroup.add(floor);

  // 镜面反射层：Reflector 的相机/投影逻辑直接复用，只换成半透 + 距离衰减的片元着色器
  let reflector = null;
  if (quality.reflector) {
    const rw = Math.max(256, Math.floor(window.innerWidth * 0.5));
    const rh = Math.max(256, Math.floor(window.innerHeight * 0.5));
    reflector = new Reflector(new THREE.PlaneGeometry(SCALE.hallWidth, SCALE.hallDepth), {
      clipBias: 0.004,
      textureWidth: rw,
      textureHeight: rh,
      multisample: 0,
      color: 0x8899aa
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(0, 0.012, (SCALE.lineStartZ + SCALE.lineEndZ) / 2);

    // 只反射第 0 层：粒子/光束在第 2 层，不进反射，省一半开销
    if (reflector.camera) reflector.camera.layers.set(0);

    const mat = reflector.material;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.uniforms.uOpacity = { value: 0.42 };
    mat.uniforms.uFade = { value: 0.0075 };
    mat.uniforms.uCamPos = { value: new THREE.Vector3() };
    mat.uniforms.uTint = { value: new THREE.Color(0x9fd0e8) };

    mat.vertexShader = /* glsl */`
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`;
    mat.fragmentShader = /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uOpacity;
      uniform float uFade;
      uniform vec3 uCamPos;
      uniform vec3 uTint;
      varying vec4 vUv;
      varying vec3 vWorldPos;
      void main() {
        vec4 base = texture2DProj(tDiffuse, vUv);
        // 反射暗化 + 冷色偏，像环氧地坪的镜面层
        vec3 col = base.rgb * uTint;
        float d = distance(vWorldPos, uCamPos);
        float fade = exp(-d * uFade);
        float a = clamp(uOpacity * fade, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
      }`;
    mat.needsUpdate = true;

    reflector.renderOrder = 1;
    floorGroup.add(reflector);
  }

  /* ---------------- 人行道标线 ---------------- */
  const walkTex = walkwayTexture();
  const walkMat = new THREE.MeshStandardMaterial({
    map: walkTex, roughness: 0.55, metalness: 0.1,
    transparent: true, opacity: 0.92,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  [-6.4, 6.4].forEach((x) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(SCALE.walkwayWidth, 146), walkMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, -79);
    m.receiveShadow = true;
    floorGroup.add(m);
  });

  // 安全通道文字牌
  const walkLabelTex = labelTexture('安全通道', 'SAFETY AISLE', {
    bg: '#0d1a16', border: '#2e6b52', color: '#8fe0b8', subColor: '#3d7a5c', w: 512, h: 160
  });
  [-6.4, 6.4].forEach((x, i) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.5),
      new THREE.MeshBasicMaterial({ map: walkLabelTex, transparent: true, toneMapped: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = i % 2 === 0 ? 0 : Math.PI;
    m.position.set(x, 0.03, -12);
    floorGroup.add(m);
  });

  /* ---------------- 厂房结构：墙 / 屋顶 / 桁架 / 天窗 ---------------- */
  const structureMat = new THREE.MeshStandardMaterial({
    color: 0x121a22, roughness: 0.75, metalness: 0.55, envMapIntensity: 0.45
  });
  const roofGroup = new THREE.Group();
  root.add(roofGroup);

  // 侧面墙（只做暗面，靠雾吃掉边界）
  const wallGeoL = new THREE.BoxGeometry(0.6, SCALE.roofY, SCALE.hallDepth);
  const wallL = new THREE.Mesh(wallGeoL, structureMat);
  wallL.position.set(-SCALE.hallWidth / 2, SCALE.roofY / 2, -70);
  wallL.receiveShadow = true;
  roofGroup.add(wallL);
  const wallR = wallL.clone();
  wallR.position.x = SCALE.hallWidth / 2;
  roofGroup.add(wallR);

  // 端墙（消失点尽头）
  const endWall = new THREE.Mesh(new THREE.BoxGeometry(SCALE.hallWidth, SCALE.roofY, 0.6), structureMat);
  endWall.position.set(0, SCALE.roofY / 2, -170);
  roofGroup.add(endWall);

  // 端墙上的发光标识
  const endSignTex = labelTexture('B7 无人化车间', 'UNMANNED WORKSHOP · LINE 01', {
    w: 1024, h: 200, bg: '#060b10', border: '#1f7a96', color: '#7fe3ff', subColor: '#3f7a8e'
  });
  const endSign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 3.1),
    new THREE.MeshBasicMaterial({ map: endSignTex, transparent: true, toneMapped: false, opacity: 0.9 })
  );
  endSign.position.set(0, 6.2, -169.6);
  roofGroup.add(endSign);

  // 屋顶：留 3 条天窗缝
  const skylightX = [-7.5, 0, 7.5];
  const skylightW = 2.6;
  const roofPanelMat = new THREE.MeshStandardMaterial({
    color: 0x0b1218, roughness: 0.9, metalness: 0.3, side: THREE.DoubleSide
  });
  const roofSegments = [];
  // 每两两之间铺板
  const spans = [[-SCALE.hallWidth / 2, skylightX[0] - skylightW / 2]];
  for (let i = 0; i < skylightX.length - 1; i++) {
    spans.push([skylightX[i] + skylightW / 2, skylightX[i + 1] - skylightW / 2]);
  }
  spans.push([skylightX[skylightX.length - 1] + skylightW / 2, SCALE.hallWidth / 2]);
  spans.forEach(([x0, x1]) => {
    const w = x1 - x0;
    if (w <= 0.05) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, SCALE.hallDepth), roofPanelMat);
    m.rotation.x = Math.PI / 2;
    m.position.set((x0 + x1) / 2, SCALE.roofY, -70);
    roofGroup.add(m);
    roofSegments.push(m);
  });

  // 天窗玻璃（微亮，透出月色）
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0x24435c, transparent: true, opacity: 0.42, side: THREE.DoubleSide, toneMapped: false
  });
  skylightX.forEach((x) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(skylightW, SCALE.hallDepth), glassMat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, SCALE.roofY + 0.02, -70);
    roofGroup.add(m);
  });

  // 桁架：横向 I 形梁，全部合并成一个几何体
  const trussGeos = [];
  const beamLen = SCALE.hallWidth;
  for (let z = 0; z >= -160; z -= 8) {
    const topFlange = new THREE.BoxGeometry(beamLen, 0.12, 0.36);
    topFlange.translate(0, SCALE.roofY - 0.32, z);
    trussGeos.push(topFlange);
    const bottomFlange = new THREE.BoxGeometry(beamLen, 0.1, 0.28);
    bottomFlange.translate(0, SCALE.roofY - 0.92, z);
    trussGeos.push(bottomFlange);
    // 腹杆
    for (let x = -24; x <= 24; x += 6) {
      const web = new THREE.BoxGeometry(0.06, 0.62, 0.06);
      web.translate(x, SCALE.roofY - 0.62, z);
      trussGeos.push(web);
    }
  }
  // 纵向檩条
  [-20, -12, -4, 4, 12, 20].forEach((x) => {
    const purlin = new THREE.BoxGeometry(0.14, 0.14, SCALE.hallDepth);
    purlin.translate(x, SCALE.roofY - 1.05, -70);
    trussGeos.push(purlin);
  });
  const trussMerged = BufferGeometryUtils.mergeGeometries(trussGeos, false);
  trussGeos.forEach((g) => g.dispose());
  const truss = new THREE.Mesh(trussMerged, structureMat);
  truss.castShadow = false;
  truss.receiveShadow = true;
  roofGroup.add(truss);

  /* ---------------- 顶部灯管（发光条，bloom 主要来源） ---------------- */
  const tubeMaterial = new THREE.MeshBasicMaterial({ color: 0xbfe4ff, toneMapped: false });
  const tubeBaseColor = new THREE.Color(0xbfe4ff);
  const tubeGeo = new THREE.BoxGeometry(0.16, 0.1, 6.4);
  const tubeGroup = new THREE.Group();
  root.add(tubeGroup);
  const tubeMatrices = [];
  for (let z = -4; z >= -156; z -= 10) {
    [-4.6, 4.6].forEach((x) => {
      tubeMatrices.push([x, SCALE.roofY - 1.35, z]);
    });
  }
  const tubeInst = new THREE.InstancedMesh(tubeGeo, tubeMaterial, tubeMatrices.length);
  const tmpM = new THREE.Matrix4();
  tubeMatrices.forEach(([x, y, z], i) => {
    tmpM.makeTranslation(x, y, z);
    tubeInst.setMatrixAt(i, tmpM);
  });
  tubeInst.instanceMatrix.needsUpdate = true;
  tubeGroup.add(tubeInst);

  // 灯管外壳（暗色，做出"灯具"的体积感）
  const fixtureGeo = new THREE.BoxGeometry(0.34, 0.18, 6.6);
  const fixtureMat = new THREE.MeshStandardMaterial({ color: 0x1b242c, roughness: 0.6, metalness: 0.7 });
  const fixtureInst = new THREE.InstancedMesh(fixtureGeo, fixtureMat, tubeMatrices.length);
  tubeMatrices.forEach(([x, y, z], i) => {
    tmpM.makeTranslation(x, y + 0.12, z);
    fixtureInst.setMatrixAt(i, tmpM);
  });
  fixtureInst.instanceMatrix.needsUpdate = true;
  tubeGroup.add(fixtureInst);

  /* ---------------- 体积光柱（天窗月光） ---------------- */
  const shaftUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0.55 },
    uColor: { value: new THREE.Color(0x9fc8ff) }
  };
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: shaftUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vUv = uv;
        vY = uv.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        // 正对相机处光柱最厚 => 最亮；轮廓处衰减
        float thick = abs(dot(normalize(vN), normalize(vV)));
        float vert = smoothstep(0.0, 0.35, vY) * smoothstep(1.0, 0.72, vY);
        float streak = 0.78 + 0.22 * sin(vY * 26.0 - uTime * 0.8 + vUv.x * 14.0);
        float a = pow(thick, 2.0) * vert * streak * uIntensity;
        gl_FragColor = vec4(uColor * (0.35 + a), a);
      }`
  });

  const shaftGroup = new THREE.Group();
  shaftGroup.layers.set(2);          // 第 2 层：不进地面反射
  root.add(shaftGroup);
  skylightX.forEach((x) => {
    for (let i = 0; i < 5; i++) {
      const z = -16 - i * 32;
      const geo = new THREE.CylinderGeometry(2.0, 4.4, SCALE.roofY, 20, 1, true);
      const cone = new THREE.Mesh(geo, shaftMat);
      cone.position.set(x, SCALE.roofY / 2, z);
      cone.renderOrder = 3;
      cone.frustumCulled = false;
      shaftGroup.add(cone);
    }
  });

  /* ---------------- 灯光 ---------------- */
  const hemi = new THREE.HemisphereLight(0x2a4c72, 0x03060a, 0.55);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xa9cdff, 1.35);
  key.position.set(34, 42, 12);
  key.target.position.set(0, 0, -70);
  scene.add(key.target);
  if (quality.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -34;
    key.shadow.camera.right = 34;
    key.shadow.camera.top = 40;
    key.shadow.camera.bottom = -40;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 140;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 2;
    key.shadow.camera.updateProjectionMatrix();
  }
  scene.add(key);

  // 琥珀点光：焊接工位附近，数量受限（前向渲染每个灯都要算）
  const amberLights = [];
  const amberPositions = [[-2.6, 2.6, -50], [2.6, 2.6, -82], [-9, 4.2, -34], [9, 4.2, -114]];
  amberPositions.forEach((p) => {
    const l = new THREE.PointLight(0xffa040, 38, 30, 2);
    l.position.set(p[0], p[1], p[2]);
    scene.add(l);
    amberLights.push(l);
  });

  /* ---------------- 工位（7 个） ---------------- */
  const stationMat = new THREE.MeshStandardMaterial({
    color: 0x1e262d, roughness: 0.55, metalness: 0.8, envMapIntensity: 0.9
  });
  const stationAccentMat = new THREE.MeshStandardMaterial({
    color: 0x2a3540, roughness: 0.4, metalness: 0.9
  });
  const hazardTex = hazardTexture();

  STATIONS.forEach((def, idx) => {
    const g = new THREE.Group();
    g.position.set(0, 0, def.z);
    root.add(g);

    // 立柱（跨在机械臂工位外侧，形成门架）
    [-2.35, 2.35].forEach((x) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), stationMat);
      post.position.set(x, 1.25, 0);
      post.castShadow = true;
      g.add(post);
    });

    // 横梁
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4.86, 0.16, 0.2), stationMat);
    beam.position.set(0, 2.5, 0);
    beam.castShadow = true;
    g.add(beam);

    // 工位编号牌（面向入口，+z 方向）
    const tex = labelTexture(`工位 ${def.id}`, `${def.name} · STATION`, {
      w: 512, h: 160, bg: '#0a1119', border: '#2a7e96', color: '#cdefff', subColor: '#4d7c90'
    });
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.47),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
    );
    plate.position.set(0, 2.05, 0.1);
    g.add(plate);

    // 地面警示条
    const hazardPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(4.5, 0.5),
      new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8, metalness: 0.2 })
    );
    hazardPlate.rotation.x = -Math.PI / 2;
    hazardPlate.position.set(0, 0.021, 1.4);
    g.add(hazardPlate);

    // 状态灯（独立材质，逐工位控制）
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x52ff9a, toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), lampMat);
    lamp.position.set(2.35, 2.62, 0);
    g.add(lamp);

    // 灯罩
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.12, 0.16, 12, 1, true),
      stationAccentMat
    );
    shade.position.set(2.35, 2.72, 0);
    g.add(shade);

    const station = {
      index: idx,
      id: def.id,
      name: def.name,
      z: def.z,
      group: g,
      lamp,
      lampMat,
      status: idx === 5 ? 'alarm' : 'run',   // 06 工位预置报警，供交互演示
      phase: Math.random() * Math.PI * 2
    };
    station.lamp.userData = { kind: 'station', index: idx };
    world.pickables.push(lamp);
    world.stations.push(station);
  });

  /* ---------------- 检测隧道门 ---------------- */
  const gateGroup = new THREE.Group();
  gateGroup.position.set(0, 0, SCALE.gateZ);
  root.add(gateGroup);

  const gateFrameMat = new THREE.MeshStandardMaterial({ color: 0x1a222b, roughness: 0.5, metalness: 0.85 });
  [-2.4, 2.4].forEach((x) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.4, 0.6), gateFrameMat);
    p.position.set(x, 2.2, 0);
    p.castShadow = true;
    gateGroup.add(p);
  });
  const gateTop = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.55, 0.7), gateFrameMat);
  gateTop.position.set(0, 4.5, 0);
  gateTop.castShadow = true;
  gateGroup.add(gateTop);

  // 门框内部的青色发光条
  const gateGlowMat = new THREE.MeshBasicMaterial({ color: 0x39d6ff, toneMapped: false, transparent: true, opacity: 0.9 });
  [-2.1, 2.1].forEach((x) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.2, 0.06), gateGlowMat);
    strip.position.set(x, 2.1, 0.32);
    gateGroup.add(strip);
  });

  // 扫描面（平时隐藏，产品穿过时扫一次）
  const scanMat = new THREE.MeshBasicMaterial({
    color: 0x39d6ff, transparent: true, opacity: 0, toneMapped: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.4), scanMat);
  scanPlane.rotation.x = -Math.PI / 2;
  scanPlane.position.set(0, 0.2, 0);
  scanPlane.visible = false;
  gateGroup.add(scanPlane);

  // 顶部状态显示屏
  const gateScreenTex = labelTexture('检测隧道', 'INSPECTION TUNNEL', {
    w: 512, h: 160, bg: '#08131a', border: '#2a8ba8', color: '#8fe6ff', subColor: '#3f7a8e'
  });
  const gateScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.68),
    new THREE.MeshBasicMaterial({ map: gateScreenTex, transparent: true, toneMapped: false })
  );
  gateScreen.position.set(0, 3.9, 0.36);
  gateGroup.add(gateScreen);

  const gate = {
    group: gateGroup,
    scanPlane,
    scanMat,
    t: 0,          // 0..1 扫描进度，<0 表示空闲
    pulse() { this.t = 0; scanPlane.visible = true; },
    update(dt) {
      if (this.t < 0) return;
      this.t += dt / 0.62;
      if (this.t >= 1) {
        this.t = -1;
        scanPlane.visible = false;
        this.scanMat.opacity = 0;
        return;
      }
      const p = this.t;
      scanPlane.position.y = 0.25 + p * 3.3;
      // 两端淡入淡出
      this.scanMat.opacity = Math.sin(p * Math.PI) * 0.85;
    }
  };
  gate.t = -1;
  world.gate = gate;

  /* ---------------- 自动化立体仓库（两侧各一排，12m 高） ---------------- */
  const layers = quality.rackLayers;
  const bayCount = 13;
  const rackMat = new THREE.MeshStandardMaterial({
    color: 0x1d2530, roughness: 0.5, metalness: 0.88, envMapIntensity: 0.75
  });

  function buildRack(sideX) {
    const geos = [];
    const bayW = SCALE.rackBay;
    const totalLen = bayCount * bayW;
    const z0 = -30;
    const layerH = (SCALE.rackHeight - 0.4) / layers;

    // 立柱
    for (let b = 0; b <= bayCount; b++) {
      const z = z0 - b * bayW;
      [-1, 1].forEach((s) => {
        const g = new THREE.BoxGeometry(0.16, SCALE.rackHeight, 0.34);
        g.translate(sideX + s * (SCALE.rackDepth / 2), SCALE.rackHeight / 2, z);
        geos.push(g);
      });
    }
    // 横梁 + 层板
    for (let l = 1; l <= layers; l++) {
      const y = l * layerH;
      const beam = new THREE.BoxGeometry(SCALE.rackDepth, 0.14, totalLen);
      beam.translate(sideX, y, z0 - totalLen / 2 + bayW / 2);
      geos.push(beam);
      const shelf = new THREE.BoxGeometry(SCALE.rackDepth - 0.2, 0.05, totalLen);
      shelf.translate(sideX, y + 0.09, z0 - totalLen / 2 + bayW / 2);
      geos.push(shelf);
    }
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, rackMat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    root.add(mesh);

    // 货物（InstancedMesh，随机占用）
    const boxGeo = new THREE.BoxGeometry(1.5, 0.92, 1.1);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x8a6b3a, roughness: 0.75, metalness: 0.25 });
    const spots = [];
    for (let l = 1; l <= layers; l++) {
      for (let b = 0; b < bayCount; b++) {
        if (Math.random() > 0.62) continue;
        spots.push([sideX, l * layerH + 0.55, z0 - b * bayW - bayW / 2]);
      }
    }
    const inst = new THREE.InstancedMesh(boxGeo, boxMat, Math.max(1, spots.length));
    const m4 = new THREE.Matrix4();
    spots.forEach((p, i) => {
      m4.makeTranslation(p[0], p[1], p[2]);
      inst.setMatrixAt(i, m4);
    });
    inst.count = spots.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = false;
    root.add(inst);

    // 堆垛机：轨道 + 立柱 + 载货台（升降）
    const crane = new THREE.Group();
    const craneX = sideX - Math.sign(sideX) * (SCALE.rackDepth / 2 + 1.5);
    crane.position.set(craneX, 0, z0 - totalLen / 2);
    root.add(crane);

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.14, totalLen + 2),
      new THREE.MeshStandardMaterial({ color: 0x2c3640, roughness: 0.35, metalness: 0.95 })
    );
    rail.position.set(0, 0.07, 0);
    crane.add(rail);

    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.26, SCALE.rackHeight, 0.26), rackMat);
    mast.position.set(0, SCALE.rackHeight / 2, 0);
    crane.add(mast);

    const carriage = new THREE.Group();
    carriage.position.set(0, 2.0, 0);
    crane.add(carriage);

    const carriageBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.8), rackMat);
    carriage.add(carriageBody);
    const forks = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.06, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x39454f, roughness: 0.4, metalness: 0.9 })
    );
    forks.position.set(Math.sign(sideX) * 0.9, -0.18, 0);
    carriage.add(forks);

    // 载货台上的货物
    const carried = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.92, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x9a7b46, roughness: 0.7, metalness: 0.3 })
    );
    carried.position.set(Math.sign(sideX) * 0.9, 0.3, 0);
    carried.visible = false;
    carried.castShadow = true;
    carriage.add(carried);

    return {
      side: Math.sign(sideX),
      crane, carriage, carried,
      z0, totalLen, layerH, layers, bayW, bayCount,
      state: 'travel',
      targetZ: 0,
      targetY: 2,
      timer: Math.random() * 3,
      speed: 3.4
    };
  }

  world.racks.push(buildRack(-19));
  world.racks.push(buildRack(19));

  /* ---------------- 管道 / 细节 ---------------- */
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x2a3238, roughness: 0.45, metalness: 0.9 });
  [-11, 11].forEach((x) => {
    for (let i = 0; i < 3; i++) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12 - i * 0.02, 0.12 - i * 0.02, SCALE.hallDepth - 20, 8, 1),
        pipeMat
      );
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x + i * 0.3, SCALE.roofY - 2.0 - i * 0.3, -70);
      root.add(pipe);
    }
  });

  /* ---------------- 粒子系统：蒸汽 / 浮尘 / 焊花 ---------------- */
  const softTex = particleTexture(true);
  const sparkTex = particleTexture(false);

  function makePoints(count, tex, size, color, opacity, blending) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size, map: tex, color, transparent: true, opacity,
      depthWrite: false, blending, sizeAttenuation: true
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.layers.set(2);
    root.add(points);
    return { points, geo, pos, mat, count };
  }

  // 蒸汽：工位两侧地缝冒出，缓慢上升扩散
  const steamCount = Math.floor(320 * (quality.particles || 1));
  const steam = makePoints(steamCount, softTex, 0.9, 0xbfd4e6, 0.16, THREE.NormalBlending);
  const steamData = [];
  for (let i = 0; i < steamCount; i++) {
    steamData.push({
      x: (Math.random() - 0.5) * 40,
      y: Math.random() * 6,
      z: -10 - Math.random() * 140,
      vy: 0.25 + Math.random() * 0.5,
      drift: (Math.random() - 0.5) * 0.25,
      life: Math.random()
    });
  }

  // 浮尘：全空间低速漂浮，靠体积光条纹点亮
  const dustCount = Math.floor(520 * (quality.particles || 1));
  const dust = makePoints(dustCount, softTex, 0.34, 0x9fc4e0, 0.12, THREE.AdditiveBlending);
  const dustData = [];
  for (let i = 0; i < dustCount; i++) {
    dustData.push({
      x: (Math.random() - 0.5) * 46,
      y: Math.random() * 10,
      z: -6 - Math.random() * 150,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.1,
      vz: (Math.random() - 0.5) * 0.18
    });
  }

  // 焊花：3 个焊接点，短命火星，向上抛洒
  const sparkPer = Math.floor(46 * (quality.particles || 1));
  const sparkEmitters = [
    { x: -2.1, y: 1.5, z: -50 },
    { x: 2.1, y: 1.5, z: -82 },
    { x: 0.0, y: 1.4, z: -66 }
  ];
  const sparkTotal = sparkPer * sparkEmitters.length;
  const sparks = makePoints(sparkTotal, sparkTex, 0.22, 0xffb060, 0.95, THREE.AdditiveBlending);
  const sparkData = [];
  for (let i = 0; i < sparkTotal; i++) {
    const e = sparkEmitters[i % sparkEmitters.length];
    sparkData.push({
      ex: e.x, ey: e.y, ez: e.z,
      x: e.x, y: e.y, z: e.z,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 0.6 + Math.random() * 2.0,
      vz: (Math.random() - 0.5) * 1.6,
      life: Math.random() * 1.2
    });
  }

  world.particleSystems = [
    { kind: 'steam', steam, steamData },
    { kind: 'dust', dust, dustData },
    { kind: 'sparks', sparks, sparkData }
  ];

  /* ---------------- 相机/可见性辅助：第 2 层给主相机 ---------------- */
  // （主相机在 main.js 里 layers.enable(2)）

  /* ---------------- 灯光预设 ---------------- */
  const cur = {
    bg: new THREE.Color(LIGHT_PRESETS.cold.bg),
    fog: new THREE.Color(LIGHT_PRESETS.cold.fog),
    fogDensity: LIGHT_PRESETS.cold.fogDensity,
    hemiSky: new THREE.Color(LIGHT_PRESETS.cold.hemiSky),
    hemiGround: new THREE.Color(LIGHT_PRESETS.cold.hemiGround),
    hemiI: LIGHT_PRESETS.cold.hemiI,
    key: new THREE.Color(LIGHT_PRESETS.cold.key),
    keyI: LIGHT_PRESETS.cold.keyI,
    amber: new THREE.Color(LIGHT_PRESETS.cold.amber),
    amberI: LIGHT_PRESETS.cold.amberI,
    tube: new THREE.Color(LIGHT_PRESETS.cold.tube),
    tubeI: LIGHT_PRESETS.cold.tubeI,
    accent: new THREE.Color(LIGHT_PRESETS.cold.accent),
    exposure: LIGHT_PRESETS.cold.exposure,
    bloom: LIGHT_PRESETS.cold.bloom
  };
  const target = {
    bg: cur.bg.clone(), fog: cur.fog.clone(), fogDensity: cur.fogDensity,
    hemiSky: cur.hemiSky.clone(), hemiGround: cur.hemiGround.clone(), hemiI: cur.hemiI,
    key: cur.key.clone(), keyI: cur.keyI,
    amber: cur.amber.clone(), amberI: cur.amberI,
    tube: cur.tube.clone(), tubeI: cur.tubeI,
    accent: cur.accent.clone(),
    exposure: cur.exposure, bloom: cur.bloom
  };

  function setPresetTo(state) {
    target.bg.set(state.bg);
    target.fog.set(state.fog);
    target.fogDensity = state.fogDensity;
    target.hemiSky.set(state.hemiSky);
    target.hemiGround.set(state.hemiGround);
    target.hemiI = state.hemiI;
    target.key.set(state.key);
    target.keyI = state.keyI;
    target.amber.set(state.amber);
    target.amberI = state.amberI;
    target.tube.set(state.tube);
    target.tubeI = state.tubeI;
    target.accent.set(state.accent);
    target.exposure = state.exposure;
    target.bloom = state.bloom;
  }

  function applyCur() {
    scene.background.copy(cur.bg);
    scene.fog.color.copy(cur.fog);
    scene.fog.density = cur.fogDensity;
    hemi.color.copy(cur.hemiSky);
    hemi.groundColor.copy(cur.hemiGround);
    hemi.intensity = cur.hemiI;
    key.color.copy(cur.key);
    key.intensity = cur.keyI;
    amberLights.forEach((l) => {
      l.color.copy(cur.amber);
      l.intensity = cur.amberI;
    });
    tubeMaterial.color.copy(tubeBaseColor).multiplyScalar(cur.tubeI * 2.0);
    tubeMaterial.color.lerp(cur.tube, 0.35);
    gateGlowMat.color.copy(cur.accent).multiplyScalar(2.2);
    gate.scanMat.color.copy(cur.accent).multiplyScalar(1.6);
    shaftUniforms.uColor.value.copy(cur.key).lerp(new THREE.Color(0xffffff), 0.25);
    renderer.toneMappingExposure = cur.exposure;
  }
  applyCur();

  world.setPreset = function (name, instant) {
    const p = LIGHT_PRESETS[name] || LIGHT_PRESETS.cold;
    setPresetTo(p);
    if (instant) {
      cur.bg.copy(target.bg); cur.fog.copy(target.fog); cur.fogDensity = target.fogDensity;
      cur.hemiSky.copy(target.hemiSky); cur.hemiGround.copy(target.hemiGround); cur.hemiI = target.hemiI;
      cur.key.copy(target.key); cur.keyI = target.keyI;
      cur.amber.copy(target.amber); cur.amberI = target.amberI;
      cur.tube.copy(target.tube); cur.tubeI = target.tubeI;
      cur.accent.copy(target.accent); cur.accent.lerp(target.accent, 1);
      cur.exposure = target.exposure; cur.bloom = target.bloom;
      applyCur();
    }
    return p.label;
  };

  world.presetNames = Object.keys(LIGHT_PRESETS);
  world.getPresetLabel = (n) => (LIGHT_PRESETS[n] || LIGHT_PRESETS.cold).label;

  /* ---------------- 剖面模式：隐藏屋顶 ---------------- */
  let sectionOn = false;
  world.setSection = function (on) {
    sectionOn = !!on;
    roofGroup.visible = !sectionOn;
    truss.visible = !sectionOn;
    tubeGroup.visible = !sectionOn;
    shaftGroup.visible = !sectionOn;
    return sectionOn;
  };
  world.isSection = () => sectionOn;

  /* ---------------- 粒子密度 ---------------- */
  world.setParticleDensity = function (mult) {
    const m = Math.max(0, Math.min(1.5, mult));
    steam.geo.setDrawRange(0, Math.floor(steamCount * m));
    dust.geo.setDrawRange(0, Math.floor(dustCount * m));
    sparks.geo.setDrawRange(0, Math.floor(sparkTotal * m));
    steam.mat.opacity = 0.16 * Math.min(1, m + 0.2);
    dust.mat.opacity = 0.12 * Math.min(1, m + 0.2);
  };
  world.setParticleDensity(quality.particles || 1);

  /* ---------------- 工位状态 ---------------- */
  const STATUS_COLOR = { run: 0x52ff9a, alarm: 0xff3b30, idle: 0xffb454 };
  const STATUS_COLOR_OBJ = {
    run: new THREE.Color(0x52ff9a),
    alarm: new THREE.Color(0xff3b30),
    idle: new THREE.Color(0xffb454)
  };
  world.setStationStatus = function (index, status) {
    const s = world.stations[index];
    if (!s) return;
    s.status = status;
    s.lampMat.color.set(STATUS_COLOR[status] || 0x52ff9a);
  };

  /* ---------------- 尺寸变化 ---------------- */
  world.resize = function (w, h) {
    if (!reflector) return;
    const rt = reflector.getRenderTarget();
    if (rt) rt.setSize(Math.max(256, Math.floor(w * 0.5)), Math.max(256, Math.floor(h * 0.5)));
  };

  /* ---------------- 每帧更新 ---------------- */
  const camPosTmp = new THREE.Vector3();

  world.update = function (dt, t) {
    // 灯光预设平滑过渡
    const k = 1 - Math.pow(0.001, dt);   // 与帧率无关的插值
    cur.bg.lerp(target.bg, k);
    cur.fog.lerp(target.fog, k);
    cur.fogDensity += (target.fogDensity - cur.fogDensity) * k;
    cur.hemiSky.lerp(target.hemiSky, k);
    cur.hemiGround.lerp(target.hemiGround, k);
    cur.hemiI += (target.hemiI - cur.hemiI) * k;
    cur.key.lerp(target.key, k);
    cur.keyI += (target.keyI - cur.keyI) * k;
    cur.amber.lerp(target.amber, k);
    cur.amberI += (target.amberI - cur.amberI) * k;
    cur.tube.lerp(target.tube, k);
    cur.tubeI += (target.tubeI - cur.tubeI) * k;
    cur.accent.lerp(target.accent, k);
    cur.exposure += (target.exposure - cur.exposure) * k;
    cur.bloom += (target.bloom - cur.bloom) * k;
    applyCur();
    if (world.onBloomChange) world.onBloomChange(cur.bloom);

    // 体积光
    shaftUniforms.uTime.value = t;

    // 工位状态灯
    for (let i = 0; i < world.stations.length; i++) {
      const s = world.stations[i];
      let puls = 0;
      if (s.status === 'run') {
        puls = 0.55 + 0.45 * Math.sin(t * 3.4 + s.phase);        // 绿闪
      } else if (s.status === 'alarm') {
        puls = (Math.sin(t * 11.0 + s.phase) > 0) ? 1.0 : 0.05;  // 红急促闪
      } else {
        puls = 0.5;                                              // 黄常亮
      }
      s.lampMat.color.copy(STATUS_COLOR_OBJ[s.status] || STATUS_COLOR_OBJ.run);
      const base = s.status === 'idle' ? 0.75 : 1.0;
      s.lampMat.color.multiplyScalar((0.35 + puls * 0.9) * base);
    }

    // 检测隧道扫描
    gate.update(dt);

    // 堆垛机存取循环
    for (let i = 0; i < world.racks.length; i++) {
      const r = world.racks[i];
      r.timer -= dt;
      if (r.state === 'travel') {
        const dz = r.targetZ - r.crane.position.z;
        const step = Math.sign(dz) * Math.min(Math.abs(dz), r.speed * dt);
        r.crane.position.z += step;
        if (Math.abs(dz) < 0.05 && r.timer <= 0) {
          r.state = 'lift';
        }
      } else if (r.state === 'lift') {
        const dy = r.targetY - r.carriage.position.y;
        const step = Math.sign(dy) * Math.min(Math.abs(dy), 1.6 * dt);
        r.carriage.position.y += step;
        if (Math.abs(dy) < 0.05) {
          r.state = 'drop';
          r.timer = 0.7;
        }
      } else if (r.state === 'drop') {
        if (r.timer > 0) {
          r.carried.visible = r.timer > 0.35;
        } else {
          r.state = 'travel';
          r.timer = 1.2 + Math.random() * 2.5;
          const zMin = r.z0 - r.totalLen + r.bayW / 2;
          const zMax = r.z0 - r.bayW / 2;
          r.targetZ = zMin + Math.random() * (zMax - zMin);
          const l = 1 + Math.floor(Math.random() * r.layers);
          r.targetY = Math.max(1.6, Math.min(SCALE.rackHeight - 1.2, l * r.layerH + 0.55));
          r.carried.visible = true;
        }
      }
    }

    // 蒸汽
    const steamN = steam.geo.drawRange.count;
    for (let i = 0; i < steamN && i < steamData.length; i++) {
      const p = steamData[i];
      p.y += p.vy * dt;
      p.x += p.drift * dt;
      p.life += dt * 0.16;
      if (p.y > 7 || p.life > 1) {
        p.y = 0.15;
        p.life = 0;
        p.x = (Math.random() - 0.5) * 42;
        p.z = -10 - Math.random() * 140;
        p.vy = 0.25 + Math.random() * 0.5;
      }
      steam.pos[i * 3] = p.x;
      steam.pos[i * 3 + 1] = p.y;
      steam.pos[i * 3 + 2] = p.z;
    }
    steam.geo.attributes.position.needsUpdate = true;

    // 浮尘
    const dustN = dust.geo.drawRange.count;
    for (let i = 0; i < dustN && i < dustData.length; i++) {
      const p = dustData[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt + Math.sin(t * 0.6 + i) * 0.0015;
      p.z += p.vz * dt;
      if (p.y > 10) { p.y = 0.2; }
      if (p.y < 0.1) { p.y = 2; }
      dust.pos[i * 3] = p.x;
      dust.pos[i * 3 + 1] = p.y;
      dust.pos[i * 3 + 2] = p.z;
    }
    dust.geo.attributes.position.needsUpdate = true;

    // 焊花
    const sparkN = sparks.geo.drawRange.count;
    for (let i = 0; i < sparkN && i < sparkData.length; i++) {
      const p = sparkData[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.life = 0.35 + Math.random() * 0.75;
        p.x = p.ex + (Math.random() - 0.5) * 0.3;
        p.y = p.ey;
        p.z = p.ez + (Math.random() - 0.5) * 0.3;
        p.vx = (Math.random() - 0.5) * 1.9;
        p.vy = 0.8 + Math.random() * 2.2;
        p.vz = (Math.random() - 0.5) * 1.9;
      } else {
        p.vy -= 6.5 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.1) { p.y = 0.1; p.life = 0; }
      }
      sparks.pos[i * 3] = p.x;
      sparks.pos[i * 3 + 1] = p.y;
      sparks.pos[i * 3 + 2] = p.z;
    }
    sparks.geo.attributes.position.needsUpdate = true;

    // 反射层的相机位置（做距离衰减）
    if (reflector) {
      const cam = scene.userData.activeCamera;
      if (cam) {
        reflector.material.uniforms.uCamPos.value.copy(camPosTmp.copy(cam.position));
      }
    }
  };

  world.dispose = function () {
    scene.remove(root);
    root.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m && m.dispose && m.dispose());
      }
    });
    if (scene.environment) scene.environment.dispose();
  };

  return world;
}