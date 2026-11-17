export const STREAM_PATH_PREFIX = '/ghvp-stream/';
export const DEFAULT_STREAM_CHUNK_BYTES = 1024 * 1024;
export const DEFAULT_STREAM_KEEPALIVE_MS = 20_000;

/**
 * HTTP Content-Range ヘッダからファイル全体のバイトサイズを抽出する。
 */
export function parseContentRangeTotalSize(contentRangeHeader: string | null): number | null {
  if (!contentRangeHeader) return null;
  const match = contentRangeHeader.trim().match(/^bytes\s+\d+-\d+\/(\d+)$/i);
  if (!match?.[1]) return null;
  const totalSize = Number(match[1]);
  return Number.isSafeInteger(totalSize) && totalSize > 0 ? totalSize : null;
}

/**
 * MV3 Service Worker がアイドル停止してストリームセッションが消えないよう、定期的に keepalive を送る。
 */
export function startStreamKeepalive(
  streamId: string,
  getWorker: () => Promise<{
    postMessage: (message: unknown, transfer: Transferable[]) => void;
  } | null>,
  intervalMs = DEFAULT_STREAM_KEEPALIVE_MS,
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void getWorker().then((sw) => {
      if (!stopped && sw) {
        sw.postMessage({ type: 'ghvp:keepalive-stream', streamId }, []);
      }
    });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface StreamSession {
  port: MessagePort;
  totalSize: number;
  contentType: string;
}

interface RangeRequestPayload {
  type: 'ghvp:range-request';
  requestId: string;
  start: number;
  end: number;
}

interface RangeResponsePayload {
  type: 'ghvp:range-response';
  requestId: string;
  ok: boolean;
  buffer?: ArrayBuffer;
}

/**
 * HTTP Range ヘッダを解析し、1 回のチャンク上限に収まるバイト範囲を返す。
 */
export function parseByteRange(
  rangeHeader: string | null,
  totalSize: number,
  maxChunkBytes = DEFAULT_STREAM_CHUNK_BYTES,
): ByteRange | 'unsatisfiable' {
  if (totalSize <= 0) return 'unsatisfiable';

  if (!rangeHeader) {
    return {
      start: 0,
      end: Math.min(totalSize - 1, maxChunkBytes - 1),
    };
  }

  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return 'unsatisfiable';

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'unsatisfiable';

  let start: number;
  let end: number;

  if (!rawStart && rawEnd) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'unsatisfiable';
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = Number.parseInt(rawStart ?? '0', 10);
    if (!Number.isFinite(start) || start < 0 || start >= totalSize) {
      return 'unsatisfiable';
    }
    const requestedEnd = rawEnd ? Number.parseInt(rawEnd, 10) : totalSize - 1;
    if (!Number.isFinite(requestedEnd) || requestedEnd < start) {
      return 'unsatisfiable';
    }
    end = Math.min(requestedEnd, totalSize - 1, start + maxChunkBytes - 1);
  }

  return { start, end };
}

let requestCounter = 0;

function requestChunkFromPort(
  port: MessagePort,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }

    const requestId = `req-${++requestCounter}`;
    // 待つのをやめた要求は Content Script 側の上流 fetch も止め、シーク時に不要な取得が積み上がらないようにする
    const cancelUpstream = () => {
      try {
        port.postMessage({ type: 'ghvp:range-cancel', requestId });
      } catch {
        // ポートが既に閉じている場合は止める対象もない
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      cancelUpstream();
      resolve(null);
    }, 15_000);

    const onMessage = (event: MessageEvent) => {
      const data = event.data as Partial<RangeResponsePayload> | null;
      if (!data || data.type !== 'ghvp:range-response' || data.requestId !== requestId) return;
      cleanup();
      if (!data.ok || !(data.buffer instanceof ArrayBuffer)) {
        resolve(null);
        return;
      }
      resolve(data.buffer);
    };

    const onAbort = () => {
      cleanup();
      cancelUpstream();
      resolve(null);
    };

    const cleanup = () => {
      clearTimeout(timer);
      port.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };

    port.addEventListener('message', onMessage);
    port.start?.();
    signal?.addEventListener('abort', onAbort, { once: true });

    const message: RangeRequestPayload = {
      type: 'ghvp:range-request',
      requestId,
      start,
      end,
    };
    port.postMessage(message);
  });
}

/**
 * 拡張機能 Service Worker 内で `/ghvp-stream/:streamId` への Range リクエストを 206 中継するハンドラを生成する。
 */
export function createStreamFetchHandler(
  sessions: Map<string, StreamSession>,
  maxChunkBytes = DEFAULT_STREAM_CHUNK_BYTES,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(STREAM_PATH_PREFIX)) {
      return new Response('Not Found', { status: 404 });
    }

    const streamId = decodeURIComponent(url.pathname.slice(STREAM_PATH_PREFIX.length));
    const session = sessions.get(streamId);
    if (!session) {
      return new Response('Stream Not Found', { status: 404 });
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Type': session.contentType,
          'Content-Length': String(session.totalSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      });
    }

    const range = parseByteRange(request.headers.get('Range'), session.totalSize, maxChunkBytes);
    if (range === 'unsatisfiable') {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: {
          'Content-Range': `bytes */${session.totalSize}`,
        },
      });
    }

    const buffer = await requestChunkFromPort(session.port, range.start, range.end, request.signal);
    if (!buffer || buffer.byteLength === 0) {
      if (!request.signal.aborted) {
        session.port.close();
        sessions.delete(streamId);
      }
      return new Response('Stream Upstream Failed', { status: 502 });
    }

    const actualEnd = range.start + buffer.byteLength - 1;
    return new Response(buffer, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': session.contentType,
        'Content-Range': `bytes ${range.start}-${actualEnd}/${session.totalSize}`,
        'Content-Length': String(buffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  };
}
