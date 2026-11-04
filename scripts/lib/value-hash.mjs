import { createHash } from 'node:crypto';

// V8 serialization is not canonical, even for equal values (for example typed-array alignment).
export function valueHash(value) {
  const hash = createHash('sha256');
  const visit = (v) => {
    if (v === null) { hash.update('null;'); return; }
    if (ArrayBuffer.isView(v)) {
      hash.update(`${v.constructor.name}:${v.byteLength}:`);
      hash.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      hash.update(';');
      return;
    }
    if (Array.isArray(v)) {
      hash.update(`array:${v.length}:[`);
      for (let i = 0; i < v.length; i++) {
        hash.update(Object.hasOwn(v, i) ? '+' : '-');
        if (Object.hasOwn(v, i)) visit(v[i]);
      }
      hash.update('];');
      return;
    }
    if (typeof v === 'object') {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('Unsupported value-hash object');
      hash.update('{');
      for (const k of Object.keys(v).sort()) { hash.update(JSON.stringify(k)); hash.update(':'); visit(v[k]); }
      hash.update('};');
      return;
    }
    if (typeof v === 'number') { hash.update(`number:${Object.is(v, -0) ? '-0' : String(v)};`); return; }
    if (typeof v === 'undefined') { hash.update('undefined;'); return; }
    if (typeof v === 'boolean' || typeof v === 'string') { hash.update(`${typeof v}:${JSON.stringify(v)};`); return; }
    throw new Error(`Unsupported value-hash type ${typeof v}`);
  };
  visit(value);
  return hash.digest('hex');
}
