// Client for /api/library: user-created mic array and sound models.
import { ApiError } from './library.js';

export function createModelApi(fetchImpl = (...args) => fetch(...args)) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`/api/library${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new ApiError(0, { message: 'Cannot reach the server, so the library cannot be saved right now.' });
    }
    if (res.status === 204) return null;
    const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
    if (res.status === 502) throw new ApiError(502, { message: 'The backend is unavailable, so the library cannot be saved right now.' });
    if (!res.ok || !data) throw new ApiError(res.status, data);
    return data;
  }
  return {
    list: (kind) => call('GET', `/${kind}`).then((d) => d.models),
    put: (kind, model) => call('PUT', `/${kind}/${encodeURIComponent(model.id)}`, model),
    remove: (kind, id) => call('DELETE', `/${kind}/${encodeURIComponent(id)}`)
  };
}

export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'item';
