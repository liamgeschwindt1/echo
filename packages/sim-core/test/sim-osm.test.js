import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTERSEA, buildingFootprint, buildingHeight, importOsm, mapArea, osmQuery, projectMapPoint } from '../src/osm.js';

const way = (id, tags, geometry) => ({ type: 'way', id, tags, nodes: geometry.map((point, index) => id * 100 + (index === geometry.length - 1 && point.lat === geometry[0].lat && point.lon === geometry[0].lon ? 0 : index)), geometry });
const square = [
  { lat: BATTERSEA.lat, lon: BATTERSEA.lon },
  { lat: BATTERSEA.lat, lon: BATTERSEA.lon + 0.001 },
  { lat: BATTERSEA.lat + 0.001, lon: BATTERSEA.lon + 0.001 },
  { lat: BATTERSEA.lat + 0.001, lon: BATTERSEA.lon },
  { lat: BATTERSEA.lat, lon: BATTERSEA.lon }
];

test('OSM import projects real footprints and height into simulator metres', () => {
  const imported = importOsm({ elements: [way(1, { building: 'yes', name: 'Power Station', height: '50 m' }, square)] });
  const building = imported.buildings[0];
  assert.equal(building.size[2], 50);
  assert.equal(building.name, 'Power Station');
  assert.ok(building.size[0] > 69 && building.size[0] < 70);
  assert.ok(building.size[1] > 111 && building.size[1] < 112);
  assert.deepEqual(buildingFootprint(building)[0][0], [0, 0]);
  assert.equal(imported.environment.name, 'Battersea Power Station');
  assert.match(imported.environment.attribution, /OpenStreetMap/);
  assert.deepEqual(projectMapPoint(BATTERSEA.lon, BATTERSEA.lat, BATTERSEA), [0, 0]);
});

test('OSM heights use units, storeys, and safe fallbacks', () => {
  assert.equal(buildingHeight({ height: '100 ft' }), 30.48);
  assert.equal(buildingHeight({ 'building:levels': '8' }), 24);
  assert.equal(buildingHeight({ height: 'unknown' }), 15);
  assert.equal(buildingHeight({ height: '-1' }), 15);
});

test('OSM import keeps roads and parks and rejects incomplete data', () => {
  const imported = importOsm({ elements: [way(1, { building: 'yes' }, square), way(2, { highway: 'footway' }, square.slice(0, 2)), way(3, { leisure: 'park' }, square)] });
  assert.ok(imported.environment.features.some(feature => feature.kind === 'road' && feature.type === 'line'));
  assert.ok(imported.environment.features.some(feature => feature.kind === 'land' && feature.type === 'polygon'));
  assert.throws(() => importOsm({ elements: [], remark: 'timeout' }), /incomplete/);
  assert.throws(() => importOsm({ elements: [] }), /No building/);
});

test('OSM query accepts only bounded geographic tiles', () => {
  assert.match(osmQuery(BATTERSEA), /way\[building\]/);
  assert.throws(() => mapArea({ lat: NaN }), /latitude/);
  assert.throws(() => mapArea({ size: 10000 }), /tile size/);
  assert.throws(() => mapArea({ lat: 90 }), /latitude/);
});
test('scenario keeps the OSM environment and rejects a malformed one', async () => {
  const { defaultScenario, validateScenario } = await import('../src/scenario.js');
  const imported = importOsm({ elements: [way(1, { building: 'yes' }, square)] });
  const loaded = validateScenario({ ...defaultScenario(), buildings: imported.buildings, environment: imported.environment });
  assert.equal(loaded.environment.name, 'Battersea Power Station');
  assert.throws(() => validateScenario({ ...defaultScenario(), environment: { kind: 'x' } }), /environment/);
});
