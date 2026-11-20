/**
 * conveyor.js — 主线 + 3 条支线汇入
 *
 * 皮带面用「沿曲线的带状几何体」生成（UV 的 v 方向按弧长累加），
 * 所以纹理滚动速度和真实线速度一致；滚轮用 InstancedMesh 逐帧转向。
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const BELT_H = 0.95;
const BELT_W = 1.2;

/** 皮带纹理：橡胶底 + 横向挡条 */
function beltTexture() {
  const w = 64, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#14191e';
  ctx.fillRect(0, 0, w, h);
  // 挡条
  for (let y = 0; y < h; y += 32) {
    ctx.fillStyle = '#232c34';
    ctx.fillRect(0, y, w, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(0, y, w, 2);
  }
  // 细噪点
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${90 + Math.random() * 60},${90 + Math.random() * 60},${100 + Math.random() * 60},0.06)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 地面方向箭头纹理 */
function arrowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(90, 220, 255, 0.85)';
  const cx = s / 2;
  for (let i = 0; i < 3; i++) {
    const y = 26 + i * 30;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx + 22, y + 24);
    ctx.lineTo(cx + 9, y + 24);
    ctx.lineTo(cx + 9, y + 34);
    ctx.lineTo(cx - 9, y + 34);
    ctx.lineTo(cx - 9, y + 24);
    ctx.lineTo(cx - 22, y + 24);
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 沿曲线生成皮带面（带正确 UV） */
function buildRibbon(curve, halfWidth, samples) {
  const pos = [];
  const uvs = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let arc = 0;
  let prev = null;

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    right.crossVectors(up, dir).normalize().multiplyScalar(halfWidth);

    if (prev) arc += p.distanceTo(prev);
    prev = p.clone();

    pos.push(p.x - right.x, p.y, p.z - right.z);
    pos.push(p.x + right.x, p.y, p.z + right.z);
    // v 方向按弧长/2m 重复，纹理滚动才会跟着线速度走
    const v = arc / 2;
    uvs.push(0, v, 1, v);
  }
  for (let i = 0; i < samples; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 沿曲线生成框架（侧梁 + 支腿），合并成一个几何体 */
function buildFrame(curve, halfWidth, samples) {
  const geos = [];
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  const n = samples;
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n;
    const p0 = curve.getPointAt(u0), p1 = curve.getPointAt(u1);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const len = p0.distanceTo(p1);
    curve.getTangentAt(u0, dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    q.setFromUnitVectors(zAxis, dir);
    right.crossVectors(up, dir).normalize();

    // 两侧侧梁
    [-1, 1].forEach((s) => {
      const g = new THREE.BoxGeometry(0.08, 0.16, len * 1.02);
      const px = mid.x + right.x * halfWidth * s;
      const pz = mid.z + right.z * halfWidth * s;
      m4.compose(new THREE.Vector3(px, mid.y - 0.09, pz), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m4);
      geos.push(g);
    });

    // 每 4 段加一对支腿
    if (i % 4 === 0) {
      [-1, 1].forEach((s) => {
        const g = new THREE.BoxGeometry(0.1, BELT_H - 0.1, 0.1);
        const px = mid.x + right.x * halfWidth * s;
        const pz = mid.z + right.z * halfWidth * s;
        g.translate(px, (BELT_H - 0.1) / 2, pz);
        geos.push(g);
      });
      // 横撑
      const brace = new THREE.BoxGeometry(halfWidth * 2, 0.07, 0.07);
      m4.compose(new THREE.Vector3(mid.x, 0.28, mid.z), q, new THREE.Vector3(1, 1, 1));
      brace.applyMatrix4(m4);
      geos.push(brace);
    }
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

/* ------------------------------------------------------------------ */
/* 传送带实例                                                          */
/* ------------------------------------------------------------------ */
class Conveyor {
  constructor(curve, opts) {
    this.curve = curve;
    this.length = curve.getLength();
    this.isMain = !!opts.isMain;
    this.items = [];
    this.rollerAngle = 0;
    this.speedK = 1;

    this.group = new THREE.Group();
    this.beltTex = opts.beltTex;
    this.beltTex.offset.y = 0;
  }

  build(scene, quality) {
    const samples = Math.max(12, Math.floor(this.length / 2));

    // 每条线用自己的纹理副本，否则 offset 会被各线重复累加
    this.beltTex = this.beltTex.clone();
    this.beltTex.needsUpdate = true;
    this.beltTex.offset.y = 0;

    // 皮带面
    const beltMat = new THREE.MeshStandardMaterial({
      map: this.beltTex,
      color: 0xa8b4c0,
      roughness: 0.78,
      metalness: 0.25,
      envMapIntensity: 0.5
    });
    const belt = new THREE.Mesh(buildRibbon(this.curve, BELT_W / 2, samples), beltMat);
    belt.receiveShadow = true;
    this.group.add(belt);
    this.beltMesh = belt;

    // 框架
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x222a32, roughness: 0.48, metalness: 0.85
    });
    const frame = new THREE.Mesh(buildFrame(this.curve, BELT_W / 2, Math.max(8, samples >> 1)), frameMat);
    frame.castShadow = false;
    frame.receiveShadow = true;
    this.group.add(frame);

    // 滚轮：实例化，逐帧转向
    const rollerCount = Math.min(60, Math.max(8, Math.floor(this.length / 2.4)));
    const rollerGeo = new THREE.CylinderGeometry(0.055, 0.055, BELT_W * 0.94, 8, 1);
    const rollerMat = new THREE.MeshStandardMaterial({
      color: 0x8f9aa4, roughness: 0.3, metalness: 0.95
    });
    this.rollers = new THREE.InstancedMesh(rollerGeo, rollerMat, rollerCount);
    this.rollerBase = [];
    this.rollerCount = rollerCount;

    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < rollerCount; i++) {
      const u = (i + 0.5) / rollerCount;
      const p = this.curve.getPointAt(u);
      this.curve.getTangentAt(u, dir);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      right.crossVectors(up, dir).normalize();
      // 圆柱默认轴为 Y，把它转到皮带横向（right）
      q.setFromUnitVectors(yAxis, right);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.y - 0.07, p.z), q, new THREE.Vector3(1, 1, 1)
      );
      this.rollerBase.push(m);
      this.rollers.setMatrixAt(i, m);
    }
    this.rollers.instanceMatrix.needsUpdate = true;
    this.group.add(this.rollers);

    scene.add(this.group);
    return this;
  }

  setSpeedK(k) { this.speedK = k; }

  /** 生成一个工件；u 为曲线参数 */
  spawnItem(u, scene, glowColor) {
    const geo = new THREE.BoxGeometry(0.3, 0.24, 0.3);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8c96a2, roughness: 0.35, metalness: 0.7,
      emissive: new THREE.Color(glowColor), emissiveIntensity: 1.6
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    scene.add(mesh);
    const item = { u, mesh, mat };
    this.items.push(item);
    return item;
  }

  update(dt, speedMps, onTransfer, onPassGate) {
    const v = speedMps;
    const du = (v * dt) / this.length;

    // 皮带纹理滚动（1 个 repeat = 2m）
    this.beltTex.offset.y -= (v * dt) / 2;

    // 滚轮转动：角速度 = 线速度 / 半径
    if (v > 0.001) {
      this.rollerAngle += (v / 0.055) * dt;
      const tmp = new THREE.Matrix4();
      const rot = new THREE.Matrix4().makeRotationY(this.rollerAngle);
      for (let i = 0; i < this.rollerCount; i++) {
        tmp.multiplyMatrices(this.rollerBase[i], rot);
        this.rollers.setMatrixAt(i, tmp);
      }
      this.rollers.instanceMatrix.needsUpdate = true;
    }

    const p = new THREE.Vector3();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.u += du;
      if (it.u >= 1) {
        if (onTransfer) onTransfer(this, it);
        this.removeItem(i);
        continue;
      }
      this.curve.getPointAt(it.u, p);
      it.mesh.position.set(p.x, p.y + 0.14, p.z);
      // 朝向随切线
      const tan = this.curve.getTangentAt(it.u, new THREE.Vector3());
      tan.y = 0;
      if (tan.lengthSq() > 1e-6) it.mesh.rotation.y = Math.atan2(tan.x, tan.z);

      if (onPassGate) onPassGate(this, it, p);
    }
  }

  removeItem(i) {
    const it = this.items[i];
    if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
    it.mesh.geometry.dispose();
    it.mat.dispose();
    this.items.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ */
/* 装配：主线 + 3 条支线                                               */
/* ------------------------------------------------------------------ */
export function createConveyors(scene, quality, options = {}) {
  const beltTex = beltTexture();
  const arrowTex = arrowTexture();

  const main = new Conveyor(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, BELT_H, -6),
      new THREE.Vector3(0, BELT_H, -78),
      new THREE.Vector3(0, BELT_H, -150)
    ]),
    { isMain: true, beltTex }
  );
  main.build(scene, quality);

  const branchDefs = [
    { side: -1, z: -46 },
    { side: 1, z: -76 },
    { side: -1, z: -106 }
  ];

  const branches = branchDefs.map((def) => {
    const z = def.z;
    const s = def.side;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 17, BELT_H, z + 3.0),
      new THREE.Vector3(s * 12, BELT_H, z + 2.2),
      new THREE.Vector3(s * 6.5, BELT_H, z + 0.8),
      new THREE.Vector3(s * 2.8, BELT_H, z - 1.4),
      new THREE.Vector3(0, BELT_H, z - 4.2),
      new THREE.Vector3(0, BELT_H, z - 8.0)
    ], false, 'catmullrom', 0.4);
    const c = new Conveyor(curve, { isMain: false, beltTex });
    c.build(scene, quality);
    c.mergeZ = z - 8;
    c.side = s;
    return c;
  });

  /* ---------------- 地面方向箭头 ---------------- */
  const arrowMat = new THREE.MeshBasicMaterial({
    map: arrowTex, transparent: true, opacity: 0.5,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide
  });
  const arrows = [];
  const arrowGroup = new THREE.Group();
  arrowGroup.layers.set(2);
  scene.add(arrowGroup);

  function placeArrows(curve, count) {
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u, new THREE.Vector3());
      const a = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), arrowMat);
      a.rotation.x = -Math.PI / 2;
      a.rotation.z = -Math.atan2(tan.x, tan.z);
      a.position.set(p.x, 0.035, p.z);
      arrowGroup.add(a);
      arrows.push(a);
    }
  }
  branches.forEach((b) => placeArrows(b.curve, 6));

  /* ---------------- 工件投放 ---------------- */
  const glowColors = [0xffb463, 0xff8a3c, 0x66e0ff];
  const stats = { gatePass: 0 };

  // 支线预置工件
  branches.forEach((b, i) => {
    const n = quality.mobile ? 2 : 3;
    for (let k = 0; k < n; k++) {
      b.spawnItem(0.12 + k * (0.8 / n), scene, glowColors[(i + k) % glowColors.length]);
    }
  });
  // 主线预置工件（铺满纵深）
  const mainN = quality.mobile ? 6 : 12;
  for (let k = 0; k < mainN; k++) {
    main.spawnItem(0.02 + (k / mainN) * 0.7, scene, glowColors[k % glowColors.length]);
  }

  function transfer(branch, item) {
    // 支线末端 → 主线对应位置
    const zMerge = branch.mergeZ;
    const u = (-6 - zMerge) / 144;   // 主线参数（z -6 → -150）
    main.spawnItem(Math.min(0.995, Math.max(0, u)), scene, glowColors[0]);
    // 支线补料，保持车流不断
    branch.spawnItem(0.02, scene, glowColors[2]);
  }

  const gateZ = -128;
  function passGate(line, item, p) {
    if (!line.isMain) return;
    if (item._passed) return;
    if (p.z <= gateZ) {
      item._passed = true;
      stats.gatePass += 1;
      if (options.onItemPassGate) options.onItemPassGate(p);
    }
  }

  let speedK = 1;
  const BASE_SPEED = 0.95;   // 1x 时的线速度 m/s

  return {
    main,
    branches,
    arrows,
    stats,
    isMain: (l) => l === main,
    setSpeed(k) {
      speedK = Math.max(0, Math.min(3, k));
      return speedK;
    },
    getSpeed() { return speedK; },
    update(dt) {
      const v = BASE_SPEED * speedK;
      // 支线先走
      for (let i = 0; i < branches.length; i++) {
        branches[i].update(dt, v, transfer, null);
      }
      main.update(dt, v, null, passGate);

      // 主线补料：末端出料后不会让产线空掉
      const mainTarget = quality.mobile ? 6 : 12;
      if (main.items.length < mainTarget) {
        main.spawnItem(0.012, scene, glowColors[main.items.length % glowColors.length]);
      }

      // 箭头呼吸
      const pulse = 0.32 + 0.22 * Math.sin(performance.now() * 0.0022);
      arrowMat.opacity = speedK < 0.01 ? 0.18 : pulse;
    }
  };
}