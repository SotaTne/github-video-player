import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
import { DEFAULT_STREAM_CHUNK_BYTES } from '../../features/video-stream/rangeStream';
import { VideoFrame } from './VideoFrame';

describe('VideoFrame', () => {
  it('sets explicit width/height and omits loading attribute when lazy is false/omitted', () => {
    const { getByTestId } = render(() => (
      <VideoFrame src="https://github.com/octocat/hello/raw/main/demo.mp4" testId="video-el" />
    ));

    const video = getByTestId('video-el') as HTMLVideoElement;
    expect(video.getAttribute('width')).toBe('1280');
    expect(video.getAttribute('height')).toBe('720');
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('loading')).toBe(false);
  });

  it('applies loading="lazy" when lazy is true', () => {
    const { getByTestId } = render(() => (
      <VideoFrame
        src="https://github.com/octocat/hello/raw/main/demo.mp4"
        lazy
        testId="video-lazy"
      />
    ));

    const video = getByTestId('video-lazy');
    expect(video.getAttribute('loading')).toBe('lazy');
  });

  it('updates width/height on loadedmetadata without rendering top-right metadata text', () => {
    const { getByTestId, queryByTestId } = render(() => (
      <VideoFrame
        src="https://github.com/octocat/hello/raw/main/demo.mp4"
        label="変更後 (After)"
        labelVariant="success"
        testId="video-meta"
      />
    ));

    const video = getByTestId('video-meta') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
    Object.defineProperty(video, 'duration', { value: 65, configurable: true });

    fireEvent(video, new Event('loadedmetadata'));
    flush();

    expect(queryByTestId('ghvp-metadata')).toBeNull();
    expect(video.getAttribute('width')).toBe('1920');
    expect(video.getAttribute('height')).toBe('1080');
  });

  it('renders error fallback and invokes onUnavailable when video fails to load', () => {
    const onUnavailable = vi.fn<() => void>();
    const { getByTestId, queryByTestId } = render(() => (
      <VideoFrame
        src="https://github.com/octocat/hello/raw/main/broken.mp4"
        testId="video-broken"
        onUnavailable={onUnavailable}
      />
    ));

    fireEvent(getByTestId('video-broken'), new Event('error'));
    flush();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(queryByTestId('video-broken')).toBeNull();
    expect(getByTestId('ghvp-error')).toBeTruthy();
  });

  it('uses isolated extension iframe even in lazy diff mode and passes Blob via postMessage', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(sampleBytes, { status: 200 }));

    let observerCallback: IntersectionObserverCallback | undefined;
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe = vi.fn();
        disconnect = disconnectSpy;
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId, queryByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/develop/video.webm"
          lazy
          testId="video-iframe"
        />
      ));

      // 交差前は iframe 自体も生成せずプレースホルダーのみ表示する
      expect(queryByTestId('video-iframe')).toBeNull();
      expect(getByTestId('ghvp-placeholder')).toBeTruthy();

      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      const iframe = getByTestId('video-iframe') as HTMLIFrameElement;
      expect(iframe.tagName).toBe('IFRAME');
      expect(iframe.hasAttribute('loading')).toBe(false);
      expect(iframe.hasAttribute('title')).toBe(false);
      expect(iframe.getAttribute('aria-label')).toBe('動画プレイヤー');
      const frameSrc = iframe.getAttribute('src') ?? '';
      const frameId = new URL(frameSrc).searchParams.get('frameId') ?? '';
      expect(frameSrc).toContain(`${extensionOrigin}/video-frame.html?frameId=`);

      const postMessageSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        configurable: true,
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          'https://github.com/octocat/hello/raw/develop/video.webm',
          expect.objectContaining({ credentials: 'same-origin' }),
        );
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ghvp:load-video',
            frameId,
            blob: expect.any(Blob),
          }),
          extensionOrigin,
        );
      });

      const postedMessage = postMessageSpy.mock.calls[0]?.[0] as { blob: Blob };
      expect(postedMessage.blob.type).toBe('video/webm');
      expect(postedMessage.blob.size).toBe(4);

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:video-metadata', frameId, width: 1280, height: 720, duration: 12 },
        }),
      );

      await waitFor(() => {
        expect(iframe.style.getPropertyValue('--ghvp-aspect')).toBe('1280 / 720');
      });
      expect(queryByTestId('ghvp-metadata')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('defers fetching video until container intersects viewport when lazy is true', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(sampleBytes, { status: 200 }));

    let observerCallback: IntersectionObserverCallback | undefined;
    let observerOptions: IntersectionObserverInit | undefined;
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          observerCallback = callback;
          observerOptions = options;
        }
        observe = observeSpy;
        disconnect = disconnectSpy;
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/develop/lazy-video.mp4"
          lazy
          testId="video-lazy-iframe"
        />
      ));

      await Promise.resolve();
      expect(observeSpy).toHaveBeenCalledTimes(1);
      expect(observerOptions).toEqual({ rootMargin: '200px' });
      expect(fetchSpy).not.toHaveBeenCalled();

      observerCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await Promise.resolve();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(disconnectSpy).not.toHaveBeenCalled();

      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          'https://github.com/octocat/hello/raw/develop/lazy-video.mp4',
          expect.objectContaining({ credentials: 'same-origin' }),
        );
      });
      expect(disconnectSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('resends the fetched Blob when iframe reloads and emits ghvp:frame-ready again', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(sampleBytes, { status: 200 }));

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/main/reload.webm"
          testId="video-iframe-reload"
        />
      ));

      const iframe = getByTestId('video-iframe-reload') as HTMLIFrameElement;
      const frameId = new URL(iframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';
      const postMessageSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        configurable: true,
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      // 1回目の frame-ready で初回 Blob を送信
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledTimes(1);
      });

      // DOM 移動等で iframe が再ロードされ、2回目の frame-ready が届いた場合でも再送されること
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledTimes(2);
      });
    } finally {
      fetchSpy.mockRestore();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('resets iframe readiness after error recovery so a new src waits for new frame-ready', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response(sampleBytes, { status: 200 })));

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const [src, setSrc] = createSignal('https://github.com/octocat/hello/raw/main/first.webm');
      const { getByTestId } = render(() => (
        <VideoFrame src={src()} testId="video-iframe-recover" />
      ));

      const firstIframe = getByTestId('video-iframe-recover') as HTMLIFrameElement;
      const frameId =
        new URL(firstIframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';
      const firstPostSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(firstIframe, 'contentWindow', {
        value: { postMessage: firstPostSpy },
        configurable: true,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );
      await waitFor(() => {
        expect(firstPostSpy).toHaveBeenCalledTimes(1);
      });

      // 一度動画エラーになって iframe がアンマウントされる
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:video-error', frameId },
        }),
      );
      await waitFor(() => {
        expect(getByTestId('ghvp-error')).toBeTruthy();
      });

      // src が切り替わって新しい iframe がマウントされた直後（まだ frame-ready 前）
      setSrc('https://github.com/octocat/hello/raw/main/second.webm');
      flush();

      const secondIframe = getByTestId('video-iframe-recover') as HTMLIFrameElement;
      const secondPostSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(secondIframe, 'contentWindow', {
        value: { postMessage: secondPostSpy },
        configurable: true,
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      // 新しい iframe から frame-ready が来る前に postMessage されていてはいけない
      expect(secondPostSpy).not.toHaveBeenCalled();

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );

      await waitFor(() => {
        expect(secondPostSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      fetchSpy.mockRestore();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('falls back to error state when fetch returns an empty or HTML response', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>Login</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/main/login-redirect.mp4"
          testId="video-iframe-html"
        />
      ));

      const iframe = getByTestId('video-iframe-html') as HTMLIFrameElement;
      const postMessageSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        configurable: true,
      });

      await waitFor(() => {
        expect(getByTestId('ghvp-error')).toBeTruthy();
      });
      expect(postMessageSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('limits concurrent video fetches when many videos mount at once', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;

    const resolvers: Array<() => void> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(() => resolve(new Response(sampleBytes.slice(0), { status: 200 })));
        }),
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      render(() => (
        <div>
          <VideoFrame src="https://github.com/octocat/hello/raw/main/v1.mp4" />
          <VideoFrame src="https://github.com/octocat/hello/raw/main/v2.mp4" />
          <VideoFrame src="https://github.com/octocat/hello/raw/main/v3.mp4" />
          <VideoFrame src="https://github.com/octocat/hello/raw/main/v4.mp4" />
        </div>
      ));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      });
      // 3本がインフライトのあいだは4本目は待機する
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // 1本完了すると4本目が開始される
      resolvers.shift()?.();
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(4);
      });
    } finally {
      while (resolvers.length > 0) {
        resolvers.shift()?.();
      }
      fetchSpy.mockRestore();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('unloads offscreen lazy iframe when scrolled far out while paused and reloads on re-enter', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(sampleBytes.slice(0), { status: 200 })),
      );

    const callbacksByMargin = new Map<string, IntersectionObserverCallback>();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          callbacksByMargin.set(options?.rootMargin ?? '', callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId, queryByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/develop/offscreen.mp4"
          lazy
          testId="video-offscreen"
        />
      ));

      callbacksByMargin.get('200px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
      expect(getByTestId('video-offscreen')).toBeTruthy();

      // 停止中のまま遠方（1500px 外）へ離脱するとプレースホルダーへ戻って解放される
      callbacksByMargin.get('1500px')?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      expect(queryByTestId('video-offscreen')).toBeNull();
      expect(getByTestId('ghvp-placeholder')).toBeTruthy();

      // 再びビューポート付近に入ると再マウント・再取得される
      callbacksByMargin.get('200px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
      expect(getByTestId('video-offscreen')).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('keeps offscreen lazy iframe mounted while video is playing', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(sampleBytes, { status: 200 }));

    const callbacksByMargin = new Map<string, IntersectionObserverCallback>();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          callbacksByMargin.set(options?.rootMargin ?? '', callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId, queryByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/develop/playing.mp4"
          lazy
          testId="video-playing"
        />
      ));

      callbacksByMargin.get('200px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      const iframe = getByTestId('video-playing') as HTMLIFrameElement;
      const frameId = new URL(iframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:playback-state', frameId, playing: true },
        }),
      );

      callbacksByMargin.get('1500px')?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      expect(getByTestId('video-playing')).toBeTruthy();
      expect(queryByTestId('ghvp-placeholder')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('initializes Service Worker stream via HEAD and falls back to Blob when stream fails', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const originalNavigatorDesc = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {},
      configurable: true,
    });

    const fullFirstChunk = new Uint8Array(DEFAULT_STREAM_CHUNK_BYTES);
    fullFirstChunk[0] = 10;
    fullFirstChunk[1] = 20;
    const totalLargeSize = DEFAULT_STREAM_CHUNK_BYTES * 2;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      if (init?.method === 'HEAD') {
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: {
              'content-length': String(totalLargeSize),
              'content-type': 'video/mp4',
            },
          }),
        );
      }
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.['Range']) {
        return Promise.resolve(new Response(fullFirstChunk.buffer.slice(0), { status: 206 }));
      }
      return Promise.resolve(new Response(fullFirstChunk.buffer.slice(0), { status: 200 }));
    });

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/main/large.mp4"
          testId="video-stream"
        />
      ));

      const iframe = getByTestId('video-stream') as HTMLIFrameElement;
      const frameId = new URL(iframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';

      let transferredPort: MessagePort | undefined;
      const postMessageSpy = vi.fn(
        (message: unknown, _targetOrigin: string, transfer?: Transferable[]) => {
          const msg = message as { type?: string };
          if (msg.type === 'ghvp:init-stream') {
            transferredPort = transfer?.[0] as MessagePort | undefined;
          }
        },
      );
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        configurable: true,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ghvp:init-stream',
            frameId,
            totalSize: totalLargeSize,
            contentType: 'video/mp4',
          }),
          extensionOrigin,
          expect.any(Array),
        );
      });

      const fetchCallsBeforeRange = fetchSpy.mock.calls.length;

      // 転送された MessagePort へ先頭範囲の Range 要求を送り、キャッシュからネットワーク再取得なしで返ることを検証
      const rangeResponse = await new Promise<{ ok: boolean; buffer?: ArrayBuffer }>((resolve) => {
        if (!transferredPort) {
          resolve({ ok: false });
          return;
        }
        transferredPort.addEventListener('message', (e) => {
          resolve(e.data as { ok: boolean; buffer?: ArrayBuffer });
        });
        transferredPort.start();
        transferredPort.postMessage(
          {
            type: 'ghvp:range-request',
            requestId: 'r1',
            start: 10,
            end: 13,
          },
          [],
        );
      });

      expect(rangeResponse.ok).toBe(true);
      expect(rangeResponse.buffer?.byteLength).toBe(4);
      expect(fetchSpy.mock.calls.length).toBe(fetchCallsBeforeRange);

      // ストリーミング失敗通知を受けると Blob 方式へフォールバックすること
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:stream-fallback', frameId },
        }),
      );

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ghvp:load-video',
            frameId,
            blob: expect.any(Blob),
          }),
          extensionOrigin,
        );
      });
    } finally {
      fetchSpy.mockRestore();
      if (originalNavigatorDesc) {
        Object.defineProperty(navigator, 'serviceWorker', originalNavigatorDesc);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('plays video normally even when server returns text/plain content-type for video binary', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sampleBytes, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId, queryByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/main/plain-header.mp4"
          testId="video-plain-ct"
        />
      ));

      const iframe = getByTestId('video-plain-ct') as HTMLIFrameElement;
      const frameId = new URL(iframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';
      const postMessageSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        configurable: true,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ghvp:load-video',
            frameId,
            blob: expect.any(Blob),
          }),
          extensionOrigin,
        );
      });
      expect(queryByTestId('ghvp-error')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('keeps error fallback mounted across offscreen scroll without re-fetching', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 404 }));

    const callbacksByMargin = new Map<string, IntersectionObserverCallback>();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          callbacksByMargin.set(options?.rootMargin ?? '', callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId, queryByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/develop/missing.mp4"
          lazy
          testId="video-error-persist"
        />
      ));

      callbacksByMargin.get('200px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      await waitFor(() => {
        expect(getByTestId('ghvp-error')).toBeTruthy();
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // 画面外へ大きくスクロールして戻ってきてもエラー表示のまま再取得しないこと
      callbacksByMargin.get('1500px')?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();
      callbacksByMargin.get('200px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();
      await Promise.resolve();

      expect(getByTestId('ghvp-error')).toBeTruthy();
      expect(queryByTestId('video-error-persist')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('keeps offscreen lazy iframe mounted after user played and paused the video', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(sampleBytes, { status: 200 }));

    const callbacksByMargin = new Map<string, IntersectionObserverCallback>();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          callbacksByMargin.set(options?.rootMargin ?? '', callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId, queryByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/develop/paused-midway.mp4"
          lazy
          testId="video-paused-midway"
        />
      ));

      callbacksByMargin.get('200px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      const iframe = getByTestId('video-paused-midway') as HTMLIFrameElement;
      const frameId = new URL(iframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';

      // 再生開始したあと一時停止する
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:playback-state', frameId, playing: true, currentTime: 5.2 },
        }),
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:playback-state', frameId, playing: false, currentTime: 5.2 },
        }),
      );

      // 遠方へスクロールしても再生位置が失われないようアンロードしないこと
      callbacksByMargin.get('1500px')?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      expect(getByTestId('video-paused-midway')).toBeTruthy();
      expect(queryByTestId('ghvp-placeholder')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('restores saved playback position across unmount and remount for the same src', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(sampleBytes.slice(0), { status: 200 })),
      );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const targetSrc = 'https://github.com/octocat/hello/raw/develop/virtualized-remount.mp4';
      const firstMount = render(() => <VideoFrame src={targetSrc} testId="video-remount-1" />);

      const firstIframe = firstMount.getByTestId('video-remount-1') as HTMLIFrameElement;
      const firstFrameId =
        new URL(firstIframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: {
            type: 'ghvp:playback-state',
            frameId: firstFrameId,
            playing: false,
            currentTime: 12.5,
          },
        }),
      );

      // GitHub の仮想スクロール等で DOM ごとアンマウントされる
      firstMount.unmount();

      // 同じ src で再マウントされる
      const secondMount = render(() => <VideoFrame src={targetSrc} testId="video-remount-2" />);
      const secondIframe = secondMount.getByTestId('video-remount-2') as HTMLIFrameElement;
      const secondFrameId =
        new URL(secondIframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';
      const secondPostSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(secondIframe, 'contentWindow', {
        value: { postMessage: secondPostSpy },
        configurable: true,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId: secondFrameId },
        }),
      );

      await waitFor(() => {
        expect(secondPostSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ghvp:load-video',
            frameId: secondFrameId,
            initialTime: 12.5,
          }),
          extensionOrigin,
        );
      });
    } finally {
      fetchSpy.mockRestore();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('plays small videos directly as Blob in a single Range request without HEAD', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const originalNavigatorDesc = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {},
      configurable: true,
    });

    const smallBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(smallBytes, {
        status: 206,
        headers: { 'content-type': 'video/webm' },
      }),
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const { getByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/main/small-clip.webm"
          testId="video-small-fast"
        />
      ));

      const iframe = getByTestId('video-small-fast') as HTMLIFrameElement;
      const frameId = new URL(iframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';
      const postMessageSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        configurable: true,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ghvp:load-video',
            frameId,
            blob: expect.any(Blob),
          }),
          extensionOrigin,
        );
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'HEAD')).toBe(false);
    } finally {
      fetchSpy.mockRestore();
      if (originalNavigatorDesc) {
        Object.defineProperty(navigator, 'serviceWorker', originalNavigatorDesc);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('pauses iframe playback when hidden becomes true', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(sampleBytes, { status: 200 }));

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `${extensionOrigin}${path}`,
      },
    };

    try {
      const [hidden, setHidden] = createSignal(false);
      const { getByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/main/pause-on-hide.mp4"
          hidden={hidden()}
          testId="video-pause-on-hide"
        />
      ));

      const iframe = getByTestId('video-pause-on-hide') as HTMLIFrameElement;
      const frameId = new URL(iframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';
      const postMessageSpy = vi.fn<(message: unknown, targetOrigin: string) => void>();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        configurable: true,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: extensionOrigin,
          data: { type: 'ghvp:frame-ready', frameId },
        }),
      );

      await waitFor(() => {
        expect(postMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'ghvp:load-video', frameId }),
          extensionOrigin,
        );
      });

      setHidden(true);
      flush();

      expect(postMessageSpy).toHaveBeenCalledWith({ type: 'ghvp:pause', frameId }, extensionOrigin);
    } finally {
      fetchSpy.mockRestore();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });
});

