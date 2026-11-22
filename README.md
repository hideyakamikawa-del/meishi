# Meishi (名刺) — どの端末でも動く名刺管理 PWA(試作)

- サーバーなし。名簿・写真は、利用者のブラウザ(IndexedDB)の中だけ。
- 読み取りは、利用者自身のAPIキーで AI 提供元へ直接(Anthropic / OpenAI / Google / OpenAI互換=ローカルLLM)。
- 多言語: i18n.js に言語を追加(現在 ja / en)。
- 既存の「名刺一覧.csv」(20列)をそのまま取り込める。CSV / vCard / JSON で書き出せる。

## 動かす
    python3 -m http.server 8890 --bind 127.0.0.1   # → http://127.0.0.1:8890/
カメラとPWA(ホーム画面追加・オフライン)は HTTPS または localhost が必要。公開は静的ホスティング(GitHub Pages など)に置くだけ。

## バージョン
version.js の APP_VERSION と CHANGELOG(設定画面に表示)。機能を変えたら、1件足して、index.html の ?v= も同じ数字にする。

## ファイル
index.html(画面)/ app.js(画面処理)/ core.js(登録・重複・変更検出・CSV/vCard)/ ai.js(AIアダプター)/ store.js(保存)/ i18n.js(多言語)/ sw.js(オフライン)

## 確認済み / 未確認
確認済み: CSV取込(470件)・往復、vCard往復、重複・変更検出、確認待ち、履歴、XSS・CSV数式対策、スマホ幅の表示(模擬AI)。
未確認: 実際のAI APIでの読み取り(各社のCORS含む)、Service Worker(確認用ブラウザでは登録不可)、実機のカメラ、iOS Safari での保存の永続性。

## v0.7.x モード分離
- 初回に「AIなし(端末内OCR・無料)」「AIあり(自動読取)」を選択。設定からいつでも切替。
- (v0.9.0) 公開版は「AIあり」を標準に案内。AIなしは精度が限定的なため「手入力の補助」と明記。
- AIなし: Tesseract(lib/, jpn+eng)で端末内OCR→ルールで項目推定→確認画面のOCR行チップをタップして入力。
- AIあり: かんたんAI設定(3ステップ: 費用→提供元→キー貼付→接続確認)。
