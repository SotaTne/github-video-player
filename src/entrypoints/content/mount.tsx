import { render } from '@solidjs/web';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  isUnmounted,
  markMounted,
  markMounting,
  MOUNTED_ATTR,
  polishGitHubBlobPage,
  polishGitHubDiffContainer,
  type VideoMountTarget,
} from '../../features/github-detector';
import { VideoPlayer } from '../../features/video-player/VideoPlayer';

function renderPlayer(target: VideoMountTarget, container: HTMLElement): () => void {
  return render(
    () => (
      <VideoPlayer
        filePath={target.filePath}
        rawUrl={target.rawUrl}
        beforeRawUrl={target.beforeRawUrl}
        mode={target.type}
      />
    ),
    container,
  );
}

function isContextInvalidatedError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.toLowerCase().includes('extension context invalidated')
  );
}

/**
 * WXT が管理する隔離された Shadow DOM ルート内に VideoPlayer をマウントする。
 */
export async function mountTargetWithShadowUi(
  ctx: ContentScriptContext,
  target: VideoMountTarget,
): Promise<void> {
  if (ctx.isInvalid || !isUnmounted(target.container, target.rawUrl)) return;
  markMounting(target.container);

  let ui: Awaited<ReturnType<typeof createShadowRootUi>>;
  try {
    ui = await createShadowRootUi(ctx, {
      name: 'github-video-player',
      position: 'inline',
      anchor: target.container,
      append: 'first',
      onMount(container) {
        return renderPlayer(target, container);
      },
      onRemove(dispose) {
        dispose?.();
      },
    });
  } catch (error) {
    target.container.removeAttribute(MOUNTED_ATTR);
    if (ctx.isInvalid || isContextInvalidatedError(error)) return;
    throw error;
  }

  if (!target.container.isConnected || ctx.isInvalid) {
    target.container.removeAttribute(MOUNTED_ATTR);
    return;
  }

  for (const staleHost of Array.from(target.container.querySelectorAll('github-video-player'))) {
    staleHost.remove();
  }

  if (target.type === 'blob') {
    polishGitHubBlobPage(document, target.container);
  } else {
    polishGitHubDiffContainer(target.container);
  }

  ui.mount();
  markMounted(target.container, target.rawUrl);

  // 非同期のマウント待機中に挿入されたテキストや翻訳要素を再度除去する
  if (target.type === 'diff') {
    polishGitHubDiffContainer(target.container);
  }
}
