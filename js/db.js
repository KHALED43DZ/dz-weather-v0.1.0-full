// تخزين النشرات (النص + الصوت + الفيديو) في IndexedDB
const DB_NAME = 'dzweather';
const STORE = 'bulletins';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'id' });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const rq = fn(st);
    t.oncomplete = () => resolve(rq && rq.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const getB = (id) => tx('readonly', (s) => s.get(id));
export const putB = (rec) => tx('readwrite', (s) => s.put(rec));
export const delB = (id) => tx('readwrite', (s) => s.delete(id));
export const allB = () => tx('readonly', (s) => s.getAll()).then((r) => r || []);

// حذف النشرات القديمة (أقدم من 'keepFromIso')
export async function purgeOld(keepFromIso) {
  const all = await allB();
  for (const r of all) if (r.id < keepFromIso) await delB(r.id);
}

export async function wipeAll() {
  const all = await allB();
  for (const r of all) await delB(r.id);
}
