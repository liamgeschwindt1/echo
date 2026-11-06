import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

function stableMetricSubset(report) {
  return report.summary.map((row) => ({
    config_id: row.config_id,
    split: row.split,
    realism: row.realism,
    analysis_mode: row.analysis_mode,
    metrics: Object.fromEntries(Object.entries(row.metrics ?? {}).filter(([key]) => key !== 'runtime_ms'))
  }));
}

async function main() {
  const { values } = parseArgs({
    options: {
      local: { type: 'string' },
      sharded: { type: 'string' }
    }
  });
  if (!values.local || !values.sharded) throw new Error('--local and --sharded are required');
  const local = JSON.parse(await readFile(resolve(values.local), 'utf8'));
  const sharded = JSON.parse(await readFile(resolve(values.sharded), 'utf8'));
  const left = JSON.stringify(stableMetricSubset(local));
  const right = JSON.stringify(stableMetricSubset(sharded));
  if (left !== right) throw new Error('Sharded and local summary metrics differ (excluding runtime_ms)');
  console.log(JSON.stringify({ equal: true, compared: 'summary metrics excluding runtime_ms' }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
