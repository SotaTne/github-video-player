import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { getVideoMimeType } from '../../features/github-detector';
import { DEFAULT_STREAM_CHUNK_BYTES } from '../../features/video-stream/rangeStream';
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
  hidden?: boolean;
  testId?: string;
  initialBlob?: Blob;
  onBlobLoaded?: (blob: Blob) => void;
  onUnavailable?: () => void;
}

interface ExtensionRuntimeLike {
  id?: string;
  getURL?: (path: string) => string;
}

let frameCounter = 0;

interface StreamInfo {
  streamId: string;
  totalSize: number;
  contentType: string;
  cachedFirstChunk?: ArrayBuffer;
}

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

const MAX_CONCURRENT_VIDEO_FETCHES = 3;
let activeVideoFetches = 0;
const pendingFetchQueue: Array<() => void> = [];

function releaseFetchSlot(): void {
  activeVideoFetches = Math.max(0, activeVideoFetches - 1);
  const next = pendingFetchQueue.shift();
  next?.();
}

async function acquireFetchSlot(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (activeVideoFetches < MAX_CONCURRENT_VIDEO_FETCHES) {
    activeVideoFetches += 1;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener('abort', onAbort);
      activeVideoFetches += 1;
      resolve();
    };
    const onAbort = () => {
      const index = pendingFetchQueue.indexOf(start);
      if (index !== -1) pendingFetchQueue.splice(index, 1);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pendingFetchQueue.push(start);
  });
}

const NON_VIDEO_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/json',
  'application/xml',
  'text/xml',
]);

function resolveVideoContentType(contentType: string | null, fallbackMime: string): string | null {
  if (!contentType) return fallbackMime;
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime) return fallbackMime;
  if (NON_VIDEO_MIME_TYPES.has(mime)) return null;
  return mime.startsWith('video/') ? mime : fallbackMime;
}

function isValidVideoBlob(blob: Blob): boolean {
  if (blob.size === 0) return false;
  return resolveVideoContentType(blob.type || null, 'video/mp4') !== null;
}

const MAX_SAVED_PLAYBACK_ENTRIES = 200;
const savedPlaybackTimeBySrc = new Map<string, number>();

