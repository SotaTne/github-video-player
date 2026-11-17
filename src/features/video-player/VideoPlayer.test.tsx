import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
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

  it('switches between After, Before, and Split comparison views in diff mode', () => {
    const { getByRole, getByTestId, queryByTestId } = render(() => (
      <VideoPlayer
        filePath="assets/demo.mp4"
        rawUrl="https://github.com/octocat/hello/raw/head/assets/demo.mp4"
        beforeRawUrl="https://github.com/octocat/hello/raw/base/assets/demo.mp4"
        mode="diff"
      />
    ));

    // 初期状態では変更後 (After) のみが loading="lazy" で描画される
    const afterVideo = getByTestId('ghvp-video-after');
    expect(afterVideo.getAttribute('loading')).toBe('lazy');
    expect(queryByTestId('ghvp-video-before')).toBeNull();

    // 変更前 (Before) に切り替える
    fireEvent.click(getByRole('button', { name: '変更前 (Before)' }));
    flush();
    expect(getByTestId('ghvp-video-before').getAttribute('loading')).toBe('lazy');
    expect(queryByTestId('ghvp-video-after')).toBeNull();

    // 並列比較 (Split) に切り替える
    fireEvent.click(getByRole('button', { name: '並列比較 (Split)' }));
    flush();
    expect(getByTestId('ghvp-video-before')).toBeTruthy();
    expect(getByTestId('ghvp-video-after')).toBeTruthy();
  });

  it('updates dimensions independently for Before and After videos in Split view', () => {
    const { getByRole, getByTestId, queryAllByTestId } = render(() => (
      <VideoPlayer
        filePath="assets/demo.mp4"
        rawUrl="https://github.com/octocat/hello/raw/head/assets/demo.mp4"
        beforeRawUrl="https://github.com/octocat/hello/raw/base/assets/demo.mp4"
        mode="diff"
      />
    ));

    fireEvent.click(getByRole('button', { name: '並列比較 (Split)' }));
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

  it('falls back to After view and hides comparison controls when Before fails to load', () => {
    const { getByRole, getByTestId, queryByRole } = render(() => (
      <VideoPlayer
        filePath="assets/demo.mp4"
        rawUrl="https://github.com/octocat/hello/raw/head/assets/demo.mp4"
        beforeRawUrl="https://github.com/octocat/hello/raw/base/assets/demo.mp4"
        mode="diff"
      />
    ));

    fireEvent.click(getByRole('button', { name: '変更前 (Before)' }));
    flush();
    fireEvent(getByTestId('ghvp-video-before'), new Event('error'));
    flush();

    expect(queryByRole('group', { name: '動画の比較表示モード' })).toBeNull();
    expect(getByTestId('ghvp-video-after')).toBeTruthy();
  });
});
