import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent } from '@solidjs/testing-library';
import { flush } from 'solid-js';
import {
  createGitHubBlobDom,
  createGitHubPrDiffDom,
  mountPlayerForTest,
  toGitHubPageHtml,
} from '../../../test/github-fixtures';
import { detectVideoTargets, hasRelevantDomMutation, polishMountedDiffContainers } from './index';

describe('github-detector', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/octocat/hello/pull/12/files');
  });

  it('detects a video on live react and classic GitHub blob pages', () => {
    const reactUrl = 'https://github.com/octocat/hello/blob/develop/recordings/demo/video.webm';

    document.body.innerHTML = createGitHubBlobDom({
      owner: 'octocat',
      repo: 'hello',
      ref: 'develop',
      filePath: 'recordings/demo/video.webm',
      variant: 'react',
    });

    const reactTargets = detectVideoTargets(document, reactUrl);
    expect(reactTargets).toHaveLength(1);
    expect(reactTargets[0]).toMatchObject({
      type: 'blob',
      filePath: 'video.webm',
      rawUrl: 'https://github.com/octocat/hello/raw/develop/recordings/demo/video.webm',
    });

    document.body.innerHTML = createGitHubBlobDom({
      filePath: 'clips/demo.mp4',
      variant: 'classic',
    });
    const classicTargets = detectVideoTargets(
      document,
      'https://github.com/octocat/hello/blob/main/clips/demo.mp4',
    );
    expect(classicTargets).toHaveLength(1);
    expect(classicTargets[0]).toMatchObject({
      type: 'blob',
      filePath: 'demo.mp4',
      rawUrl: 'https://github.com/octocat/hello/raw/main/clips/demo.mp4',
    });
  });

  it('hides Code/Blame, Raw, Copy, and View raw without duplicating size label on blob mount', () => {
    const url = 'https://github.com/octocat/hello/blob/develop/recordings/demo/video.webm';
    document.body.innerHTML = createGitHubBlobDom({
      owner: 'octocat',
      repo: 'hello',
      ref: 'develop',
      filePath: 'recordings/demo/video.webm',
      variant: 'react',
    });

    const targets = detectVideoTargets(document, url);
    expect(targets).toHaveLength(1);

    const dispose = mountPlayerForTest(targets[0]!);
    try {
      expect(document.querySelector<HTMLElement>('ul[aria-label="File view"]')?.style.display).toBe(
        'none',
      );
      expect(document.querySelector<HTMLElement>('[data-testid="raw-button"]')?.style.display).toBe(
        'none',
      );
      expect(
        document.querySelector<HTMLElement>('[data-testid="copy-raw-button"]')?.style.display,
      ).toBe('none');
      expect(document.querySelector('[data-ghvp-blob-size]')).toBeNull();
      expect(
        document.querySelector<HTMLElement>('.react-code-size-details-banner')?.style.display,
      ).not.toBe('none');
      expect(
        document.querySelector<HTMLElement>('[data-testid="download-raw-button"]')?.style.display,
      ).not.toBe('none');
      expect(
        document.querySelector<HTMLElement>('.tooLargeError-module_V1eN3_heading')?.style.display,
      ).toBe('none');
    } finally {
      dispose();
    }
  });

  it('detects video files in both react and classic PR diff blocks and ignores non-video files', () => {
    for (const variant of ['react', 'classic'] as const) {
      document.body.innerHTML = createGitHubPrDiffDom({
        headSha: 'headsha',
        variant,
        files: [{ path: 'assets/intro.webm' }, { path: 'assets/logo.png' }],
      });

      const targets = detectVideoTargets(
        document,
        'https://github.com/octocat/hello/pull/12/changes',
      );

      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({
        type: 'diff',
        filePath: 'assets/intro.webm',
        rawUrl: 'https://github.com/octocat/hello/raw/headsha/assets/intro.webm',
      });
    }
  });

  it('derives rawUrl and beforeRawUrl for react PR diffs even without inline raw/blob links', () => {
    document.body.innerHTML = createGitHubPrDiffDom({
      owner: 'octocat',
      repo: 'hello',
      baseSha: 'develop',
      headSha: 'feature-video',
      variant: 'react',
      includeViewFileMenu: false,
      files: [
        { path: 'recordings/demo/video.webm', status: 'modified' },
        { path: 'recordings/added/video.webm', status: 'added' },
      ],
    });

    const targets = detectVideoTargets(
      document,
      'https://github.com/octocat/hello/pull/13/changes',
    );

    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      filePath: 'recordings/demo/video.webm',
      rawUrl: 'https://github.com/octocat/hello/raw/feature-video/recordings/demo/video.webm',
      beforeRawUrl: 'https://github.com/octocat/hello/raw/develop/recordings/demo/video.webm',
    });
    expect(targets[1]).toMatchObject({
      filePath: 'recordings/added/video.webm',
      rawUrl: 'https://github.com/octocat/hello/raw/feature-video/recordings/added/video.webm',
      beforeRawUrl: undefined,
    });
  });

  it('detects videos on a Commit Diff page using commit URL and parent commit link', () => {
    document.body.innerHTML = `
      <div>
        <a href="/octocat/hello/commit/1111111111111111111111111111111111111111">1111111</a>
        <div class="position-relative">
          <div class="diffHeaderWrapper__EHUZul">
            <h3>
              <a class="Link--primary prc-Link-Link-9ZwDx" href="#diff-f004190d">
                <code>recordings/demo/video.webm</code>
              </a>
            </h3>
          </div>
          <div class="border position-relative rounded-bottom-2">
            <div class="fgColor-muted p-2" data-diff-anchor="diff-f004190d">Binary file not shown.</div>
          </div>
        </div>
      </div>
    `;

    const targets = detectVideoTargets(
      document,
      'https://github.com/octocat/hello/commit/2222222222222222222222222222222222222222',
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      type: 'diff',
      filePath: 'recordings/demo/video.webm',
      rawUrl:
        'https://github.com/octocat/hello/raw/2222222222222222222222222222222222222222/recordings/demo/video.webm',
      beforeRawUrl:
        'https://github.com/octocat/hello/raw/1111111111111111111111111111111111111111/recordings/demo/video.webm',
    });
  });

  it('skips blob and diff containers that are already mounted', () => {
    document.body.innerHTML = createGitHubBlobDom({
      filePath: 'demo.mp4',
      mounted: true,
    });
    expect(
      detectVideoTargets(document, 'https://github.com/octocat/hello/blob/main/demo.mp4'),
    ).toHaveLength(0);

    document.body.innerHTML = createGitHubPrDiffDom({
      files: [{ path: 'assets/demo.mp4', mounted: true }],
    });
    expect(
      detectVideoTargets(document, 'https://github.com/octocat/hello/pull/12/changes'),
    ).toHaveLength(0);
  });

  it('wraps fixture DOM in full HTML with GitHub Primer CSS variables', () => {
    const html = toGitHubPageHtml(createGitHubBlobDom({ filePath: 'demo.webm' }), {
      theme: 'dark',
      title: 'demo.webm',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('--bgColor-default: #0d1117');
    expect(html).toContain('data-testid="file-size-too-large"');
  });

  it('mounts a working VideoPlayer into detected PR diff DOM and switches to Split comparison', () => {
    document.body.innerHTML = createGitHubPrDiffDom({
      baseSha: 'basesha',
      headSha: 'headsha',
      variant: 'react',
      files: [{ path: 'recordings/demo/video.webm', status: 'modified' }],
    });

    const targets = detectVideoTargets(
      document,
      'https://github.com/octocat/hello/pull/12/changes',
    );
    expect(targets).toHaveLength(1);

    const dispose = mountPlayerForTest(targets[0]!);
    try {
      expect(targets[0]!.container.textContent).not.toContain('Binary file not shown.');

      const splitButton = document.querySelector('button[aria-pressed="false"]:nth-of-type(3)');
      expect(splitButton?.textContent).toBe('並列比較 (Split)');

      fireEvent.click(splitButton!);
      flush();

      const beforeVideo = document.querySelector('[data-testid="ghvp-video-before"]');
      const afterVideo = document.querySelector('[data-testid="ghvp-video-after"]');
      expect(beforeVideo?.getAttribute('src')).toBe(
        'https://github.com/octocat/hello/raw/basesha/recordings/demo/video.webm',
      );
      expect(afterVideo?.getAttribute('src')).toBe(
        'https://github.com/octocat/hello/raw/headsha/recordings/demo/video.webm',
      );
    } finally {
      dispose();
    }
  });

  it('ignores #diff-comparison-viewer-container wrapper, leading non-video files, slash branch names, and added fgColor-success badges', () => {
    document.body.innerHTML = createGitHubPrDiffDom({
      owner: 'octocat',
      repo: 'hello',
      baseSha: 'feature/base-branch',
      headSha: 'feature/video-preview',
      variant: 'react',
      includeViewFileMenu: false,
      files: [
        { path: 'src/components/header.tsx', status: 'modified' },
        { path: 'recordings/flow-a/video.webm', status: 'added' },
        { path: 'recordings/flow-b/video.webm', status: 'added' },
      ],
    });

    const targets = detectVideoTargets(
      document,
      'https://github.com/octocat/hello/pull/42/changes',
    );

    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      type: 'diff',
      filePath: 'recordings/flow-a/video.webm',
      rawUrl:
        'https://github.com/octocat/hello/raw/feature/video-preview/recordings/flow-a/video.webm',
      beforeRawUrl: undefined,
    });
    expect(targets[1]).toMatchObject({
      type: 'diff',
      filePath: 'recordings/flow-b/video.webm',
      rawUrl:
        'https://github.com/octocat/hello/raw/feature/video-preview/recordings/flow-b/video.webm',
      beforeRawUrl: undefined,
    });
  });

  it('falls back to react-app.embeddedData JSON when branch badges are not rendered', () => {
    document.body.innerHTML = `
      <script type="application/json" data-target="react-app.embeddedData">
        {
          "payload": {
            "pullRequest": {
              "baseRefName": "main",
              "headRefName": "feature/video",
              "baseRefOid": "1111111111111111111111111111111111111111",
              "headRefOid": "2222222222222222222222222222222222222222"
            }
          }
        }
      </script>
      <div id="diff-comparison-viewer-container">
        <div id="diff-mock-0" class="diffTargetable__jbrCub">
          <div data-diff-header-wrapper="true">
            <h3><a href="#diff-mock-0"><code>e2e/demo.webm</code></a></h3>
            <code class="px-2 fgColor-muted">120 KB</code>
          </div>
          <div data-diff-anchor="diff-mock-0">Binary file not shown.</div>
        </div>
      </div>
    `;

    const targets = detectVideoTargets(
      document,
      'https://github.com/octocat/hello/pull/99/changes',
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      filePath: 'e2e/demo.webm',
      rawUrl:
        'https://github.com/octocat/hello/raw/2222222222222222222222222222222222222222/e2e/demo.webm',
      beforeRawUrl:
        'https://github.com/octocat/hello/raw/1111111111111111111111111111111111111111/e2e/demo.webm',
    });
  });

  it('does not mount onto fileEl or hide the file header when a PR diff block is collapsed, and remounts when expanded', () => {
    document.body.innerHTML = createGitHubPrDiffDom({
      baseSha: 'base',
      headSha: 'head',
      variant: 'react',
      files: [{ path: 'e2e/demo.webm', status: 'added' }],
    });

    const diffUrl = 'https://github.com/octocat/hello/pull/12/changes';
    const fileEl = document.getElementById('diff-mock-0')!;
    const header = fileEl.querySelector<HTMLElement>('[data-diff-header-wrapper]')!;
    const bodyWrapper = fileEl.querySelector<HTMLElement>('.border.position-relative')!;
    const originalAnchor = bodyWrapper.innerHTML;

    // 折りたたみ（閉じ）状態：差分ボディが DOM から除去され、ヘッダーのみが残る
    bodyWrapper.remove();

    expect(detectVideoTargets(document, diffUrl)).toHaveLength(0);
    expect(fileEl.hasAttribute('data-ghvp-mounted')).toBe(false);
    expect(header.style.display).not.toBe('none');

    // 再度展開：差分ボディと [data-diff-anchor] が復活したら再びマウント対象になる
    const reopenedBody = document.createElement('div');
    reopenedBody.className = 'border position-relative rounded-bottom-2';
    reopenedBody.innerHTML = originalAnchor;
    fileEl.appendChild(reopenedBody);

    const targetsAfterReopen = detectVideoTargets(document, diffUrl);
    expect(targetsAfterReopen).toHaveLength(1);
    const dispose = mountPlayerForTest(targetsAfterReopen[0]!);
    try {
      expect(header.style.display).not.toBe('none');
      expect(fileEl.hasAttribute('data-ghvp-mounted')).toBe(false);
      expect(targetsAfterReopen[0]!.container.hasAttribute('data-ghvp-mounted')).toBe(true);
    } finally {
      dispose();
    }
  });

  it('removes placeholder text nodes and hides Chrome translation elements injected after mount', () => {
    document.body.innerHTML = createGitHubPrDiffDom({
      baseSha: 'base',
      headSha: 'head',
      variant: 'react',
      files: [{ path: 'e2e/translated.webm', status: 'added' }],
    });

    const targets = detectVideoTargets(
      document,
      'https://github.com/octocat/hello/pull/12/changes',
    );
    expect(targets).toHaveLength(1);

    const dispose = mountPlayerForTest(targets[0]!);
    try {
      const container = targets[0]!.container;
      expect(container.getAttribute('translate')).toBe('no');
      expect(container.classList.contains('notranslate')).toBe(true);
      expect(container.textContent).not.toContain('Binary file not shown.');

      // マウント後に Chrome 翻訳や非同期描画で <font> やテキストノードが挿入された場合を模擬する
      const translatedFont = document.createElement('font');
      translatedFont.textContent = 'バイナリファイルは表示されません。';
      container.appendChild(translatedFont);
      container.appendChild(document.createTextNode('バイナリファイルは表示されません。'));

      polishMountedDiffContainers(document);

      expect(translatedFont.style.display).toBe('none');
      expect(container.textContent).not.toContain('Binary file not shown.');
      expect(
        Array.from(container.childNodes).some((node) => node.nodeType === Node.TEXT_NODE),
      ).toBe(false);
    } finally {
      dispose();
    }
  });

  it('skips scanning unsupported GitHub pages and skips JSON parsing when diff has no videos', () => {
    document.body.innerHTML = createGitHubPrDiffDom({
      variant: 'react',
      files: [{ path: 'src/index.ts', status: 'modified' }],
    });
    const script = document.createElement('script');
    script.setAttribute('data-target', 'react-app.embeddedData');
    script.textContent = JSON.stringify({ payload: { baseRefOid: 'a', headRefOid: 'b' } });
    document.body.appendChild(script);

    const jsonParseSpy = vi.spyOn(JSON, 'parse');
    try {
      expect(
        detectVideoTargets(document, 'https://github.com/octocat/hello/issues/42'),
      ).toHaveLength(0);
      expect(
        detectVideoTargets(document, 'https://github.com/octocat/hello/pull/12/changes'),
      ).toHaveLength(0);
      expect(jsonParseSpy).not.toHaveBeenCalled();
    } finally {
      jsonParseSpy.mockRestore();
    }
  });

  it('filters out irrelevant text/self-host mutations and accepts external element or mounted-text mutations', () => {
    const plainDiv = document.createElement('div');
    const mountedDiv = document.createElement('div');
    mountedDiv.setAttribute('data-ghvp-mounted', 'true');
    const ownHost = document.createElement('github-video-player');
    const externalDiff = document.createElement('div');

    expect(
      hasRelevantDomMutation([
        {
          type: 'childList',
          target: plainDiv,
          addedNodes: [document.createTextNode('typing')],
        },
        {
          type: 'childList',
          target: mountedDiv,
          addedNodes: [ownHost],
        },
      ]),
    ).toBe(false);

    expect(
      hasRelevantDomMutation([
        {
          type: 'childList',
          target: plainDiv,
          addedNodes: [externalDiff],
        },
      ]),
    ).toBe(true);

    expect(
      hasRelevantDomMutation([
        {
          type: 'childList',
          target: mountedDiv,
          addedNodes: [document.createTextNode('translated')],
        },
      ]),
    ).toBe(true);
  });
});
