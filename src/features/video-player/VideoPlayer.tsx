import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { SegmentedControl, type SegmentOption } from '../../components/molecules/SegmentedControl';
import { VideoFrame } from '../../components/molecules/VideoFrame';

export type DiffViewMode = 'after' | 'before' | '2side';

const DIFF_VIEW_OPTIONS: readonly SegmentOption<DiffViewMode>[] = [
  { value: 'after', label: 'After' },
  { value: 'before', label: 'Before' },
  { value: '2side', label: '2-Side' },
];

export interface VideoPlayerProps {
  filePath: string;
  rawUrl: string;
  beforeRawUrl?: string;
  mode?: 'blob' | 'diff';
}

/**
 * GitHub の Blob 表示および PR / Commit Diff 比較に対応したインライン動画プレイヤー。
 */
export function VideoPlayer(props: VideoPlayerProps) {
  const [viewMode, setViewMode] = createSignal<DiffViewMode>('after');
  const [beforeAvailable, setBeforeAvailable] = createSignal(Boolean(props.beforeRawUrl));
  const [shouldProbeBefore, setShouldProbeBefore] = createSignal(
    props.mode !== 'diff' || typeof IntersectionObserver === 'undefined',
  );
  let articleRef: HTMLElement | undefined;

  // タブ往復時に同一動画を再 fetch しないよう、プレイヤー単位で取得済み Blob を保持する
  const blobCache = new Map<string, Blob>();
  onCleanup(() => {
    blobCache.clear();
  });

  const canCompare = () => Boolean(props.beforeRawUrl && beforeAvailable());
  const isTwoSide = () => viewMode() === '2side' && canCompare();
  const isDiffMode = () => props.mode === 'diff';
  const isAfterHidden = () => viewMode() === 'before' && canCompare();

  // 一度表示した Before は After へ戻しても破棄せず隠すだけにし、切り替えのたびに iframe と先頭チャンクを取り直さない
  const [hasShownBefore, setHasShownBefore] = createSignal(false);
  const changeViewMode = (mode: DiffViewMode) => {
    if (mode !== 'after') setHasShownBefore(true);
    setViewMode(mode);
  };

  // Diff で大量動画があるとき、画面外の動画に対して不要な before HEAD を一斉送信しない
  createEffect(
    () => ({
      hasBefore: Boolean(props.beforeRawUrl),
      diff: isDiffMode(),
      ready: shouldProbeBefore(),
    }),
    ({ hasBefore, diff, ready }) => {
      if (!hasBefore || ready) return;
      if (!diff || typeof IntersectionObserver === 'undefined') {
        setShouldProbeBefore(true);
        return;
      }
      const target = articleRef;
      if (!target) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setShouldProbeBefore(true);
            observer.disconnect();
          }
        },
        { rootMargin: '400px' },
      );
      observer.observe(target);
      return () => observer.disconnect();
    },
  );

  // DOM 判定をすり抜けて存在しない beforeRawUrl が渡された場合も、クリック前に比較ボタンを引っ込める
  createEffect(
    () => (shouldProbeBefore() ? props.beforeRawUrl : undefined),
    (beforeUrl) => {
      if (!beforeUrl) {
        if (!props.beforeRawUrl) setBeforeAvailable(false);
        return;
      }
      setBeforeAvailable(true);
      const controller = new AbortController();
      void fetch(beforeUrl, {
        method: 'HEAD',
        credentials: 'same-origin',
        signal: controller.signal,
      })
        .then((res) => {
          if (!controller.signal.aborted && !res.ok) {
            setBeforeAvailable(false);
            if (viewMode() !== 'after') setViewMode('after');
          }
        })
        .catch(() => {
          // テスト環境や一時的な通信エラー時はフォールバック判定へ委ねる
        });
      return () => controller.abort();
    },
  );

  return (
    <article
      ref={(el) => {
        articleRef = el;
      }}
      data-testid="ghvp-player"
      aria-label={props.filePath}
      class={`@container w-full text-gh-fg font-sans text-sm flex flex-col gap-3 ${
        isDiffMode() ? 'p-4' : ''
      }`}
    >
      <div
        class={
          isTwoSide()
            ? 'grid grid-cols-1 @md:grid-cols-2 gap-4 w-full items-start'
            : 'w-full flex justify-center'
        }
      >
        <Show when={canCompare() && hasShownBefore()}>
          <VideoFrame
            src={props.beforeRawUrl!}
            label={isTwoSide() ? 'Before' : undefined}
            labelVariant="danger"
            lazy={isDiffMode()}
            hidden={viewMode() === 'after'}
            testId="ghvp-video-before"
            initialBlob={blobCache.get(props.beforeRawUrl!)}
            onBlobLoaded={(blob) => blobCache.set(props.beforeRawUrl!, blob)}
            onUnavailable={() => {
              setBeforeAvailable(false);
              if (viewMode() !== 'after') setViewMode('after');
            }}
          />
        </Show>

        <VideoFrame
          src={props.rawUrl}
          label={isTwoSide() ? 'After' : undefined}
          labelVariant={isTwoSide() ? 'success' : undefined}
          lazy={isDiffMode()}
          hidden={isAfterHidden()}
          testId="ghvp-video-after"
          initialBlob={blobCache.get(props.rawUrl)}
          onBlobLoaded={(blob) => blobCache.set(props.rawUrl, blob)}
        />
      </div>

      <Show when={canCompare()}>
        <div class="flex items-center justify-center">
          <SegmentedControl
            options={DIFF_VIEW_OPTIONS}
            value={viewMode()}
            onChange={changeViewMode}
            ariaLabel="動画の比較表示モード"
          />
        </div>
      </Show>
    </article>
  );
}
