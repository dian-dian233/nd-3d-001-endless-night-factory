/**
 * robot-arm.js — 六轴工业机械臂
 *
 * 关节链：J1 底座回转 → J2 大臂俯仰 → J3 小臂俯仰 → J4 腕部回转 → J5 腕部俯仰
 * 循环：抓取 → 抬升 → 旋转 → 放置 → 回零，各台用不同相位错开同步运行。
 * 总高约 2.5m，与场景真实尺度对齐。
 */
import * as THREE from 'three';

/* ---------------------------------------------------------------- */
/* 两连杆 IK：给末端目标（局部 z 前 / y 上），反解 J2 / J3            */
/* 大臂 0.9m + 小臂 0.8m，肩关节高 0.78m                              */
/* ---------------------------------------------------------------- */
const L1 = 0.9;
const L2 = 0.8;
const TOOL = 0.62;   // 腕部法兰 → 夹爪指尖的伸出长度
                     // 夹爪组原点在腕部 +0.38，两指再沿工具轴伸出 0.24

/**
 * 循环关键帧 —— z/y 是**夹爪指尖**相对肩关节的目标坐标（局部 z 前 / y 上）
 * 肩关节世界高度 0.78m，传送带台面 0.95m ⇒ 抓取时 y≈0.17 正好贴着皮带
 */
const CYCLE = [
  { t: 0.00, j1: 0.06, z: 0.95, y: 0.80, j4: 0.00, j5: 0.20, open: 1 },  // 回零
  { t: 0.24, j1: 0.00, z: 1.35, y: 0.18, j4: 0.00, j5: 0.05, open: 1 },  // 探向料点（贴皮带）
  { t: 0.32, j1: 0.00, z: 1.35, y: 0.18, j4: 0.00, j5: 0.05, open: 0 },  // 夹紧
  { t: 0.48, j1: 0.12, z: 1.18, y: 0.76, j4: 0.35, j5: 0.05, open: 0 },  // 抬升
  { t: 0.62, j1: 0.95, z: 1.06, y: 0.72, j4: 0.70, j5: 0.05, open: 0 },  // 旋转
  { t: 0.80, j1: 0.95, z: 1.34, y: 0.26, j4: 0.70, j5: 0.05, open: 0 },  // 放到下料位
  { t: 0.86, j1: 0.95, z: 1.34, y: 0.26, j4: 0.70, j5: 0.05, open: 1 },  // 松爪
  { t: 1.00, j1: 0.06, z: 0.95, y: 0.80, j4: 0.00, j5: 0.20, open: 1 }   // 回零
];

const MODELS = ['KR-6AX-2100', 'ABB-IRB-2600', 'FANUC-M20iA', 'KUKA-KR-6-R900'];

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

/** 在关键帧之间插值（末端目标走直线，姿态随之联动） */
function solveIK(z, y) {
  const dRaw = Math.hypot(z, y);
  const d = Math.min(L1 + L2 - 0.01, Math.max(Math.abs(L1 - L2) + 0.02, dRaw));
  const alpha = Math.atan2(z, y);
  const cb = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const beta = Math.acos(Math.max(-1, Math.min(1, cb)));
  const cp = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
  const phi = Math.acos(Math.max(-1, Math.min(1, cp)));
  return [alpha - beta, Math.PI - phi];
}

/**
 * 对**夹爪指尖**做反解：先把指尖目标换算回腕部，再解 J2/J3。
 * 工具沿小臂方向伸出 TOOL，方向随解变化，所以迭代两次收敛。
 */
function solveIKForTool(z, y) {
  let wz = z, wy = y;
  for (let k = 0; k < 2; k++) {
    const [j2, j3] = solveIK(wz, wy);
    const th = j2 + j3;
    wz = z - TOOL * Math.sin(th);
    wy = y - TOOL * Math.cos(th);
  }
  return solveIK(wz, wy);
}

