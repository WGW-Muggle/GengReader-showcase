/** The response transport is shared with integration tests; it never batches deltas. */
export function chatStreamResponse(prepared: {
  replay?: unknown;
  aborter?: AbortController;
  run?: (emit: (event: string, data: unknown) => void) => Promise<void>;
}) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const clearHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (value: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          closed = true;
          clearHeartbeat();
          prepared.aborter?.abort();
        }
      };
      const emit = (event: string, data: unknown) =>
        enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const finish = () => {
        clearHeartbeat();
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      // Open the stream immediately, including when a model spends time thinking.
      // SSE comments keep idle proxies alive without inventing answer progress.
      enqueue(': connected\n\n');
      if (prepared.replay) {
        emit('done', { message: prepared.replay });
        finish();
        return;
      }
      heartbeat = setInterval(() => enqueue(': keep-alive\n\n'), 15000);
      void prepared.run!(emit)
        .catch(() =>
          emit('error', {
            code: 'STREAM_FAILED',
            message: '连接中断，请从历史恢复讨论。',
          })
        )
        .finally(finish);
    },
    cancel() {
      closed = true;
      clearHeartbeat();
      prepared.aborter?.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-cache, no-transform',
      // Explicitly opt out of compression buffers in servers and proxies.
      'Content-Encoding': 'identity',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
