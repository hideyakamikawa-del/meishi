// 端末内の保存(IndexedDB)。データはこの端末のブラウザの中だけにあり、運営者のサーバーには送られません。
const Store = (() => {
  let db;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open("meishi", 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("contacts", { keyPath: "id" }); d.createObjectStore("images", { keyPath: "id" }); };
    r.onsuccess = () => { db = r.result; res(db); }; r.onerror = () => rej(r.error);
  });
  const tx = async (s, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(s, mode); const o = t.objectStore(s); const q = fn(o); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  // 同期用: 更新時刻(ts)と、削除の記録(tomb)を持つ
  const TK = "sync.tomb", getT = () => { try { return JSON.parse(localStorage.getItem(TK) || "{}"); } catch (e) { return {}; } }, setT = o => { try { localStorage.setItem(TK, JSON.stringify(o)); } catch (e) {} };
  const stamp = c => { c.ts = Date.now(); const T = getT(); if (T[c.id]) { delete T[c.id]; setT(T); } return c; };
  const bump = () => { try { window.dispatchEvent(new Event("meishi-changed")); } catch (e) {} };
  return {
    tombs: getT, setTombs: setT,
    // 同期の取り込み専用(ts・削除記録をそのまま保つ)
    async applySync(put, delIds) { const d = await open(); await new Promise((res, rej) => { const t = d.transaction("contacts", "readwrite"); put.forEach(c => t.objectStore("contacts").put(c)); delIds.forEach(i => t.objectStore("contacts").delete(i)); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
    clearImgs: () => tx("images", "readwrite", o => o.clear()),
    imgIds: () => tx("images", "readonly", o => o.getAllKeys()),
    all: () => tx("contacts", "readonly", o => o.getAll()),
    put: c => tx("contacts", "readwrite", o => o.put(stamp(c))).then(r => { bump(); return r; }),
    del: id => tx("contacts", "readwrite", o => o.delete(id)).then(r => { const T = getT(); T[id] = Date.now(); setT(T); bump(); return r; }),
    clear: async () => { const T = getT(), now = Date.now(); (await tx("contacts", "readonly", o => o.getAll())).forEach(c => T[c.id] = now); setT(T); return tx("contacts", "readwrite", o => o.clear()).then(r => { bump(); return r; }); },
    putImg: (id, blob) => tx("images", "readwrite", o => o.put({ id, blob })),
    getImg: id => tx("images", "readonly", o => o.get(id)).then(r => r && r.blob),
    delImg: id => tx("images", "readwrite", o => o.delete(id)),
    async putMany(list) { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("contacts", "readwrite"); list.forEach(c => t.objectStore("contacts").put(stamp(c))); t.oncomplete = () => { bump(); res(); }; t.onerror = () => rej(t.error); }); },
  };
})();
