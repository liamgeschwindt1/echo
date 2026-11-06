import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, statfs } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const label = process.argv[2];
if (!/^[a-z][a-z0-9-]*$/.test(label ?? '')) {
  throw new Error('Usage: node scripts/integration-gate.mjs <unique-label>');
}
const disk = await statfs('.');
if (1 - disk.bavail / disk.blocks > 0.85) throw new Error('Disk exceeds 85%');
const directory = resolve('.benchmark-r3-integration', label);
await mkdir(directory, { recursive: true });
const evidence = `baselines/integration-gate-${label}.json`;
await writeFile(evidence, '{}\n', { flag: 'wx' });
const result = {
  label,
  source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  started_at: new Date().toISOString(),
  steps: [],
  pass: false
};
async function run(name, command, args) {
  const start = performance.now();
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (data) => chunks.push(data));
  child.stderr.on('data', (data) => chunks.push(data));
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  const log = Buffer.concat(chunks);
  const path = `baselines/integration-gate-${label}-${name}.log.gz`;
  await writeFile(path, gzipSync(log));
  result.steps.push({
    name, command: [command, ...args], exit_code: code,
    wall_ms: performance.now() - start, log: path,
    log_sha256: createHash('sha256').update(log).digest('hex')
  });
  console.log(`${label}: ${name}: ${code === 0 ? 'PASS' : 'FAIL'}`);
  if (code !== 0) {
    console.error(log.toString().split('\n').slice(-30).join('\n'));
    throw new Error(`${name} failed with exit code ${code}`);
  }
}
try {
  await run('core', 'npm', ['test', '-w', '@echo/sim-core']);
  await run('app', 'npm', ['test', '-w', '@echo/sim']);
  await run('build', 'npm', ['run', 'build', '-w', '@echo/sim']);
  const baseline = resolve(directory, 'baseline.json');
  const reference = resolve(directory, 'le0-reference.json');
  await writeFile(reference, gunzipSync(await readFile('baselines/integration-le0-smoke.json.gz')));
  await run('rescore', 'node', [
    'scripts/benchmark-rescore.mjs', '--from', reference, '--out', baseline
  ]);
  const reportPath = resolve(directory, 'smoke.json');
  await run('smoke', 'node', [
    'scripts/benchmark.mjs', '--experiment', 'smoke',
    '--compare', baseline, '--fail-on-regress', '--workers', '2',
    '--discard-renders', '--cache', resolve(directory, 'cache'), '--out', reportPath
  ]);
  const bytes = await readFile(reportPath);
  const report = JSON.parse(bytes);
  result.smoke = {
    runs: report.runs.length, comparison: report.comparison,
    report: `baselines/integration-gate-${label}-smoke.json.gz`,
    report_sha256: createHash('sha256').update(bytes).digest('hex')
  };
  await writeFile(result.smoke.report, gzipSync(bytes));
  result.golden_changes = execFileSync('git', [
    'diff', '--name-only', 'ff75074', '--', 'packages/sim-core/test/golden'
  ], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (result.smoke.runs !== 16 || !report.comparison.pass || result.golden_changes.length) {
    throw new Error('Expected 16 smoke runs, no tracked regressions and unchanged goldens');
  }
  result.pass = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  result.finished_at = new Date().toISOString();
  await writeFile(evidence, `${JSON.stringify(result, null, 2)}\n`);
}
