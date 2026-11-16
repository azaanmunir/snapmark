// electron-builder afterPack hook: drop Chromium parts SnapMark never uses, to make the app smaller.
//   dxcompiler.dll / dxil.dll        WebGPU shader compiler (we only draw with canvas 2D)
//   vk_swiftshader*, vulkan-1.dll    software Vulkan/WebGL fallback (canvas 2D falls back to the CPU on its own)
// Locales are trimmed by `electronLanguages` in package.json.
const fs = require('fs');
const path = require('path');

const DROP = ['dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll'];

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return; // macOS: the framework is signed as a whole, leave it intact
  let saved = 0;
  for (const f of DROP) {
    const p = path.join(ctx.appOutDir, f);
    if (fs.existsSync(p)) { saved += fs.statSync(p).size; fs.rmSync(p); }
  }
  console.log(`  • after-pack: removed unused Chromium files (${(saved / 1e6).toFixed(1)} MB)`);
};
