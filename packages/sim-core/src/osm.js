import osmtogeojson from 'osmtogeojson';

export const BATTERSEA = Object.freeze({ name: 'Battersea Power Station', lat: 51.4818, lon: -0.1446, size: 600 });
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export function mapArea({ lat = BATTERSEA.lat, lon = BATTERSEA.lon, size = BATTERSEA.size, name = 'OpenStreetMap area' } = {}) {
  if (![lat, lon, size].every(Number.isFinite) || Math.abs(lat) > 80 || Math.abs(lon) > 180 || size < 200 || size > 1000) {
    throw new Error('Choose latitude -80 to 80, longitude -180 to 180, and tile size 200 to 1000 m.');
  }
  return { lat, lon, size, name: String(name).slice(0, 100) };
}

export function projectMapPoint(lon, lat, origin) {
  const radians = Math.PI / 180;
  return [(lon - origin.lon) * radians * 6371000 * Math.cos(origin.lat * radians), (lat - origin.lat) * radians * 6371000];
}

export function mapBounds(area) {
  const dy = area.size / 2 / 111194.9266;
  const dx = dy / Math.cos(area.lat * Math.PI / 180);
  return [area.lat - dy, area.lon - dx, area.lat + dy, area.lon + dx];
}

export function osmQuery(options) {
  const bounds = mapBounds(mapArea(options)).join(',');
  return `[out:json][timeout:12][maxsize:16777216];(way[building](${bounds});relation[building](${bounds});way["building:part"](${bounds});way[highway](${bounds});way[railway](${bounds});way[natural](${bounds});way[landuse](${bounds});way[leisure](${bounds});way[waterway](${bounds});node[natural=tree](${bounds});node[man_made=chimney](${bounds}););out body geom;`;
}

function metres(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(m|ft|')?$/i);
  return match ? Number(match[1]) * (/ft|'/i.test(match[2] || '') ? 0.3048 : 1) : null;
}

export function buildingHeight(tags) {
  const height = metres(tags.height) ?? metres(tags['building:height']);
  const levels = Number(tags['building:levels']);
  return Math.min(300, Math.max(1, height ?? (Number.isFinite(levels) && levels > 0 ? levels * 3 : 15)));
}

export function buildingFootprint(building) {
  const rings = building.footprint || [[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]];
  return rings.map(ring => ring.map(point => [building.position[0] + point[0] * building.size[0], building.position[1] + point[1] * building.size[1]]));
}

export function importOsm(data, options = BATTERSEA) {
  const area = mapArea(options);
  if (!data || !Array.isArray(data.elements)) throw new Error('OpenStreetMap returned invalid map data.');
  if (data.remark) throw new Error(`OpenStreetMap query incomplete: ${data.remark}`);
  const geojson = osmtogeojson(data, { flatProperties: true });
  const buildings = [];
  const features = [];
  const project = point => projectMapPoint(point[0], point[1], area);
  for (const feature of geojson.features) {
    const tags = feature.properties;
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    const isBuilding = (tags.building && tags.building !== 'no') || (tags['building:part'] && tags['building:part'] !== 'no');
    if (isBuilding) {
      polygons.forEach((polygon, index) => {
        const rings = polygon.map(ring => ring.map(project));
        const outer = rings[0];
        if (!outer || outer.length < 4 || outer.some(point => !point.every(Number.isFinite))) return;
        const xs = outer.map(point => point[0]);
        const ys = outer.map(point => point[1]);
        const width = Math.max(...xs) - Math.min(...xs);
        const depth = Math.max(...ys) - Math.min(...ys);
        if (width < 0.5 || depth < 0.5) return;
        const position = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
        buildings.push({ id: `osm-${feature.id}-${index}`, position, size: [width, depth, buildingHeight(tags)], rotation_deg: 0,
          name: tags.name || '', osm_id: feature.id, height_estimated: metres(tags.height) === null && metres(tags['building:height']) === null,
          footprint: rings.map(ring => ring.map(point => [(point[0] - position[0]) / width, (point[1] - position[1]) / depth])) });
      });
      continue;
    }
    const kind = tags.natural === 'water' || tags.waterway ? 'water' : tags.highway ? 'road' : tags.railway ? 'rail' : tags.natural === 'tree' ? 'tree' : tags.landuse || tags.leisure || tags.natural ? 'land' : null;
    if (!kind) continue;
    for (const polygon of polygons) features.push({ kind, type: 'polygon', points: polygon.map(ring => ring.map(project)) });
    if (geometry.type === 'LineString') features.push({ kind, type: 'line', points: geometry.coordinates.map(project), width: tags.highway === 'footway' || tags.highway === 'path' ? 2 : kind === 'water' ? 8 : 6 });
    if (geometry.type === 'Point' && kind === 'tree') features.push({ kind, type: 'point', points: project(geometry.coordinates) });
  }
  if (!buildings.length) throw new Error('No building footprints found in this tile. Choose another area.');
  if (buildings.length > 250) throw new Error('This tile has more than 250 buildings. Choose a smaller tile.');
  return { buildings, environment: { kind: 'osm', ...area, attribution: OSM_ATTRIBUTION, features, fetched_at: data.osm3s?.timestamp_osm_base || null } };
}