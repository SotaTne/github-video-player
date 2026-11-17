import { STREAM_PATH_PREFIX } from '../../features/video-stream/rangeStream';

interface LoadVideoMessage {
  type: 'ghvp:load-video';
  frameId: string;
  blob: Blob;
}

interface InitStreamMessage {
  type: 'ghvp:init-stream';
  frameId: string;
  streamId: string;
  totalSize: number;
  contentType: string;
}

const params = new URLSearchParams(window.location.search);
const frameId = params.get('frameId') ?? '';
const player = document.getElementById('player') as HTMLVideoElement | null;

let currentObjectUrl: string | null = null;
let activeStreamId: string | null = null;

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
    const registration = await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller ?? registration.active;
  } catch {
    return null;
  }
}

function unregisterCurrentStream(): void {
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

  const notifyPlaybackState = () => {
    window.parent.postMessage(
      {
        type: 'ghvp:playback-state',
        frameId,
        playing: !player.paused && !player.ended,
      },
      '*',
    );
  };

  player.addEventListener('play', notifyPlaybackState);
  player.addEventListener('pause', notifyPlaybackState);
  player.addEventListener('ended', notifyPlaybackState);
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
      player.src = `${STREAM_PATH_PREFIX}${encodeURIComponent(event.data.streamId)}`;
      player.load();
    })();
    return;
  }

  if (!isLoadVideoMessage(event.data)) return;

  if (event.data.blob.size === 0) {
    window.parent.postMessage({ type: 'ghvp:video-error', frameId }, '*');
    return;
  }

  unregisterCurrentStream();
  revokeCurrentUrl();
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
