/**
 * agv.js — 潜伏式 AGV 小车
 * 沿地面磁条导引线闭环巡游，载料箱，车头有扫描光锥与地面光斑。
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const TRACK_Y = 0.022;

function radialTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(120,240,255,0.55)');
  g.addColorStop(0.5, 'rgba(80,200,240,0.18)');
  g.addColorStop(1, 'rgba(40,140,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 导引线：沿曲线铺一条细带 */
function buildGuideLine(curve, width, samples) {
  const pos = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const dir = new THREE.Vector3();

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    right.crossVectors(up, dir).normalize().multiplyScalar(width / 2);
    pos.push(p.x - right.x, TRACK_Y, p.z - right.z);
    pos.push(p.x + right.x, TRACK_Y, p.z + right.z);
  }
  for (let i = 0; i < samples; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class Agv {
  constructor(opts) {
    this.curve = opts.curve;
    this.u = opts.u || 0;
    this.speed = opts.speed || 1.5;      // m/s
    this.pathLen = this.curve.getLength();
    this.index = opts.index;

    this.group = new THREE.Group();
    this.group.layers.set(0);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1c252d, roughness: 0.42, metalness: 0.8, envMapIntensity: 0.9
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xb8641c, roughness: 0.55, metalness: 0.5
    });
    const cargoMat = new THREE.MeshStandardMaterial({
      color: 0x6d5734, roughness: 0.85, metalness: 0.15
    });

    // 底盘
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.34, 2.3), bodyMat);
    chassis.position.y = 0.26;
    chassis.castShadow = true;
    this.group.add(chassis);

    // 上盖（略小，做出层次）
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 2.1), accentMat);
    deck.position.y = 0.46;
    this.group.add(deck);

    // 斜切车头（工程感）
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.5), bodyMat);
    nose.position.set(0, 0.42, -1.15);
    nose.rotation.x = -0.22;
    this.group.add(nose);

    // 料箱
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.78, 1.15), cargoMat);
    cargo.position.set(0, 0.9, 0.15);
    cargo.castShadow = true;
    this.group.add(cargo);
    // 绑带
    [-0.32, 0.32].forEach((x) => {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.17), accentMat);
      strap.position.set(x, 0.9, 0.15);
      this.group.add(strap);
    });

    // 车轮（4 个，随行驶转动）
    const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0b0e11, roughness: 0.9, metalness: 0.1 });
    this.wheels = [];
    const wheelPos = [[-0.66, -0.78], [0.66, -0.78], [-0.66, 0.78], [0.66, 0.78]];
    wheelPos.forEach(([x, z]) => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, 0.16, z);
      this.group.add(w);
      this.wheels.push(w);
    });

    // 车头扫描光锥
    const coneGeo = new THREE.ConeGeometry(0.85, 2.6, 18, 1, true);
    coneGeo.rotateX(Math.PI / 2);        // 锥尖朝 +Z
    this.scanMat = new THREE.MeshBasicMaterial({
      color: 0x6fe6ff, transparent: true, opacity: 0.1,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false
    });
    this.scanCone = new THREE.Mesh(coneGeo, this.scanMat);
    this.scanCone.position.set(0, 0.34, -2.2);
    this.scanCone.rotation.x = 0.12;
    this.group.add(this.scanCone);

    // 地面扫描光斑
    this.poolMat = new THREE.MeshBasicMaterial({
      map: opts.poolTex, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), this.poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(0, 0.045, -2.4);
    this.group.add(this.pool);

    // 顶部警示灯
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xffa03a, toneMapped: false });
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.beaconMat);
    this.beacon.position.set(0, 1.36, -0.9);
    this.group.add(this.beacon);

    // 侧面色带（发光，进 bloom）
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x39d6ff, toneMapped: false });
    [-1, 1].forEach((s) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 1.7), stripMat);
      strip.position.set(s * 0.73, 0.4, 0.1);
      this.group.add(strip);
    });

    this._lookTarget = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this._wheelAngle = 0;
    this._bob = Math.random() * 10;
  }

  update(dt, t, speedK) {
    const v = this.speed * Math.max(0, speedK);
    this.u = (this.u + (v * dt) / this.pathLen) % 1;

    this.curve.getPointAt(this.u, this._pos);
    this.curve.getTangentAt(this.u, this._tan);
    this.group.position.set(this._pos.x, 0, this._pos.z);

    // 朝向：tangent 指向运动方向
    const yaw = Math.atan2(this._tan.x, this._tan.z);
    this.group.rotation.y = yaw;

    // 车轮转动
    this._wheelAngle += (v / 0.16) * dt;
    for (let i = 0; i < this.wheels.length; i++) this.wheels[i].rotation.x = this._wheelAngle;

    // 扫描锥左右摆
    this.scanCone.rotation.z = Math.sin(t * 1.6 + this.index) * 0.18;
    this.pool.position.x = Math.sin(t * 1.6 + this.index) * 0.35;

    // 警示灯闪烁
    const blink = (Math.sin(t * 5.2 + this.index * 2.1) > 0.35) ? 1.0 : 0.15;
    this.beaconMat.color.setRGB(1.0 * blink, 0.62 * blink, 0.22 * blink);

    // 轻微颠簸
    this.group.position.y = Math.abs(Math.sin(t * 6 + this._bob)) * 0.012;
  }
}