const STREAM_ORIGIN = 'chrome-extension://test-extension-id';
const LATER_RANGE = `bytes=${DEFAULT_STREAM_CHUNK_BYTES}-${DEFAULT_STREAM_CHUNK_BYTES + 3}`;

interface StreamHarness {
  frameId: string;
  postMessageSpy: ReturnType<typeof vi.fn>;
  ports: MessagePort[];
  fetchSpy: ReturnType<typeof vi.spyOn>;
  sendFrameReady: () => void;
  requestRange: (
    requestId: string,
    start: number,
    end: number,
  ) => Promise<{ ok: boolean; buffer?: ArrayBuffer }>;
  restore: () => void;
}

/**
 * 1MB 以上の動画を SW ストリーミングで初期化した状態を用意する。
 * laterRange は先頭チャンク以降の Range 取得に対する応答を差し替える。
 */
async function setupStreamingFrame(
  laterRange: (init: RequestInit | undefined) => Promise<Response>,
): Promise<StreamHarness> {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });

  const firstChunk = new Uint8Array(DEFAULT_STREAM_CHUNK_BYTES);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    if (init?.method === 'HEAD') {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': String(DEFAULT_STREAM_CHUNK_BYTES * 2),
            'content-type': 'video/mp4',
          },
        }),
      );
    }
    const range = (init?.headers as Record<string, string> | undefined)?.['Range'];
    if (range === LATER_RANGE) return laterRange(init);
    return Promise.resolve(new Response(firstChunk.buffer.slice(0), { status: 206 }));
  });

  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: 'test-extension-id', getURL: (path: string) => `${STREAM_ORIGIN}${path}` },
  };

  const { getByTestId, unmount } = render(() => (
    <VideoFrame src="https://github.com/octocat/hello/raw/main/large.mp4" testId="video-stream" />
  ));
  const iframe = getByTestId('video-stream') as HTMLIFrameElement;
  const frameId = new URL(iframe.getAttribute('src') ?? '').searchParams.get('frameId') ?? '';

  const ports: MessagePort[] = [];
  const postMessageSpy = vi.fn((message: unknown, _origin: string, transfer?: Transferable[]) => {
    if ((message as { type?: string }).type === 'ghvp:init-stream' && transfer?.[0]) {
      ports.push(transfer[0] as MessagePort);
    }
  });
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage: postMessageSpy },
    configurable: true,
  });

  const sendFrameReady = () =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: STREAM_ORIGIN,
        data: { type: 'ghvp:frame-ready', frameId },
      }),
    );
  sendFrameReady();
  await waitFor(() => expect(ports.length).toBe(1));

  const requestRange = (requestId: string, start: number, end: number) =>
    new Promise<{ ok: boolean; buffer?: ArrayBuffer }>((resolve) => {
      const port = ports[ports.length - 1]!;
      port.addEventListener('message', (e) => {
        const data = e.data as { requestId?: string; ok: boolean; buffer?: ArrayBuffer };
        if (data.requestId === requestId) resolve(data);
      });
      port.start();
      port.postMessage({ type: 'ghvp:range-request', requestId, start, end });
    });

  return {
    frameId,
    postMessageSpy,
    ports,
    fetchSpy,
    sendFrameReady,
    requestRange,
    restore: () => {
      unmount();
      fetchSpy.mockRestore();
      if (originalNavigatorDesc) {
        Object.defineProperty(navigator, 'serviceWorker', originalNavigatorDesc);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    },
  };
}

