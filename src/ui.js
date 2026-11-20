/**
 * ui.js — HUD 控制面板与交互绑定
 *
 * 只做 DOM 与事件，不碰 three.js 场景对象；
 * 所有会改动场景的动作都通过 handlers 回调交给 main.js。
 */
export function createUI(handlers) {
  const $ = (id) => document.getElementById(id);

  /* ---------------- 元素 ---------------- */
  const el = {
    loader: $('loader'),
    loaderBar: $('loader-bar'),
    loaderText: $('loader-text'),
    loaderPct: $('loader-pct'),
    statsYield: $('stats-yield'),
    statsCycle: $('stats-cycle'),
    statsOnline: $('stats-online'),
    statsOee: $('stats-oee'),
    fps: $('fps-badge'),
    quality: $('quality-badge'),
    hover: $('hover-card'),
    hcModel: $('hc-model'),
    hcCycle: $('hc-cycle'),
    hcStatus: $('hc-status'),
    hcCount: $('hc-count'),
    fault: $('fault-modal'),
    faultTitle: $('fault-title'),
    faultBody: $('fault-body'),
    faultClose: $('fault-close'),
    speed: $('slider-speed'),
    valSpeed: $('val-speed'),
    armsRun: $('btn-arms-run'),
    armsIdle: $('btn-arms-idle'),
    particles: $('slider-particles'),
    valParticles: $('val-particles'),
    section: $('btn-section'),
    daynight: $('btn-daynight'),
    presetBtns: [
      $('btn-preset-1'), $('btn-preset-2'), $('btn-preset-3')
    ],
    cruise: $('btn-cruise'),
    cinematic: $('btn-cinematic'),
    lightBtns: Array.from(document.querySelectorAll('[data-light]'))
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    speed: 1,
    armsRunning: true,
    light: 'cold',
    density: 1,
    section: false,
    dayNight: false   // false = 夜班
  };

  let qualityTimer = null;

  /* ---------------- 按钮组互斥高亮 ---------------- */
  function setGroupActive(btns, activeBtn) {
    btns.forEach((b) => b && b.classList.toggle('on', b === activeBtn));
  }

  /* ---------------- 事件绑定 ---------------- */
  el.speed.addEventListener('input', (e) => {
    state.speed = parseFloat(e.target.value);
    el.valSpeed.textContent = state.speed.toFixed(2) + 'x';
    handlers.onSpeed(state.speed);
  });

  el.armsRun.addEventListener('click', () => {
    state.armsRunning = true;
    el.armsRun.classList.add('on');
    el.armsIdle.classList.remove('on');
    handlers.onArmRun(true);
  });
  el.armsIdle.addEventListener('click', () => {
    state.armsRunning = false;
    el.armsIdle.classList.add('on');
    el.armsRun.classList.remove('on');
    handlers.onArmRun(false);
  });

  el.lightBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.light;
      state.light = name;
      setGroupActive(el.lightBtns, btn);
      handlers.onLight(name);
    });
  });

  el.particles.addEventListener('input', (e) => {
    state.density = parseFloat(e.target.value);
    el.valParticles.textContent = Math.round(state.density * 100) + '%';
    handlers.onParticleDensity(state.density);
  });

  el.section.addEventListener('click', () => {
    state.section = !state.section;
    el.section.classList.toggle('on', state.section);
    el.section.textContent = state.section ? '退出剖面' : '剖面模式';
    handlers.onSection(state.section);
  });

  el.daynight.addEventListener('click', () => {
    state.dayNight = !state.dayNight;
    el.daynight.classList.toggle('on', state.dayNight);
    el.daynight.textContent = state.dayNight ? '切夜班' : '切白班';
    handlers.onDayNight(state.dayNight);
    showQualityNote(state.dayNight ? '已切换到白班冷光' : '已切换到夜班霓虹');
  });

  el.presetBtns.forEach((btn, i) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      setGroupActive(el.presetBtns, btn);
      handlers.onCameraPreset(i);
    });
  });

  el.cruise.addEventListener('click', () => {
    const on = handlers.onCruise();
    el.cruise.classList.toggle('on', !!on);
    el.cruise.textContent = on ? '停止巡航' : '一键巡航巡线';
  });

  el.cinematic.addEventListener('click', () => {
    handlers.onCinematic();
  });

  el.faultClose.addEventListener('click', () => hideFault());
  el.fault.addEventListener('click', (e) => {
    if (e.target === el.fault) hideFault();
  });

  /* ---------------- 键盘 ---------------- */
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        handlers.onCinematic();
        break;
      case 'Digit1': setGroupActive(el.presetBtns, el.presetBtns[0]); handlers.onCameraPreset(0); break;
      case 'Digit2': setGroupActive(el.presetBtns, el.presetBtns[1]); handlers.onCameraPreset(1); break;
      case 'Digit3': setGroupActive(el.presetBtns, el.presetBtns[2]); handlers.onCameraPreset(2); break;
      case 'KeyC':
        el.cruise.click();
        break;
      case 'KeyP':
        el.section.click();
        break;
      case 'KeyL':
        el.daynight.click();
        break;
      default: break;
    }
  });

  /* ---------------- 对外方法 ---------------- */
  const api = {
    state,

    setLoader(pct, text) {
      const p = Math.max(0, Math.min(100, pct));
      if (el.loaderBar) el.loaderBar.style.width = p.toFixed(1) + '%';
      if (el.loaderPct) el.loaderPct.textContent = Math.round(p) + '%';
      if (text && el.loaderText) el.loaderText.textContent = text;
    },

    hideLoader() {
      if (!el.loader) return;
      el.loader.classList.add('hide');
      setTimeout(() => { el.loader.style.display = 'none'; }, 800);
    },

    /** 数据面板：数字变化时闪一下 */
    updateStats(s) {
      const set = (node, text, changed) => {
        if (!node) return;
        if (node.textContent === text) return;
        node.textContent = text;
        if (changed) {
          node.classList.add('tick');
          setTimeout(() => node.classList.remove('tick'), 180);
        }
      };
      set(el.statsYield, String(s.yield), true);
      set(el.statsCycle, s.cycle.toFixed(1), false);
      set(el.statsOnline, String(s.online), false);
      set(el.statsOee, s.oee.toFixed(1), false);
    },

    setFps(fps) {
      if (el.fps) el.fps.textContent = `${Math.round(fps)} FPS`;
    },

    showQualityNote(text, sticky) {
      if (!el.quality) return;
      el.quality.textContent = text;
      el.quality.classList.add('show');
      if (qualityTimer) clearTimeout(qualityTimer);
      if (!sticky) qualityTimer = setTimeout(() => el.quality.classList.remove('show'), 3600);
    },

    /** 悬停信息卡：屏幕坐标定位 */
    showHover(arm, x, y) {
      if (!el.hover) return;
      el.hcModel.textContent = arm.model;
      el.hcCycle.textContent = arm.cycleTime.toFixed(1) + ' s/件';
      el.hcStatus.textContent = arm.running ? '运行中' : '待机';
      el.hcCount.textContent = arm.pieces + ' 件';
      el.hover.style.left = x + 'px';
      el.hover.style.top = y + 'px';
      el.hover.classList.add('show');
    },

    hideHover() {
      if (el.hover) el.hover.classList.remove('show');
    },

    showFault(station) {
      if (!el.fault) return;
      el.faultTitle.textContent = `工位 ${station.id} · 设备报警`;
      el.faultBody.innerHTML =
        `<span class="k">设备：</span>${station.name}工位 · 六轴机械臂\n` +
        `<span class="k">代码：</span>E-0217 伺服过载（关节 J2）\n` +
        `<span class="k">触发：</span>连续 3 个循环扭矩超阈值\n` +
        `<span class="k">建议：</span>降低节拍至 85% 或检查减速机润滑\n` +
        `<span class="k">影响：</span>该工位已暂停，上游缓存可支撑 12 分钟`;
      el.fault.classList.add('show');
    },

    hideFault,

    setActivePreset(i) {
      setGroupActive(el.presetBtns, el.presetBtns[i]);
    },

    setCruiseActive(on) {
      if (!el.cruise) return;
      el.cruise.classList.toggle('on', !!on);
      el.cruise.textContent = on ? '停止巡航' : '一键巡航巡线';
    }
  };

  function hideFault() {
    if (el.fault) el.fault.classList.remove('show');
  }

  return api;
}