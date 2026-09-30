/**
 * Compatibility wrapper retained for existing callers. Model headers and body
 * wait until the provider responds, the transport fails, or the caller cancels.
 */
export async function fetchModelResponseWithHeadersTimeout(
  input: string | URL | Request,
  init: RequestInit,
  options: {
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Response> {
  return (options.fetchImpl ?? fetch)(input, init);
}
