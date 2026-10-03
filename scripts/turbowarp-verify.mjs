// 真实 TurboWarp 网页验证 + 截图。
//
// 为什么需要它：`test/vm-run.test.mjs` 用的是 node 里的 scratch-vm，只证明「逻辑跑得通」；
// 它不会发现「TurboWarp 导入后画不出来 / 键盘收不到 / 精灵本体没隐藏」这类真机问题。
// 本脚本用本地 Edge 打开 turbowarp.org/editor，把 .sb3 注入 `window.vm`，用真键盘驱动，
// 并在火焰出现的那一帧直接截舞台画布。
//
// 依赖（不在 package.json 里，属于本地开发工具）：
//   npm i playwright-core  → 装到哪都行，按下面 resolveRequire() 的顺序找得到即可
//   Edge 可执行文件路径见下方 EDGE 常量
// 运行：node scripts/turbowarp-verify.mjs [sb3] [输出png]
//
// 注意：TurboWarp 编辑器会在 URL 上 pushState 到 /fullscreen（进入全屏舞台），
// 这只是改 URL，不会重载页面，VM 状态保留 —— 看到 [nav] 日志不必惊慌。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

// 本机 shell 继承了指向死代理的 https_proxy，浏览器和 node 都要显式清掉
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) delete process.env[k];

// playwright-core 是本地开发工具，按顺序找：PW_CORE_DIR 环境变量 → node 常规解析 → 家目录下的 agent 工作区
function resolveRequire() {
  const cands = [];
  if (process.env.PW_CORE_DIR) cands.push(path.join(process.env.PW_CORE_DIR, 'package.json'));
  cands.push(import.meta.url);
  cands.push(path.join(os.homedir(), '.workbuddy-ai', 'binaries', 'node', 'workspace', 'package.json'));
  for (const c of cands) {
    try {
      const r = createRequire(c);
      r.resolve('playwright-core');
      return r;
    } catch {}
  }
  throw new Error('playwright-core not found — npm i playwright-core，或设 PW_CORE_DIR 指向其 node_modules 所在目录');
}
const require = resolveRequire();
const {chromium} = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SB3 = process.argv[2] || 'examples/bomberman/out/bomberman.sb3';
const OUT = process.argv[3] || 'examples/bomberman/out/turbowarp-运行截图.png';
const b64 = fs.readFileSync(SB3).toString('base64');

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  OK ' + m); } else { fail++; console.log('  NG ' + m + (extra ? '  -> ' + extra : '')); } };

// 舞台画布：TurboWarp 的舞台 canvas 是 480x360
async function stageCanvas(pg) {
  const h = await pg.evaluateHandle(() => {
    const cs = [...document.querySelectorAll('canvas')];
    return cs.find(c => c.width === 480 && c.height === 360) || cs.find(c => c.width >= 400 && c.width <= 640) || null;
  });
  return h.asElement();
}

const browser = await chromium.launch({executablePath: EDGE, args: ['--no-proxy-server', '--disable-gpu'], headless: false});
const page = await browser.newPage({viewport: {width: 1280, height: 860}});
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('   [nav]', f.url()); });
page.on('crash', () => console.log('   [crash] 页面崩溃'));

console.log('打开 TurboWarp 编辑器…');
await page.goto('https://turbowarp.org/editor', {waitUntil: 'domcontentloaded', timeout: 90000});
await page.waitForFunction(() => window.vm && window.vm.runtime, null, {timeout: 90000});
await page.waitForTimeout(3000);

console.log('注入 .sb3…');
await page.evaluate(async b => {
  const bin = atob(b);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  await window.vm.loadProject(arr.buffer);
}, b64);
await page.waitForTimeout(2500);

const info = await page.evaluate(() => ({
  targets: window.vm.runtime.targets.length,
  names: window.vm.runtime.targets.map(t => t.getName()),
  originalsVisible: window.vm.runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => [t.getName(), t.visible]),
}));
console.log('\n[1] 载入');
ok(info.targets === 8, `8 个目标 (实际 ${info.targets})`, JSON.stringify(info.names));
const visAtLoad = info.originalsVisible.filter(([, v]) => v).map(([n]) => n);
ok(JSON.stringify(visAtLoad) === JSON.stringify(['玩家']), `按绿旗前只有「玩家」可见 (实际 ${JSON.stringify(visAtLoad)})`);
{
  const el0 = await stageCanvas(page);
  if (el0) { await el0.screenshot({path: OUT.replace(/\.png$/, '-打开工程.png')}); console.log('  已存「打开工程」截图'); }
}

console.log('\n[2] 绿旗 + 真实键盘');
await page.evaluate(() => window.vm.greenFlag());
await page.waitForTimeout(1200);
const afterFlag = await page.evaluate(() => {
  const st = window.vm.runtime.getTargetForStage();
  const g = n => { const v = Object.values(st.variables).find(x => x.name === n); return v && v.value; };
  return {
    visibleKinds: [...new Set(window.vm.runtime.targets.filter(t => t.visible && !t.isStage).map(t => t.getName()))],
    playerCell: g('玩家格'),
    firepower: g('火力'),
  };
});
ok(JSON.stringify(afterFlag.visibleKinds.slice().sort()) === JSON.stringify(['数字', '方块', '敌人', '玩家'].sort()),
  `绿旗后可见角色种类 = ${JSON.stringify(afterFlag.visibleKinds)}`);
