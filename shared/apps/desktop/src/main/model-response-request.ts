export const DEFAULT_MODEL_RESPONSE_HEADERS_TIMEOUT_MS = 60_000;

/**
 * Wait for model response headers with a bounded budget.
 *
 * Important: the timeout must NOT stay attached after headers arrive. Fetch
 * binds the request signal to the response body as well, so an absolute
 * AbortSignal.timeout would abort long-running SSE streams mid-output even
 * while tokens are still flowing.
 */
export async function fetchModelResponseWithHeadersTimeout(
  input: string | URL | Request,
  init: RequestInit,
  options: {
    fetchImpl?: typeof fetch;
    headersTimeoutMs?: number;
  } = {},
): Promise<Response> {
  const timeoutMs = Math.max(
    1,
    options.headersTimeoutMs ?? DEFAULT_MODEL_RESPONSE_HEADERS_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const externalSignal = init.signal ?? undefined;
  const onExternalAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(externalSignal?.reason);
    }
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onExternalAbort);
    }
  }

  let headersTimedOut = false;
  const timer = setTimeout(() => {
    headersTimedOut = true;
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException(
          `Model response headers timed out after ${timeoutMs}ms.`,
          "TimeoutError",
        ),
      );
    }
  }, timeoutMs);
  timer.unref?.();

  try {
    const response = await (options.fetchImpl ?? fetch)(input, {
      ...init,
      signal: controller.signal,
    });
    // Headers received: drop the headers-only budget. Body streaming continues
    // under the caller's cancel signal (and the SSE inactivity reader).
    clearTimeout(timer);
    headersTimedOut = false;
    return response;
  } catch (error) {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    if (headersTimedOut && !externalSignal?.aborted) {
      throw new Error(`Model response headers timed out after ${timeoutMs}ms.`, {
        cause: error,
      });
    }
    throw error;
  }
}
