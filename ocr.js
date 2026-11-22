// AIなしモード: 端末内の文字認識(Tesseract)と、ルールによる項目の推定。通信はしません。
const OCR = (() => {
  let worker, loading;
  async function getWorker() {
    if (worker) return worker;
    if (!loading) loading = (async () => {
      await new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement("script"); s.src = "lib/tesseract.min.js"; s.onload = res; s.onerror = () => rej(new Error("OCR library not found")); document.head.append(s); });
      worker = await Tesseract.createWorker(["jpn", "eng"], 1, { workerPath: "lib/worker.min.js", corePath: "lib/", langPath: "lib/lang", gzip: true }); return worker; })();
    return loading;
  }
  async function run(blob) { const w = await getWorker(); const r = await w.recognize(blob); return r.data.text || ""; }
  const N = s => (s || "").normalize("NFKC");
  const TITLE = /(代表取締役|取締役|執行役員|部長|次長|課長|係長|主任|主幹|社長|会長|専務|常務|所長|室長|顧問|教授|准教授|講師|博士|CEO|CTO|CFO|COO|CMO|President|Director|Manager|Professor|Engineer|Chief|Head of)/i;
  const COMP = /(株式会社|有限会社|合同会社|一般社団法人|公益財団法人|大学|研究所|Inc\.?|Ltd\.?|Co\.,?|Corp|Corporation|GmbH|LLC|S\.A\.|PLC)/i;
  const DEPT = /(部|課|室|センター|事業所|本部|グループ|支店|営業所|工場|Division|Department|Dept\.?|Group|Team)/i;
  const ADDR = /(東京都|北海道|(?:京都|大阪)府|[^\s]{2,3}県|[市区町村郡].*\d)/;
  function parse(raw) {
    const lines = N(raw).split(/\n/).map(l => l.replace(/\s+/g, " ").replace(/([^\x00-\x7F]) (?=[^\x00-\x7F])/g, "$1").trim()).filter(l => l.length > 1);
    const f = { company: "", dept: "", title: "", name: "", tel: "", fax: "", mobile: "", email: "", zip: "", address: "", url: "" }, flags = [], used = new Set(), BLD = /(ビル|タワー|センター|棟|館|プラザ|ハイツ|\d+\s*[FＦ階]|Bldg|Building|Tower)/i; let addrIdx = -1; const take = (k, v, i, flag) => { if (!f[k] && v) { f[k] = v; if (i != null) used.add(i); if (flag) flags.push(k); } };
    lines.forEach((l, i) => {
      const em = l.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/); if (em) take("email", em[0], i);
      const u = l.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i); if (u) take("url", /^www/i.test(u[0]) ? "https://" + u[0] : u[0], i);
      const z = l.match(/(?<![\d-])〒?\s*(\d{3})[-ー]?(\d{4})(?![\d-])/); let rest = l;
      if (em) rest = rest.replace(em[0], " "); if (u) rest = rest.replace(u[0], " ");
      if (z && /〒|\d{3}-\d{4}/.test(l)) { take("zip", z[1] + "-" + z[2], i); if (/〒/.test(l) || ADDR.test(l.replace(z[0], ""))) rest = rest.replace(z[0], " "); if (ADDR.test(l.replace(z[0], ""))) used.delete(i); }
      { const re = /(tel|電話|fax|ファックス|ファクス|携帯|mobile|cell|m)?\s*[.:：]?\s*(\+?\(?\d[\d\-() ]{7,}\d)/gi; let m;
        while ((m = re.exec(rest))) { const lab = (m[1] || "").toLowerCase(), num = m[2].trim(), d = num.replace(/\D/g, "").replace(/^81/, "0");
          if (/fax|ファ/.test(lab)) take("fax", num, i); else if (/携帯|mobile|cell|^m$/.test(lab) || /^0[789]0\d{8}$/.test(d)) take("mobile", num, i); else take("tel", num, i); } }
    });
    lines.forEach((l, i) => { if (used.has(i)) return;
      if (!f.company && COMP.test(l) && l.length < 40) { take("company", l, i, true); return; }
      if (!f.address && ADDR.test(l) && /\d/.test(l)) { take("address", l.replace(/^〒?\s*\d{3}-?\d{4}\s*/, ""), i); addrIdx = i; return; } });
    if (addrIdx >= 0) for (let j = addrIdx + 1; j < lines.length && j <= addrIdx + 2; j++) { const l = lines[j]; if (used.has(j) || !BLD.test(l) || TITLE.test(l) || COMP.test(l) || l.length > 30) break; f.address += " " + l; used.add(j); }
    lines.forEach((l, i) => { if (used.has(i)) return;
      if (TITLE.test(l) && DEPT.test(l) && l.length < 40) { (/\s/.test(l) ? l.split(" ") : (l.match(/^(.*?[部課室係])((?:部長|課長|室長|係長|主任|主査|主幹|次長|所長|取締役|社長|代表|マネージャー|リーダー|担当|主席|主事|技師長|顧問|統括).*)$/) || [0, l]).slice(1)).forEach(w => { if (TITLE.test(w)) take("title", w, i, true); else if (DEPT.test(w)) take("dept", w, i, true); }); return; }
      if (!f.title && TITLE.test(l) && l.length < 30) { take("title", l, i, true); return; }
      if (!f.dept && DEPT.test(l) && l.length < 40) { take("dept", l, i, true); return; } });
    lines.forEach((l, i) => { if (used.has(i) || f.name) return; const c = l.replace(/\s/g, "");
      if (/^[一-鿿々〆ヶ]{2,5}$/.test(c) || /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(l)) take("name", l, i, true); });
    return { fields: f, flags, lines };
  }
  return { run, parse };
})();
