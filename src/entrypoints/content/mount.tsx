import { render } from 'solid-js/web';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  isUnmounted,
  markMounted,
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

/**
 * WXT が管理する隔離された Shadow DOM ルート内に VideoPlayer をマウントする。
 */
export async function mountTargetWithShadowUi(
  ctx: ContentScriptContext,
  target: VideoMountTarget,
): Promise<void> {
  if (!isUnmounted(target.container)) return;
  markMounted(target.container);

  if (target.type === 'blob') {
    polishGitHubBlobPage(document, target.container);
  } else {
    polishGitHubDiffContainer(target.container);
  }

  const ui = await createShadowRootUi(ctx, {
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

  ui.mount();

  // 非同期のマウント待機中に挿入されたテキストや翻訳要素を再度除去する
  if (target.type === 'diff') {
    polishGitHubDiffContainer(target.container);
  }
}
