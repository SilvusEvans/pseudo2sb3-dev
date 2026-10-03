#!/usr/bin/env node
// .sb3 structural checkup: no third-party deps, reads project.json straight out of the zip.
// Usage:
//   node inspect-sb3.mjs <file.sb3>                     overview (targets/block histogram/structural self-check)
//   node inspect-sb3.mjs <file.sb3> --opcode data_itemoflist [--limit 3]
//   node inspect-sb3.mjs <file.sb3> --list-ops          only print the opcode histogram
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
const flag = name => {
  const i = argv.indexOf(name);
  return i < 0 ? null : argv[i + 1];
};
if (!file) {
  console.log('用法: node inspect-sb3.mjs <文件.sb3> [--opcode OP] [--limit N] [--list-ops]');
  process.exit(1);
}

/* ------------------------------ zip reading ------------------------------ */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip（找不到中央目录结尾）');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录条目损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const ln = buf.readUInt16LE(localOff + 26);
    const le = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + ln + le;
    const raw = buf.subarray(start, start + compSize);
    out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const zip = readZip(fs.readFileSync(file));
const pj = zip.get('project.json');
if (!pj) throw new Error('zip 里没有 project.json');
const project = JSON.parse(pj.toString('utf8'));

/* --------------------------- block and slot decoding --------------------------- */
const PRIM = {4: 'num', 5: 'posNum', 6: 'wholeNum', 7: 'int', 8: 'angle', 9: 'color', 10: 'text', 11: 'broadcast', 12: 'variable', 13: 'list'};
const allBlocks = {};
for (const t of project.targets) Object.assign(allBlocks, t.blocks);

function describeInput(id) {
  const b = allBlocks[id];
  if (!b) return `<缺块 ${id}>`;
  return `${b.opcode}${b.shadow ? '(shadow)' : ''}${b.topLevel ? '[帽]' : ''}`;
}
function decodeSlot(v) {
  if (!Array.isArray(v)) return JSON.stringify(v);
  if (v[0] === 1) {
    const inner = v[1];
    if (typeof inner === 'string') return `→${describeInput(inner)}`;
    if (Array.isArray(inner)) {
      const [type, ...rest] = inner;
      const kind = PRIM[type] || `type${type}`;
      if (type === 12 || type === 13 || type === 11) {
        const reg = type === 12 ? varReg : type === 13 ? listReg : bcastReg;
        const nm = reg.get(rest[1]);
        return `${kind} "${rest[0]}"${nm === undefined ? ' ⚠未注册' : ` (${nm === rest[0] ? '名一致' : '名不符 ' + nm})`}`;
      }
      return `${kind} ${JSON.stringify(rest[0])}`;
    }
    return `?${JSON.stringify(inner)}`;
  }
  if (v[0] === 2) return `substack→${describeInput(v[1])}`;
  if (v[0] === 3) return `shadow→${describeInput(v[1])}` + (v[2] ? ` value=${decodeSlot(v[2])}` : '');
  return `?${JSON.stringify(v)}`;
}
function blockLines(op) {
  const ids = Object.entries(allBlocks).filter(([, b]) => b.opcode === op).map(([id]) => id);
  return ids.map(id => {
    const b = allBlocks[id];
    const inputs = Object.entries(b.inputs || {}).map(([k, v]) => `    ${k} = ${decodeSlot(v)}`).join('\n');
    const fields = Object.entries(b.fields || {}).map(([k, v]) => `    @${k} = ${JSON.stringify(v[0])}${v[1] ? ' (menu/shadow字段)' : ''}`).join('\n');
    const chain = `    next=${b.next ? describeInput(b.next) : 'null'}  parent=${b.parent ? describeInput(b.parent) : 'null'}`;
    return `  ${id}  ${b.opcode}${b.shadow ? ' shadow' : ''}${b.topLevel ? ' 顶层' : ''}\n${[inputs, fields, chain].filter(Boolean).join('\n')}`;
  });
}

