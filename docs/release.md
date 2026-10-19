# 配布とモジュール更新

配布先は[nisesimadao/AllsAmple](https://github.com/nisesimadao/AllsAmple)のGitHub Releases。独自サーバーや配布URLの入力は不要。
アプリ本体は手動で入れ替えるZIP / インストーラー、頻繁に変わるサイト取得処理は別の小さなモジュールとして配布する。
正式署名・公証とWindows実機検証は、利用者の指定により必須条件としない。

## アプリ本体

```sh
npm run dist:release:mac
npm run dist:release:win
```

MacはUniversalのDMG / ZIP、Windowsはx64 NSIS。Macはad-hoc署名、Windowsは未署名。インストーラーによる自動差し替えは行わず、`app-update.yml`も生成しない。`--publish never`なのでビルドだけでは公開しない。

本体を更新したときだけ通常のバージョンタグ（例:`v0.1.0`）へ配布物を添付する。
プロジェクトや履歴はuserDataに保存するため、本体とは別に維持する。

## サイトモジュール

```sh
npm run build:modules
# 内容を変更して次のモジュール版を作るとき
npm run build:modules -- 2.0.1
```

`dist/modules/`へ次の2ファイルを生成する。

- `allsample-modules-v2.json`: API番号、版、ファイル名、バイト数、SHA-256。
- `allsample-sites-<版>.json`: 10サイトの取得処理、共通ヘルパー、ページ注入スクリプト、SampleTapのフックとライセンス。

約95KBのテキストで、Electron・node_modules・音源・ユーザーデータは含まない。
`modules`タグのリリースへ両方を添付する。通常のアプリダウンロードを邪魔しないよう、このリリースはLatestにしない。

```sh
gh release create modules --repo nisesimadao/AllsAmple --target main --title "サイトモジュール" --notes-file docs/MODULE_RELEASE.md --latest=false
gh release upload modules dist/modules/allsample-sites-2.0.0.json --repo nisesimadao/AllsAmple --clobber
gh release upload modules dist/modules/allsample-modules-v2.json --repo nisesimadao/AllsAmple --clobber
```

更新時は版を上げ、先に本体データ、最後にmanifestを更新する。
アプリは固定の`releases/download/modules/allsample-modules-v2.json`を参照する。任意URLを入力してコードを実行する機能や、他作者のプラグイン管理は作らない。

## 読み込み

1. 起動時に保存済みモジュールがあれば検証して読み込む。なければ同梱版を使用。
2. 起動30秒後・6時間ごと、または設定から更新情報だけを確認。
3. 利用者が「モジュールを取得」を押すと、バイト数・ハッシュ・API・ファイル構成・構文を確認して保存。
4. 次回起動時に新しいサイト取得コードを実行する。本体のインストールや強制再起動はしない。
5. 読み込みに失敗した場合は、同梱の10サイトへ戻る。ローカル素材と書き出した音源は触らない。

モジュールはこのプロジェクトのアプリコードであり、アプリと同じ権限で実行する。新しいネイティブ依存や互換性のないAPIが必要な変更は本体の更新として配布する。

`npm run test:updates`は一時フォルダと制御したHTTP応答で実モジュールの取得・保存・次のローダーでの実行・検索・破損時の復帰を確認する。画面やインストーラーを開かない。

API 1の旧本体向け `allsample-modules.json` と1.0.1のバンドルは残す。API 2向けのmanifestだけを差し替える。
