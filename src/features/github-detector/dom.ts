import { toGitHubRawUrl } from './url';

export const MOUNTED_ATTR = 'data-ghvp-mounted';

export interface PrComparisonShas {
  owner?: string;
  repo?: string;
  baseSha?: string;
  headSha?: string;
}

/**
 * 要素が存在し、かつ現在マウント処理中または有効なプレイヤーがマウント済みでないことを判定する型ガード。
 */
export function isUnmounted(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  const mountedState = el.getAttribute(MOUNTED_ATTR);
  if (!mountedState) return true;
  if (mountedState === 'mounting') return false;
  return !el.querySelector('github-video-player, [data-ghvp-host]');
}

/**
 * 非同期のマウント待機中に二重マウントされるのを防ぐため、要素にマウント中属性を付与する。
 */
export function markMounting(el: HTMLElement): void {
  el.setAttribute(MOUNTED_ATTR, 'mounting');
}

/**
 * 繰り返しの DOM スキャン対象から外すため、要素にマウント済み属性を付与する。
 */
export function markMounted(el: HTMLElement): void {
  el.setAttribute(MOUNTED_ATTR, 'true');
}

/**
 * 要素内から Raw 動画リンクを探し、見つからない場合はフォールバック URL から生成する。
 */
export function findRawUrlInElement(
  root: ParentNode,
  fallbackUrl?: string,
  origin = 'https://github.com',
): string | null {
  const rawLink = root.querySelector<HTMLAnchorElement>(
    'a[data-testid="raw-button"], a#raw-url, a[href*="/raw/"], a[href*="?raw=true"], a[href*="&raw=true"]',
  );

  const href = rawLink?.getAttribute('href');
  if (href) {
    return toGitHubRawUrl(href, origin);
  }

  return fallbackUrl ? toGitHubRawUrl(fallbackUrl, origin) : null;
}

function hideNonPlayerChildren(container: HTMLElement): void {
  for (const child of Array.from(container.children)) {
    if (
      child instanceof HTMLElement &&
      !child.hasAttribute('data-ghvp-host') &&
      child.tagName.toLowerCase() !== 'github-video-player'
    ) {
      child.style.display = 'none';
    }
  }
}

/**
 * Blob 画面の不要なテキスト向け UI（Code/Blame・Raw・Copy・View raw 等）を非表示にし、
 * 画像ビューアと同様にサイズ表示とダウンロードボタン・動画プレイヤーのみへ整理する。
 */
export function polishGitHubBlobPage(doc: Document, container: HTMLElement): void {
  hideNonPlayerChildren(container);

  if (container.getAttribute('data-testid') === 'file-size-too-large') {
    container.style.padding = '16px';
    container.style.width = '100%';
    container.style.boxSizing = 'border-box';
  }

  const fileViewTabs = doc.querySelector<HTMLElement>('ul[aria-label="File view"]');
  if (fileViewTabs) {
    fileViewTabs.style.display = 'none';
  }

  const rawButton = doc.querySelector<HTMLElement>('[data-testid="raw-button"]');
  if (rawButton) {
    rawButton.style.display = 'none';
  }

  const copyButton = doc.querySelector<HTMLElement>('[data-testid="copy-raw-button"]');
  if (copyButton) {
    copyButton.style.display = 'none';
  }

  const downloadButton = doc.querySelector<HTMLElement>('[data-testid="download-raw-button"]');
  if (downloadButton) {
    downloadButton.style.borderRadius = '6px';
  }
}

/**
 * PR / Commit Diff のバイナリ表示エリアから既存のプレースホルダーテキスト等を除去する。
 */
export function polishGitHubDiffContainer(container: HTMLElement): void {
  if (container.getAttribute('translate') !== 'no') {
    container.setAttribute('translate', 'no');
  }
  if (!container.classList.contains('notranslate')) {
    container.classList.add('notranslate');
  }

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      node.remove();
    }
  }
  hideNonPlayerChildren(container);
}

/**
 * マウント済みの Diff コンテナに対し、非同期描画や Chrome 翻訳で後から挿入されたテキスト・要素を除去する。
 */
export function polishMountedDiffContainers(doc: Document): void {
  const mountedContainers = doc.querySelectorAll<HTMLElement>(
    `[data-diff-anchor][${MOUNTED_ATTR}], .js-file-content[${MOUNTED_ATTR}], .data[${MOUNTED_ATTR}]`,
  );
  for (const container of mountedContainers) {
    polishGitHubDiffContainer(container);
  }
}

function isOwnPlayerHostNode(node: Node): boolean {
  return (
    node instanceof HTMLElement &&
    (node.tagName.toLowerCase() === 'github-video-player' || node.hasAttribute('data-ghvp-host'))
  );
}

/**
 * MutationObserver の変更群に、動画検出やマウント済みコンテナの清掃が必要な要素追加が含まれるかを判定する。
 */
export function hasRelevantDomMutation(
  mutations: ReadonlyArray<{
    type: MutationRecord['type'];
    target: Node;
    addedNodes: ArrayLike<Node>;
  }>,
): boolean {
  for (const mutation of mutations) {
    if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;

    const targetIsMounted =
      mutation.target instanceof HTMLElement && mutation.target.hasAttribute(MOUNTED_ATTR);

    for (const node of Array.from(mutation.addedNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && !isOwnPlayerHostNode(node)) {
        return true;
      }
      if (targetIsMounted && node.nodeType === Node.TEXT_NODE) {
        return true;
      }
    }
  }
  return false;
}

function parsePathname(urlOrPath: string): string {
  try {
    return new URL(urlOrPath, 'https://github.com').pathname;
  } catch {
    return urlOrPath;
  }
}

