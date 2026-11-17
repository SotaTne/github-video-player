---
name: debug
description: >
  不具合の原因を推測で直さず、観測と再現テスト（Red）を起点に特定・修正するデバッグ方針。
  レースコンディション、DOM 再描画、iframe 通信、Blob 転送などの症状ベースの問題に使う。
  Use when the user asks to debug, investigate a flaky bug, reproduce an issue with a test,
  or fix an intermittent failure.
---

# Debug

再現しにくい不具合や症状ベースのバグを調査・修正するときはこの方針に従う。

## 原則

- 推測だけでコードを書き換えない。まず「どの境界・どのタイミングで壊れるか」を特定する。
- 修正の前に、その不具合を再現して失敗するテスト（Red）を書く（`tdd` スキル準拠）。
- 1つの原因に対して最小限の修正を行い、既存のテストとビルドを壊さない。
- 同じ構造の弱点が周辺にないか確認し、必要なら同様にテストで固定する。

## 手順

1. **症状の言語化**: 何が起きるべきで、実際には何が起きているか（状態・見た目・発生条件）を整理する。
2. **境界の洗い出し**: 関連する状態遷移と非同期境界を辿り、壊れうる仮説を列挙する。
3. **再現テストの作成 (Red)**: 仮説のうち再現可能なものを単体・結合テストとして書き、失敗することを確認する。
4. **最小修正 (Green)**: テストを通す最小限の修正を入れ、関連テストだけでなく全体を実行する。
5. **再発防止の点検**: 同種の状態漏れやレースが他にないか確認し、不要な副作用を残さない。

## このプロジェクトで特に疑う境界

- **Content Script ↔ `video-frame` iframe 通信**: `ghvp:frame-ready` と `fetch` 完了の順序逆転、iframe 再ロード時の再送漏れ、`isFrameReady` のリセット漏れ。
- **GitHub DOM / Turbo / React の非同期更新**: `createShadowRootUi` の `await` 中の DOM 差し替え、ホスト要素消失後の `data-ghvp-mounted` 残留、部分描画時の URL 解決。
- **Blob / ObjectURL / メディア要素**: 空 `Blob` や HTML エラー応答の誤通過、`URL.revokeObjectURL` のタイミング、`IntersectionObserver` の監視解除タイミング。
