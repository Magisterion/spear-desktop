import { net, type Session } from 'electron';

/** Keep downloads on the player's network session (including its proxy). */
export const getNetFetchAsFetch = (session?: Session) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const options = { ...init };
    if (options.body && !options.method) options.method = 'POST';
    const request = new Request(
      input instanceof URL ? input.href : input,
      options,
    );
    try {
      return await (session ? session.fetch(request) : net.fetch(request));
    } catch (error) {
      // Do not print signed media URLs, request headers or account cookies.
      const host = new URL(request.url).hostname;
      const code =
        error instanceof Error
          ? error.message.match(/net::ERR_[A-Z_]+/)?.[0]
          : undefined;
      throw new Error(
        `Network request to ${host} failed${code ? ` (${code})` : ''}. Check Spear's proxy and connection settings. No file was saved.`,
      );
    }
  }) as typeof fetch;