ok(afterFlag.firepower === 2, `火力 = 2 (实际 ${afterFlag.firepower})`);

const COLS = 13;
const dist = (a, b) => {
  const ar = Math.floor((a - 1) / COLS), ac = (a - 1) % COLS;
  const br = Math.floor((b - 1) / COLS), bc = (b - 1) % COLS;
  return Math.abs(ar - br) + Math.abs(ac - bc);
};
const gvar = async n => page.evaluate(nm => {
  const st = window.vm.runtime.getTargetForStage();
  const v = Object.values(st.variables).find(x => x.name === nm);
  return v && v.value;
}, n);
const glist = async n => page.evaluate(nm => {
  const st = window.vm.runtime.getTargetForStage();
  const v = Object.values(st.variables).find(x => x.name === nm);
  return v && v.value.slice();
}, n);

// 1) 清出玩家所在格上下左右各 3 格的十字走廊：
//    这样爆炸必然能完整延伸 2 格（可断言 maxD===2），玩家也能走开 3 格不被自己炸死。
const clearCross = async (cell, reach) => page.evaluate(([cell, reach]) => {
  const st = window.vm.runtime.getTargetForStage();
  const map = Object.values(st.variables).find(x => x.name === '地图');
  const COLS = 13, ROWS = 11;
  const r = Math.floor((cell - 1) / COLS), c = (cell - 1) % COLS;
  const put = (rr, cc) => { if (rr >= 1 && rr <= ROWS - 2 && cc >= 1 && cc <= COLS - 2) map.value[rr * COLS + cc] = 0; };
  for (let d = 1; d <= reach; d++) { put(r - d, c); put(r + d, c); put(r, c - d); put(r, c + d); }
}, [cell, reach]);

const startCell = afterFlag.playerCell;
await clearCross(startCell, 3);
await page.waitForTimeout(300);

// 2) 向右走一段（走廊已清空，必然走得动）
const cell0 = startCell;
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(1100);
await page.keyboard.up('ArrowRight');
await page.waitForTimeout(350);
const cell1 = await gvar('玩家格');
ok(cell1 !== cell0, `真实方向键让玩家移动 ${cell0} -> ${cell1}`);

// 3) 在落脚点再清一次十字走廊（保证爆炸能完整延伸 2 格、玩家能走开 3 格），然后放炸弹
await clearCross(cell1, 3);
await page.waitForTimeout(250);
await page.keyboard.down(' ');
await page.waitForTimeout(120);
await page.keyboard.up(' ');
const bomb = await glist('炸弹格');
ok(bomb && bomb.length >= 1, `空格放下炸弹 (炸弹格 ${JSON.stringify(bomb)})`);
const bombCell = bomb && bomb[0];

// 4) 走开，直到离炸弹 ≥3 格（爆炸只有 2 格），免得被自己炸死挡住画面
await page.keyboard.down('ArrowRight');
const t0 = Date.now();
let away = 0;
while (Date.now() - t0 < 2600) {
  await page.waitForTimeout(100);
  away = dist(await gvar('玩家格'), bombCell);
  if (away >= 3) break;
}
await page.keyboard.up('ArrowRight');
await page.waitForTimeout(120);
console.log(`  玩家走到距炸弹 ${away} 格处`);

// 5) 轮询火焰：一出现就立刻截图，抓爆炸瞬间
let shot = false, best = [], flameSeen = 0;
const t1 = Date.now();
while (Date.now() - t1 < 14000) {
  const fl = await glist('爆炸格');
  if (fl && fl.length) {
    flameSeen++;
    if (fl.length > best.length) best = fl;
    if (!shot) {
      const el = await stageCanvas(page);
      if (el) { await el.screenshot({path: OUT}); shot = true; console.log('  截图已保存: ' + OUT); }
    }
  } else if (shot) {
    break; // 火焰已散
  }
  await page.waitForTimeout(30);
}
ok(flameSeen > 0, '炸弹炸出可见火焰');
let maxD = 0;
for (const c of best) maxD = Math.max(maxD, dist(c, bombCell));
ok(maxD === 2, `TurboWarp 里爆炸最远 2 格（炸弹格 ${bombCell}，火焰 ${JSON.stringify(best)}，最远 ${maxD}）`);
const st = await gvar('状态');
ok(st === 0, `截图时玩家仍存活 (状态 ${st})`);

console.log('\n[3] 运行时错误');
const realErrors = consoleErrors.filter(e => !/favicon|ERR_|net::|Failed to load resource/i.test(e));
ok(realErrors.length === 0, '无 JS 运行时错误', realErrors.slice(0, 3).join(' | '));

console.log(`\n===== TurboWarp 实跑：通过 ${pass} 项，失败 ${fail} 项 =====`);
await browser.close();
process.exit(fail ? 1 : 0);
