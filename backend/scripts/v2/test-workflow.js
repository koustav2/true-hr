// Workflow area (NFA & approvals, vendors, PMS & tasks, resignations &
// terminations). Runs each sub-suite in its own process (each one boots the app
// on its own port) and sums the results.
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_workflow node scripts/v2/test-workflow.js
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SUITES = ['test-workflow-nfa.js', 'test-workflow-vendor.js', 'test-workflow-pms.js', 'test-workflow-exit.js'];
let passed = 0; let failed = 0;
for (const s of SUITES) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [path.join(dir, s)], { env: process.env, encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.stderr) process.stderr.write(r.stderr);
  const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || '');
  if (m) { passed += Number(m[1]); failed += Number(m[2]); }
  else { failed += 1; console.log(`  FAIL ${s} did not finish (exit ${r.status})`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
