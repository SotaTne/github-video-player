import { createSignal, Show } from 'solid-js';
import { SegmentedControl, type SegmentOption } from '../../components/molecules/SegmentedControl';
import { VideoFrame } from '../../components/molecules/VideoFrame';

export type DiffViewMode = 'after' | 'before' | 'split';

const DIFF_VIEW_OPTIONS: readonly SegmentOption<DiffViewMode>[] = [
  { value: 'after', label: '変更後 (After)' },
  { value: 'before', label: '変更前 (Before)' },
  { value: 'split', label: '並列比較 (Split)' },
];

export interface VideoPlayerProps {
  filePath: string;
  rawUrl: string;
  beforeRawUrl?: string;
  mode?: 'blob' | 'diff';
}

/**
 * GitHub の Blob 表示および PR / Commit Diff 比較に対応したシンプルなインライン動画プレイヤー。
 */
export function VideoPlayer(props: VideoPlayerProps) {
  const [viewMode, setViewMode] = createSignal<DiffViewMode>('after');
  const [beforeAvailable, setBeforeAvailable] = createSignal(Boolean(props.beforeRawUrl));

  const canCompare = () => Boolean(props.beforeRawUrl && beforeAvailable());
  const isSplit = () => viewMode() === 'split' && canCompare();
  const isLazy = () => props.mode === 'diff';

  return (
    <article
      data-testid="ghvp-player"
      aria-label={props.filePath}
      class="@container w-full text-gh-fg font-sans text-sm flex flex-col gap-3"
    >
      <Show when={canCompare()}>
        <div class="flex items-center justify-end">
          <SegmentedControl
            options={DIFF_VIEW_OPTIONS}
            value={viewMode()}
            onChange={setViewMode}
            ariaLabel="動画の比較表示モード"
          />
        </div>
      </Show>

      <div
        class={
          isSplit() ? 'grid grid-cols-1 @md:grid-cols-2 gap-4 w-full' : 'w-full flex justify-center'
        }
      >
        <Show when={canCompare() && (viewMode() === 'before' || isSplit())}>
          <VideoFrame
            src={props.beforeRawUrl!}
            label="変更前 (Before)"
            labelVariant="danger"
            lazy={isLazy()}
            testId="ghvp-video-before"
            onUnavailable={() => {
              setBeforeAvailable(false);
              if (viewMode() !== 'after') setViewMode('after');
            }}
          />
        </Show>

        <Show when={viewMode() === 'after' || isSplit()}>
          <VideoFrame
            src={props.rawUrl}
            label={canCompare() ? '変更後 (After)' : undefined}
            labelVariant="success"
            lazy={isLazy()}
            testId="ghvp-video-after"
          />
        </Show>
      </div>
    </article>
  );
}
