# DOVA / OpenTracks

2026-10-19に実ページで確認。DOVA-SYNDROMEは[公式のお知らせ](https://opentracks.com/news/detail/7)のとおり、2026-09-15からOpenTracksへ名称・ドメインが変更されている。

`providers/dova.cjs` が `/bgm?keywords=…` と `/se?keywords=…` の公開HTMLを並行検索する。初回は各2ページまで、検索結果だけを先に返し、音声を要求されるまで曲ごとの詳細ページを取得しない。英語のrainなどは既存の辞書で日本語にも展開する。

詳細は選択中のページのJSON-LDとaudio/sourceを使用。ダウンロードページのCSRF cookie・トラック番号を使って通常のフォームを送信し、応答に実在するMP3 URLを取得する。推測でURLを作らない。失敗した場合は公開HTML5試聴URLに切り替え、`isPreview` をtrueに保つ。音源は同梱しない。複数トラックを持つ曲は検索結果の先頭トラックを扱う。

[音源利用ライセンス](https://opentracks.com/help/articles/license/)と詳細ページの作者条件を正規化する。作者条件の確認前は商用可と断定せず橙。サイト準拠を確認できたものは緑。クレジットは任意、再配布・Content ID登録は不可。音楽作品としての利用には配信媒体などの条件があるため、詳細の注意文と規約リンクを残す。

## 確認

- `node --test tests/dova.test.cjs`: 一覧・トラックの識別、作者条件、元MP3のフォーム、試聴へのフォールバック、署名期限、並行検索、一部カテゴリの失敗、音声の段階的配信と保存データの一致。
- `npm run test:dova`: 実際の「雨」の検索結果20件を使い、BGMと効果音を各1件、headless Chromiumの実rendererで再生・波形生成・書き出し。元の配布MP3と書き出しのバイト一致、利用条件バッジ、元MP3/試聴用の表示、320px幅を確認する。ネットワークは実サイト、IPCとOSドラッグ開始だけはテスト用の橋渡し。
- 確認素材は[雨情](https://opentracks.com/bgm/detail/23898)と[タライや缶の音](https://opentracks.com/se/detail/1221)。取得した4,710,083 / 17,135バイトの配布MP3は、実rendererでデコードでき、書き出しでも同一だった。
- `test:ui` は旧設定へのDOVA追加と、利用者が後から外した選択の保持も確認する。

実行時にデスクトップのウィンドウを開かない。Windows実機や各DAWのドロップ受け入れ確認は、この検証には含めない。スクリーンショットは `docs/assets/dova.png`、詳細な実行結果はgit管理外の `output/research/dova/verification.json` に置く。
