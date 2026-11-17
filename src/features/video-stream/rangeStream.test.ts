import { describe, it, expect } from 'vitest';
import { createStreamFetchHandler, parseByteRange, type StreamSession } from './rangeStream';

describe('video-stream/rangeStream', () => {
  describe('parseByteRange', () => {
    it('caps open-ended ranges to maxChunkBytes', () => {
      expect(parseByteRange(null, 5_000_000, 1024)).toEqual({ start: 0, end: 1023 });
      expect(parseByteRange('bytes=0-', 5_000_000, 1024)).toEqual({ start: 0, end: 1023 });
      expect(parseByteRange('bytes=2000-2500', 5_000_000, 1024)).toEqual({
        start: 2000,
        end: 2500,
      });
      expect(parseByteRange('bytes=-100', 1000, 1024)).toEqual({ start: 900, end: 999 });
      expect(parseByteRange('bytes=1000-', 1000, 1024)).toBe('unsatisfiable');
    });
  });

  describe('createStreamFetchHandler', () => {
    it('serves 206 Partial Content with Content-Range via MessagePort', async () => {
      const channel = new MessageChannel();
      const sourceBytes = new Uint8Array([10, 20, 30, 40, 50, 60]);

      channel.port1.addEventListener('message', (event) => {
        const { requestId, start, end } = event.data as {
          requestId: string;
          start: number;
          end: number;
        };
        const slice = sourceBytes.slice(start, end + 1).buffer;
        channel.port1.postMessage(
          { type: 'ghvp:range-response', requestId, ok: true, buffer: slice },
          [slice],
        );
      });
      channel.port1.start();

      const sessions = new Map<string, StreamSession>([
        [
          'stream-1',
          {
            port: channel.port2,
            totalSize: sourceBytes.byteLength,
            contentType: 'video/mp4',
          },
        ],
      ]);

      const handleFetch = createStreamFetchHandler(sessions, 4);
      try {
        const headRes = await handleFetch(
          new Request('chrome-extension://test-id/ghvp-stream/stream-1', { method: 'HEAD' }),
        );
        expect(headRes.status).toBe(200);
        expect(headRes.headers.get('Content-Length')).toBe('6');
        expect(headRes.headers.get('Accept-Ranges')).toBe('bytes');

        const partRes = await handleFetch(
          new Request('chrome-extension://test-id/ghvp-stream/stream-1', {
            headers: { Range: 'bytes=1-' },
          }),
        );
        expect(partRes.status).toBe(206);
        expect(partRes.headers.get('Content-Range')).toBe('bytes 1-4/6');
        expect(partRes.headers.get('Content-Length')).toBe('4');
        expect(partRes.headers.get('Content-Type')).toBe('video/mp4');
        expect(Array.from(new Uint8Array(await partRes.arrayBuffer()))).toEqual([20, 30, 40, 50]);

        const invalidRangeRes = await handleFetch(
          new Request('chrome-extension://test-id/ghvp-stream/stream-1', {
            headers: { Range: 'bytes=99-' },
          }),
        );
        expect(invalidRangeRes.status).toBe(416);
      } finally {
        channel.port1.close();
        channel.port2.close();
      }
    });

    it('returns 502 when upstream range transfer fails', async () => {
      const channel = new MessageChannel();
      channel.port1.addEventListener('message', (event) => {
        const { requestId } = event.data as { requestId: string };
        channel.port1.postMessage({ type: 'ghvp:range-response', requestId, ok: false });
      });
      channel.port1.start();

      const sessions = new Map<string, StreamSession>([
        [
          'stream-fail',
          {
            port: channel.port2,
            totalSize: 100,
            contentType: 'video/mp4',
          },
        ],
      ]);

      const handleFetch = createStreamFetchHandler(sessions);
      try {
        const res = await handleFetch(
          new Request('chrome-extension://test-id/ghvp-stream/stream-fail', {
            headers: { Range: 'bytes=0-10' },
          }),
        );
        expect(res.status).toBe(502);
      } finally {
        channel.port1.close();
        channel.port2.close();
      }
    });
  });
});
