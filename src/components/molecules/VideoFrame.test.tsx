import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal, flush } from 'solid-js';
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

    const chunkBytes = new Uint8Array([10, 20, 30, 40]).buffer;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      if (init?.method === 'HEAD') {
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: {
              'content-length': '4',
              'content-type': 'video/mp4',
            },
          }),
        );
      }
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.['Range']) {
        return Promise.resolve(new Response(chunkBytes.slice(0), { status: 206 }));
      }
      return Promise.resolve(new Response(chunkBytes.slice(0), { status: 200 }));
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
            totalSize: 4,
            contentType: 'video/mp4',
          }),
          extensionOrigin,
          expect.any(Array),
        );
      });

      // 転送された MessagePort へ Range 要求を送り、206 チャンクが返ることを検証
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
            start: 0,
            end: 3,
          },
          [],
        );
      });

      expect(rangeResponse.ok).toBe(true);
      expect(rangeResponse.buffer?.byteLength).toBe(4);

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
});
