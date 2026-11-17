import {
  createStreamFetchHandler,
  STREAM_PATH_PREFIX,
  type StreamSession,
} from '../features/video-stream/rangeStream';

interface ExtendableMessageEventLike extends Event {
  data: unknown;
  ports: readonly MessagePort[];
  source: { postMessage: (message: unknown) => void } | null;
}

interface FetchEventLike extends Event {
  request: Request;
  respondWith: (response: Promise<Response> | Response) => void;
}

interface ServiceWorkerScopeLike {
  skipWaiting?: () => Promise<void>;
  clients?: { claim?: () => Promise<void> };
  addEventListener: (type: string, listener: (event: Event) => void) => void;
}

export default defineBackground(() => {
  const sw = self as unknown as ServiceWorkerScopeLike;
  const sessions = new Map<string, StreamSession>();
  const handleStreamFetch = createStreamFetchHandler(sessions);

  sw.addEventListener('install', () => {
    void sw.skipWaiting?.();
  });

  sw.addEventListener('activate', (event) => {
    const extendable = event as Event & { waitUntil?: (p: Promise<unknown>) => void };
    if (sw.clients?.claim) {
      extendable.waitUntil?.(sw.clients.claim());
    }
  });

  sw.addEventListener('message', (rawEvent) => {
    const event = rawEvent as ExtendableMessageEventLike;
    const data = event.data as Record<string, unknown> | null;
    if (!data) return;

    if (data['type'] === 'ghvp:register-stream') {
      const streamId = typeof data['streamId'] === 'string' ? data['streamId'] : '';
      const totalSize = Number(data['totalSize']);
      const contentType =
        typeof data['contentType'] === 'string' && data['contentType']
          ? data['contentType']
          : 'video/mp4';
      const port = event.ports[0];

      if (!streamId || !Number.isFinite(totalSize) || totalSize <= 0 || !port) return;

      const existing = sessions.get(streamId);
      existing?.port.close();
      port.start();
      sessions.set(streamId, { port, totalSize, contentType });
      event.source?.postMessage({ type: 'ghvp:stream-registered', streamId });
      return;
    }

    if (data['type'] === 'ghvp:keepalive-stream') {
      return;
    }

    if (data['type'] === 'ghvp:unregister-stream') {
      const streamId = typeof data['streamId'] === 'string' ? data['streamId'] : '';
      if (!streamId) return;
      const existing = sessions.get(streamId);
      existing?.port.close();
      sessions.delete(streamId);
    }
  });

  sw.addEventListener('fetch', (rawEvent) => {
    const event = rawEvent as FetchEventLike;
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith(STREAM_PATH_PREFIX)) return;

    event.respondWith(handleStreamFetch(event.request));
  });
});
