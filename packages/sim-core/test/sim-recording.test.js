import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeMultichannelWav, encodeFloat32Wav, analyseRecording, parseTruthCsv, scoreRecording, calibrateRecording, geodeticToEnu } from '../src/recording.js';
import { recordingFixture as fixture } from './recording-fixture.js';

test('multichannel float32 WAV round-trips every sample without downmixing', () => {
  const channels = [new Float32Array([0.1, -0.5, 0.25]), new Float32Array([0.9, 0.2, -0.1])];
  const wav = decodeMultichannelWav(encodeFloat32Wav(channels, 48000));
  assert.deepEqual(wav.channels, channels);
  assert.equal(wav.sample_rate, 48000);
  const bytes = encodeFloat32Wav(channels, 48000);
  new DataView(bytes).setFloat32(44, NaN, true);
  assert.throws(() => decodeMultichannelWav(bytes), /Nonfinite/);
  assert.throws(() => decodeMultichannelWav(new ArrayBuffer(8)), /RIFF/);
  assert.throws(() => encodeFloat32Wav([new Float32Array([NaN])], 48000), /Invalid/);
});

test('PCM24 and PCM16 channel identity and signed decoding are preserved', () => {
  for (const bits of [16, 24, 32]) {
    const bytes = bits / 8, size = 2 * bytes;
    const buffer = new ArrayBuffer(44 + size), v = new DataView(buffer);
    const text = (p, s) => [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
    text(0, 'RIFF'); v.setUint32(4, 36 + size, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, 48000, true); v.setUint16(32, 2 * bytes, true); v.setUint16(34, bits, true);
    text(36, 'data'); v.setUint32(40, size, true);
    v.setUint8(44 + bytes - 1, 0x40); v.setUint8(44 + 2 * bytes - 1, 0xc0);
    const decoded = decodeMultichannelWav(buffer);
    assert.equal(decoded.channels[0][0], 0.5);
    assert.equal(decoded.channels[1][0], -0.5);
  }
});

test('multichannel WAVE_FORMAT_EXTENSIBLE float32 retains channels', () => {
  const normal = encodeFloat32Wav([new Float32Array([0.25]), new Float32Array([-0.5])], 48000);
  const buffer = new ArrayBuffer(normal.byteLength + 24), out = new Uint8Array(buffer), v = new DataView(buffer);
  out.set(new Uint8Array(normal, 0, 36));
  out.set(new Uint8Array(normal, 36), 60);
  v.setUint32(4, buffer.byteLength - 8, true); v.setUint32(16, 40, true); v.setUint16(20, 0xfffe, true);
  v.setUint16(36, 22, true); v.setUint16(38, 32, true); v.setUint32(40, 3, true); v.setUint32(44, 3, true);
  out.set([0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113], 48);
  assert.deepEqual(decodeMultichannelWav(buffer).channels, decodeMultichannelWav(normal).channels);
});

test('synthetic render WAV, measured inference, external truth and calibration work end to end', () => {
  const { wav: bytes, geometry } = fixture(), wav = decodeMultichannelWav(bytes);
  const report = analyseRecording(wav, geometry);
  assert.ok(report.inference.fixes.length > 0, 'Must exercise an actual fix, not no-fix equality');
  const truth = parseTruthCsv('t_s,x_m,y_m,z_m\n0,0,20,1.5\n2,0,20,1.5\n', geometry);
  const score = scoreRecording(report, truth);
  assert.ok(score.scored_fixes > 0);
  assert.ok(score.fixes.every((f) => f.horizontal_error_m < 2));
  const fit = calibrateRecording(wav, geometry, { quiet_s: [0, 0.15], signal_s: [0.4, 0.8], source_position: [0, 20, 1.5] });
  assert.ok(fit.channels.every((ch) => Number.isFinite(ch.noise_floor_dbfs) && ch.noise_floor_db_spl === null));
  assert.ok(fit.nodes.every((n) => n.heading_windows > 0 && Math.abs(n.heading_offset_deg) < 2));
  assert.deepEqual(analyseRecording(wav, geometry), report);
  const invalid = structuredClone(geometry); invalid.nodes[0].channels[1] = invalid.nodes[0].channels[0];
  assert.throws(() => analyseRecording(wav, invalid), /Duplicate/);
  assert.throws(() => calibrateRecording(wav, geometry, { quiet_s: [0, 0.5], signal_s: [0.4, 0.8], source_position: [0, 20, 1.5] }), /overlap/);
  assert.throws(() => calibrateRecording(wav, geometry, { quiet_s: [0, 1e-8], signal_s: [0.4, 0.8], source_position: [0, 20, 1.5] }), /one sample/);
  assert.throws(() => analyseRecording(wav, { ...geometry, settings: { ...geometry.settings, measured_hop_ms: 1e-9 } }), /options/);
});

test('external GPS and Flightradar CSV require explicit time, units and origin', () => {
  const geometry = { origin: { latitude_deg: 51.5, longitude_deg: -0.1, altitude_m: 0 }, truth_altitude_unit: 'ft', start_time_utc: '2026-11-04T10:00:00Z' };
  const csv = 'Timestamp,UTC,Callsign,Position,Altitude\n1793786400,2026-11-04T10:00:00Z,TEST,"51.5,-0.1",1000\n1793786401,2026-11-04T10:00:01Z,TEST,"51.5001,-0.1",1000\n';
  const track = parseTruthCsv(csv, geometry);
  assert.equal(track[1].t_s - track[0].t_s, 1);
  assert.ok(Math.abs(track[0].position[2] - 304.8) < 1e-6);
  assert.ok(track[1].position[1] > track[0].position[1]);
  assert.ok(geodeticToEnu(51.5, -0.1, 0, geometry.origin).every((v) => Math.abs(v) < 1e-8));
  assert.throws(() => parseTruthCsv(csv, { ...geometry, truth_altitude_unit: undefined }), /explicit/);
  assert.throws(() => parseTruthCsv('t_s,x_m,y_m\n1,0,0\n1,1,1', {}), /Duplicate/);
  const recording = { inference: { fixes: [{ final_position: [0, 0], positions: [{ t_e: 20 }] }] } };
  assert.equal(scoreRecording(recording, [{ t_s: 0, position: [0, 0, 0] }]).fixes[0].horizontal_error_m, null);
});

test('recording CLI persists input hashes, scores and calibration on synthetic exports', async () => {
  const { wav, geometry } = fixture();
  const directory = await mkdtemp(join(tmpdir(), 'echo-recording-'));
  try {
    await writeFile(join(directory, 'audio.wav'), new Uint8Array(wav));
    await writeFile(join(directory, 'nodes.json'), JSON.stringify(geometry));
    await writeFile(join(directory, 'truth.csv'), 't_s,x_m,y_m,z_m\n0,0,20,1.5\n2,0,20,1.5\n');
    await writeFile(join(directory, 'cal.json'), JSON.stringify({ quiet_s: [0, 0.15], signal_s: [0.4, 0.8], source_position: [0, 20, 1.5] }));
    const script = new URL('../../../scripts/recording.mjs', import.meta.url).pathname;
    for (const args of [
      ['ingest', '--wav', 'audio.wav', '--geometry', 'nodes.json', '--out', 'inference.json'],
      ['score', '--inference', 'inference.json', '--truth', 'truth.csv', '--out', 'score.json'],
      ['calibrate', '--wav', 'audio.wav', '--geometry', 'nodes.json', '--spec', 'cal.json', '--out', 'fit.json']
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const inference = JSON.parse(await readFile(join(directory, 'inference.json')));
    assert.match(inference.input_sha256.wav, /^[a-f0-9]{64}$/);
    assert.ok(JSON.parse(await readFile(join(directory, 'score.json'))).scored_fixes > 0);
    assert.ok(JSON.parse(await readFile(join(directory, 'fit.json'))).nodes.every((n) => n.heading_windows > 0));
  } finally { await rm(directory, { recursive: true }); }
});
