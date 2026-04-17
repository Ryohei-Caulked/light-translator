# Light Translator（同時通訳字幕）

プレゼン用途の **日英同時通訳（字幕）** を想定したローカル Web アプリです。

- 音声入力: ブラウザの Web Speech API（Chrome / Edge 推奨）
- 言語判定/翻訳: Google Cloud Translation API（API キー）
- 日本語→英語 / 英語→日本語に翻訳して字幕表示

## 起動方法

前提: Node.js（推奨: Node 18+）

```powershell
npm start
```

ブラウザで `http://127.0.0.1:5173` を開きます。

## 使い方（画面）

- 右上: `Start` / `Stop` で聞き取り開始/停止（Space でも開始/停止）
- 右上: `Full`（全画面）/ `Normal`（通常）
- 右上: 音声入力言語（`自動` / `ja-JP` / `en-US`）
- 右上: `A-` / `A+`（字幕の文字サイズを微調整）
- 左パネル:
  - `基本` タブ: 翻訳の待ち時間、字幕表示オプション、履歴クリア等
  - `API` タブ: API キー設定（保存/接続テスト）と「取得方法」ヘルプ

## API キーの準備

- 手順書: `docs/google-cloud-api-key.md`
- アプリ内ヘルプ: `API` タブの「取得方法」（`/help/api-key.html`）

## 注意

- Web Speech API の仕様・精度はブラウザ/OS に依存します。
- API キーは **ブラウザの localStorage**（`lt.settings.v1`）に保存されます。社内ポリシーに従って管理してください。

