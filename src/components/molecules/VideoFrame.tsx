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

  let iframeRef: HTMLIFrameElement | undefined;
  let isFrameReady = false;
  let pendingPayload: { buffer: ArrayBuffer; mimeType: string } | null = null;

  const handleError = () => {
    setHasError(true);
    props.onUnavailable?.();
  };

  const postVideoToFrame = (payload: { buffer: ArrayBuffer; mimeType: string }) => {
    const targetWindow = iframeRef?.contentWindow;
    if (!targetWindow || !extensionOrigin) return;
    targetWindow.postMessage(
      {
        type: 'ghvp:load-video',
        frameId,
        buffer: payload.buffer,
        mimeType: payload.mimeType,
      },
      extensionOrigin,
      [payload.buffer],
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
        if (pendingPayload) {
          const payload = pendingPayload;
          pendingPayload = null;
          postVideoToFrame(payload);
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
    });
  }

  // Content Script 側のセッション Cookie 付き fetch で動画バイト列を取得し、iframe へ転送する
  createEffect(
    () => (extensionFrameUrl ? props.src : null),
    (src) => {
      if (!src) return;

      const controller = new AbortController();
      pendingPayload = null;
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
          const buffer = await response.arrayBuffer();
          if (controller.signal.aborted) return;

          const payload = { buffer, mimeType: getVideoMimeType(src) };
          if (isFrameReady && iframeRef?.contentWindow) {
            postVideoToFrame(payload);
          } else {
            pendingPayload = payload;
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
    <div class="flex flex-col items-center w-full gap-1.5">
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
                iframeRef = el;
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
