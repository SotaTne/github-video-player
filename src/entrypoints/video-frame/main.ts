interface LoadVideoMessage {
  type: 'ghvp:load-video';
  frameId: string;
  blob: Blob;
}

const params = new URLSearchParams(window.location.search);
const frameId = params.get('frameId') ?? '';
const player = document.getElementById('player') as HTMLVideoElement | null;

let currentObjectUrl: string | null = null;

function revokeCurrentUrl(): void {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
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
    // 動画データ割り当て前の空エラーは無視し、読み込み後のエラーのみ親へ通知する
    if (!currentObjectUrl) return;
    window.parent.postMessage({ type: 'ghvp:video-error', frameId }, '*');
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !player || !isLoadVideoMessage(event.data)) {
    return;
  }

  revokeCurrentUrl();
  currentObjectUrl = URL.createObjectURL(event.data.blob);
  player.src = currentObjectUrl;
});

window.addEventListener('pagehide', revokeCurrentUrl);

window.parent.postMessage({ type: 'ghvp:frame-ready', frameId }, '*');
