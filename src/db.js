// Minimal IndexedDB wrapper so a page refresh does not lose the session log.
// No server storage — everything stays in the browser.
const DB_NAME = 'echo-sessions';
const DB_VERSION = 1;
const ROWS_STORE = 'rows';
const NOTES_STORE = 'notes';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ROWS_STORE)) {
        db.createObjectStore(ROWS_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        db.createObjectStore(NOTES_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SessionStore {
  constructor() {
    this.dbPromise = openDb();
  }

  async addRow(row) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROWS_STORE, 'readwrite');
      tx.objectStore(ROWS_STORE).add(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async addNote(note) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      tx.objectStore(NOTES_STORE).add(note);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async allRows() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROWS_STORE, 'readonly');
      const req = tx.objectStore(ROWS_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async allNotes() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const req = tx.objectStore(NOTES_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async clear() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction([ROWS_STORE, NOTES_STORE], 'readwrite');
      tx.objectStore(ROWS_STORE).clear();
      tx.objectStore(NOTES_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
