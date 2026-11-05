import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { decodeMultichannelWav, analyseRecording, parseTruthCsv, scoreRecording, calibrateRecording } from '../packages/sim-core/src/recording.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  wav: { type: 'string' }, geometry: { type: 'string' }, truth: { type: 'string' },
  inference: { type: 'string' }, spec: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' }
} });
if (values.help) {
  console.log('node scripts/recording.mjs ingest --wav capture.wav --geometry nodes.json --out inference.json\nnode scripts/recording.mjs score --inference inference.json --truth track.csv --out score.json\nnode scripts/recording.mjs calibrate --wav calibration.wav --geometry nodes.json --spec calibration.json --out fit.json');
  process.exit(0);
}
const command = positionals[0];
if (positionals.length !== 1 || !['ingest', 'score', 'calibrate'].includes(command) || !values.out) throw new Error('Specify ingest|score|calibrate and --out; see --help');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let result;
if (command === 'score') {
  if (!values.inference || !values.truth) throw new Error('score requires --inference and --truth');
  const recording = await json(values.inference), truthBytes = await readFile(values.truth);
  result = { ...scoreRecording(recording, parseTruthCsv(truthBytes.toString('utf8'), recording.geometry)),
    truth_sha256: hash(truthBytes), inference_sha256: hash(await readFile(values.inference)) };
} else {
  if (!values.wav || !values.geometry) throw new Error('ingest/calibrate requires --wav and --geometry');
  const bytes = await readFile(values.wav), geometry = await json(values.geometry);
  const wav = decodeMultichannelWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (command === 'calibrate' && !values.spec) throw new Error('calibrate requires --spec');
  result = command === 'ingest' ? analyseRecording(wav, geometry) : calibrateRecording(wav, geometry, await json(values.spec));
  result.input_sha256 = { wav: hash(bytes), geometry: hash(await readFile(values.geometry)) };
}
await writeFile(values.out, JSON.stringify(result, (_, v) => {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Refusing to export NaN/Infinity');
  return v;
}, 2) + '\n');
console.log(`Saved ${values.out}; real-world validation has not been established.`);
