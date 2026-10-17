/** Keeps a completed model turn durable when shadow memory throws. */
export async function rememberExchangeSafely<T extends { memory?: unknown; shadow: { changed: string[]; skillName: string } }>(
  remember: () => Promise<T>,
  report: (detail: string) => Promise<unknown> | unknown
): Promise<T> {
  try {
    return await remember();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await report(detail);
    return {
      memory: null,
      shadow: { changed: [], skillName: "" }
    } as T;
  }
}
