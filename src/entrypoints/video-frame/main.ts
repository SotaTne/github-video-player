import { startStreamKeepalive, STREAM_PATH_PREFIX } from '../../features/video-stream/rangeStream';

interface LoadVideoMessage {
  type: 'ghvp:load-video';
  frameId: string;
  blob: Blob;
  initialTime?: number;
}

interface InitStreamMessage {
  type: 'ghvp:init-stream';
  frameId: string;
  streamId: string;
  totalSize: number;
  contentType: string;
  initialTime?: number;
}

const params = new URLSearchParams(window.location.search);
const frameId = params.get('frameId') ?? '';
const player = document.getElementById('player') as HTMLVideoElement | null;

let currentObjectUrl: string | null = null;
let activeStreamId: string | null = null;
let stopKeepalive: (() => void) | null = null;
let pendingInitialTime = 0;

function revokeCurrentUrl(): void {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

async function getActiveServiceWorker(): Promise<ServiceWorker | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    await navigator.serviceWorker.ready;
    // controller が無い場合、このフレームの fetch は SW に捕捉されないため Blob フォールバックへ回す
    return navigator.serviceWorker.controller;
  } catch {
    return null;
  }
}

function unregisterCurrentStream(): void {
  stopKeepalive?.();
  stopKeepalive = null;
  if (!activeStreamId) return;
  const streamId = activeStreamId;
  activeStreamId = null;
  void getActiveServiceWorker().then((sw) => {
    sw?.postMessage({ type: 'ghvp:unregister-stream', streamId }, []);
  });
}

function isLoadVideoMessage(data: unknown): data is LoadVideoMessage {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<LoadVideoMessage>;
  return (
    candidate.type === 'ghvp:load-video' &&
    candidate.frameId === frameId &&
    candidate.blob instanceof Blob
  );
}

function isInitStreamMessage(data: unknown): data is InitStreamMessage {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<InitStreamMessage>;
  return (
    candidate.type === 'ghvp:init-stream' &&
    candidate.frameId === frameId &&
    typeof candidate.streamId === 'string' &&
    typeof candidate.totalSize === 'number' &&
    candidate.totalSize > 0
  );
}

function registerStreamWithWorker(
  sw: ServiceWorker,
  message: InitStreamMessage,
  port: MessagePort,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(false);
    }, 3000);

    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (
        !data ||
        data['type'] !== 'ghvp:stream-registered' ||
        data['streamId'] !== message.streamId
      ) {
        return;
      }
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(true);
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    sw.postMessage(
      {
        type: 'ghvp:register-stream',
        streamId: message.streamId,
        totalSize: message.totalSize,
        contentType: message.contentType,
      },
      [port],
    );
  });
}

if (player) {
  player.addEventListener('loadedmetadata', () => {
    if (
      pendingInitialTime > 0 &&
      Number.isFinite(player.duration) &&
      pendingInitialTime < player.duration
    ) {
      player.currentTime = pendingInitialTime;
    }
    pendingInitialTime = 0;

    window.parent.postMessage(
      {
        type: 'ghvp:video-metadata',
        frameId,
        width: player.videoWidth,
        height: player.videoHeight,
        duration: player.duration,
      },
      '*',
    );
  });

  player.addEventListener('error', () => {
    // 動画データ割り当て前の空エラーは無視し、ストリーミングエラー時は親へ Blob フォールバックを要求する
    if (activeStreamId) {
      unregisterCurrentStream();
      window.parent.postMessage({ type: 'ghvp:stream-fallback', frameId }, '*');
      return;
    }
    if (!currentObjectUrl) return;
    window.parent.postMessage({ type: 'ghvp:video-error', frameId }, '*');
  });

  let lastTimeSyncAt = 0;
  const notifyPlaybackState = (ended = false) => {
    window.parent.postMessage(
      {
        type: 'ghvp:playback-state',
        frameId,
        playing: !player.paused && !player.ended,
        currentTime: ended ? 0 : player.currentTime,
        ended,
      },
      '*',
    );
  };

  player.addEventListener('play', () => notifyPlaybackState(false));
  player.addEventListener('pause', () => notifyPlaybackState(false));
  player.addEventListener('ended', () => notifyPlaybackState(true));
  player.addEventListener('seeked', () => notifyPlaybackState(false));
  player.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastTimeSyncAt < 500) return;
    lastTimeSyncAt = now;
    notifyPlaybackState(false);
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !player) return;

  if (isInitStreamMessage(event.data)) {
    const port = event.ports[0];
    if (!port) {
      window.parent.postMessage({ type: 'ghvp:stream-fallback', frameId }, '*');
      return;
    }

    void (async () => {
      const sw = await getActiveServiceWorker();
      if (!sw) {
        port.close();
        window.parent.postMessage({ type: 'ghvp:stream-fallback', frameId }, '*');
        return;
      }

      unregisterCurrentStream();
      revokeCurrentUrl();
      const ok = await registerStreamWithWorker(sw, event.data, port);
      if (!ok) {
        port.close();
        window.parent.postMessage({ type: 'ghvp:stream-fallback', frameId }, '*');
        return;
      }

      activeStreamId = event.data.streamId;
      stopKeepalive = startStreamKeepalive(event.data.streamId, getActiveServiceWorker);
      pendingInitialTime =
        typeof event.data.initialTime === 'number' && event.data.initialTime > 0
          ? event.data.initialTime
          : 0;
      player.src = `${STREAM_PATH_PREFIX}${encodeURIComponent(event.data.streamId)}`;
      player.load();
    })();
    return;
  }

  if (
    event.data &&
    typeof event.data === 'object' &&
    (event.data as Record<string, unknown>)['type'] === 'ghvp:pause' &&
    (event.data as Record<string, unknown>)['frameId'] === frameId
  ) {
    player.pause();
    return;
  }

  if (!isLoadVideoMessage(event.data)) return;

  if (event.data.blob.size === 0) {
    window.parent.postMessage({ type: 'ghvp:video-error', frameId }, '*');
    return;
  }

  unregisterCurrentStream();
  revokeCurrentUrl();
  pendingInitialTime =
    typeof event.data.initialTime === 'number' && event.data.initialTime > 0
      ? event.data.initialTime
      : 0;
  currentObjectUrl = URL.createObjectURL(event.data.blob);
  player.src = currentObjectUrl;
  player.load();
});

window.addEventListener('pagehide', () => {
  unregisterCurrentStream();
  revokeCurrentUrl();
});

window.parent.postMessage(
  {
    type: 'ghvp:frame-ready',
    frameId,
    supportsStream: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  },
  '*',
);
