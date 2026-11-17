import { detectBlobTargets } from './detectBlob';
import { detectDiffTargets } from './detectDiff';
import { isSupportedGitHubVideoPage } from './url';

export interface VideoMountTarget {
  id: string;
  type: 'blob' | 'diff';
  filePath: string;
  rawUrl: string;
  beforeRawUrl?: string;
  container: HTMLElement;
}

export {
  getVideoExtension,
  getVideoMimeType,
  isSupportedGitHubVideoPage,
  isVideoFile,
  toGitHubRawUrl,
  parseGitHubBlobUrl,
} from './url';
export {
  MOUNTED_ATTR,
  isUnmounted,
  markMounted,
  polishGitHubBlobPage,
  polishGitHubDiffContainer,
  polishMountedDiffContainers,
} from './dom';

/**
 * 現在の GitHub ドキュメントを走査し、未マウントの動画 Blob 表示や Diff エントリを検出する。
 */
export function detectVideoTargets(doc: Document, currentUrl: string): VideoMountTarget[] {
  if (!isSupportedGitHubVideoPage(currentUrl)) return [];

  const origin = (() => {
    try {
      return new URL(currentUrl).origin;
    } catch {
      return 'https://github.com';
    }
  })();

  return [
    ...detectBlobTargets(doc, currentUrl, origin),
    ...detectDiffTargets(doc, origin, currentUrl),
  ];
}
