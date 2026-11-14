// تخزين محلي في IndexedDB: النشرات (النص + الصوت + الفيديو) والملفات الثابتة (مقطع البداية)
const DB_NAME = 'dzweather';
const STORE = 'bulletins';
const ASSETS = 'assets';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB_NAME, 2);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'id' });
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const st = t.objectStore(store);
    const rq = fn(st);
    t.oncomplete = () => resolve(rq && rq.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const getB = (id) => tx(STORE, 'readonly', (s) => s.get(id));
export const putB = (rec) => tx(STORE, 'readwrite', (s) => s.put(rec));
export const delB = (id) => tx(STORE, 'readwrite', (s) => s.delete(id));
export const allB = () => tx(STORE, 'readonly', (s) => s.getAll()).then((r) => r || []);

export const getAsset = (id) => tx(ASSETS, 'readonly', (s) => s.get(id));
export const putAsset = (rec) => tx(ASSETS, 'readwrite', (s) => s.put(rec));
export const delAsset = (id) => tx(ASSETS, 'readwrite', (s) => s.delete(id));

// حذف النشرات القديمة (أقدم من 'keepFromIso')
export async function purgeOld(keepFromIso) {
  const all = await allB();
  for (const r of all) if (r.id < keepFromIso) await delB(r.id);
}

// حذف النشرات فقط (مقطع البداية يبقى)
export async function wipeAll() {
  const all = await allB();
  for (const r of all) await delB(r.id);
}
