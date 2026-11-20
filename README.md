# 无人工厂 · 永夜车间（ND-3D-001）

Three.js / WebGL2 程序化生成的无人化工厂交互场景。**不加载任何外部模型、贴图、字体**——所有几何体、纹理、环境贴图均为运行时用代码和 Canvas 生成，整包离线可跑。

- 需求单：`ND-3D-001`
- 第一版定位：**先把动态和交互跑通，画质后续再调**
- 桌面优先，手机自动降级
- 版本：`v1.0.0`

---

## 一、快速开始

ES Module + `importmap` 不能走 `file://`（浏览器 CORS 限制），必须起一个静态服务。任选其一：

```bash
# 方式 1：Python 自带（零依赖）
cd 项目根目录
python3 -m http.server 8080
# 打开 http://localhost:8080

# 方式 2：Node
npx serve .
```

### 部署到 GitHub Pages

```bash
git init && git add -A && git commit -m "feat: ND-3D-001 首版"
git remote add origin git@github.com:<你的账号>/<仓库名>.git
git push -u origin main
```

仓库 **Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`，分支 `main`，目录 `/ (root)`**，保存后等 1~2 分钟，地址形如：

```
https://<你的账号>.github.io/<仓库名>/
```

> 注意：项目是纯静态的，不需要构建步骤，也不需要 Actions 工作流。只要 `index.html` 在仓库根目录即可。

### 上传静态包

`zip -r nd3d-001.zip . -x '.git/*'` 直接丢到任意静态托管（Nginx / OSS / Vercel / Netlify）即可，入口是根目录 `index.html`。

---

## 二、操作说明

### 视角

| 操作 | 效果 |
|---|---|
| 左键拖动 | 旋转（轨道相机） |
| 滚轮 / 双指捏合 | 缩放（2.5m ~ 120m） |
| 右键拖动 / 双指拖动 | 平移（贴地面平移，符合看厂房直觉） |
| `①②③` 按钮 或 `1/2/3` | 入口低角 / 中段侧视 / 顶部全景 |
| 一键巡航巡线 或 `C` | 相机沿产线自动巡游，再按停止 |
| `空格` | 电影运镜：19 秒低空掠过产线的长镜头，拖动即中断 |

### 机械臂

| 操作 | 效果 |
|---|---|
| 鼠标悬停 | 轮廓高亮（青色描边脉冲）+ 浮动信息卡（型号 / 节拍 / 状态 / 累计件数） |
| 单击机械臂 | 进入跟随视角（镜头锁定该臂末端，可继续绕它旋转）；再点一次退出 |

### HUD 控制面板

| 控件 | 范围 / 选项 |
|---|---|
| 传送带速度 | `0 ~ 3.00x`（0 完全停机，皮带纹理、滚轮、工件、AGV 一起停） |
| 机械臂状态 | 运行 / 待机（待机时工位灯转黄） |
| 灯光预设 | 冷蓝 / 琥珀 / 应急红 / 熄灯月色（平滑过渡，约 1 秒） |
| 粒子密度 | `0% ~ 150%`（蒸汽、浮尘、焊花同步缩放） |
| 剖面模式 或 `P` | 一键隐藏屋顶、桁架、灯管、光柱，直接看车间内部 |
| 切白班 / 切夜班 或 `L` | 白班冷光 ⇄ 夜班霓虹 |
| 工位状态灯 | 点击**红色报警灯**弹出故障提示窗；点击其他灯提示该工位运行正常 |

---

## 三、功能自检表

状态说明：**✅ 已实现并跑通**；**⚠️ 需真机验证**（无 GPU 的构建环境无法实测帧率）。

### 场景清单

| # | 需求 | 实现位置 | 状态 | 怎么验 |
|---|---|---|---|---|
| 1 | 中央主产线贯穿纵深，≥6 工位，节点带状态灯与编号 | `scene.js` `STATIONS`（7 个工位，`z=-18…-114`），Canvas 生成「工位 01」编号牌 | ✅ | 切②号机位侧视，数门架数量与吊牌 |
| 2 | 机械臂矩阵左右各 5~6 台，错相位跑「抓取→抬升→旋转→放置→回零」，夹爪开合，抓发光工件 | `robot-arm.js`：左 6 + 右 6（手机 4+4），12 台相位 `i*0.137` 错开 | ✅ | 盯任意两台 3 秒，臂不会同拍；夹爪有明显开合；夹住时出现琥珀色发光块 |
| 3 | ≥3 条支线汇入主线，滚轮转，地面方向箭头，速度可调 | `conveyor.js`：3 条支线（`z=-46 / -76 / -106`）曲线汇入主线；`InstancedMesh` 滚轮逐帧旋转 | ✅ | 拉速度滑杆 0→3x，滚轮转速、皮带纹理、工件速度同步变化 |
| 4 | AGV 3~5 台沿导引线巡游，载料箱，车头扫描光 | `agv.js`：默认 5 台（手机 3 台），两条 2.4m 宽闭环导引线，锥形扫描光 + 地面光斑 | ✅ | 看 x≈±9.5 的车道，车头青色光锥左右摆 |
| 5 | 自动化立体仓库：高耸货架，货物格自动存取升降 | `scene.js` `buildRack()`：12m 高 × 13 跨 × 9 层（手机 3 层），两台堆垛机载货台升降往返 | ✅ | 看 x≈±19 的两排货架，堆垛机在轨道上移动并升降停靠 |
| 6 | 检测隧道门：产品穿过时蓝色扫描面扫过 | `scene.js` `gate`：`z=-128`，`pulse()` 由传送带事件触发，扫描面自下而上 0.62s 扫过 | ✅ | 盯隧道门，每有工件穿过就亮一次蓝光面 |
| 7 | 环境：天窗体积光柱、蒸汽烟尘、焊接火星、体积雾 | `scene.js`：15 根体积光柱（自定义 ShaderMaterial）、320 蒸汽 + 520 浮尘 + 138 焊花、`FogExp2` | ✅ | 抬头看天窗光柱；焊接工位附近有上抛的火星 |

### 交互清单

| # | 需求 | 实现位置 | 状态 | 怎么验 |
|---|---|---|---|---|
| 1 | 轨道相机：左键旋转 / 滚轮缩放 / 右键平移 | `main.js` `OrbitControls`（`maxPolarAngle` 钳制，不会钻到地面下） | ✅ | 三种操作各试一次 |
| 2 | 三个预设机位一键切换 | `CAM_PRESETS`，1.7s 缓动飞行 | ✅ | 连点 ①②③，镜头平滑过渡不跳变 |
| 3 | 一键巡航巡线 | `state.cruise`，相机沿 z 轴 128m 往返 | ✅ | 按 `C`，相机自动沿线推进 |
| 4 | 悬停机械臂：轮廓高亮 + 浮动信息卡 | `RobotArm.setHighlight()`（反法线描边壳 + 自发光脉冲）、`ui.showHover()` | ✅ | 鼠标移到任意机械臂上 |
| 5 | 点击进入跟随视角，再点退出 | `enterFollow / exitFollow`，跟随末端 TCP | ✅ | 点一台臂 → 镜头贴上；再点同台 → 回到当前机位 |
| 6 | HUD：传送带 0~3x 调速 | `slider-speed` → `conveyors.setSpeed()` | ✅ | 拖动滑杆 |
| 7 | HUD：机械臂运行 / 待机 | `btn-arms-run / btn-arms-idle` → `armMatrix.setRunning()` | ✅ | 点待机，12 台臂停止循环并轻微保持 |
| 8 | HUD：灯光预设（冷蓝 / 琥珀 / 应急红 / 熄灯月色） | `scene.js` `LIGHT_PRESETS` + 逐帧插值 | ✅ | 四个按钮依次点，色彩平滑过渡 |
| 9 | HUD：粒子密度 | `setParticleDensity()` 改 `drawRange` | ✅ | 拖到 0%，蒸汽/浮尘/火星全部消失 |
| 10 | HUD：剖面模式（隐藏屋顶看内部） | `world.setSection()` | ✅ | 按 `P`，屋顶桁架与光柱消失 |
| 11 | 状态灯：运行绿闪 / 报警红 / 待机黄 | `world.update()` 内按状态计算亮度相位 | ✅ | 06 工位预置报警，红光急促闪 |
| 12 | 点报警弹故障提示窗 | `ui.showFault()`（工位号 / 故障码 / 触发原因 / 建议 / 影响） | ✅ | 点 06 工位的红灯 |
| 13 | 一键切昼夜：白班冷光 ⇄ 夜班霓虹 | `onDayNight` → 预设 `day` / `night` | ✅ | 按 `L`，整个车间变亮/变暗 |
| 14 | 实时数据面板，数字滚动跳动 | `ui.updateStats()` 每 0.35s 刷新，变化时闪白 | ✅ | 看左上角产量一路涨 |
| 15 | 空格触发电影运镜 | `startCinematic()`：8 段 CatmullRom 曲线 + 视场角呼吸 | ✅ | 按空格，19 秒长镜头 |

### 技术指标

| # | 指标 | 实现 | 状态 |
|---|---|---|---|
| 1 | 强 Bloom | `UnrealBloomPass`（strength 0.8 / radius 0.62 / threshold 0.72） | ✅ |
| 2 | ACES 调色 | `renderer.toneMapping = ACESFilmicToneMapping` + `OutputPass` | ✅ |
| 3 | 抗锯齿 | WebGL2 多重采样渲染目标（`samples: 4`），移动端退回 canvas MSAA | ✅ |
| 4 | 1080p 中端本 ≥50 FPS | 分级 + 自适应降级（见下） | ⚠️ 需真机验 |
| 5 | 手机自动降级 | 关 Bloom、粒子 ×0.35、货架 9 层→3 层、关反射、关阴影、DPR 1.5 | ✅ |
| 6 | 加载进度条 | 8 个真实构建阶段驱动，不是假动画 | ✅ |
| 7 | resize 不错位 | `resize` 去抖 120ms，同步 renderer / camera / composer / 反射 RT | ✅ |

**关于第 4 条**：构建环境没有 GPU，我无法给出实测帧率，不编数字。项目内置了左下角 FPS 角标 + 自动降级（连续 3 秒 < 42 FPS 时自动降 DPR 并削弱 Bloom）。请在甲方机器上开 1080p 全屏看 30 秒，把角标数值回传；若低于 50，先调 `main.js` 里 `QUALITY.maxPixelRatio`，再考虑把 `scene.js` 的 `rackLayers` 降到 6。

---

## 四、文件结构

```
.
├── index.html              # 入口：importmap + HUD 结构 + 加载层
├── style.css               # HUD 样式（工业青橙、角标、手机适配）
├── README.md
├── src/
│   ├── main.js             # 装配 + 相机装置（预设/巡航/运镜/跟随）+ 拾取 + 主循环 + 降级
│   ├── scene.js            # 厂房、地面反射、7 工位、立体仓库、检测门、灯光预设、粒子
│   ├── robot-arm.js        # 六轴机械臂（两连杆 IK 反解）+ 12 台矩阵 + 高亮壳
│   ├── conveyor.js         # 主线 + 3 支线、沿曲线带宽 UV 的皮带、实例化滚轮、地面箭头
│   ├── agv.js              # AGV 车队、闭环导引线、扫描光锥
│   ├── postfx.js           # Bloom + OutputPass(ACES) + MSAA，移动端直出旁路
│   └── ui.js               # HUD 事件绑定、信息卡、故障窗、键盘快捷键
├── tools/
│   └── selfcheck.py        # 静态自检：THREE API 存在性 / import 解析 / DOM id 交叉校验
└── vendor/three/           # three.js r160.1（离线内置，不走 CDN）
    ├── build/three.module.js
    └── addons/
        ├── controls/OrbitControls.js
        ├── objects/Reflector.js
        ├── postprocessing/{EffectComposer,RenderPass,ShaderPass,MaskPass,UnrealBloomPass,OutputPass,Pass}.js
        ├── shaders/{CopyShader,LuminosityHighPassShader,OutputShader}.js
        └── utils/BufferGeometryUtils.js
