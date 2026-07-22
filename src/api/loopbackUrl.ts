const LOOPBACK_HOST = "127.0.0.1" as const;

export function buildLoopbackHttpUrl(
  host: string,
  port: number,
  path: `/${string}`,
): string {
  if (host !== LOOPBACK_HOST) {
    throw new Error(`Only ${LOOPBACK_HOST} is permitted for local runtime requests.`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Loopback runtime port must be an integer between 1 and 65535.");
  }
  if (path.startsWith("//") || path.includes("\\")) {
    throw new Error("Loopback runtime path must be an absolute local path.");
  }
  return `http://127.0.0.1:${port}${path}`;
}
