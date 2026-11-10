import test from 'node:test';
import assert from 'node:assert/strict';
import { windowReflectionEvidence } from '../src/pathreport.js';
import { multipathSigmaDeg, pathSpreadSigmaDeg } from '../src/uncertainty.js';

const settings = { multipath_floor_deg: 5, multipath_spread_ref_ms: 20 };

test('multipath uncertainty only uses a reflection inside the selected window', () => {
  const paths = [
    { type: 'direct', delay_s: 0.1, level_db_re_direct: 0 },
    { type: 'diffracted', delay_s: 0.101, level_db_re_direct: 0 },
    { type: 'wall', delay_s: 0.11, level_db_re_direct: -6 },
    { type: 'ground', delay_s: 0.14, level_db_re_direct: 0 }
  ];
  const evidence = windowReflectionEvidence(paths, 0.025);
  assert.ok(Math.abs(evidence.reflection_gap_s - 0.01) < 1e-12);
  assert.equal(evidence.direct_to_reflected_db, 6);
  const sigma = multipathSigmaDeg({
    directToReflectedDb: evidence.direct_to_reflected_db,
    reflectionGapS: evidence.reflection_gap_s,
    windowS: 0.025,
    settings
  });
  assert.ok(Math.abs(sigma - 1.50356) < 1e-4);
  assert.deepEqual(windowReflectionEvidence(paths, 0.005), {
    direct_to_reflected_db: null,
    reflection_gap_s: null
  });
  assert.equal(multipathSigmaDeg({
    directToReflectedDb: 0, reflectionGapS: 0.03, windowS: 0.025, settings
  }), 0);
});

test('multipath uncertainty ignores global path spread when in-window reflection is same', () => {
  const evidence = { directToReflectedDb: 0, reflectionGapS: 0.005, windowS: 0.025, settings };
  assert.ok(Math.abs(multipathSigmaDeg(evidence) - 4) < 1e-12);
  assert.ok(Math.abs(pathSpreadSigmaDeg({
    directToReflectedDb: 0, delaySpreadS: 0.1, pathGapS: 0.005, windowS: 0.025, settings
  }) - 4) < 1e-12);
});
