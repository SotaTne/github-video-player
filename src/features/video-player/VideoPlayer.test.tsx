import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import { VideoPlayer } from './VideoPlayer';

describe('VideoPlayer', () => {
  it('renders a single clean video without redundant toolbar or diff controls in blob mode', () => {
    const { getByTestId, queryByRole, queryByText } = render(() => (
      <VideoPlayer
        filePath="demo.mp4"
        rawUrl="https://github.com/octocat/hello/raw/main/demo.mp4"
        mode="blob"
      />
    ));

    const player = getByTestId('ghvp-player');
    expect(player.tagName).toBe('ARTICLE');
    expect(queryByRole('group', { name: '動画の比較表示モード' })).toBeNull();
    expect(queryByText('Raw ↗')).toBeNull();

    const video = getByTestId('ghvp-video-after');
    expect(video.getAttribute('src')).toBe('https://github.com/octocat/hello/raw/main/demo.mp4');
    expect(video.hasAttribute('loading')).toBe(false);
  });

  it('switches between After, Before, and 2-Side comparison views in diff mode without duplicate badges', () => {
    const { getByRole, getByTestId, queryByTestId, getAllByText } = render(() => (
      <VideoPlayer
        filePath="assets/demo.mp4"
        rawUrl="https://github.com/octocat/hello/raw/head/assets/demo.mp4"
        beforeRawUrl="https://github.com/octocat/hello/raw/base/assets/demo.mp4"
        mode="diff"
      />
    ));

    // 初期状態では After のみが表示され、二重ラベルは出ない
    const afterVideo = getByTestId('ghvp-video-after');
    expect(afterVideo.getAttribute('loading')).toBe('lazy');
    expect(afterVideo.closest('[aria-hidden="true"]')).toBeNull();
    expect(queryByTestId('ghvp-video-before')).toBeNull();
    expect(getAllByText('After')).toHaveLength(1);

    // Before に切り替えると After は DOM 上に保持したまま非表示になり、Before にも二重ラベルを出さない
    fireEvent.click(getByRole('button', { name: 'Before' }));
    flush();
    expect(getByTestId('ghvp-video-before').getAttribute('loading')).toBe('lazy');
    expect(getByTestId('ghvp-video-after').closest('[aria-hidden="true"]')).toBeTruthy();
    expect(getAllByText('Before')).toHaveLength(1);

    // 2-Side に切り替えると両方が表示され、それぞれに Before / After ラベルが付く
    fireEvent.click(getByRole('button', { name: '2-Side' }));
    flush();
    expect(getByTestId('ghvp-video-before')).toBeTruthy();
    expect(getByTestId('ghvp-video-after').closest('[aria-hidden="true"]')).toBeNull();
    expect(getAllByText('Before')).toHaveLength(2);
    expect(getAllByText('After')).toHaveLength(2);
  });

  it('updates dimensions independently for Before and After videos in 2-Side view', () => {
    const { getByRole, getByTestId, queryAllByTestId } = render(() => (
      <VideoPlayer
        filePath="assets/demo.mp4"
        rawUrl="https://github.com/octocat/hello/raw/head/assets/demo.mp4"
        beforeRawUrl="https://github.com/octocat/hello/raw/base/assets/demo.mp4"
        mode="diff"
      />
    ));

    fireEvent.click(getByRole('button', { name: '2-Side' }));
    flush();

    const beforeVideo = getByTestId('ghvp-video-before') as HTMLVideoElement;
    Object.defineProperty(beforeVideo, 'videoWidth', { value: 1280, configurable: true });
    Object.defineProperty(beforeVideo, 'videoHeight', { value: 720, configurable: true });
    Object.defineProperty(beforeVideo, 'duration', { value: 8, configurable: true });
    fireEvent(beforeVideo, new Event('loadedmetadata'));
    flush();

    const afterVideo = getByTestId('ghvp-video-after') as HTMLVideoElement;
    Object.defineProperty(afterVideo, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(afterVideo, 'videoHeight', { value: 1080, configurable: true });
    Object.defineProperty(afterVideo, 'duration', { value: 15, configurable: true });
    fireEvent(afterVideo, new Event('loadedmetadata'));
    flush();

    expect(beforeVideo.getAttribute('width')).toBe('1280');
    expect(beforeVideo.getAttribute('height')).toBe('720');
    expect(afterVideo.getAttribute('width')).toBe('1920');
    expect(afterVideo.getAttribute('height')).toBe('1080');
    expect(queryAllByTestId('ghvp-metadata')).toHaveLength(0);
  });

  it('falls back to After view without unmounting or re-fetching After when Before fails to load', () => {
    const { getByRole, getByTestId, queryByRole } = render(() => (
      <VideoPlayer
        filePath="assets/demo.mp4"
        rawUrl="https://github.com/octocat/hello/raw/head/assets/demo.mp4"
        beforeRawUrl="https://github.com/octocat/hello/raw/base/assets/demo.mp4"
        mode="diff"
      />
    ));

    const initialAfterEl = getByTestId('ghvp-video-after');

    fireEvent.click(getByRole('button', { name: 'Before' }));
    flush();
    fireEvent(getByTestId('ghvp-video-before'), new Event('error'));
    flush();

    expect(queryByRole('group', { name: '動画の比較表示モード' })).toBeNull();
    const afterElAfterFallback = getByTestId('ghvp-video-after');
    expect(afterElAfterFallback).toBe(initialAfterEl);
    expect(afterElAfterFallback.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('reuses fetched Blob across After/Before tab switches without re-fetching', async () => {
    const extensionOrigin = 'chrome-extension://test-extension-id';
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const sampleBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(sampleBytes.slice(0), { status: 200 })),
      );

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private callback: IntersectionObserverCallback) {}
        observe = () => {
          this.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        };
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
      const { getByRole, getByTestId } = render(() => (
        <VideoPlayer
          filePath="assets/demo.mp4"
          rawUrl="https://github.com/octocat/hello/raw/head/assets/demo.mp4"
          beforeRawUrl="https://github.com/octocat/hello/raw/base/assets/demo.mp4"
          mode="diff"
        />
      ));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          'https://github.com/octocat/hello/raw/head/assets/demo.mp4',
          expect.objectContaining({ credentials: 'same-origin' }),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Before タブへ切り替え、その後 After タブへ戻す
      fireEvent.click(getByRole('button', { name: 'Before' }));
      flush();
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          'https://github.com/octocat/hello/raw/base/assets/demo.mp4',
          expect.objectContaining({ credentials: 'same-origin' }),
        );
      });

      fireEvent.click(getByRole('button', { name: 'After' }));
      flush();
      const afterIframe = getByTestId('ghvp-video-after') as HTMLIFrameElement;
      expect(afterIframe.closest('[aria-hidden="true"]')).toBeNull();

      const afterFetchCount = fetchSpy.mock.calls.filter(
        ([url]) => url === 'https://github.com/octocat/hello/raw/head/assets/demo.mp4',
      ).length;
      expect(afterFetchCount).toBe(1);
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });
});
