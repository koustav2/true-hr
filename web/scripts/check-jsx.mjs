// Fast syntax check of web source files with Next's own SWC, without a full
// `next build` (which can't run concurrently in one checkout).
//   node scripts/check-jsx.mjs app/admin/payroll/page.jsx components/ui.jsx
//   node scripts/check-jsx.mjs            # every .js/.jsx under app, components, lib
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { transform } = require('next/dist/build/swc/index.js');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []);
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['app', 'components', 'lib'].flatMap(walk);
let bad = 0;
for (const f of files) {
  try {
    await transform(fs.readFileSync(f, 'utf8'), {
      filename: f, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    });
  } catch (e) { bad += 1; console.log(`FAIL ${f}\n${String(e.message || e).slice(0, 800)}`); }
}
console.log(`${files.length - bad} ok, ${bad} failed`);
process.exit(bad ? 1 : 0);
