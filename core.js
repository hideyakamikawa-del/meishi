// 名簿のデータ処理(読み取り結果の登録・重複と変更の検出・CSV/vCard の入出力)。
const Core = (() => {
  const FIELDS = ["company", "dept", "title", "name", "reading", "tel", "fax", "mobile", "email", "zip", "address", "url", "business", "memo", "meetDate", "meetPlace"];
  const nz = s => (s || "").normalize("NFKC").replace(/[\s　・,.\-_]/g, "").toLowerCase();
  const core = c => nz((c || "").replace(/株式会社|有限会社|\(.*?\)|（.*?）|\b(inc|ltd|llc|corp|corporation|co|gmbh|sa|ag|plc)\b\.?/gi, "").trim().split(/[\s　]+/)[0]); // 事業所・拠点名が後ろに付いても同じ会社として扱う
  const digits = s => (s || "").replace(/\D/g, "");
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const today = () => new Date().toISOString().slice(0, 10);
  const blank = () => Object.fromEntries(FIELDS.map(f => [f, ""]));
  const clean = v => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim();
  const isDup = (a, b) => (nz(a.email) && nz(a.email) === nz(b.email)) || (nz(a.name) && nz(a.name) === nz(b.name) && core(a.company) && core(a.company) === core(b.company));
  const contained = (x, y) => { x = nz(x); y = nz(y); return !!x && !!y && (x.includes(y) || y.includes(x)); };
  const DIFF = [["company", "company"], ["dept", "dept"], ["title", "title"], ["tel", "tel"], ["fax", "fax"], ["mobile", "mobile"], ["email", "email"], ["zip", "zip"], ["address", "address"]];
  function diff(old, nu) {
    const out = [];
    for (const [k] of DIFF) {
      const a = clean(old[k]), b = clean(nu[k]); if (!b || !a && !b) continue;
      let same;
      if (["tel", "fax", "mobile", "zip"].includes(k)) same = !digits(b) || digits(a) === digits(b);
      else if (k === "address") same = contained(a, b);
      else if (k === "company") same = core(a) === core(b);
      else same = nz(a) === nz(b);
      if (!same) out.push([k, a, b]);
    }
    return out;
  }
  // AI の読み取り結果を名簿へ。戻り値: 件ごとの結果
  async function ingest(result, imgIds) {
    const all = await Store.all(); const res = [];
    for (const c of result.cards || []) {
      const n = blank(); for (const f of FIELDS) if (c[f] != null) n[f] = clean(c[f]);
      if (!n.name && !n.company) continue;
      const imgs = c.file && imgIds[c.file] ? [imgIds[c.file]] : (Object.values(imgIds).length === 1 ? Object.values(imgIds) : []);
      const dup = all.find(x => isDup(x, n));
      if (dup) {
        const ch = diff(dup, n);
        if (ch.length) { dup.change = { date: today(), imgs, changes: ch }; await Store.put(dup); res.push({ s: "chg", c: dup }); } else res.push({ s: "dup", c: dup });
        continue;
      }
      const row = { ...n, id: uid(), createdAt: today(), pending: true, change: null, imgs, flags: (c.uncertain || []).map(String) };
      if (!row.business) { const same = all.find(x => core(x.company) && core(x.company) === core(n.company) && x.business); if (same) { row.business = same.business; row.url = row.url || same.url; } }
      await Store.put(row); all.push(row); res.push({ s: "new", c: row });
    }
    return res;
  }
  function applyChange(c, picks) { // picks: 反映する項目のindex配列
    const hist = []; for (const i of picks) { const [k, o, nv] = c.change.changes[i]; hist.push(k + " 旧:" + (o || "-")); c[k] = nv; }
    if (hist.length) c.memo = (c.memo ? c.memo + " / " : "") + "【変更履歴 " + c.change.date + "】" + hist.join("、");
    if (c.change.imgs && c.change.imgs.length) c.imgs = [...c.change.imgs, ...(c.imgs || [])];
    c.change = null; return c;
  }
  function history(list) {
    const out = [];
    for (const x of list) for (const h of (x.memo || "").matchAll(/【変更履歴 (\d{4}-\d\d-\d\d)】([^/]*)/g)) for (const it of h[2].split("、")) { const m = it.trim().match(/^(\S+) 旧:(.*)$/); if (m) out.push({ date: h[1], key: m[1], old: m[2], cur: x[m[1]] || "", x }); }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }
  // ---- CSV (既存の「名刺一覧.csv」20列と互換) ----
  const HEAD = ["登録日", "面会日", "面会場所", "会社名", "部署", "役職", "氏名", "読み仮名", "TEL", "FAX", "メール", "郵便番号", "住所", "メモ", "名刺画像", "URL", "事業内容", "携帯", "変更提案", "共有"];
  const MARK = "【自動登録・未確認】";
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, ""); const rows = []; let r = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { r.push(f); f = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; r.push(f); f = ""; if (r.length > 1 || r[0] !== "") rows.push(r); r = []; } else f += ch; }
    if (f !== "" || r.length) { r.push(f); rows.push(r); } return rows;
  }
  const safeCell = v => { v = String(v == null ? "" : v); return /^(=|@|[+\-][A-Za-z(@=])/.test(v) ? "'" + v : v; };
  const csvRow = a => a.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",");
  function toCSV(list) {
    const rows = list.map(c => [c.createdAt || "", c.meetDate, c.meetPlace, c.company, c.dept, c.title, c.name, c.reading, c.tel, c.fax, c.email, c.zip, c.address, (c.pending && !(c.memo || "").includes(MARK) ? (c.memo ? c.memo + " / " : "") + MARK : c.memo), "", c.url, c.business, c.mobile, c.change ? JSON.stringify({ date: c.change.date, changes: c.change.changes.map(([k, o, n]) => [k, 0, o, n]) }) : "", ""].map(safeCell));
    return "\uFEFF" + [csvRow(HEAD), ...rows.map(csvRow)].join("\r\n") + "\r\n";
  }
  const KEYS = ["company", "dept", "title", "tel", "fax", "mobile", "email", "zip", "address"], JA2K = { "会社名": "company", "部署": "dept", "役職": "title", "TEL": "tel", "FAX": "fax", "携帯": "mobile", "メール": "email", "郵便番号": "zip", "住所": "address" };
  function fromCSV(text) {
    const R = parseCSV(text); if (R.length < 2) return [];
    const ix = {}; R[0].forEach((h, i) => ix[h.trim()] = i); const g = (r, h) => clean(r[ix[h]]);
    return R.slice(1).filter(r => g(r, "氏名") || g(r, "会社名")).map(r => {
      const c = { ...blank(), id: uid(), createdAt: g(r, "登録日") || today(), pending: g(r, "メモ").includes(MARK), change: null, imgs: [], flags: [],
        company: g(r, "会社名"), dept: g(r, "部署"), title: g(r, "役職"), name: g(r, "氏名"), reading: g(r, "読み仮名"), tel: g(r, "TEL"), fax: g(r, "FAX"), mobile: g(r, "携帯"), email: g(r, "メール"), zip: g(r, "郵便番号"), address: g(r, "住所"),
        url: g(r, "URL"), business: g(r, "事業内容"), memo: g(r, "メモ").replace(MARK, "").replace(/\s*\/\s*$/, "").trim(), meetDate: g(r, "面会日"), meetPlace: g(r, "面会場所") };
      try { const j = JSON.parse(r[ix["変更提案"]] || "null"); if (j && j.changes) c.change = { date: j.date, imgs: [], changes: j.changes.map(x => [JA2K[x[0]] || x[0], x[2], x[3]]) }; } catch (e) {}
      return c;
    });
  }
  // ---- vCard ----
  const vesc = s => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\;").replace(/,/g, "\\,");
  function toVCF(list) {
    return list.map(c => ["BEGIN:VCARD", "VERSION:3.0", "FN:" + vesc(c.name), "N:" + vesc(c.name) + ";;;;", c.company || c.dept ? "ORG:" + vesc(c.company) + ";" + vesc(c.dept) : "", c.title ? "TITLE:" + vesc(c.title) : "",
      c.tel ? "TEL;TYPE=WORK,VOICE:" + vesc(c.tel) : "", c.mobile ? "TEL;TYPE=CELL:" + vesc(c.mobile) : "", c.fax ? "TEL;TYPE=WORK,FAX:" + vesc(c.fax) : "", c.email ? "EMAIL;TYPE=WORK:" + vesc(c.email) : "",
      c.address || c.zip ? "ADR;TYPE=WORK:;;" + vesc(c.address) + ";;;" + vesc(c.zip) + ";" : "", c.url ? "URL:" + vesc(c.url.split(" ")[0]) : "", c.memo ? "NOTE:" + vesc(c.memo) : "", "END:VCARD"].filter(Boolean).join("\r\n")).join("\r\n") + "\r\n";
  }
  function fromVCF(text) {
    const un = s => s.replace(/\\n/gi, "\n").replace(/\\([;,\\])/g, "$1");
    return text.replace(/\r?\n[ \t]/g, "").split(/BEGIN:VCARD/i).slice(1).map(b => {
      const c = { ...blank(), id: uid(), createdAt: today(), pending: true, change: null, imgs: [], flags: [] };
      for (const ln of b.split(/\r?\n/)) { const i = ln.indexOf(":"); if (i < 0) continue; const key = ln.slice(0, i).toUpperCase(), v = ln.slice(i + 1), base = key.split(";")[0];
        if (base === "FN") c.name = un(v); else if (base === "ORG") { const p = v.split(";"); c.company = un(p[0] || ""); c.dept = un(p[1] || ""); } else if (base === "TITLE") c.title = un(v);
        else if (base === "TEL") { if (/FAX/.test(key)) c.fax = c.fax || un(v); else if (/CELL|MOBILE/.test(key)) c.mobile = c.mobile || un(v); else c.tel = c.tel || un(v); }
        else if (base === "EMAIL") c.email = c.email || un(v); else if (base === "URL") c.url = c.url || un(v); else if (base === "NOTE") c.memo = un(v);
        else if (base === "ADR") { const p = v.split(";"); c.address = un(p.slice(2, 5).filter(Boolean).join(" ")); c.zip = un(p[5] || ""); } }
      return c; }).filter(c => c.name || c.company);
  }
  return { FIELDS, nz, core, uid, today, blank, clean, isDup, diff, ingest, applyChange, history, toCSV, fromCSV, toVCF, fromVCF, MARK };
})();
