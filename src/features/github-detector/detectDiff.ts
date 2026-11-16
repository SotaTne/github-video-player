import {
  extractPrComparisonShas,
  findRawUrlInElement,
  isUnmounted,
  type PrComparisonShas,
} from './dom';
import { isVideoFile, toGitHubRawUrl } from './url';
import type { VideoMountTarget } from './index';

const DIFF_BLOCK_SELECTOR =
  '.file.js-file, [data-testid="file-diff-container"], div[id^="diff-"]:not(#diff-comparison-viewer-container), div.file[data-tagsearch-path]';

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildRawUrl(
  origin: string,
  owner: string,
  repo: string,
  refOrSha: string,
  filePath: string,
): string {
  return `${origin}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${encodePathSegments(refOrSha)}/${encodePathSegments(filePath)}`;
}

function findCommitBlockForAnchor(anchorEl: HTMLElement, anchorId: string): HTMLElement | null {
  let current: HTMLElement | null = anchorEl.parentElement;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current.id === 'diff-comparison-viewer-container') break;
    if (current.querySelector(`[data-diff-header-wrapper], a[href="#${CSS.escape(anchorId)}"]`)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function collectDiffBlocks(doc: Document): HTMLElement[] {
  const blocks = new Set<HTMLElement>(doc.querySelectorAll<HTMLElement>(DIFF_BLOCK_SELECTOR));

  for (const anchorEl of doc.querySelectorAll<HTMLElement>('[data-diff-anchor^="diff-"]')) {
    const anchorId = anchorEl.getAttribute('data-diff-anchor');
    if (!anchorId) continue;

    const alreadyContained = Array.from(blocks).some((block) => block.contains(anchorEl));
    if (alreadyContained) continue;

    const block = findCommitBlockForAnchor(anchorEl, anchorId);
    if (block) {
      blocks.add(block);
    }
  }

  return Array.from(blocks);
}

function extractDiffFilePath(fileEl: HTMLElement): string {
  const headerWithPath = fileEl.querySelector<HTMLElement>('[data-path]');
  const primaryLink = fileEl.querySelector<HTMLAnchorElement>(
    'h3 a[href^="#diff-"], .file-info a.Link--primary, [data-testid="file-name-link"], a.Link--primary[href^="#diff-"], a[title]',
  );

  const linkCodeText = primaryLink?.querySelector('code')?.textContent?.trim();
  const rawPath = (
    fileEl.getAttribute('data-file-path') ||
    fileEl.getAttribute('data-tagsearch-path') ||
    headerWithPath?.getAttribute('data-path') ||
    linkCodeText ||
    primaryLink?.getAttribute('title') ||
    primaryLink?.textContent?.trim() ||
    ''
  ).replace(/[\u200B-\u200F\uFEFF]/g, '');

  const renamedParts = rawPath.split('→').map((part) => part.trim());
  return renamedParts[renamedParts.length - 1] || '';
}

function resolveDiffContentArea(fileEl: HTMLElement): HTMLElement | null {
  const contentArea =
    fileEl.querySelector<HTMLElement>('[data-diff-anchor]') ??
    fileEl.querySelector<HTMLElement>('.js-file-content') ??
    fileEl.querySelector<HTMLElement>('.data');

  if (!contentArea || contentArea.closest('[hidden]') || !isUnmounted(contentArea)) {
    return null;
  }

  return contentArea;
}

function resolveDiffRawUrls(
  fileEl: HTMLElement,
  filePath: string,
  shas: PrComparisonShas,
  origin: string,
): { rawUrl: string; beforeRawUrl?: string } | null {
  const { owner, repo, baseSha, headSha } = shas;

  let rawUrl = findRawUrlInElement(fileEl, undefined, origin);
  if (!rawUrl) {
    const viewFileHref = fileEl
      .querySelector<HTMLAnchorElement>('a[href*="/blob/"]')
      ?.getAttribute('href');
    if (viewFileHref) {
      rawUrl = toGitHubRawUrl(viewFileHref, origin);
    } else if (owner && repo && headSha) {
      rawUrl = buildRawUrl(origin, owner, repo, headSha, filePath);
    }
  }

  if (!rawUrl) return null;

  const isAdded =
    fileEl.getAttribute('data-file-type') === 'added' ||
    Boolean(fileEl.querySelector('[title="added"], .octicon-file-added, .octicon-diff-added')) ||
    (Boolean(fileEl.querySelector('code.fgColor-success')) &&
      !fileEl.querySelector('code.fgColor-danger'));

  let beforeRawUrl: string | undefined;
  if (!isAdded && owner && repo && baseSha && headSha && baseSha !== headSha) {
    const candidateBefore = buildRawUrl(origin, owner, repo, baseSha, filePath);
    if (candidateBefore !== rawUrl) {
      beforeRawUrl = candidateBefore;
    }
  }

  return { rawUrl, beforeRawUrl };
}

function toDiffMountTarget(
  fileEl: HTMLElement,
  index: number,
  shas: PrComparisonShas,
  origin: string,
): VideoMountTarget | null {
  if (!isUnmounted(fileEl)) return null;

  const filePath = extractDiffFilePath(fileEl);
  if (!filePath || !isVideoFile(filePath)) return null;

  const container = resolveDiffContentArea(fileEl);
  if (!container) return null;

  const urls = resolveDiffRawUrls(fileEl, filePath, shas, origin);
  if (!urls) return null;

  return {
    id: `diff:${filePath}:${index}`,
    type: 'diff',
    filePath,
    rawUrl: urls.rawUrl,
    beforeRawUrl: urls.beforeRawUrl,
    container,
  };
}

/**
 * GitHub の Pull Request / Commit ページから動画の差分エントリを検出する。
 */
export function detectDiffTargets(
  doc: Document,
  origin: string,
  currentUrl?: string,
): VideoMountTarget[] {
  const shas = extractPrComparisonShas(doc, currentUrl);
  return collectDiffBlocks(doc)
    .map((fileEl, index) => toDiffMountTarget(fileEl, index, shas, origin))
    .filter((target): target is VideoMountTarget => target !== null);
}
