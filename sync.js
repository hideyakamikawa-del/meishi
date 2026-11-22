// 端末間の同期(Google Drive の「アプリ専用の領域」)。
// ・名簿と写真は、利用者本人のGoogle Drive内の、このアプリ専用の領域にだけ置きます(運営者のサーバーは通りません)。
// ・APIキーなどの設定は同期しません。
// ・「接続」を押すまで、Googleには一切つながりません。
const Sync = (() => {
  // ★公開前に、Google Cloud で発行した「クライアントID」を入れてください(手順は 同期の設定手順.md)。
  const CLIENT_ID = "874990181901-3iefql2808mnmh0scg2pdsb4jmpmm2di.apps.googleusercontent.com";
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const DATA = "meishi-data.json";
  const K = { on: "sync.on", last: "sync.last" };
  const configured = () => !/^YOUR_/.test(CLIENT_ID);
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  // ---------- 統合(純粋関数。テスト可能) ----------
  // 同じidは、更新時刻(ts)が新しい方を採用。削除の記録(tomb)が新しければ削除。
  function merge(local, remote, tl, tr) {
    const tomb = { ...tr }; for (const [id, ts] of Object.entries(tl)) tomb[id] = Math.max(tomb[id] || 0, ts);
    const m = new Map(); for (const c of remote) m.set(c.id, c);
    for (const c of local) { const r = m.get(c.id); if (!r || (c.ts || 0) >= (r.ts || 0)) m.set(c.id, c); }
    const out = [], del = [];
    for (const [id, c] of m) { if ((tomb[id] || 0) >= (c.ts || 0) && tomb[id]) del.push(id); else out.push(c); }
    for (const id of Object.keys(tomb)) if (!m.has(id) && !del.includes(id)) del.push(id);
    return { contacts: out, tomb, del };
  }

  // ---------- Google Drive 側 ----------
  let token = null, tokenExp = 0, tc = null;
  function loadGis() { return new Promise((res, rej) => { if (window.google && google.accounts && google.accounts.oauth2) return res(); const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = res; s.onerror = () => rej(new Error("GIS load failed")); document.head.append(s); }); }
  async function auth(interactive) {
    if (token && Date.now() < tokenExp - 60000) return token;
    if (!configured()) throw new Error("NOCLIENT");
    await loadGis();
    return new Promise((res, rej) => {
      tc = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: r => { if (r.error) return rej(new Error(r.error)); token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000; res(token); }, error_callback: e => rej(new Error((e && e.type) || "auth")) });
      tc.requestAccessToken({ prompt: interactive ? "select_account" : "" });
    });
  }
  const API = "https://www.googleapis.com";
  async function dj(path, opt = {}) { const r = await fetch(API + path, { ...opt, headers: { authorization: "Bearer " + token, ...(opt.headers || {}) } }); if (r.status === 401) { token = null; throw new Error("EXPIRED"); } if (!r.ok) throw new Error("Drive HTTP " + r.status + ": " + (await r.text()).slice(0, 200)); return r; }
  async function findFile(name) { const q = encodeURIComponent("name='" + name + "' and trashed=false"); const j = await (await dj("/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=" + q)).json(); return (j.files || [])[0] || null; }
  async function listAll() { let out = [], tk = ""; do { const j = await (await dj("/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name)" + (tk ? "&pageToken=" + tk : ""))).json(); out = out.concat(j.files || []); tk = j.nextPageToken || ""; } while (tk); return out; }
  async function upload(name, blob, type, id) {
    const meta = id ? { name } : { name, parents: ["appDataFolder"] }, b = "meishi" + Math.random().toString(16).slice(2);
    const body = new Blob(["--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + b + "\r\nContent-Type: " + type + "\r\n\r\n", blob, "\r\n--" + b + "--"]);
    await dj("/upload/drive/v3/files" + (id ? "/" + id : "") + "?uploadType=multipart", { method: id ? "PATCH" : "POST", headers: { "content-type": "multipart/related; boundary=" + b }, body });
  }
  const drive = {
    async readData() { const f = await findFile(DATA); if (!f) return null; return (await dj("/drive/v3/files/" + f.id + "?alt=media")).json(); },
    async writeData(obj) { const f = await findFile(DATA); await upload(DATA, new Blob([JSON.stringify(obj)], { type: "application/json" }), "application/json", f && f.id); },
    async listImgs() { return (await listAll()).filter(f => f.name.startsWith("img-")).map(f => ({ id: f.name.slice(4, -4), fid: f.id })); },
    async getImg(x) { return (await dj("/drive/v3/files/" + x.fid + "?alt=media")).blob(); },
    async putImg(id, blob) { await upload("img-" + id + ".jpg", blob, "image/jpeg"); },
    async delImg(x) { await dj("/drive/v3/files/" + x.fid, { method: "DELETE" }); },
  };

  // ---------- 同期本体 ----------
  let busy = false;
  async function run(backend) {
    if (busy) return { skipped: true }; busy = true;
    try {
      const rem = (await backend.readData()) || { contacts: [], tomb: {} };
      const local = await Store.all(), tl = Store.tombs();
      const m = merge(local, rem.contacts || [], tl, rem.tomb || {});
      const lmap = new Map(local.map(c => [c.id, c])), put = m.contacts.filter(c => { const l = lmap.get(c.id); return !l || (l.ts || 0) < (c.ts || 0); });
      const delIds = m.del.filter(id => lmap.has(id));
      await Store.applySync(put, delIds); Store.setTombs(m.tomb);
      // 写真: 足りない方へ送る/受け取る
      const need = new Set(m.contacts.flatMap(c => [...(c.imgs || []), ...((c.change && c.change.imgs) || [])]));
      const rimgs = await backend.listImgs(), rset = new Set(rimgs.map(x => x.id)), lset = new Set(await Store.imgIds());
      let up = 0, down = 0;
      for (const id of lset) if (need.has(id) && !rset.has(id)) { const b = await Store.getImg(id); if (b) { await backend.putImg(id, b); up++; } }
      for (const x of rimgs) if (need.has(x.id) && !lset.has(x.id)) { await Store.putImg(x.id, await backend.getImg(x)); down++; }
      if (backend.delImg) for (const x of rimgs) if (!need.has(x.id)) await backend.delImg(x); // どの名刺からも使われない写真は、Drive側から消す
      const same = JSON.stringify(m.contacts.map(c => [c.id, c.ts]).sort()) === JSON.stringify((rem.contacts || []).map(c => [c.id, c.ts]).sort()) && JSON.stringify(m.tomb) === JSON.stringify(rem.tomb || {});
      if (!same) await backend.writeData({ v: 1, at: Date.now(), contacts: m.contacts, tomb: m.tomb });
      set(K.last, String(Date.now()));
      return { pulled: put.length, removed: delIds.length, pushed: same ? 0 : 1, up, down };
    } finally { busy = false; }
  }
  async function now(interactive) { await auth(interactive); try { return await run(drive); } catch (e) { if (e.message === "EXPIRED") { await auth(true); return run(drive); } throw e; } }

  return {
    configured, merge, run, drive,
    isOn: () => get(K.on) === "1", last: () => +get(K.last) || 0,
    async connect() { await auth(true); set(K.on, "1"); return now(false); },
    now, off() { set(K.on, null); set(K.last, null); const tk = token; token = null; try { if (tk && window.google && google.accounts) google.accounts.oauth2.revoke(tk, () => {}); } catch (e) {} },
    hasToken: () => !!token && Date.now() < tokenExp - 60000,
  };
})();
