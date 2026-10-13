// IndexedDB so a refresh does not lose the session. Nothing here leaves the device.
const DB_NAME = 'echo-sessions';
const DB_VERSION = 2;
const ROWS = 'rows';
const STATE = 'state';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      db.createObjectStore(ROWS, { keyPath: 'id', autoIncrement: true });
      db.createObjectStore(STATE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export class SessionStore {
  constructor() {
    this.dbPromise = openDb();
  }

  async addRow(row) {
    const db = await this.dbPromise;
    const tx = db.transaction(ROWS, 'readwrite');
    tx.objectStore(ROWS).add(row);
    return done(tx);
  }

  async allRows() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const req = db.transaction(ROWS, 'readonly').objectStore(ROWS).getAll();
      req.onsuccess = () => resolve(req.result.map(({ id, ...row }) => row));
      req.onerror = () => reject(req.error);
    });
  }

  // Everything except rows: meta, periods, level series, notes, errors, report.
  async saveState(state) {
    const db = await this.dbPromise;
    const tx = db.transaction(STATE, 'readwrite');
    tx.objectStore(STATE).put({ key: 'current', ...state });
    return done(tx);
  }

  async loadState() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const req = db.transaction(STATE, 'readonly').objectStore(STATE).get('current');
      req.onsuccess = () => {
        if (!req.result) return resolve(null);
        const { key, ...state } = req.result;
        resolve(state);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clear() {
    const db = await this.dbPromise;
    const tx = db.transaction([ROWS, STATE], 'readwrite');
    tx.objectStore(ROWS).clear();
    tx.objectStore(STATE).clear();
    return done(tx);
  }
}
