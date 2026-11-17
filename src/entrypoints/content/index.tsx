import './style.css';
import {
  detectVideoTargets,
  hasRelevantDomMutation,
  isSupportedGitHubVideoPage,
  polishMountedDiffContainers,
} from '../../features/github-detector';
import { mountTargetWithShadowUi } from './mount';

export default defineContentScript({
  matches: ['*://github.com/*'],
  cssInjectionMode: 'ui',

  main(ctx) {
    let scanTimer: ReturnType<typeof setTimeout> | null = null;
    let isScanning = false;

    const scanAndMount = () => {
      if (!isSupportedGitHubVideoPage(window.location.href)) return;

      isScanning = true;
      try {
        polishMountedDiffContainers(document);
        const targets = detectVideoTargets(document, window.location.href);
        for (const target of targets) {
          void mountTargetWithShadowUi(ctx, target);
        }
      } finally {
        isScanning = false;
      }
    };

    // 連続的な DOM 更新やスクロール中でも 100ms 以内にスキャンが実行されるようスロットル制御する
    const scheduleScan = () => {
      if (isScanning || scanTimer !== null || !isSupportedGitHubVideoPage(window.location.href)) {
        return;
      }
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scanAndMount();
      }, 100);
    };

    scanAndMount();

    ctx.addEventListener(window, 'wxt:locationchange', scheduleScan);
    ctx.addEventListener(document, 'turbo:render' as keyof DocumentEventMap, scheduleScan);

    // Turbo による <body> 差し替え後でも監視が途切れないよう documentElement を監視する
    const observer = new MutationObserver((mutations) => {
      if (hasRelevantDomMutation(mutations)) {
        scheduleScan();
      }
    });
    const observeTarget = document.documentElement ?? document.body;
    if (observeTarget) {
      observer.observe(observeTarget, {
        childList: true,
        subtree: true,
      });
    }

    ctx.onInvalidated(() => {
      observer.disconnect();
      if (scanTimer) clearTimeout(scanTimer);
    });
  },
});