describe('VideoFrame streaming resilience', () => {
  it('re-sends stream init with a fresh streamId when the iframe reloads during streaming', async () => {
    const harness = await setupStreamingFrame(() => new Promise<Response>(() => {}));
    try {
      harness.sendFrameReady();

      await waitFor(() => expect(harness.ports.length).toBe(2));
      const inits = harness.postMessageSpy.mock.calls
        .map(([message]) => message as { type?: string; streamId?: string })
        .filter((message) => message.type === 'ghvp:init-stream');
      expect(inits).toHaveLength(2);
      expect(inits[1]!.streamId).not.toBe(inits[0]!.streamId);
    } finally {
      harness.restore();
    }
  });

  it('aborts the upstream range fetch when the Service Worker cancels the request', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const harness = await setupStreamingFrame((init) => {
      upstreamSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    try {
      void harness.requestRange(
        'r-cancel',
        DEFAULT_STREAM_CHUNK_BYTES,
        DEFAULT_STREAM_CHUNK_BYTES + 3,
      );
      await waitFor(() => expect(upstreamSignal).toBeDefined());

      harness.ports[0]!.postMessage({ type: 'ghvp:range-cancel', requestId: 'r-cancel' });

      await waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
    } finally {
      harness.restore();
    }
  });

  it('retries an upstream range fetch once after a transient network error', async () => {
    let attempts = 0;
    const harness = await setupStreamingFrame(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('network error'));
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 206 }));
    });
    try {
      const response = await harness.requestRange(
        'r-retry',
        DEFAULT_STREAM_CHUNK_BYTES,
        DEFAULT_STREAM_CHUNK_BYTES + 3,
      );

      expect(response.ok).toBe(true);
      expect(response.buffer?.byteLength).toBe(4);
      expect(attempts).toBe(2);
    } finally {
      harness.restore();
    }
  });

  it('keeps a hidden lazy iframe loaded even when the observer reports it offscreen', async () => {
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 })),
      );
    const callbacksByMargin = new Map<string, IntersectionObserverCallback>();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          callbacksByMargin.set(options?.rootMargin ?? '', callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { id: 'test-extension-id', getURL: (path: string) => `${STREAM_ORIGIN}${path}` },
    };

    try {
      const [hidden, setHidden] = createSignal(false);
      const { getByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/main/hidden-keep.mp4"
          lazy
          hidden={hidden()}
          testId="video-hidden-keep"
        />
      ));

      callbacksByMargin.get('200px')?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const iframe = getByTestId('video-hidden-keep');

      // display:none になった非表示タブは IntersectionObserver から常に画面外として報告される
      setHidden(true);
      flush();
      callbacksByMargin.get('1500px')?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      flush();

      expect(getByTestId('video-hidden-keep')).toBe(iframe);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });
});
