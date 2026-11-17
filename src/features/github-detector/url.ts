/**
 * モダンな Chromium / Firefox ブラウザでネイティブ再生可能な動画拡張子一覧。
 */
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'ogg'] as const;

export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number];

const VIDEO_MIME_TYPES: Record<VideoExtension, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
};

/**
 * 対応する動画フォーマットと一致する場合に小文字の拡張子を返す。
 */
export function getVideoExtension(pathOrUrl: string): VideoExtension | null {
  if (!pathOrUrl) return null;

  const cleanPath = (pathOrUrl.split(/[?#]/)[0] ?? '').trim();
  const lastDotIndex = cleanPath.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === cleanPath.length - 1) {
    return null;
  }

  const ext = cleanPath.slice(lastDotIndex + 1).toLowerCase();
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext) ? (ext as VideoExtension) : null;
}

/**
 * 拡張子から動画再生に適切な MIME タイプを返す。
 */
export function getVideoMimeType(pathOrUrl: string): string {
  const ext = getVideoExtension(pathOrUrl);
  return ext ? VIDEO_MIME_TYPES[ext] : 'video/mp4';
}

/**
 * ファイルパスまたは URL が対応する動画ファイルかどうかを判定する。
 */
export function isVideoFile(pathOrUrl: string): boolean {
  return getVideoExtension(pathOrUrl) !== null;
}

/**
 * GitHub の Blob URL を <video> でストリーミング再生できる Raw URL へ変換する。
 */
export function toGitHubRawUrl(url: string, origin = 'https://github.com'): string {
  if (!url) return url;

  let resolved: URL;
  try {
    resolved = new URL(url, origin);
  } catch {
    return url;
  }

  if (
    resolved.hostname === 'raw.githubusercontent.com' ||
    resolved.hostname === 'media.githubusercontent.com'
  ) {
    return resolved.toString();
  }

  const blobMatch = resolved.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (blobMatch) {
    const [, owner, repo, rest] = blobMatch;
    resolved.pathname = `/${owner}/${repo}/raw/${rest}`;
    resolved.searchParams.delete('raw');
    return resolved.toString();
  }

  return resolved.toString();
}

export interface ParsedBlobUrl {
  owner: string;
  repo: string;
  refAndPath: string;
  rawUrl: string;
}

/**
 * 動画ファイルを指す GitHub Blob ページの URL を解析する。
 */
export function parseGitHubBlobUrl(url: string): ParsedBlobUrl | null {
  try {
    const parsed = new URL(url, 'https://github.com');
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (!match) return null;

    const [, owner, repo, refAndPath] = match;
    if (!owner || !repo || !refAndPath || !isVideoFile(refAndPath)) return null;

    return {
      owner,
      repo,
      refAndPath: decodeURIComponent(refAndPath),
      rawUrl: `${parsed.origin}/${owner}/${repo}/raw/${refAndPath}`,
    };
  } catch {
    return null;
  }
}

/**
 * 動画の Blob 表示または PR / Commit / Compare Diff を含みうる GitHub ページかを判定する。
 */
export function isSupportedGitHubVideoPage(url: string): boolean {
  if (parseGitHubBlobUrl(url) !== null) return true;
  try {
    const parsed = new URL(url, 'https://github.com');
    return /^\/[^/]+\/[^/]+\/(pull|commit|compare)(\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}
