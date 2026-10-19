# 開発・検証

```sh
npm ci
npm start
```

## 通常の確認

```sh
npm test
npx playwright install chromium --only-shell  # 画面検証用。アプリの利用には不要
npm run test:ui
npm run test:updates
npm run build:modules
node scripts/verify-public-modules.cjs  # 公開済みモジュールから実サイト検索・MP3保存
```

`npm test`はSampleTapの無改変14テストと、サイト解析、権利、保存名、永続化、キャッシュ、ストリーミング、検索、モジュール更新のテストを実行する。`test:ui`は実rendererをheadless Chromiumで動かす。IPCと音声はfixtureであり、実サイトやOS連携の確認とは区別する。

画面検証では、上下キー、4件の比較、ブラインド、ライセンス絞り込み、保存操作、用途別条件、モジュール更新操作、320〜1360pxの収まりを確認する。表示を伴う検証を自動で再開しない。

## 実サイト・OS連携の確認

次のコマンドはElectron等のウィンドウを表示する。利用者が実機確認を求めた場合だけ実行する。

```sh
npm run test:desktop
npm run test:catalogs
npm run test:library
npm run test:actions
npm run test:audio
npm run test:cache
npm run test:workflows
npm run test:streaming
npm run test:freesound
npm run test:pixabay
npm run test:reveal
```

保存ダイアログの返すファイル名を自動指定し、実際に書き込んだバイト列とOSクリップボードを確認する。波形・ピッチ・速度は合成WAVの出力周波数と再生時刻でも検証する。検証用WAVは一時フォルダへ生成し、製品に同梱しない。

これまでの確認範囲と未確認部分は[acceptance.md](acceptance.md)に記録している。過去の実機結果を直近のコードで再確認したものとして扱わない。Windows実機確認は利用者の指定により必須条件から除外している。

## パッケージ

```sh
npm run pack
npm run dist:win
npm run dist:release:mac
node scripts/verify-mac-universal.cjs
npm run test:windows-package
```

Macはad-hoc署名のUniversal版、Windowsは未署名のx64 NSISを配布する。正式署名・公証・更新配布URLを用意する必要はない。アプリ本体の自動差し替えは行わない。[配布とモジュール更新](release.md)を参照。

## SampleTapの移植

`vendor/sampletap/hook.js`、`tests/hook.test.cjs`、MIT LICENSEは無改変。
参照コミットは`c7822a79230db1d189fcd9860b3560f39599db9a`。

- SampleFocus: 埋め込みJSONのslug照合と補助経路。
- LANDR: 署名付き音源URLの監視と対象行IDの照合。
- Splice: 埋め込みJSONと通信から個別プレビューを解決。
- Noiiz: 行のデータとVNodeから解決し、パックデモと混同しない。

アプリ内の非表示Chromiumに元のフックを注入する。`playwright-core`はその操作層で、利用者に別のブラウザを追加インストールさせない。

## READMEの画像

```sh
node scripts/capture-docs.cjs
```

headless Chromiumで実rendererを撮影する。効果音ラボ・魔王魂・On-Jinの公開ページから観測したメタデータと、実際の音源をデコードした波形を使う。再生・OS操作は行わず、音源ファイルも保存しない。`docs/assets/screenshots.json`に撮影日時・出典・測定値を保存する。バナーは`docs/assets/cover.svg`。

音源の取得ロジックは[architecture.md](architecture.md)、UIの方針は[../DESIGN.md](../DESIGN.md)を参照。

UIはRadix ColorsとLucideに統一。[共通ルール](design-system.md)を参照。`npm run assets:ui`と`npm run icons`で配色・SVG・アプリアイコンを生成する。
