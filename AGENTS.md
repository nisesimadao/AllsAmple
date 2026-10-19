# 作業上の約束

- UIを変える前に [DESIGN.md](DESIGN.md) を読む。調査結果は [docs/interface-research.md](docs/interface-research.md) にある。
- 検証でデスクトップにウィンドウを繰り返し出さない。通常の画面確認は `npm run test:ui`（headless Chromium）で行う。ElectronやFinder等を表示する検証は、利用者が表示を伴う確認を明示的に求めた場合だけ行う。
- `robots.txt` を取得・読解する処理は実行・追加しない。
- ホバーは音声の先読みだけ。再生を再導入しない。先読みの失敗で通知を出さない。
- Connected、Ready、飾りの状態ドット、実装の内部事情を示す常設表示を増やさない。必要な進行・失敗・操作結果は伝える。
- 利用者の指定により、Windows実機確認と正式署名・公証は完成の必須条件にしない。未確認の動作を確認済みとは書かない。
- 配布先は `nisesimadao/AllsAmple` のGitHub Releases。本体の自動差し替えは実装せず、サイト取得モジュールを取得して次回起動時に読み込む。
