// Project persistence: IndexedDB on the device (typed arrays stored natively)
// and a portable JSON file (typed arrays as base64) for Blender / backups.
const DB = 'tiny-craftsman', STORE = 'projects', KEY = 'current';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveLocal(project) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(project, KEY);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
  db.close();
}

export async function loadLocal() {
  try {
    const db = await openDB();
    const v = await new Promise((res, rej) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    db.close();
    return v || null;
  } catch (e) {
    console.warn('IndexedDB unavailable', e);
    return null;
  }
}

export async function clearLocal() {
  const db = await openDB();
  await new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = res; tx.onerror = res; });
  db.close();
}

// The project saved by parts (BUILD 187): what changed since the last save only — the ground
// by tiles, the journal by entries, the rest small. Keys 'p:…'; the old single 'current'
// record goes once the parts are written.
let _db = null;
const db1 = async () => (_db ||= await openDB());
export async function saveParts(puts, dels = [], dropLegacy = false) {
  const db = await db1();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    for (const [k, v] of puts) st.put(v, k);
    for (const k of dels) st.delete(k);
    if (dropLegacy) st.delete(KEY);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}
export async function loadParts() {
  try {
    const db = await db1();
    return await new Promise((res, rej) => {
      const out = new Map(), r = db.transaction(STORE).objectStore(STORE).openCursor(IDBKeyRange.bound('p:', 'p:\uffff'));
      r.onsuccess = () => { const c = r.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); };
      r.onerror = () => rej(r.error);
    });
  } catch (e) {
    console.warn('IndexedDB unavailable', e);
    return new Map();
  }
}

// ---- JSON with typed arrays -------------------------------------------------------
const TYPES = { Float32Array, Uint32Array, Int16Array, Uint8Array };

function b64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

function unb64(str) {
  const s = atob(str);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export function toJSON(project) {
  return JSON.stringify(project, (_k, v) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      return { __typed: v.constructor.name, data: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    return v;
  });
}

export function fromJSON(text) {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && v.__typed && TYPES[v.__typed]) {
      const u8 = unb64(v.data);
      return new TYPES[v.__typed](u8.buffer, 0, u8.byteLength / TYPES[v.__typed].BYTES_PER_ELEMENT);
    }
    return v;
  });
}

export async function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  // iPhone / iPad: the share sheet («Сохранить в Файлы», a messenger) — Safari does not save
  // a blob link (an error in a home-screen app)
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'shared'; }
  } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
