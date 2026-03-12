export const DEFAULT_API_PROXY_TARGET = "http://localhost:3100";

export function resolveApiProxyTarget(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw =
    (env.VITE_API_PROXY_TARGET || env.ORCHESTORAI_API_URL || DEFAULT_API_PROXY_TARGET).trim();
  if (!raw) {
    return DEFAULT_API_PROXY_TARGET;
  }
  return raw.replace(/\/+$/, "") || DEFAULT_API_PROXY_TARGET;
}
