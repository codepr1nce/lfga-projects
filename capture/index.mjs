// Gera snapshots/INDEX.md a partir dos meta.json de cada captura.
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'snapshots');
const rows = [];
for (const group of await fs.readdir(ROOT, { withFileTypes: true })) {
  if (!group.isDirectory()) continue;
  for (const funnel of await fs.readdir(path.join(ROOT, group.name))) {
    for (const date of await fs.readdir(path.join(ROOT, group.name, funnel))) {
      const dir = path.join(group.name, funnel, date);
      const meta = JSON.parse(await fs.readFile(path.join(ROOT, dir, 'meta.json'), 'utf8'));
      rows.push({ group: group.name, dir, meta });
    }
  }
}
const out = ['# Snapshots dos funis', '', 'Cada etapa é um `.mhtml` (abre no Chrome/Edge, offline). Gerado por `capture/index.mjs`.', ''];
for (const g of [...new Set(rows.map((r) => r.group))]) {
  out.push(`## ${g}`, '', '| Funil | Data | Etapas | Como terminou |', '|---|---|---|---|');
  for (const r of rows.filter((x) => x.group === g)) {
    out.push(`| [${r.meta.startUrl}](${r.dir.split(path.sep).join('/')}/) | ${r.dir.split(path.sep).pop()} | ${r.meta.steps.length} | ${r.meta.end} |`);
  }
  out.push('');
}
await fs.writeFile(path.join(ROOT, 'INDEX.md'), out.join('\n'));
console.log(`INDEX.md: ${rows.length} capturas`);
