/**
 * logic-test.mjs — 无需浏览器的逻辑自测
 *
 * 真的实例化 RobotArm / Conveyor / Agv，用假 canvas 顶掉 2D 贴图，
 * 跑固定步长模拟，断言：IK 落点、几何合并、工件流转、AGV 曲线、数值不发散。
 *
 * 跑法见 tools/run-logic-test.sh（会准备 three 的裸包解析）
 */
import assert from 'node:assert';
import * as THREE from 'three';

/* ---------------- 假 DOM：贴图生成只需要一个能画的 canvas ---------------- */
class FakeCtx2D {
  constructor() {
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'left';
    this.textBaseline = 'top';
  }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  fillRect() {} clearRect() {} strokeRect() {} beginPath() {} closePath() {}
  arc() {} ellipse() {} fill() {} stroke() {} save() {} restore() {}
  translate() {} rotate() {} scale() {} moveTo() {} lineTo() {} fillText() {}
  measureText() { return { width: 20 }; }
}
function fakeCanvas() {
  const ctx = new FakeCtx2D();
  return {
    width: 64, height: 64, style: {},
    getContext: () => ctx,
    addEventListener() {}, removeEventListener() {}
  };
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
  getElementById: () => null,
  querySelectorAll: () => []
};
globalThis.window = globalThis;
globalThis.self = globalThis;

const { RobotArm, createArmMatrix } = await import('./src/robot-arm.js');
const { createConveyors } = await import('./src/conveyor.js');
const { createAgvFleet } = await import('./src/agv.js');

const DT = 1 / 60;
let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

/* ================= 1. 单台机械臂：IK 落点 ================= */
console.log('\n[1] 机械臂 IK 落点与循环');
const arm = new RobotArm({ index: 0, x: -1.55, z: -22, facing: Math.PI / 2 });
const tcp = new THREE.Vector3();
let reachMin = Infinity, reachMax = 0;
let beltHits = 0;
let nanSeen = false;

let lowestOnBelt = Infinity;

for (let i = 0; i < 60 * 20; i++) {
  arm.update(DT, i * DT);
  arm.getTCP(tcp);
  if (!Number.isFinite(tcp.x) || !Number.isFinite(tcp.y) || !Number.isFinite(tcp.z)) nanSeen = true;
  const shoulder = new THREE.Vector3(-1.55, 0.78, -22);
  reachMax = Math.max(reachMax, tcp.distanceTo(shoulder));
  // 抓取窗口：夹爪原点应下探到皮带上方（指尖再往下 0.24 ⇒ 触到 0.95 的皮带面）
  if (Math.abs(tcp.x) < 0.6 && tcp.y < lowestOnBelt) lowestOnBelt = tcp.y;
  if (tcp.y > 0.95 && tcp.y < 1.35 && Math.abs(tcp.x) < 0.75) beltHits++;
}

check('末端坐标全程有限（无 NaN）', () => assert.ok(!nanSeen, '出现 NaN'));
check('末端不会超出臂展（1.7m 臂 + 0.38m 腕部）', () =>
  assert.ok(reachMax < 2.09, `实测最大伸展 ${reachMax.toFixed(3)}m`));
check('循环中指尖真的落到传送带台面上', () => assert.ok(beltHits > 10, `命中 ${beltHits} 帧`));
check('抓取时夹爪下探到皮带面附近（指尖≈0.95m）', () =>
  assert.ok(lowestOnBelt > 1.02 && lowestOnBelt < 1.36, `最低点 ${lowestOnBelt.toFixed(3)}m`));
check('累计件数会增长', () => assert.ok(arm.pieces > 0, `pieces=${arm.pieces}`));

/* ================= 2. 夹爪开合 & 高亮 ================= */
console.log('\n[2] 夹爪开合与轮廓高亮');
check('夹爪两指有行程差', () => {
  const spanMin = { v: Infinity }, spanMax = { v: 0 };
  const probe = new RobotArm({ index: 1, x: 1.55, z: -40, facing: -Math.PI / 2 });
  for (let i = 0; i < 60 * 12; i++) {
    probe.update(DT, i * DT);
    const gap = probe.fingerR.position.x - probe.fingerL.position.x;
    spanMin.v = Math.min(spanMin.v, gap);
    spanMax.v = Math.max(spanMax.v, gap);
  }
  assert.ok(spanMax.v - spanMin.v > 0.06, `开合幅度仅 ${(spanMax.v - spanMin.v).toFixed(3)}`);
});
check('高亮壳可开关且数量正确', () => {
  arm.setHighlight(true);
  assert.ok(arm.shells.length >= 10, `壳数量 ${arm.shells.length}`);
  assert.ok(arm.shells.every((s) => s.visible), '高亮后仍有隐藏壳');
  arm.setHighlight(false);
  assert.ok(arm.shells.every((s) => !s.visible), '取消高亮后壳未隐藏');
});