function savePlaybackTime(src: string, time: number): void {
  if (!src || !Number.isFinite(time) || time <= 0) {
    savedPlaybackTimeBySrc.delete(src);
    return;
  }
  savedPlaybackTimeBySrc.set(src, time);
  if (savedPlaybackTimeBySrc.size > MAX_SAVED_PLAYBACK_ENTRIES) {
    const oldestKey = savedPlaybackTimeBySrc.keys().next().value;
    if (oldestKey !== undefined) {
      savedPlaybackTimeBySrc.delete(oldestKey);
    }
  }
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
  let videoRef: HTMLVideoElement | undefined;
  let isFrameReady = false;
  let isPlaying = false;
  let hasPlayedOrSeeked = (savedPlaybackTimeBySrc.get(props.src) ?? 0) > 0;
  let latestBlob: Blob | null = null;
  let lastLoadedSrc: string | null = null;
  let activeStreamPort: MessagePort | null = null;
  let pendingStreamInfo: StreamInfo | null = null;
  let activeLoadController: AbortController | null = null;
  let activeLoadSrc: string | null = null;
  let hasFallenBackToBlob = false;
  // iframe が再読み込みされたときに同じ動画のストリームを張り直すため、最後に送った情報を保持する
  let lastStreamInfo: StreamInfo | null = null;
  let abortActiveRanges: (() => void) | null = null;
  let streamSeq = 0;
  const nextStreamId = () => `${frameId}-${++streamSeq}`;

  const cleanupActiveStream = () => {
    abortActiveRanges?.();
    abortActiveRanges = null;
    if (activeStreamPort) {
      activeStreamPort.close();
      activeStreamPort = null;
    }
    pendingStreamInfo = null;
    lastStreamInfo = null;
  };

  const handleError = () => {
    cleanupActiveStream();
    isFrameReady = false;
    isPlaying = false;
    hasPlayedOrSeeked = false;
    latestBlob = null;
    setHasError(true);
    props.onUnavailable?.();
  };

  const postVideoToFrame = (blob: Blob) => {
    const targetWindow = iframeRef?.contentWindow;
    if (!targetWindow || !extensionOrigin) return;
    const initialTime = savedPlaybackTimeBySrc.get(activeLoadSrc ?? props.src) ?? 0;
    targetWindow.postMessage(
      {
        type: 'ghvp:load-video',
        frameId,
        blob,
        ...(initialTime > 0 ? { initialTime } : {}),
      },
      extensionOrigin,
    );
  };

  const postStreamToFrame = (src: string, info: StreamInfo, signal: AbortSignal) => {
    const targetWindow = iframeRef?.contentWindow;
    if (!targetWindow || !extensionOrigin || signal.aborted) return;

    cleanupActiveStream();
    lastStreamInfo = info;
    const channel = new MessageChannel();
    activeStreamPort = channel.port1;
    const inflight = new Map<string, AbortController>();
    abortActiveRanges = () => {
      for (const requestController of inflight.values()) requestController.abort();
      inflight.clear();
    };

    const respond = (requestId: string, buffer: ArrayBuffer | null) => {
      if (buffer) {
        channel.port1.postMessage({ type: 'ghvp:range-response', requestId, ok: true, buffer }, [
          buffer,
        ]);
      } else {
        channel.port1.postMessage({ type: 'ghvp:range-response', requestId, ok: false });
      }
    };

    channel.port1.addEventListener('message', (event: MessageEvent) => {
      const req = event.data as {
        type?: string;
        requestId?: string;
        start?: number;
        end?: number;
      } | null;
      if (!req || !req.requestId) return;

      if (req.type === 'ghvp:range-cancel') {
        inflight.get(req.requestId)?.abort();
        inflight.delete(req.requestId);
        return;
      }
      if (req.type !== 'ghvp:range-request') return;
      const { requestId, start = 0, end = 0 } = req;

      if (info.cachedFirstChunk && start >= 0 && end < info.cachedFirstChunk.byteLength) {
        respond(requestId, info.cachedFirstChunk.slice(start, end + 1));
        return;
      }

      const requestController = new AbortController();
      inflight.set(requestId, requestController);

      void (async () => {
        try {
          // 一時的な通信断で SW セッションごと全体 Blob 取得へ落ちないよう、通信エラーと 5xx は 1 回だけ再試行する
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              const response = await fetch(src, {
                headers: { Range: `bytes=${start}-${end}` },
                credentials: 'same-origin',
                signal: requestController.signal,
              });
              if (response.status === 206) {
                const buffer = await response.arrayBuffer();
                if (!requestController.signal.aborted) respond(requestId, buffer);
                return;
              }
              if (response.status < 500) break;
            } catch {
              if (requestController.signal.aborted) return;
            }
          }
          if (!requestController.signal.aborted) respond(requestId, null);
        } finally {
          inflight.delete(requestId);
        }
      })();
    });
    channel.port1.start();

    const initialTime = savedPlaybackTimeBySrc.get(src) ?? 0;
    targetWindow.postMessage(
      {
        type: 'ghvp:init-stream',
        frameId,
        streamId: info.streamId,
        totalSize: info.totalSize,
        contentType: info.contentType,
        ...(initialTime > 0 ? { initialTime } : {}),
      },
      extensionOrigin,
      [channel.port2],
    );
  };

  const loadViaBlob = async (src: string, controller: AbortController) => {
    let hasSlot = false;
    try {
      await acquireFetchSlot(controller.signal);
      hasSlot = true;

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
      props.onBlobLoaded?.(blob);
      if (isFrameReady && iframeRef?.contentWindow) {
        postVideoToFrame(blob);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      handleError();
    } finally {
      if (hasSlot) {
        releaseFetchSlot();
      }
    }
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
        } else if (
          (pendingStreamInfo || lastStreamInfo) &&
          activeLoadSrc &&
          activeLoadController &&
          !activeLoadController.signal.aborted
        ) {
          // 再読み込みされた iframe の pagehide による登録解除と衝突しないよう、張り直し時は新しい streamId を使う
          const info = pendingStreamInfo ?? { ...lastStreamInfo!, streamId: nextStreamId() };
          pendingStreamInfo = null;
          postStreamToFrame(activeLoadSrc, info, activeLoadController.signal);
        }
        return;
      }

      if (data['type'] === 'ghvp:stream-fallback') {
        cleanupActiveStream();
        if (
          !hasFallenBackToBlob &&
          activeLoadSrc &&
          activeLoadController &&
          !activeLoadController.signal.aborted
        ) {
          hasFallenBackToBlob = true;
          void loadViaBlob(activeLoadSrc, activeLoadController);
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

      if (data['type'] === 'ghvp:playback-state') {
        isPlaying = Boolean(data['playing']);
        const currentTime = Number(data['currentTime']);
        const targetSrc = activeLoadSrc ?? props.src;
        if (data['ended']) {
          savePlaybackTime(targetSrc, 0);
        } else if (Number.isFinite(currentTime) && currentTime >= 0) {
          savePlaybackTime(targetSrc, currentTime);
        }
        if (isPlaying || currentTime > 0) {
          hasPlayedOrSeeked = true;
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
      cleanupActiveStream();
      latestBlob = null;
      isFrameReady = false;
      isPlaying = false;
      hasPlayedOrSeeked = false;
    });
  }

  // lazy 時はビューポート付近に入るまで動画 fetch を遅延し、大きく画面外へ離れた停止中動画は解放する
  // エラー表示（Raw ダウンロード導線）へ遷移済みの場合は同じ src で再取得せず状態を維持する
  // 非表示タブ（display:none）は常に画面外と報告されるため、切り替えの往復で再取得しないよう解放しない
  createEffect(
    () => ({
      lazy: Boolean(props.lazy),
      hasFrame: Boolean(extensionFrameUrl),
      loaded: shouldLoad(),
      errored: hasError(),
      hidden: Boolean(props.hidden),
    }),
    ({ lazy, hasFrame, loaded, errored, hidden }) => {
      if (!hasFrame || errored) return;
      if (!lazy || typeof IntersectionObserver === 'undefined') {
        if (!loaded) setShouldLoad(true);
        return;
      }
      const target = containerRef;
      if (!target) return;

      if (!loaded) {
        const enterObserver = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              setShouldLoad(true);
              enterObserver.disconnect();
            }
          },
          { rootMargin: '200px' },
        );
        enterObserver.observe(target);
        return () => enterObserver.disconnect();
      }

      if (hidden) return;

      const leaveObserver = new IntersectionObserver(
        (entries) => {
          const isNear = entries.some((entry) => entry.isIntersecting);
          if (!isNear && !props.hidden && !isPlaying && !hasPlayedOrSeeked && !hasError()) {
            latestBlob = null;
            isFrameReady = false;
            iframeRef = undefined;
            setShouldLoad(false);
            leaveObserver.disconnect();
          }
        },
        { rootMargin: '1500px' },
      );
      leaveObserver.observe(target);
      return () => leaveObserver.disconnect();
    },
  );

  // Content Script 側のセッション Cookie 付き fetch で動画をロード（SW ストリーミング優先、非対応時は Blob へフォールバック）
  createEffect(
    () => (extensionFrameUrl && shouldLoad() ? props.src : null),
    (src) => {
      if (!src) return;

      const controller = new AbortController();
      cleanupActiveStream();
      activeLoadController = controller;
      activeLoadSrc = src;
      hasFallenBackToBlob = false;
      latestBlob = null;
      if (lastLoadedSrc !== src) {
        setMetadata(null);
        hasPlayedOrSeeked = false;
        lastLoadedSrc = src;
      }
      setHasError(false);

      if (props.initialBlob && props.initialBlob.size > 0) {
        latestBlob = props.initialBlob;
        if (isFrameReady && iframeRef?.contentWindow) {
          postVideoToFrame(props.initialBlob);
        }
        return () => {
          controller.abort();
          cleanupActiveStream();
        };
      }

      const supportsSwStream =
        typeof MessageChannel !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator;

      if (!supportsSwStream) {
        void loadViaBlob(src, controller);
        return () => {
          controller.abort();
          cleanupActiveStream();
        };
      }

      void (async () => {
        let hasSlot = false;
        try {
          await acquireFetchSlot(controller.signal);
          hasSlot = true;

          // まず先頭 1 チャンクだけ取得し、1MB 未満や Range 非対応(200)なら HEAD・SW なしで即 Blob 再生する
          const firstRes = await fetch(src, {
            headers: { Range: `bytes=0-${DEFAULT_STREAM_CHUNK_BYTES - 1}` },
            credentials: 'same-origin',
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;

          if (!firstRes.ok) {
            handleError();
            return;
          }

          const contentType = resolveVideoContentType(
            firstRes.headers.get('content-type'),
            getVideoMimeType(src),
          );
          if (!contentType) {
            handleError();
            return;
          }

          const firstBuffer = await firstRes.arrayBuffer();
          if (controller.signal.aborted) return;

          if (firstBuffer.byteLength === 0) {
            handleError();
            return;
          }

          if (firstRes.status !== 206 || firstBuffer.byteLength < DEFAULT_STREAM_CHUNK_BYTES) {
            const blob = new Blob([firstBuffer], { type: contentType });
            latestBlob = blob;
            props.onBlobLoaded?.(blob);
            if (isFrameReady && iframeRef?.contentWindow) {
              postVideoToFrame(blob);
            }
            return;
          }

          // 1MB 以上の動画のみ HEAD で総サイズを確認し、取得済み先頭チャンクを引き継いで SW ストリーミングへ移行する
          releaseFetchSlot();
          hasSlot = false;

          const headRes = await fetch(src, {
            method: 'HEAD',
            credentials: 'same-origin',
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;

          const totalSize = Number(headRes.headers.get('content-length'));
          if (headRes.ok && Number.isFinite(totalSize) && totalSize > 0) {
            if (totalSize <= firstBuffer.byteLength) {
              const blob = new Blob([firstBuffer], { type: contentType });
              latestBlob = blob;
              props.onBlobLoaded?.(blob);
              if (isFrameReady && iframeRef?.contentWindow) {
                postVideoToFrame(blob);
              }
              return;
            }

            const streamInfo = {
              streamId: nextStreamId(),
              totalSize,
              contentType,
              cachedFirstChunk: firstBuffer,
            };
            if (isFrameReady && iframeRef?.contentWindow) {
              postStreamToFrame(src, streamInfo, controller.signal);
            } else {
              pendingStreamInfo = streamInfo;
            }
            return;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        } finally {
          if (hasSlot) {
            releaseFetchSlot();
          }
        }

        if (!controller.signal.aborted && !hasFallenBackToBlob) {
          hasFallenBackToBlob = true;
          void loadViaBlob(src, controller);
        }
      })();

      return () => {
        controller.abort();
        cleanupActiveStream();
      };
    },
  );

  // 非表示タブへ切り替わったときに裏で動画の音声が再生され続けないよう一時停止する
  createEffect(
    () => Boolean(props.hidden),
    (isHidden) => {
      if (!isHidden) return;
      videoRef?.pause();
      if (isFrameReady && iframeRef?.contentWindow && extensionOrigin) {
        iframeRef.contentWindow.postMessage({ type: 'ghvp:pause', frameId }, extensionOrigin);
      }
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

  const mediaMaxWidth = () =>
    metadata() ? `${Math.round((520 * metadata()!.width) / metadata()!.height)}px` : '924px';

  const frameBorderClass = () =>
    props.labelVariant === 'danger'
      ? 'border border-gh-danger/70'
      : props.labelVariant === 'success'
        ? 'border border-gh-success/70'
        : 'border border-gh-border';

  return (
    <div
      ref={(el) => {
        containerRef = el;
      }}
      aria-hidden={props.hidden ? 'true' : undefined}
      class={`flex flex-col items-center w-full gap-1.5 ${props.hidden ? 'hidden' : ''}`}
    >
      <Show when={props.label}>
        {(label) => (
          <div class="flex items-center justify-center w-full">
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
              ref={(el) => {
                videoRef = el;
              }}
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
              style={{ 'max-width': mediaMaxWidth() }}
              class={`max-h-[520px] w-full h-auto rounded object-contain ${frameBorderClass()}`}
            />
          }
        >
          {(frameSrc) => (
            <Show
              when={shouldLoad()}
              fallback={
                <div
                  data-testid="ghvp-placeholder"
                  style={{
                    '--ghvp-aspect': metadata()
                      ? `${metadata()!.width} / ${metadata()!.height}`
                      : '16 / 9',
                    'max-width': mediaMaxWidth(),
                  }}
                  class={`ghvp-media-box w-full max-h-[520px] rounded bg-gh-canvas ${frameBorderClass()}`}
                />
              }
            >
              <iframe
                ref={(el) => {
                  if (iframeRef !== el) {
                    iframeRef = el;
                    isFrameReady = false;
                  }
                }}
                data-testid={props.testId}
                src={frameSrc()}
                aria-label="動画プレイヤー"
                allow="fullscreen"
                style={{
                  '--ghvp-aspect': metadata()
                    ? `${metadata()!.width} / ${metadata()!.height}`
                    : '16 / 9',
                  'max-width': mediaMaxWidth(),
                }}
                class={`ghvp-media-box w-full max-h-[520px] rounded bg-gh-canvas ${frameBorderClass()}`}
              />
            </Show>
          )}
        </Show>
      </Show>
    </div>
  );
}
