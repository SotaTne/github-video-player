import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { getVideoMimeType } from '../../features/github-detector';
import { Badge } from '../atoms/Badge';
import { ExternalLink } from '../atoms/ExternalLink';

export interface VideoMetadata {
  width: number;
  height: number;
}

export interface VideoFrameProps {
  src: string;
  label?: string;
  labelVariant?: 'danger' | 'success';
  lazy?: boolean;
  testId?: string;
  onUnavailable?: () => void;
}

interface ExtensionRuntimeLike {
  id?: string;
  getURL?: (path: string) => string;
}

let frameCounter = 0;

function getExtensionFrameUrl(frameId: string): string | null {
  const g = globalThis as {
    browser?: { runtime?: ExtensionRuntimeLike };
    chrome?: { runtime?: ExtensionRuntimeLike };
  };
  const runtime = g.browser?.runtime?.id ? g.browser.runtime : g.chrome?.runtime;
  if (!runtime?.id || typeof runtime.getURL !== 'function') {
    return null;
  }
  return runtime.getURL(`/video-frame.html?frameId=${encodeURIComponent(frameId)}`);
}

function resolveOrigin(urlStr: string): string {
  const parsed = new URL(urlStr);
  return parsed.origin !== 'null' ? parsed.origin : `${parsed.protocol}//${parsed.host}`;
}

function isValidVideoBlob(blob: Blob): boolean {
  if (blob.size === 0) return false;
  if (!blob.type) return true;
  const mime = blob.type.split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    mime.startsWith('video/') ||
    mime === 'application/octet-stream' ||
    mime === 'binary/octet-stream'
  );
}

/**
 * 自身のメタデータとエラーフォールバックを独立して保持する動画フレーム。
 * 拡張機能実行時は CSP を回避するため拡張機能内 iframe 経由で Blob 再生する。
 */