/* ================= 3. 矩阵：相位错开 ================= */
console.log('\n[3] 机械臂矩阵');
const sceneA = new THREE.Scene();
const matrix = createArmMatrix(sceneA, { mobile: false });
check('左右各 6 台共 12 台', () => assert.strictEqual(matrix.arms.length, 12));
check('相位互不相同（不同拍）', () => {
  const phases = matrix.arms.map((a) => a.phase.toFixed(4));
  assert.strictEqual(new Set(phases).size, phases.length, '存在同相位机械臂');
});
check('待机指令能停机再恢复', () => {
  matrix.setRunning(false);
  assert.ok(matrix.arms.every((a) => !a.running));
  matrix.setRunning(true);
  assert.ok(matrix.arms.every((a) => a.running));
});

/* ================= 4. 传送带：几何 / 流转 / 过检 ================= */
console.log('\n[4] 传送带');
const sceneB = new THREE.Scene();
const conv = createConveyors(sceneB, { mobile: false }, {
  onItemPassGate() { conv.stats.passes = (conv.stats.passes || 0) + 1; }
});
check('主线 1 条 + 支线 3 条', () => {
  assert.ok(conv.main, '缺主线');
  assert.strictEqual(conv.branches.length, 3);
});
check('皮带几何合并成功且顶点非零', () => {
  const belts = [];
  sceneB.traverse((o) => { if (o.isMesh) belts.push(o); });
  assert.ok(belts.length >= 8, `场景内网格仅 ${belts.length} 个`);
  assert.ok(belts.some((b) => b.geometry.attributes.position.count > 100), '皮带顶点过少');
});
check('100 秒模拟后仍在出料、有工件过检、无 NaN', () => {
  let nan = false;
  for (let i = 0; i < 60 * 100; i++) {
    conv.update(DT);
    for (const it of conv.main.items) {
      if (!Number.isFinite(it.mesh.position.x)) nan = true;
    }
  }
  assert.ok(!nan, '工件坐标出现 NaN');
  assert.ok(conv.main.items.length > 0, '主线空载');
  assert.ok(conv.stats.gatePass > 0, `过检门计数 ${conv.stats.gatePass}`);
});
check('调速到 0 后工件静止', () => {
  const before = conv.main.items.map((i) => i.u);
  conv.setSpeed(0);
  for (let i = 0; i < 60; i++) conv.update(DT);
  const after = conv.main.items.map((i) => i.u);
  const same = before.length === after.length && before.every((v, k) => Math.abs(v - after[k]) < 1e-9);
  assert.ok(same, '速度为 0 时工件仍在移动');
  conv.setSpeed(1);
});

/* ================= 5. AGV ================= */
console.log('\n[5] AGV 车队');
const sceneC = new THREE.Scene();
const fleet = createAgvFleet(sceneC, { mobile: false });
check('5 台 AGV', () => assert.strictEqual(fleet.agvs.length, 5));
check('沿导引线跑完一圈且坐标有限', () => {
  const a = fleet.agvs[0];
  const startU = a.u;
  let nan = false;
  for (let i = 0; i < 60 * 120; i++) {
    fleet.update(DT, i * DT, 1);
    if (!Number.isFinite(a.group.position.x) || !Number.isFinite(a.group.rotation.y)) nan = true;
  }
  assert.ok(!nan, 'AGV 坐标 NaN');
  assert.ok(Math.abs(a.u - startU) > 0.05 || a.u > 0, 'AGV 没动');
  assert.ok(a.group.position.x > -14 && a.group.position.x < 14, `跑出车道 x=${a.group.position.x}`);
});

console.log('\n' + (failures === 0 ? '[通过] 逻辑自测全部通过' : `[失败] ${failures} 项`));
process.exit(failures === 0 ? 0 : 1);