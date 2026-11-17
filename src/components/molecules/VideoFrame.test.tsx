import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@solidjs/testing-library';
import { flush } from 'solid-js';
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

  it('uses isolated extension iframe even in lazy diff mode and updates aspect ratio via postMessage', async () => {
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
      const { getByTestId, queryByTestId } = render(() => (
        <VideoFrame
          src="https://github.com/octocat/hello/raw/develop/video.webm"
          lazy
          testId="video-iframe"
        />
      ));

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
            mimeType: 'video/webm',
          }),
          extensionOrigin,
          expect.any(Array),
        );
      });

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
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });
});
