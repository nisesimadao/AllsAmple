# 再生・ファイルドラッグの修正（0.1.1）

## 確認した原因

- 利用端末のSpliceキャッシュ23件すべてに `sp` から始まる転送データが保存されていた。通常のMP3ではないため、HTMLAudioElement / decodeAudioDataへそのまま渡すと失敗する。
- ホバーが音源取得と全データの波形デコードを同時に起動。素早く行を横切るだけで処理が積み上がる。
- 日本の3サイトは音源を全部Bufferに受け取るまでprepareが完了しなかった。
- 古いplayのprepare失敗を、世代が変わった後も画面へ通知していた。波形の失敗も同じ通知経路に流れていた。
- 再生ごとに全素材をlocalStorageへJSON保存し、さらに本体側のカタログも書き直していた。
- native dragが波形取得済みの行に限定され、キャッシュのハッシュ名をそのまま渡していた。
- On-Jinの保存済みURLには現在404になるディレクトリがあった。

## 実装と検証

Spliceは[公開Webプレイヤーの転送処理](https://splice.com/_app/immutable/chunks/BrQFmRJe.js)を2026-10-19に確認。28バイトのヘッダーに続くMP3の所定の区間を元に戻す。音声の再圧縮やオリジナル取得はしない。元のSampleTap hookと14件のテストは変更していない。

`node --test` に転送データの修復・同時読み出し・外部ドラッグ用ファイルの保持・URL更新の回帰テストを追加。

`npm run test:playback` は実際のrendererとHTMLAudioElement / AudioContextをheadless Chromiumで実行する。読み込み中の停止、連続操作、古い失敗、波形のみのデコード失敗、ワークレットの遅延初期化、波形なしのドラッグIPCを検証する。音は出さず、Electronウィンドウも開かない。テスト音のMP3生成だけffmpegを使用し、アプリには不要。

同テストでは本体のSiteNetwork → AudioCache → growingResponseも使用。MP3の先頭だけ配信して残りを保留しても再生が進み、未取得部分へ頭出しした後、配信再開で再生・波形・保存が完了する。保存データのバイト一致も確認。WAVの初期再生はブラウザ側の読み込み要件にも依存するため、全WAVが取得途中から鳴るとは扱わない。

`node scripts/verify-playback.cjs --cached-splice` では、このMacに以前からあった23件をメモリ上で修復し、すべてdecodeAudioDataに成功。検証中に利用者のキャッシュやライブラリは変更していない。

2026-10-19の空の一時キャッシュからの実取得では、最初の音声データを返すまで効果音ラボ126ms、魔王魂144ms、On-Jin386ms。全取得は230 / 500 / 421ms。各1件の測定であり、音が出るまでの時間や全サイトの保証値ではない。

外部ドラッグは[Electronのnative file drag](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop)を利用。ネットワーク待ちは事前に済ませ、dragstartの中では完成済みのローカルファイルをDownloadsへコピーしてstartDragする。既存ファイルは上書きせず、同じ行の再ドラッグはその書き出しを再利用。ローカル素材は元パスを渡す。Windows実機と各DAWの受け取り動作は未検証。初回取得が終わる前に掴んだ場合は、準備後の再ドラッグが必要。
