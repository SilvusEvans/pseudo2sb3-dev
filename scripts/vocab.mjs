#!/usr/bin/env node
// Export the "pseudocode block vocabulary" from the project's own catalog table, so a hand-copied syntax table can't go stale.
// Usage:
//   node vocab.mjs [repo dir] --grep list
//   node vocab.mjs [repo dir] --group sensing
//   node vocab.mjs [repo dir] --lang ja          # en / zh-Hans / zh-Hant / ja
//   node vocab.mjs [repo dir] --json
// Repo dir: first positional argument > PSEUDO2SB3_REPO env var > current working directory.
// (Don't make the default a literal placeholder — then it won't run even after cd'ing into the repo.)
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const argv = process.argv.slice(2);
const flag = n => {
  const i = argv.indexOf(n);
  return i < 0 ? null : argv[i + 1];
};
const VALUE_FLAGS = ['--grep', '--group', '--lang'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(argv[i - 1])));
const REPO = positional[0] || process.env.PSEUDO2SB3_REPO || process.cwd();

const catPath = path.join(REPO, 'src', 'core', 'catalog.js');
if (!fs.existsSync(catPath)) {
  console.log(`✘ 找不到 ${catPath}\n   先 cd 到 pseudo2sb3 仓库，或把仓库路径作为第一个参数传进来（也可以设 PSEUDO2SB3_REPO）。`);
  process.exit(1);
}
const {aliasReference} = await import(pathToFileURL(catPath).href);
const i18nPath = path.join(REPO, 'src', 'core', 'i18n.js');
const {normalizeLang, LANGS} = await import(pathToFileURL(i18nPath).href);

const lang = normalizeLang(flag('--lang')) || 'zh-Hans';
if (!LANGS.includes(lang)) {
  console.log(`✘ 不认识的语言 ${flag('--lang')}，可选：${LANGS.join(' / ')}`);
  process.exit(1);
}

// The alias table already carries four languages: aliases is the current language's form, and groupLabel/kindLabel are already localized.
let rows = aliasReference(lang);
const grep = flag('--grep'), group = flag('--group');
if (group) {
  // `--group` matches a group name in ANY of the four languages, so `--group events`
  // works without also passing `--lang en`. Match against the Chinese name, the current
  // language's label, and every other language's label derived from the category key.
  const {groupLabel} = await import(pathToFileURL(path.join(REPO, 'src', 'core', 'aliases-i18n.js')).href);
  const g = group.toLowerCase();
  const namesOf = r => [r.group, r.groupLabel, ...LANGS.filter(l => l !== 'zh-Hans').map(l => groupLabel(r.groupKey, l))];
  rows = rows.filter(r => namesOf(r).some(n => n && String(n).toLowerCase().includes(g)));
}
if (grep) {
  const g = grep.toLowerCase();
  rows = rows.filter(r => r.op.toLowerCase().includes(g)
    || [...(r.aliases || []), ...(r.zh || []), ...(r.en || []), ...(r.ja || [])].some(a => a.toLowerCase().includes(g))
    || (r.slots || []).join(' ').toLowerCase().includes(g));
}

if (flag('--json')) {
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
}

// Alias rendering: add param parentheses to the current language's first alias so each line can be copied straight into a .pseudo
const render = r => {
  const args = (r.slots || []).join(', ');
  const list = (r.aliases && r.aliases.length) ? r.aliases : (r.zh || r.en || []);
  const head = list[0] || r.op;
  const call = args ? `(${args})` : '';
  const shape = r.kind === '帽子' || r.kind === 'C形' ? `${head}${call}:` : `${head}${call}`;
  const pad = ' '.repeat(Math.max(1, 40 - shape.replace(/[^\x00-\xff]/g, 'xx').length));
  const alt = list.slice(1).concat(lang === 'en' ? r.zh : r.en);
  return `  ${shape}${pad}${r.groupLabel || r.group}/${r.kindLabel || r.kind}  ${r.op}${alt.length ? '   也可写: ' + alt.join('、') : ''}`;
};
const byGroup = {};
for (const r of rows) {
  const key = r.groupLabel || r.group;
  (byGroup[key] = byGroup[key] || []).push(r);
}
console.log(`伪代码词汇表（${lang}）：${rows.length} 条（取自 ${path.relative(process.cwd(), catPath) || catPath}，与编译器同源）\n`);
for (const [g, rs] of Object.entries(byGroup)) {
  console.log(`【${g}】${rs.length} 条`);
  for (const r of rs) console.log(render(r));
  console.log('');
}
if (!group && !grep) {
  console.log('【运算符】中缀写法: + - * / % < > = == != <= >= 与 或 and or かつ または');
  console.log('【下拉菜单】参数要写成引号字符串（四语标签都认），取值见 references/sb3-format.md');
}
