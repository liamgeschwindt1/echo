import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateNotchHeightCue, notchSpacingHz } from './notch-height.js';

test('notch spacing uses median delta', () => {
  assert.equal(notchSpacingHz([210, 420, 635, 845]), 210);
});

test('notch cue estimates aerial height and class', () => {
  const cues = [
    { node_id: 'n1', node_height_m: 5, horizontal_range_m: 90, spacing_hz: 150, ground_reflectivity: 0.8, notch_snr_db: 16 },
    { node_id: 'n2', node_height_m: 5, horizontal_range_m: 110, spacing_hz: 125, ground_reflectivity: 0.7, notch_snr_db: 14 }
  ];
  const out = estimateNotchHeightCue(cues);
  assert.equal(out.class, 'aerial');
  assert.ok(out.height_m > 20 && out.height_m < 70);
  assert.ok(out.aerial_probability > 0.8);
});

test('notch cue flags low-reflectivity failure mode', () => {
  const out = estimateNotchHeightCue([
    { node_id: 'n1', node_height_m: 5, horizontal_range_m: 100, spacing_hz: 220, ground_reflectivity: 0.05, notch_snr_db: 10 }
  ]);
  assert.equal(out.per_node[0].warnings.includes('low_reflectivity'), true);
});
