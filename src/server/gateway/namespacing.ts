const SEPARATOR = "__";

export function encodeName(serverKey: string, originalName: string): string {
  return `${serverKey}${SEPARATOR}${originalName}`;
}

export function decodeName(
  namespacedName: string
): { serverKey: string; originalName: string } | null {
  const idx = namespacedName.indexOf(SEPARATOR);
  if (idx === -1) return null;
  return {
    serverKey: namespacedName.slice(0, idx),
    originalName: namespacedName.slice(idx + SEPARATOR.length),
  };
}

export function encodeResourceUri(serverKey: string, uri: string): string {
  return `gateway://${serverKey}/${encodeURIComponent(uri)}`;
}

export function decodeResourceUri(
  gatewayUri: string
): { serverKey: string; originalUri: string } | null {
  const match = /^gateway:\/\/([^/]+)\/(.+)$/.exec(gatewayUri);
  if (!match) return null;
  const [, serverKey, encoded] = match;
  try {
    return { serverKey, originalUri: decodeURIComponent(encoded) };
  } catch {
    return null;
  }
}

export function isValidServerKey(key: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(key) && !key.includes(SEPARATOR);
}