function extractCommitComparisonShas(
  doc: Document,
  owner: string,
  repo: string,
  pathname: string,
): { baseSha?: string; headSha?: string } {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== owner || parts[1] !== repo || parts[2] !== 'commit' || !parts[3]) {
    return {};
  }

  const headSha = parts[3];
  const commitLinks = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>(`a[href*="/${owner}/${repo}/commit/"]`),
  );

  for (const link of commitLinks) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const linkParts = parsePathname(href).split('/').filter(Boolean);
    if (
      linkParts[0] === owner &&
      linkParts[1] === repo &&
      linkParts[2] === 'commit' &&
      linkParts[3] &&
      linkParts[3] !== headSha
    ) {
      return { baseSha: linkParts[3], headSha };
    }
  }

  return { headSha };
}

function extractBranchRefFromElement(el: Element): string | undefined {
  const href = el.getAttribute('href');
  if (href) {
    const linkPath = parsePathname(href);
    const treeMarker = '/tree/';
    const markerIndex = linkPath.indexOf(treeMarker);
    if (markerIndex !== -1) {
      const rawRef = linkPath.slice(markerIndex + treeMarker.length).replace(/\/$/, '');
      if (rawRef) {
        try {
          return decodeURIComponent(rawRef);
        } catch {
          return rawRef;
        }
      }
    }
  }

  const textRef = el.textContent?.trim();
  return textRef || undefined;
}

function extractBranchBadgeRefs(doc: Document): { baseSha?: string; headSha?: string } {
  const refs: string[] = [];

  for (const badge of doc.querySelectorAll('a[data-component="BranchName"], .commit-ref a')) {
    const ref = extractBranchRefFromElement(badge);
    if (ref && !refs.includes(ref)) {
      refs.push(ref);
      if (refs.length === 2) break;
    }
  }

  if (refs.length >= 2) {
    return { baseSha: refs[0], headSha: refs[1] };
  }
  return {};
}

function scanJsonForPrRefs(
  node: unknown,
  found: { baseOid?: string; headOid?: string; baseName?: string; headName?: string },
  depth = 0,
): void {
  if (depth > 6 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) {
      scanJsonForPrRefs(item, found, depth + 1);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  const pickString = (key: string): string | undefined => {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  found.baseOid ??= pickString('baseRefOid');
  found.headOid ??= pickString('headRefOid');
  found.baseName ??= pickString('baseRefName');
  found.headName ??= pickString('headRefName');

  if (found.baseOid && found.headOid) return;

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      scanJsonForPrRefs(value, found, depth + 1);
    }
  }
}

function extractEmbeddedPrRefs(doc: Document): { baseSha?: string; headSha?: string } {
  const found: { baseOid?: string; headOid?: string; baseName?: string; headName?: string } = {};

  for (const script of doc.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
    const text = script.textContent?.trim();
    if (!text) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      scanJsonForPrRefs(parsed, found);
    } catch {
      continue;
    }
  }

  return {
    baseSha: found.baseOid ?? found.baseName,
    headSha: found.headOid ?? found.headName,
  };
}

function extractTreeBranchRefs(
  doc: Document,
  owner: string,
  repo: string,
): { baseSha?: string; headSha?: string } {
  const prefix = `/${owner}/${repo}/tree/`;
  const refs: string[] = [];

  for (const link of doc.querySelectorAll<HTMLAnchorElement>(`a[href*="${prefix}"]`)) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const linkPath = parsePathname(href);
    if (!linkPath.startsWith(prefix)) continue;

    const ref = linkPath.slice(prefix.length).replace(/\/$/, '');
    if (ref && !refs.includes(ref)) {
      refs.push(ref);
      if (refs.length === 2) break;
    }
  }

  if (refs.length >= 2) {
    return { baseSha: refs[0], headSha: refs[1] };
  }
  return {};
}

/**
 * GitHub の PR / Commit Diff ページからリポジトリ情報と比較対象（Base / Head）の Ref・SHA を抽出する。
 */
export function extractPrComparisonShas(doc: Document, currentUrl?: string): PrComparisonShas {
  const pathname = currentUrl ? parsePathname(currentUrl) : (doc.location?.pathname ?? '');
  const pathParts = pathname.split('/').filter(Boolean);
  const owner = pathParts[0];
  const repo = pathParts[1];

  let baseSha =
    doc.querySelector<HTMLInputElement>('input[name="comparison_start_oid"]')?.value || undefined;
  let headSha =
    doc.querySelector<HTMLInputElement>('input[name="comparison_end_oid"]')?.value || undefined;

  if (owner && repo && (!baseSha || !headSha)) {
    const commitShas = extractCommitComparisonShas(doc, owner, repo, pathname);
    baseSha ??= commitShas.baseSha;
    headSha ??= commitShas.headSha;
  }

  if (owner && repo && (!baseSha || !headSha) && pathParts[2] !== 'commit') {
    const badgeRefs = extractBranchBadgeRefs(doc);
    baseSha ??= badgeRefs.baseSha;
    headSha ??= badgeRefs.headSha;

    if (!baseSha || !headSha) {
      const embeddedRefs = extractEmbeddedPrRefs(doc);
      baseSha ??= embeddedRefs.baseSha;
      headSha ??= embeddedRefs.headSha;
    }

    if (!baseSha || !headSha) {
      const treeRefs = extractTreeBranchRefs(doc, owner, repo);
      baseSha ??= treeRefs.baseSha;
      headSha ??= treeRefs.headSha;
    }
  }

  return { owner, repo, baseSha, headSha };
}