export function VideoFrame(props: VideoFrameProps) {
  const frameId = `ghvp-${++frameCounter}`;
  const extensionFrameUrl = getExtensionFrameUrl(frameId);
  const extensionOrigin = extensionFrameUrl ? resolveOrigin(extensionFrameUrl) : null;

  const [metadata, setMetadata] = createSignal<VideoMetadata | null>(null);
  const [hasError, setHasError] = createSignal(false);
  const [shouldLoad, setShouldLoad] = createSignal(
    !props.lazy || typeof IntersectionObserver === 'undefined',
  );

  let containerRef: HTMLDivElement | undefined;
  let iframeRef: HTMLIFrameElement | undefined;
  let isFrameReady = false;
  let latestBlob: Blob | null = null;

  const handleError = () => {
    isFrameReady = false;
    latestBlob = null;
    setHasError(true);
    props.onUnavailable?.();
  };

  const postVideoToFrame = (blob: Blob) => {
    const targetWindow = iframeRef?.contentWindow;
    if (!targetWindow || !extensionOrigin) return;
    targetWindow.postMessage(
      {
        type: 'ghvp:load-video',
        frameId,
        blob,
      },
      extensionOrigin,
    );
  };

  // 拡張機能内 iframe からの準備完了・メタデータ・エラー通知を受信する
  if (extensionOrigin) {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== extensionOrigin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data['frameId'] !== frameId) return;

      if (data['type'] === 'ghvp:frame-ready') {
        isFrameReady = true;
        // DOM 再配置等で iframe が再ロードされた場合にも再送できるよう latestBlob は保持する
        if (latestBlob) {
          postVideoToFrame(latestBlob);
        }
        return;
      }

      if (data['type'] === 'ghvp:video-metadata') {
        const width = Number(data['width']);
        const height = Number(data['height']);
        if (width > 0 && height > 0) {
          setMetadata({ width, height });
        }
        return;
      }

      if (data['type'] === 'ghvp:video-error') {
        handleError();
      }
    };

    window.addEventListener('message', handleMessage);
    onCleanup(() => {
      window.removeEventListener('message', handleMessage);
      latestBlob = null;
      isFrameReady = false;
    });
  }

  // lazy 時はビューポート付近に入るまで動画 fetch を遅延し、大規模 Diff での不要な帯域・メモリ消費を抑える
  createEffect(
    () => ({
      lazy: Boolean(props.lazy),
      hasFrame: Boolean(extensionFrameUrl),
      loaded: shouldLoad(),
    }),
    ({ lazy, hasFrame, loaded }) => {
      if (!hasFrame || loaded) return;
      if (!lazy || typeof IntersectionObserver === 'undefined') {
        setShouldLoad(true);
        return;
      }
      const target = containerRef;
      if (!target) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setShouldLoad(true);
            observer.disconnect();
          }
        },
        { rootMargin: '200px' },
      );
      observer.observe(target);
      return () => observer.disconnect();
    },
  );

  // Content Script 側のセッション Cookie 付き fetch で Blob を取得し、JS ヒープへの ArrayBuffer 一括展開を避けて iframe へ渡す
  createEffect(
    () => (extensionFrameUrl && shouldLoad() ? props.src : null),
    (src) => {
      if (!src) return;

      const controller = new AbortController();
      latestBlob = null;
      setMetadata(null);
      setHasError(false);

      void (async () => {
        try {
          const response = await fetch(src, {
            credentials: 'same-origin',
            signal: controller.signal,
          });
          if (!response.ok) {
            handleError();
            return;
          }
          const rawBlob = await response.blob();
          if (controller.signal.aborted) return;
          if (!isValidVideoBlob(rawBlob)) {
            handleError();
            return;
          }

          const mimeType = getVideoMimeType(src);
          const blob = rawBlob.type.startsWith('video/')
            ? rawBlob
            : rawBlob.slice(0, rawBlob.size, mimeType);
          latestBlob = blob;
          if (isFrameReady && iframeRef?.contentWindow) {
            postVideoToFrame(blob);
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          handleError();
        }
      })();

      return () => {
        controller.abort();
      };
    },
  );

  const handleLoadedMetadata = (e: Event) => {
    const video = e.currentTarget as HTMLVideoElement;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setMetadata({
        width: video.videoWidth,
        height: video.videoHeight,
      });
    }
  };

  return (
    <div
      ref={(el) => {
        containerRef = el;
      }}
      class="flex flex-col items-center w-full gap-1.5"
    >
      <Show when={props.label}>
        {(label) => (
          <div class="flex items-center justify-start w-full">
            <Badge variant={props.labelVariant ?? 'neutral'}>{label()}</Badge>
          </div>
        )}
      </Show>

      <Show
        when={!hasError()}
        fallback={
          <div
            data-testid="ghvp-error"
            class="w-full py-6 px-4 rounded border border-gh-border bg-gh-muted text-center flex flex-col items-center gap-2"
          >
            <p class="text-sm font-medium text-gh-fg">
              この動画形式またはLFSファイルはブラウザ内で直接再生できませんでした。
            </p>
            <ExternalLink href={props.src} variant="primary">
              Rawファイルを開く / ダウンロード
            </ExternalLink>
          </div>
        }
      >
        <Show
          when={extensionFrameUrl}
          fallback={
            <video
              data-testid={props.testId}
              src={props.src}
              width={metadata()?.width ?? 1280}
              height={metadata()?.height ?? 720}
              controls
              playsinline
              preload="metadata"
              {...(props.lazy ? ({ loading: 'lazy' } as Record<string, string>) : {})}
              onLoadedMetadata={handleLoadedMetadata}
              onError={handleError}
              class="max-h-[520px] w-full h-auto rounded bg-black object-contain"
            />
          }
        >
          {(frameSrc) => (
            <iframe
              ref={(el) => {
                if (iframeRef !== el) {
                  iframeRef = el;
                  isFrameReady = false;
                }
              }}
              data-testid={props.testId}
              src={frameSrc()}
              title="動画プレイヤー"
              allow="fullscreen"
              style={{
                '--ghvp-aspect': metadata()
                  ? `${metadata()!.width} / ${metadata()!.height}`
                  : '16 / 9',
              }}
              class="ghvp-media-box w-full max-h-[520px] border-0 rounded bg-black"
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
