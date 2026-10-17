type OAuthCallback = (url: string) => void | Promise<void>;

export function createOAuthCallbackHandler(callback: OAuthCallback) {
  return async (_event: unknown, url: string): Promise<void> => {
    try {
      await callback(url);
    } catch {
      // The renderer owns business error presentation. Keep an IPC listener failure from becoming
      // an unhandled rejection in the preload bridge.
    }
  };
}
