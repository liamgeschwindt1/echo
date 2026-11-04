let database;
export function testingDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('echo-sim-testing', 1);
    request.onupgradeneeded = () => {
      for (const name of ['cache', 'runs', 'jobs']) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Testing storage is blocked by another tab; close it and reload.'));
  });
  return database;
}
async function transaction(store, mode, action) {
  const db = await testingDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    let value;
    request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Testing storage transaction failed'));
  });
}
export const testingStore = {
  get: (store, key) => transaction(store, 'readonly', (s) => s.get(key)),
  set: (store, key, value) => transaction(store, 'readwrite', (s) => s.put(value, key)),
  all: (store) => transaction(store, 'readonly', (s) => s.getAll()),
  jobs: (runId) => transaction('jobs', 'readonly', (s) => s.getAll(IDBKeyRange.bound(`${runId}:`, `${runId}:\uffff`)))
};
export const browserCache = {
  get: (key) => testingStore.get('cache', key),
  set: (key, value) => testingStore.set('cache', key, value)
};
