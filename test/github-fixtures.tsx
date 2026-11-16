import { render } from 'solid-js/web';
import {
  MOUNTED_ATTR,
  markMounted,
  polishGitHubBlobPage,
  polishGitHubDiffContainer,
  type VideoMountTarget,
} from '../src/features/github-detector';
import { VideoPlayer } from '../src/features/video-player/VideoPlayer';

export type GitHubUiVariant = 'react' | 'classic';
export type DiffFileStatus = 'modified' | 'added' | 'deleted';

export interface GitHubBlobFixtureOptions {
  owner?: string;
  repo?: string;
  ref?: string;
  filePath: string;
  variant?: GitHubUiVariant;
  mounted?: boolean;
}

export interface GitHubDiffFileFixture {
  path: string;
  status?: DiffFileStatus;
  mounted?: boolean;
}

export interface GitHubPrDiffFixtureOptions {
  owner?: string;
  repo?: string;
  baseSha?: string;
  headSha?: string;
  variant?: GitHubUiVariant;
  includeViewFileMenu?: boolean;
  files: readonly GitHubDiffFileFixture[];
}

export interface GitHubPageHtmlOptions {
  theme?: 'dark' | 'light';
  title?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toDiffAnchorId(index: number): string {
  return `diff-mock-${index}`;
}

/**
 * 実際の GitHub DOM 構造に準拠した単体ファイル（Blob）ページの DOM 断片を生成する。
 */
export function createGitHubBlobDom(options: GitHubBlobFixtureOptions): string {
  const owner = escapeHtml(options.owner ?? 'octocat');
  const repo = escapeHtml(options.repo ?? 'hello');
  const ref = escapeHtml(options.ref ?? 'main');
  const filePath = escapeHtml(options.filePath);
  const variant = options.variant ?? 'react';
  const mountedAttr = options.mounted ? ` ${MOUNTED_ATTR}="true"` : '';
  const rawHref = `https://github.com/${owner}/${repo}/raw/${ref}/${filePath}`;

  if (variant === 'classic') {
    return `
      <div class="Box">
        <div class="Box-header">
          <a id="raw-url" href="/${owner}/${repo}/raw/${ref}/${filePath}">Raw</a>
        </div>
        <div class="Box-body blob-wrapper"${mountedAttr}>
          <div class="text-center p-4">Binary file not shown.</div>
        </div>
      </div>
    `.trim();
  }

  return `
    <div class="container BlobViewContent-module_NUrSfq_blobContainer">
      <div class="react-code-size-details-banner BlobViewContent-module_NUrSfq_codeSizeDetails">
        <div class="text-mono"><span>212 KB</span></div>
      </div>
      <div class="Box-sc-g0xbh4-0 BlobViewContent-module_NUrSfq_blobViewContent">
        <div class="BlobViewHeader-module_OdKveq_Box">
          <div class="BlobViewHeader-module_OdKveq_Box_1">
            <div class="BlobViewHeader-module_OdKveq_Box_2">
              <ul aria-label="File view" class="BlobTabButtons-module_no8dpa_SegmentedControl">
                <li><button type="button" aria-pressed="true">Code</button></li>
                <li><button type="button" aria-pressed="false">Blame</button></li>
              </ul>
            </div>
            <div class="react-blob-header-edit-and-raw-actions BlobViewHeader-module_OdKveq_Box_4">
              <a data-testid="raw-button" href="${rawHref}">Raw</a>
              <button type="button" data-testid="copy-raw-button">Copy</button>
              <button type="button" data-testid="download-raw-button">Download</button>
            </div>
          </div>
        </div>
        <div class="Box-sc-g0xbh4-0 BlobViewContent-module_NUrSfq_blobContentWrapper">
          <section
            aria-labelledby="file-name-id-wide file-name-id-mobile"
            class="Box-sc-g0xbh4-0 BlobContent-module_3JdjHW_blobContentSection BlobContent-module_3JdjHW_blobContentSectionEmpty"
          >
            <div
              class="Box-sc-g0xbh4-0 tooLargeError-module_V1eN3_tooLargeError"
              data-testid="file-size-too-large"${mountedAttr}
            >
              <h2 class="tooLargeError-module_V1eN3_heading">
                Sorry about that, but we can’t show files that are this big right now.
              </h2>
              <div>
                <a
                  class="Link--inTextBlock prc-Link-Link-9ZwDx"
                  data-component="Link"
                  href="${rawHref}"
                >View raw</a>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `.trim();
}

function renderStatusAttributes(status: DiffFileStatus): {
  fileTypeAttr: string;
  badgeHtml: string;
} {
  if (status === 'added') {
    return {
      fileTypeAttr: ' data-file-type="added"',
      badgeHtml: '<span title="added">Added</span>',
    };
  }
  if (status === 'deleted') {
    return {
      fileTypeAttr: ' data-file-type="deleted"',
      badgeHtml: '<span title="removed">Deleted</span>',
    };
  }
  return { fileTypeAttr: '', badgeHtml: '' };
}

/**
 * 実際の GitHub React / Classic DOM 構造に準拠した PR / Commit Diff ページの DOM 断片を生成する。
 */
export function createGitHubPrDiffDom(options: GitHubPrDiffFixtureOptions): string {
  const owner = escapeHtml(options.owner ?? 'octocat');
  const repo = escapeHtml(options.repo ?? 'hello');
  const headSha = escapeHtml(options.headSha ?? 'headsha');
  const variant = options.variant ?? 'react';
  const includeViewFileMenu = options.includeViewFileMenu ?? true;

  if (variant === 'classic') {
    const shaInputs = [
      options.baseSha
        ? `<input type="hidden" name="comparison_start_oid" value="${escapeHtml(options.baseSha)}" />`
        : '',
      `<input type="hidden" name="comparison_end_oid" value="${headSha}" />`,
    ]
      .filter(Boolean)
      .join('\n');

    const classicBlocks = options.files
      .map((file) => {
        const path = escapeHtml(file.path);
        const status = file.status ?? 'modified';
        const mountedAttr = file.mounted ? ` ${MOUNTED_ATTR}="true"` : '';
        const { fileTypeAttr, badgeHtml } = renderStatusAttributes(status);
        const targetSha =
          status === 'deleted' && options.baseSha ? escapeHtml(options.baseSha) : headSha;

        return `
          <div class="file js-file" data-file-path="${path}"${fileTypeAttr}>
            <div class="file-header" data-path="${path}">
              ${badgeHtml}
              <a href="/${owner}/${repo}/blob/${targetSha}/${path}">${path}</a>
            </div>
            <div class="js-file-content"${mountedAttr}>
              <a href="/${owner}/${repo}/blob/${targetSha}/${path}?raw=true">View raw</a>
            </div>
          </div>
        `.trim();
      })
      .join('\n');

    return `${shaInputs}\n${classicBlocks}`.trim();
  }

  const branchLinks = options.baseSha
    ? `
      <div class="branches__3hqMzX">
        <a data-component="BranchName" href="/${owner}/${repo}/tree/${escapeHtml(options.baseSha)}">${escapeHtml(options.baseSha)}</a>
        <span>from </span>
        <a data-component="BranchName" href="/${owner}/${repo}/tree/${headSha}">${headSha}</a>
      </div>
    `.trim()
    : '';

  const reactBlocks = options.files
    .map((file, index) => {
      const path = escapeHtml(file.path);
      const status = file.status ?? 'modified';
      const mountedAttr = file.mounted ? ` ${MOUNTED_ATTR}="true"` : '';
      const anchorId = toDiffAnchorId(index);
      const targetSha =
        status === 'deleted' && options.baseSha ? escapeHtml(options.baseSha) : headSha;
      const viewFileMenu = includeViewFileMenu
        ? `<a class="prc-ActionList-ActionListContent-KBb8- prc-Link-Link-9ZwDx" data-component="Link" role="menuitem" href="/${owner}/${repo}/blob/${targetSha}/${path}">View file</a>`
        : '';
      const sizeBadge =
        status === 'added'
          ? '<code class="px-2 fgColor-success">435 KB</code>'
          : status === 'deleted'
            ? '<span title="removed">Deleted</span><code class="px-2 fgColor-danger">435 KB</code>'
            : '<code class="px-2 fgColor-muted">212 KB</code>';

      return `
        <div class="diffTargetable__jbrCub diff__GZFl4M" id="${anchorId}">
          <div class="diffHeaderWrapper__INiK1j" data-diff-header-wrapper="true">
            <div class="d-flex px-1 flex-items-center overflow-hidden file-path-section__ZYYNNI">
              <h3 class="file-name__8GKEHg file-name-truncate__1IBLuh">
                <a class="Link--primary prc-Link-Link-9ZwDx" data-component="Link" href="#${anchorId}">
                  <code>${path}</code>
                </a>
              </h3>
            </div>
            <div class="d-flex flex-row flex-justify-end flex-items-center gap-2">
              ${sizeBadge}
              ${viewFileMenu}
            </div>
          </div>
          <div class="border position-relative rounded-bottom-2">
            <div class="fgColor-muted p-2" data-diff-anchor="${anchorId}"${mountedAttr}>Binary file not shown.</div>
          </div>
        </div>
      `.trim();
    })
    .join('\n');

  const viewerContainer = `<div id="diff-comparison-viewer-container" class="Container__qkpM1i">\n${reactBlocks}\n</div>`;

  return [branchLinks, viewerContainer].filter(Boolean).join('\n').trim();
}

const THEME_TOKENS = {
  dark: `
    --bgColor-default: #0d1117;
    --bgColor-muted: #161b22;
    --borderColor-default: #30363d;
    --fgColor-default: #e6edf3;
    --fgColor-muted: #8b949e;
    --fgColor-accent: #58a6ff;
    --bgColor-accent-emphasis: #1f6feb;
    --bgColor-accent-muted: rgba(56, 139, 253, 0.15);
    --fgColor-success: #3fb950;
    --bgColor-success-muted: rgba(46, 160, 67, 0.15);
    --fgColor-danger: #f85149;
    --bgColor-danger-muted: rgba(248, 81, 73, 0.15);
  `,
  light: `
    --bgColor-default: #ffffff;
    --bgColor-muted: #f6f8fa;
    --borderColor-default: #d0d7de;
    --fgColor-default: #1f2328;
    --fgColor-muted: #656d76;
    --fgColor-accent: #0969da;
    --bgColor-accent-emphasis: #0969da;
    --bgColor-accent-muted: rgba(84, 174, 255, 0.2);
    --fgColor-success: #1a7f37;
    --bgColor-success-muted: rgba(74, 194, 107, 0.2);
    --fgColor-danger: #cf222e;
    --bgColor-danger-muted: rgba(255, 129, 130, 0.2);
  `,
} as const;

/**
 * GitHub DOM 断片を Primer CSS 変数付きの完全な HTML ページでラップする（E2E ルーティング用）。
 */
export function toGitHubPageHtml(bodyHtml: string, options: GitHubPageHtmlOptions = {}): string {
  const theme = options.theme ?? 'dark';
  const title = escapeHtml(options.title ?? 'GitHub Mock Page');

  return `<!DOCTYPE html>
<html lang="en" data-color-mode="${theme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      ${THEME_TOKENS[theme]}
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background-color: var(--bgColor-default);
      color: var(--fgColor-default);
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
    }
    .file, .Box, [id^="diff-"], .position-relative {
      border: 1px solid var(--borderColor-default);
      border-radius: 6px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .file-header, .Box-header, [data-diff-header-wrapper] {
      padding: 8px 16px;
      background-color: var(--bgColor-muted);
      border-bottom: 1px solid var(--borderColor-default);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .js-file-content, .Box-body, [data-diff-anchor], [data-testid="file-size-too-large"] {
      padding: 16px;
    }
    a {
      color: var(--fgColor-accent);
    }
  </style>
</head>
<body>
  <main>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

/**
 * Vitest 結合テスト用に、検出された対象コンテナへ VideoPlayer を直接マウントする。
 */
export function mountPlayerForTest(target: VideoMountTarget): () => void {
  markMounted(target.container);
  if (target.type === 'blob') {
    polishGitHubBlobPage(document, target.container);
  } else {
    polishGitHubDiffContainer(target.container);
  }

  const host = document.createElement('div');
  host.setAttribute('data-ghvp-host', target.id);
  target.container.prepend(host);

  const dispose = render(
    () => (
      <VideoPlayer
        filePath={target.filePath}
        rawUrl={target.rawUrl}
        beforeRawUrl={target.beforeRawUrl}
        mode={target.type}
      />
    ),
    host,
  );

  return () => {
    dispose();
    host.remove();
    target.container.removeAttribute(MOUNTED_ATTR);
  };
}
