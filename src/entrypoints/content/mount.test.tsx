import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { MOUNTED_ATTR } from '../../features/github-detector';

const mockCreateShadowRootUi = vi.hoisted(() => vi.fn());

vi.mock('wxt/utils/content-script-ui/shadow-root', () => ({
  createShadowRootUi: mockCreateShadowRootUi,
}));

import { mountTargetWithShadowUi } from './mount';

describe('mountTargetWithShadowUi', () => {
  beforeEach(() => {
    mockCreateShadowRootUi.mockReset();
    document.body.innerHTML = '';
  });

  it('does not throw or clear original diff content when extension context is invalidated', async () => {
    const container = document.createElement('div');
    container.textContent = 'Binary file not shown';
    const child = document.createElement('span');
    child.textContent = 'View raw';
    container.appendChild(child);
    document.body.appendChild(container);

    mockCreateShadowRootUi.mockRejectedValue(new Error('Extension context invalidated.'));

    const ctx = {
      isInvalid: false,
      isValid: true,
    } as unknown as ContentScriptContext;

    await expect(
      mountTargetWithShadowUi(ctx, {
        id: 'diff:demo.mp4:0',
        type: 'diff',
        filePath: 'demo.mp4',
        rawUrl: 'https://github.com/octocat/hello/raw/head/demo.mp4',
        container,
      }),
    ).resolves.toBeUndefined();

    expect(container.textContent).toContain('Binary file not shown');
    expect(child.style.display).not.toBe('none');
    expect(container.hasAttribute(MOUNTED_ATTR)).toBe(false);
  });

  it('skips mounting and leaves original content untouched when ctx.isInvalid is already true', async () => {
    const container = document.createElement('div');
    container.textContent = 'Binary file not shown';
    document.body.appendChild(container);

    const ctx = {
      isInvalid: true,
      isValid: false,
    } as unknown as ContentScriptContext;

    await expect(
      mountTargetWithShadowUi(ctx, {
        id: 'diff:demo.mp4:0',
        type: 'diff',
        filePath: 'demo.mp4',
        rawUrl: 'https://github.com/octocat/hello/raw/head/demo.mp4',
        container,
      }),
    ).resolves.toBeUndefined();

    expect(mockCreateShadowRootUi).not.toHaveBeenCalled();
    expect(container.textContent).toBe('Binary file not shown');
    expect(container.hasAttribute(MOUNTED_ATTR)).toBe(false);
  });
});