/* ------------------------------------------------------------------ */
/* 装配                                                                */
/* ------------------------------------------------------------------ */
export function createAgvFleet(scene, quality) {
  const poolTex = radialTexture();

  // 两条环形导引线：去程 / 回程各一条直线，两端半圆掉头
  function makeLoop(x) {
    const w = 1.2;               // 半宽：环路总宽 2.4m
    const zA = -14, zB = -142;
    const pts = [];
    pts.push(new THREE.Vector3(x + w, 0, zA));
    pts.push(new THREE.Vector3(x + w, 0, -60));
    pts.push(new THREE.Vector3(x + w, 0, zB));
    // 底部半圆：右侧 → 左侧（绕到 zB 更深处）
    for (let i = 1; i <= 6; i++) {
      const a = (i / 6) * Math.PI;
      pts.push(new THREE.Vector3(x + w * Math.cos(a), 0, zB - w * Math.sin(a)));
    }
    pts.push(new THREE.Vector3(x - w, 0, -60));
    pts.push(new THREE.Vector3(x - w, 0, zA));
    // 顶部半圆：左侧 → 右侧
    for (let i = 1; i <= 6; i++) {
      const a = (i / 6) * Math.PI;
      pts.push(new THREE.Vector3(x - w * Math.cos(a), 0, zA + w * Math.sin(a)));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.1);
  }

  const loops = [makeLoop(-9.5), makeLoop(9.5)];

  // 导引线（磁条）：倒角方条，暗琥珀色自发光
  const guideMat = new THREE.MeshStandardMaterial({
    color: 0x2a2318, roughness: 0.7, metalness: 0.3,
    emissive: 0x33240e, emissiveIntensity: 1.0
  });
  loops.forEach((curve) => {
    const geo = buildGuideLine(curve, 0.12, 160);
    const mesh = new THREE.Mesh(geo, guideMat);
    mesh.receiveShadow = false;
    scene.add(mesh);
  });

  // 车道边线（虚线块，铺在地面上增强"路径"读感）
  const dashGeos = [];
  loops.forEach((curve) => {
    for (let i = 0; i < 60; i++) {
      const u = i / 60;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u, new THREE.Vector3());
      const g = new THREE.BoxGeometry(0.9, 0.01, 0.1);
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), tan.clone().normalize()
      );
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, 0.016, p.z), q, new THREE.Vector3(1, 1, 1)
      );
      g.applyMatrix4(m);
      dashGeos.push(g);
    }
  });
  const dashMerged = BufferGeometryUtils.mergeGeometries(dashGeos, false);
  dashGeos.forEach((g) => g.dispose());
  const dashMesh = new THREE.Mesh(dashMerged, new THREE.MeshStandardMaterial({
    color: 0x1b1510, roughness: 0.8, metalness: 0.2, emissive: 0x1a1206, emissiveIntensity: 1
  }));
  scene.add(dashMesh);

  const count = quality.mobile ? 3 : 5;
  const agvs = [];
  for (let i = 0; i < count; i++) {
    const loop = loops[i % 2];
    const agv = new Agv({
      index: i,
      curve: loop,
      u: (i * 0.21) % 1,
      speed: 1.35 + (i % 3) * 0.18,
      poolTex
    });
    scene.add(agv.group);
    agvs.push(agv);
  }

  return {
    agvs,
    update(dt, t, speedK) {
      for (let i = 0; i < agvs.length; i++) agvs[i].update(dt, t, speedK === undefined ? 1 : speedK);
    },
    setSpeed(k) {
      agvs.forEach((a) => { a.speed = 1.35 * Math.max(0.2, k); });
    }
  };
}