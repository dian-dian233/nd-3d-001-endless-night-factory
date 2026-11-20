/**
 * postfx.js — 后期处理管线
 * Bloom(UnrealBloomPass) + ACES 调色(OutputPass) + MSAA(WebGL2 多重采样渲染目标)
 *
 * 移动端降级策略：整套 composer 直接绕过（renderer.render 直出），
 * 省掉全部 RT 采样与 mip 生成开销，这是手机上最值钱的一刀。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createPostFX(renderer, scene, camera, quality) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio() || 1;
  const w = Math.max(1, Math.floor(size.x * pr));
  const h = Math.max(1, Math.floor(size.y * pr));

  // WebGL2 下 samples>0 即开启 MSAA，比后期 SMAA 更便宜也更干净
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples: quality.msaa || 0
  });

  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    quality.bloomStrength, // strength
    0.62,                  // radius
    0.72                   // threshold
  );
  composer.addPass(bloomPass);

  // OutputPass 负责 tonemapping + 色彩空间转换（必须放在最后）
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let enabled = quality.bloom === true || quality.bloomStrength > 0;
  let drawW = w;
  let drawH = h;

  return {
    composer,
    bloomPass,
    renderPass,

    render(dt) {
      if (enabled) composer.render(dt);
      else renderer.render(scene, camera);
    },

    setSize(width, height) {
      const ratio = renderer.getPixelRatio() || 1;
      drawW = Math.max(1, Math.floor(width * ratio));
      drawH = Math.max(1, Math.floor(height * ratio));
      composer.setSize(drawW, drawH);
      // Bloom 内部分辨率跟着走，否则半分辨率下会出现边缘错位
      bloomPass.setSize(drawW, drawH);
    },

    setBloom(strength, radius, threshold) {
      if (typeof strength === 'number') bloomPass.strength = strength;
      if (typeof radius === 'number') bloomPass.radius = radius;
      if (typeof threshold === 'number') bloomPass.threshold = threshold;
    },

    setEnabled(v) {
      enabled = !!v;
    },

    isEnabled() {
      return enabled;
    },

    getSize() {
      return { w: drawW, h: drawH };
    },

    dispose() {
      composer.passes.forEach((p) => p.dispose && p.dispose());
      composer.dispose && composer.dispose();
    }
  };
}