import { describe, it, expect } from 'vitest';
import {
  getVideoExtension,
  getVideoMimeType,
  isVideoFile,
  toGitHubRawUrl,
  parseGitHubBlobUrl,
} from './url';

describe('github-detector/url', () => {
  describe('getVideoExtension & isVideoFile', () => {
    it('detects supported video extensions regardless of case or query params', () => {
      expect(getVideoExtension('assets/demo.mp4')).toBe('mp4');
      expect(getVideoExtension('https://github.com/org/repo/blob/main/clip.WEBM?raw=true')).toBe(
        'webm',
      );
      expect(getVideoExtension('recording.mov#L10')).toBe('mov');
      expect(isVideoFile('preview.m4v')).toBe(true);
      expect(isVideoFile('video.ogv')).toBe(true);
      expect(isVideoFile('audio-or-video.ogg')).toBe(true);
    });

    it('rejects non-video binary and text files', () => {
      expect(getVideoExtension('archive.zip')).toBeNull();
      expect(getVideoExtension('image.png')).toBeNull();
      expect(getVideoExtension('README.md')).toBeNull();
      expect(isVideoFile('src/index.ts')).toBe(false);
      expect(isVideoFile('')).toBe(false);
    });

    it('resolves appropriate MIME types from video paths and URLs', () => {
      expect(getVideoMimeType('video.webm?token=abc')).toBe('video/webm');
      expect(getVideoMimeType('clip.MP4')).toBe('video/mp4');
      expect(getVideoMimeType('screen.mov')).toBe('video/quicktime');
      expect(getVideoMimeType('clip.ogv')).toBe('video/ogg');
    });
  });

  describe('toGitHubRawUrl', () => {
    it('converts GitHub blob URLs into raw URLs', () => {
      expect(toGitHubRawUrl('https://github.com/octocat/hello/blob/main/docs/demo.mp4')).toBe(
        'https://github.com/octocat/hello/raw/main/docs/demo.mp4',
      );
    });

    it('strips ?raw=true when converting blob URL', () => {
      expect(
        toGitHubRawUrl('https://github.com/octocat/hello/blob/main/docs/demo.mp4?raw=true'),
      ).toBe('https://github.com/octocat/hello/raw/main/docs/demo.mp4');
    });

    it('preserves existing raw URLs', () => {
      expect(toGitHubRawUrl('https://github.com/octocat/hello/raw/main/docs/demo.webm')).toBe(
        'https://github.com/octocat/hello/raw/main/docs/demo.webm',
      );
    });
  });

  describe('parseGitHubBlobUrl', () => {
    it('parses valid video blob URLs', () => {
      expect(
        parseGitHubBlobUrl('https://github.com/octocat/hello/blob/main/e2e/result.mp4'),
      ).toEqual({
        owner: 'octocat',
        repo: 'hello',
        refAndPath: 'main/e2e/result.mp4',
        rawUrl: 'https://github.com/octocat/hello/raw/main/e2e/result.mp4',
      });
    });

    it('returns null for non-video blob URLs', () => {
      expect(parseGitHubBlobUrl('https://github.com/octocat/hello/blob/main/README.md')).toBeNull();
    });
  });
});