/** 在关键帧之间插值（末端目标走直线，姿态随之联动） */
function samplePose(t) {
  let a = CYCLE[0], b = CYCLE[CYCLE.length - 1];
  for (let i = 0; i < CYCLE.length - 1; i++) {
    if (t >= CYCLE[i].t && t <= CYCLE[i + 1].t) {
      a = CYCLE[i]; b = CYCLE[i + 1];
      break;
    }
  }
  const span = Math.max(1e-5, b.t - a.t);
  const u = smoothstep(Math.min(1, Math.max(0, (t - a.t) / span)));
  const lerp = (p, q) => p + (q - p) * u;
  return {
    j1: lerp(a.j1, b.j1),
    z: lerp(a.z, b.z),
    y: lerp(a.y, b.y),
    j4: lerp(a.j4, b.j4),
    j5: lerp(a.j5, b.j5),
    open: lerp(a.open, b.open)
  };
}

export class RobotArm {
  /**
   * @param {object} opts { index, x, z, facing, accent, speed }
   */
  constructor(opts) {
    const accent = opts.accent !== undefined ? opts.accent : 0x38e8ff;

    this.index = opts.index;
    this.accent = new THREE.Color(accent);
    this.speed = opts.speed || 0.115;         // 循环速度（圈/秒）
    this.phase = opts.phase || 0;
    this.running = true;
    this.highlighted = false;
    this.pieces = 0;
    this._lastCycle = Math.floor(this.phase);

    this.model = MODELS[opts.index % MODELS.length];
    this.cycleTime = 8.4 + (opts.index % 5) * 0.6;   // 节拍 s/件

    // ---------- 材质（每台独立，便于单独高亮） ----------
    this.matBody = new THREE.MeshStandardMaterial({
      color: 0x2b343d, roughness: 0.42, metalness: 0.86, envMapIntensity: 1.0
    });
    this.matAccent = new THREE.MeshStandardMaterial({
      color: 0xc46a1e, roughness: 0.5, metalness: 0.55, emissive: 0x140800, emissiveIntensity: 1
    });
    this.matJoint = new THREE.MeshStandardMaterial({
      color: 0x151b21, roughness: 0.35, metalness: 0.95
    });
    this.matCable = new THREE.MeshStandardMaterial({
      color: 0x0b0e12, roughness: 0.85, metalness: 0.2
    });
    this.matWorkpiece = new THREE.MeshBasicMaterial({ color: 0xffb463, toneMapped: false });

    this.outlineMat = new THREE.MeshBasicMaterial({
      color: accent, side: THREE.BackSide, transparent: true, opacity: 0.75, depthWrite: false
    });

    // ---------- 层级 ----------
    const root = new THREE.Group();
    root.position.set(opts.x, 0, opts.z);
    root.rotation.y = opts.facing;
    this.root = root;

    const add = (parent, geo, mat, y, castShadow) => {
      const m = new THREE.Mesh(geo, mat);
      if (y !== undefined) m.position.y = y;
      m.castShadow = castShadow !== false;
      m.receiveShadow = false;
      parent.add(m);
      return m;
    };

    // 底座
    add(root, new THREE.CylinderGeometry(0.44, 0.52, 0.16, 20), this.matJoint, 0.08);
    this.shells = [];

    // J1 回转座
    this.j1 = new THREE.Group();
    this.j1.position.y = 0.42;
    root.add(this.j1);
    add(this.j1, new THREE.CylinderGeometry(0.36, 0.4, 0.34, 20), this.matBody, 0);
    // 肩部铸件
    add(this.j1, new THREE.BoxGeometry(0.46, 0.36, 0.5), this.matJoint, 0.2);
    // 出厂标牌（发光小片）
    const badge = add(this.j1, new THREE.BoxGeometry(0.02, 0.1, 0.16), this.matAccent, 0.02, false);
    badge.position.set(0.37, 0.02, 0);

    // J2 大臂
    this.j2 = new THREE.Group();
    this.j2.position.y = 0.36;
    this.j1.add(this.j2);
    add(this.j2, new THREE.CylinderGeometry(0.19, 0.19, 0.44, 16), this.matJoint, 0).rotation.z = Math.PI / 2;
    // 大臂本体（略呈梯形，用两段叠加做出收腰感）
    add(this.j2, new THREE.BoxGeometry(0.3, 0.9, 0.34), this.matBody, 0.45);
    add(this.j2, new THREE.BoxGeometry(0.26, 0.3, 0.3), this.matAccent, 0.16);
    // 走线
    const cable1 = add(this.j2, new THREE.CylinderGeometry(0.045, 0.045, 0.86, 8), this.matCable, 0.45, false);
    cable1.position.z = -0.19;

    // J3 小臂
    this.j3 = new THREE.Group();
    this.j3.position.y = 0.9;
    this.j2.add(this.j3);
    add(this.j3, new THREE.CylinderGeometry(0.15, 0.15, 0.34, 14), this.matJoint, 0).rotation.z = Math.PI / 2;
    add(this.j3, new THREE.BoxGeometry(0.24, 0.8, 0.26), this.matBody, 0.4);
    const cable2 = add(this.j3, new THREE.CylinderGeometry(0.035, 0.035, 0.76, 8), this.matCable, 0.4, false);
    cable2.position.z = 0.15;

    // J4 腕回转
    this.j4 = new THREE.Group();
    this.j4.position.y = 0.8;
    this.j3.add(this.j4);
    add(this.j4, new THREE.CylinderGeometry(0.13, 0.13, 0.2, 14), this.matJoint, 0.08);

    // J5 腕俯仰
    this.j5 = new THREE.Group();
    this.j5.position.y = 0.18;
    this.j4.add(this.j5);
    add(this.j5, new THREE.BoxGeometry(0.22, 0.18, 0.22), this.matBody, 0.09);

    // 末端法兰 + 夹爪
    this.gripper = new THREE.Group();
    this.gripper.position.y = 0.2;
    this.j5.add(this.gripper);
    add(this.gripper, new THREE.CylinderGeometry(0.09, 0.09, 0.07, 14), this.matJoint, 0.03);

    // 两指
    this.fingerL = add(this.gripper, new THREE.BoxGeometry(0.035, 0.18, 0.1), this.matAccent, 0.15, false);
    this.fingerR = add(this.gripper, new THREE.BoxGeometry(0.035, 0.18, 0.1), this.matAccent, 0.15, false);
    this.fingerL.position.x = -0.075;
    this.fingerR.position.x = 0.075;

    // 被抓取的发光工件
    this.workpiece = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), this.matWorkpiece);
    this.workpiece.position.y = 0.15;
    this.workpiece.visible = false;
    this.gripper.add(this.workpiece);

    // 夹爪下方一盏小点光模拟工件辉光（3 台以内，控制灯数量）
    this.workLight = null;

    // ---------- 轮廓高亮壳：每个 mesh 加一个反法线放大子物体 ----------
    // 先收集再挂载：traverse 过程中往树里加节点会无限递归
    const shellHosts = [];
    root.traverse((o) => {
      if (o.isMesh && o !== this.workpiece) shellHosts.push(o);
    });
    shellHosts.forEach((o) => {
      const shell = new THREE.Mesh(o.geometry, this.outlineMat);
      shell.scale.setScalar(1.055);
      shell.visible = false;
      shell.castShadow = false;
      shell.receiveShadow = false;
      o.add(shell);
      this.shells.push(shell);
    });

    this._tcpWorld = new THREE.Vector3();
  }

  /** 每帧推进 */
  update(dt, t) {
    const prev = this.phase;

    if (this.running) {
      this.phase += dt * this.speed * (8.4 / this.cycleTime);
      if (this.phase >= 1) {
        this.phase %= 1;
      }
    } else {
      // 待机：微幅摆动，像在保持位置
      this.phase += dt * 0.004;
      if (this.phase >= 1) this.phase -= 1;
    }

    const pose = samplePose(this.phase);
    const [j2Target, j3Target] = solveIKForTool(pose.z, pose.y);
    const ease = this.running ? 0.35 : 0.08;

    this.j1.rotation.y = THREE.MathUtils.lerp(this.j1.rotation.y, pose.j1, ease);
    this.j2.rotation.x = THREE.MathUtils.lerp(this.j2.rotation.x, j2Target, ease);
    this.j3.rotation.x = THREE.MathUtils.lerp(this.j3.rotation.x, j3Target, ease);
    this.j4.rotation.y = THREE.MathUtils.lerp(this.j4.rotation.y, pose.j4, ease);
    this.j5.rotation.x = THREE.MathUtils.lerp(this.j5.rotation.x, pose.j5, ease);

    // 夹爪开合（有行程感，不是瞬移）
    const target = 0.075 + pose.open * 0.055;
    this.fingerL.position.x = THREE.MathUtils.lerp(this.fingerL.position.x, -target, 0.3);
    this.fingerR.position.x = THREE.MathUtils.lerp(this.fingerR.position.x, target, 0.3);

    // 工件：夹紧后出现，松爪时消失
    const holding = this.running && this.phase > 0.33 && this.phase < 0.845;
    this.workpiece.visible = holding;

    // 高亮脉冲
    if (this.highlighted) {
      const p = 0.4 + 0.35 * Math.sin(t * 7);
      this.matAccent.emissiveIntensity = 1 + p;
      this.matBody.emissive.copy(this.accent);
      this.matBody.emissiveIntensity = p * 0.5;
      this.outlineMat.opacity = 0.55 + 0.3 * Math.sin(t * 7);
    }

    // 计数
    if (prev > this.phase && this.running) {
      this.pieces += 1;
    }
  }

  setHighlight(on) {
    if (on === this.highlighted) return;
    this.highlighted = on;
    this.shells.forEach((s) => { s.visible = on; });
    if (!on) {
      this.matBody.emissive.setHex(0x000000);
      this.matBody.emissiveIntensity = 0;
      this.matAccent.emissiveIntensity = 1;
    }
  }

  setRunning(v) {
    this.running = !!v;
  }

  /** 末端工具点世界坐标 */
  getTCP(out) {
    this.gripper.getWorldPosition(this._tcpWorld);
    if (out) out.copy(this._tcpWorld);
    return out ? out : this._tcpWorld.clone();
  }

  getStatusLabel() {
    if (!this.running) return '待机';
    return '运行中';
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m && m.dispose && m.dispose());
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* 矩阵装配                                                            */
/* ------------------------------------------------------------------ */
export function createArmMatrix(scene, quality) {
  const perSide = quality.mobile ? 4 : 6;
  const zs = [];
  const zStart = -22, zStep = -18;
  for (let i = 0; i < perSide; i++) zs.push(zStart + i * zStep);

  const arms = [];
  const accentColors = [0x38e8ff, 0x38e8ff, 0x66d9ff, 0x38e8ff, 0x7fe0ff, 0x38e8ff];

  let idx = 0;
  [-1, 1].forEach((side) => {
    zs.forEach((z, i) => {
      const arm = new RobotArm({
        index: idx,
        x: side * 1.55,
        z,
        facing: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        accent: accentColors[i % accentColors.length],
        phase: (idx * 0.137) % 1,                    // 相位错开，不在同拍
        speed: 0.105 + (idx % 4) * 0.006
      });
      scene.add(arm.root);
      arms.push(arm);
      idx++;
    });
  });

  const state = { running: true };

  return {
    arms,
    update(dt, t) {
      for (let i = 0; i < arms.length; i++) arms[i].update(dt, t);
    },
    setRunning(v) {
      state.running = !!v;
      arms.forEach((a) => a.setRunning(v));
      return state.running;
    },
    isRunning() { return state.running; },
    clearHighlights(except) {
      arms.forEach((a) => { if (a !== except) a.setHighlight(false); });
    },
    totalPieces() {
      return arms.reduce((s, a) => s + a.pieces, 0);
    }
  };
}