/* ------------------------------ structural self-check ------------------------------ */
// In project.json, variables/lists are {id: [name, value]} and broadcasts are {id: name} —
// register ids must use the "key"; reading v[1] gives the variable's current value, the most common misreading.
const varReg = new Map(), listReg = new Map(), bcastReg = new Map();
for (const t of project.targets) {
  for (const [id, v] of Object.entries(t.variables || {})) varReg.set(id, Array.isArray(v) ? v[0] : '?');
  for (const [id, v] of Object.entries(t.lists || {})) listReg.set(id, Array.isArray(v) ? v[0] : '?');
  for (const [id, v] of Object.entries(t.broadcasts || {})) bcastReg.set(id, v);
}
function structuralProblems() {
  const problems = [];
  for (const t of project.targets) {
    const ws = t.blocks;
    for (const [id, b] of Object.entries(ws)) {
      if (b.topLevel) {
        if (b.parent !== null) problems.push(`${b.opcode}: 顶层块 parent 不为 null`);
        if (b.next !== null && !ws[b.next]) problems.push(`${b.opcode}: next 指向不存在的块 ${b.next}`);
      } else if (b.parent && !ws[b.parent]) {
        problems.push(`${b.opcode}(${id}): parent 指向不存在的块 ${b.parent}`);
      }
      for (const [k, v] of Object.entries(b.inputs || {})) {
        if (!Array.isArray(v) || ![1, 2, 3].includes(v[0])) { problems.push(`${b.opcode}.${k}: 槽位首元素应为 1/2/3，实际 ${JSON.stringify(v && v[0])}`); continue; }
        const ref = v[0] === 1 && typeof v[1] === 'string' ? v[1] : v[0] === 2 || v[0] === 3 ? v[1] : null;
        if (ref && !ws[ref]) problems.push(`${b.opcode}.${k}: 引用不存在的块 ${ref}`);
        if (v[0] === 2 && ws[ref] && ws[ref].parent !== id) problems.push(`${b.opcode}.${k}: substack 首块的 parent 没指回自己`);
        if (v[0] === 1 && Array.isArray(v[1])) {
          const [type, a, bid] = v[1];
          if (type === 12 && !varReg.has(bid)) problems.push(`${b.opcode}.${k}: 变量 ${a} 的 id ${bid} 没有任何 target 注册`);
          if (type === 13 && !listReg.has(bid)) problems.push(`${b.opcode}.${k}: 列表 ${a} 的 id ${bid} 没有任何 target 注册`);
          if (type === 11 && !bcastReg.has(bid)) problems.push(`${b.opcode}.${k}: 广播 ${a} 的 id ${bid} 没有任何 target 注册`);
          // numeric slots are often written as strings even in Scratch's own files ([4,"3"]), so don't type-assert — just show them as-is
        }
      }
      if (b.shadow === true && !Object.values(ws).some(o => Object.values(o.inputs || {}).some(v => v[1] === id))) {
        // a shadow block must be referenced by some slot; an orphan shadow silently loses content in Scratch
        problems.push(`${b.opcode}: shadow 块 ${id} 没有任何槽位引用它`);
      }
    }
  }
  return problems;
}

/* -------------------------------- output -------------------------------- */
const ops = {};
for (const b of Object.values(allBlocks)) ops[b.opcode] = (ops[b.opcode] || 0) + 1;
const hist = Object.entries(ops).sort((a, b) => b[1] - a[1]);

const wantOp = flag('--opcode');
if (wantOp) {
  const limit = Number(flag('--limit') || 3);
  const lines = blockLines(wantOp);
  console.log(`${path.basename(file)}  ·  ${wantOp}  共 ${lines.length} 块`);
  console.log(lines.slice(0, limit).join('\n') || '  (无)');
  if (lines.length > limit) console.log(`  …还有 ${lines.length - limit} 块，加 --limit 看更多`);
  process.exit(0);
}

console.log(`${path.basename(file)}  ·  project.json ${pj.length} B · zip 内 ${zip.size} 个文件（素材 ${zip.size - 1}）`);
console.log(`semver ${project.meta && project.meta.semver} · 扩展 ${(project.extensions || []).join(', ') || '无'}`);
const mons = project.monitors || [];
console.log(`监视器（打开项目时 HUD 上就有的表头）${mons.length} 个:`);
for (const m of mons) {
  const what = m.params ? Object.entries(m.params).map(([k, v]) => `${k}=${v}`).join(' ') : '';
  console.log(`  ${String(m.mode).padEnd(7)} ${m.opcode} ${what}${m.spriteName ? `  [角色 ${m.spriteName}]` : ''}  x=${m.x} y=${m.y}${m.visible ? '' : '  [隐藏]'}${m.mode === 'slider' ? `  范围 ${m.sliderMin}–${m.sliderMax}` : ''}`);
}
for (const t of project.targets) {
  const hats = Object.values(t.blocks).filter(b => b.topLevel).length;
  console.log(`  ${t.isStage ? '[舞台]' : '[角色]'} ${t.name}: 积木 ${Object.keys(t.blocks).length} · 脚本 ${hats} · 变量 ${Object.keys(t.variables || {}).length} · 列表 ${Object.keys(t.lists || {}).length} · 造型 ${t.costumes.length} · 声音 ${t.sounds.length}`);
}
if (!flag('--list-ops')) {
  const problems = structuralProblems();
  console.log(problems.length ? `✘ 结构自检 ${problems.length} 项:` : '✔ 结构自检通过（槽位形状、var/list id、substack 回指、shadow 引用都正常）');
  for (const p of problems.slice(0, 25)) console.log('  - ' + p);
  if (problems.length > 25) console.log(`  …还有 ${problems.length - 25} 项`);
  console.log('');
}
console.log(`opcode 直方图（${hist.length} 种 / ${Object.keys(allBlocks).length} 块）:`);
for (const [op, n] of hist.slice(0, Number(flag('--top') || 60))) console.log(`  ${String(n).padStart(3)}  ${op}`);
if (hist.length > 60) console.log(`  …还有 ${hist.length - 60} 种`);
