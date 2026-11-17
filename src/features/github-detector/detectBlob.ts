import { findRawUrlInElement, isUnmounted } from './dom';
import { parseGitHubBlobUrl } from './url';
import type { VideoMountTarget } from './index';

const BLOB_CONTAINER_SELECTORS = [
  '[data-testid="file-size-too-large"]',
  'section[aria-labelledby*="file-name-id"]',
  '[data-testid="blob-viewer-file-content"]',
  '.Box-body.blob-wrapper',
  '.blob-wrapper',
] as const;

/**
 * GitHub の単体ファイル（Blob）ページから動画マウント対象を検出する。
 */
export function detectBlobTargets(
  doc: Document,
  currentUrl: string,
  origin: string,
): VideoMountTarget[] {
  const blobInfo = parseGitHubBlobUrl(currentUrl);
  if (!blobInfo) return [];

  const container = BLOB_CONTAINER_SELECTORS.map((selector) =>
    doc.querySelector<HTMLElement>(selector),
  ).find((el): el is HTMLElement => el !== null);

  const rawUrl = findRawUrlInElement(doc, blobInfo.rawUrl, origin) ?? blobInfo.rawUrl;
  if (!isUnmounted(container, rawUrl)) return [];

  return [
    {
      id: `blob:${blobInfo.refAndPath}`,
      type: 'blob',
      filePath: blobInfo.refAndPath.split('/').pop() || blobInfo.refAndPath,
      rawUrl,
      container,
    },
  ];
}