```

### 关键实现说明

**地面镜面反射**：没有用现成的 `Reflector` 原版材质（它是不透明镜面，出不来环氧地坪的脏感）。做法是复用 `Reflector` 的虚拟相机与斜裁剪投影逻辑，把片元着色器换成「半透 + 冷色偏 + 按距离指数衰减」，叠在深色环氧底板上。反射相机只渲染第 0 层，粒子和光柱被排除在反射之外，省掉一半开销。

**尺度对齐**（全部真实米制）：货架 12m、机械臂 2.5m（大臂 0.9 + 小臂 0.8 + 底座 0.78）、传送带台面 0.95m、人行道标线 1.2m 宽、厂房净高 11m。

**机械臂不是摆设**：循环关键帧给的是**末端目标点**（相对肩关节的局部 z/y），运行时用两连杆解析 IK 反解 J2/J3。所以抓取点真的落在传送带台面高度，改臂长也不会穿模。

---

## 五、排错表

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面全黑，控制台报 `Failed to resolve module specifier "three"` | 用 `file://` 直接打开，importmap 不生效 | 必须起 HTTP 服务（见第一节） |
| 控制台报 `CORS policy`、模块加载失败 | 同上，`file://` 下的模块被 CORS 拦 | 同上 |
| 加载条停住不动，控制台有红色报错 | 某个模块抛错，`#loader-text` 会显示失败原因 | 按报错定位；可用 `python3 tools/selfcheck.py` 先排除 API / 路径问题 |
| 画面极暗，几乎看不见 | 显示器或系统开了强制省电/夜间滤镜；或用了「熄灯月色」预设 | 点「冷蓝」预设；检查系统色彩配置 |
| 手机打开帧率低 | 默认已降级但仍不足 | 手机会自动关 Bloom；可在 `detectQuality()` 里把 `maxPixelRatio` 降到 1 |
| 反射层有锯齿或错位 | 窗口尺寸变化后反射 RT 没跟上 | 已由 `world.resize()` 处理；若二次开发改了反射尺寸，记得同步 |
| 想看帧率 | —— | 左下角 `NN FPS` 角标，半秒刷新一次 |

---

## 六、版本记录

- **v1.0.0** — 首版。场景 7 项 + 交互 15 项全部落地；离线内置 three r160.1；静态自检脚本 `tools/selfcheck.py`。