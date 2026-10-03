// 真机导入复核（反解产物专用）。
//
// test/decompile.test.mjs 已经证明「结构等价」（指纹对比 + scratch-parser），但那只到 scratch-vm
// 为止；TurboWarp 导入器还有一层自己的宽容度/严格度问题（缺字段、菜单 shadow、监视器、自制积木
// prototype）。本脚本把原工程和「反解 → 再编译」的工程依次载入真 TurboWarp 编辑器，比较两边的
// 运行时快照，并各存一张舞台截图。
//
// 运行：node scripts/turbowarp-import-check.mjs <原工程.sb3> <反解再编译.sb3> [截图前缀]
//
// 依赖（本地开发工具，不在 package.json 里）：playwright-core + 本机 Edge，同 turbowarp-verify.mjs。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) delete process.env[k];

// 同 turbowarp-verify.mjs：PW_CORE_DIR → node 常规解析 → 家目录下的 agent 工作区
function resolveRequire () {
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
const [origFile, backFile, prefix = 'import-check'] = process.argv.slice(2);
if (!origFile || !backFile) {
  console.error('用法: node scripts/turbowarp-import-check.mjs <原工程.sb3> <反解再编译.sb3> [截图前缀]');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  OK ' + m); } else { fail++; console.log('  NG ' + m + (extra ? '  -> ' + extra : '')); } };

async function snapshot(page, file, shot) {
  await page.evaluate(async b => {
    const bin = atob(b);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await window.vm.loadProject(arr.buffer);
  }, fs.readFileSync(file).toString('base64'));
  await page.waitForTimeout(2500);
  const data = await page.evaluate(() => ({
    targets: window.vm.runtime.targets.map(t => {
      // Target.blocks is a BlockContainer, so its own keys are runtime/_blocks/_scripts… — the real
      // per-target map is ._blocks (id → block). Counting Object.keys(t.blocks) gives 4 for every target.
      const blocks = Object.values((t.blocks && t.blocks._blocks) || {});
      return {
        name: t.getName(),
        isStage: t.isStage,
        blocks: blocks.length,
        // 影子块（shadow）是空槽位的占位值，Scratch 存 [3, 真积木, shadow默认值] 时一个槽会占两块，
        // 我们导出的是 [1, 表达式] 一块 —— 数量天然不等，所以只把「真积木」当作硬指标。
        real: blocks.filter(b => !b.shadow).length,
        shadows: blocks.filter(b => b.shadow).length,
        vars: Object.values(t.variables).filter(v => v.type !== 'list').map(v => v.name).sort(),
        lists: Object.values(t.variables).filter(v => v.type === 'list').map(v => v.name).sort(),
        // 自制积木在 vm 里是 prototype 块，数量必须一致，否则「定义」被反解丢了
        procs: blocks.filter(b => b.opcode === 'procedures_prototype').length,
        hats: blocks.filter(b => b.opcode && b.opcode.startsWith('event_')).length,
        // 报值积木最容易在槽位形状上被读错（tag 3 的 shadow 挡住真积木），所以要单独数
        reporters: blocks.filter(b => b.shadow === false && !b.topLevel).length
      };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    monitors: (window.vm.runtime.monitors || []).length,
  }));
  const canvas = await page.evaluateHandle(() => {
    const cs = [...document.querySelectorAll('canvas')];
    return cs.find(c => c.width === 480 && c.height === 360) || cs.find(c => c.width >= 400 && c.width <= 640) || null;
  });
  const el = canvas.asElement();
  if (el) await el.screenshot({path: `${shot}.png`});
  return data;
}

const browser = await chromium.launch({executablePath: EDGE, args: ['--no-proxy-server', '--disable-gpu'], headless: false});
const page = await browser.newPage({viewport: {width: 1280, height: 860}});
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log('打开 TurboWarp 编辑器…');
await page.goto('https://turbowarp.org/editor', {waitUntil: 'domcontentloaded', timeout: 90000});
await page.waitForFunction(() => window.vm && window.vm.runtime, null, {timeout: 90000});
await page.waitForTimeout(3000);

console.log(`\n[1] 载入原工程 ${origFile}`);
const before = await snapshot(page, origFile, `${prefix}-原工程`);
console.log(`  ${before.targets.length} 个目标 · ${before.targets.reduce((n, t) => n + t.blocks, 0)} 块积木 · ${before.monitors} 个监视器`);

console.log(`\n[2] 载入反解再编译的工程 ${backFile}`);
const after = await snapshot(page, backFile, `${prefix}-反解后`);
console.log(`  ${after.targets.length} 个目标 · ${after.targets.reduce((n, t) => n + t.blocks, 0)} 块积木 · ${after.monitors} 个监视器`);

console.log('\n[3] 比较');
// 反解器会改写不能原样写进伪代码的名字（空格、括号、引号…），所以名单比较时把这些字符抹掉再比：
// 「my variable」↔「my_variable」是预期内的改名，不是丢变量。
const norm = s => String(s).replace(/[^\p{L}\p{N}]/gu, '');
const sameNames = (a, b) => JSON.stringify(a.map(norm)) === JSON.stringify(b.map(norm));
ok(sameNames(before.targets.map(t => t.name), after.targets.map(t => t.name)),
  '目标名单一致', `${JSON.stringify(before.targets.map(t => t.name))} vs ${JSON.stringify(after.targets.map(t => t.name))}`);
for (let i = 0; i < before.targets.length; i++) {
  const a = before.targets[i], b = after.targets[i];
  if (!b) { ok(false, `${a.name} 在反解工程里不见了`); continue; }
  ok(a.real === b.real, `${b.name} 真积木数 ${a.real} → ${b.real}（影子块 ${a.shadows} → ${b.shadows}）`);
  ok(a.reporters === b.reporters, `${b.name} 非顶层块（报值/子块）数 ${a.reporters} → ${b.reporters}`);
  ok(a.procs === b.procs, `${b.name} 自制积木定义数 ${a.procs} → ${b.procs}`);
  ok(a.hats === b.hats, `${b.name} 帽子数 ${a.hats} → ${b.hats}`);
  ok(sameNames(a.vars, b.vars), `${b.name} 变量名一致`, `${JSON.stringify(a.vars)} vs ${JSON.stringify(b.vars)}`);
  ok(sameNames(a.lists, b.lists), `${b.name} 列表名一致`, `${JSON.stringify(a.lists)} vs ${JSON.stringify(b.lists)}`);
}
ok(after.monitors === before.monitors, `监视器数量 ${before.monitors} → ${after.monitors}`);

console.log('\n[4] 绿旗跑一下反解工程');
await page.evaluate(() => window.vm.greenFlag());
await page.waitForTimeout(2500);
const realErrors = consoleErrors.filter(e => !/favicon|ERR_|net::|Failed to load resource|WebSocket|storage/i.test(e));
ok(realErrors.length === 0, '绿旗运行后无 JS 运行时错误', realErrors.slice(0, 3).join(' | '));

console.log(`\n===== TurboWarp 反解导入复核：通过 ${pass} 项，失败 ${fail} 项 =====`);
await browser.close();
process.exit(fail ? 1 : 0);
