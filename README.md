# GitHub Video Player

> GitHub 上の動画ファイル（`.mp4`, `.webm`, `.mov` 等）を、画像と同じようにその場で再生するブラウザ拡張機能。

## Why

GitHub では画像ファイルはブラウザ上でそのまま確認できますが、動画ファイルや E2E テストの録画（`.webm` 等）は単体ファイル画面でも Pull Request の `Files changed` でも `Binary file not shown.` となり、確認のたびにローカルへダウンロードして開く必要があります。

動画も画像と同じように確認できるようにするため、この拡張機能を作りました。

## 驚き最小の設計

- GitHub 本来の見た目を変えず、独自のツールバーや二重の枠線、カスタム再生ボタンは追加しません。GitHub の画像プレビューと同じ場所にブラウザ標準の `<video controls>` だけを配置し、変更前後の動画が両方ある差分画面でのみ比較切り替えを表示します。
- 余計な設定や外部通信はなく、ポップアップや設定画面、外部サーバーへのデータ送信はありません。開いているブラウザのセッションのままプライベートリポジトリの動画も再生でき、ファイルを折りたためばプレイヤーも連動して閉じます。

## Quick Start

```bash
git clone https://github.com/SotaTne/github-video-player.git
cd github-video-player
pnpm install
pnpm build
```

1. Chrome で `chrome://extensions` を開きます
2. 右上の「デベロッパーモード」を有効にします
3. 「パッケージ化されていない拡張機能を読み込む」から `.output/chrome-mv3` を選択します
