import { useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";
import type { DirectTcpHostConnection, HostProfile } from "@/types/host-connection";
import { buildDaemonWebSocketUrl } from "@/utils/daemon-endpoints";

function directTcpConnectionForHttp(
  host: HostProfile | undefined,
): DirectTcpHostConnection | undefined {
  if (!host) return undefined;
  const preferred = host.preferredConnectionId
    ? host.connections.find((connection) => connection.id === host.preferredConnectionId)
    : undefined;
  if (preferred?.type === "directTcp") return preferred;
  return host.connections.find(
    (connection): connection is DirectTcpHostConnection => connection.type === "directTcp",
  );
}

/**
 * The `http(s)://` origin of a host's daemon, derived from its direct-TCP WebSocket
 * endpoint.
 *
 * Returns null when the host is unknown, or when it is reachable only over a socket,
 * pipe, or the relay — none of which have an origin a plain `fetch` could hit. Callers
 * use this for the daemon's REST surface (`/api/pets`, ...) and must treat null as
 * "this host serves no HTTP", not as an error.
 *
 * Any basic-auth credentials on the endpoint are dropped: `URL.origin` excludes them,
 * and embedding them in an image URL would leak them into the view hierarchy.
 */
export function serverHttpBaseUrl(host: HostProfile | undefined): string | null {
  const connection = directTcpConnectionForHttp(host);
  if (!connection) return null;

  try {
    const parsed = new URL(
      buildDaemonWebSocketUrl(connection.endpoint, { useTls: connection.useTls ?? false }),
    );
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Bearer header for REST calls to a password-protected direct daemon. */
export function serverHttpAuthorizationHeader(host: HostProfile | undefined): string | null {
  const connection = directTcpConnectionForHttp(host);
  const password = connection?.password?.trim();
  return password ? `Bearer ${password}` : null;
}

export function useServerHttpBaseUrl(serverId: string | null): string | null {
  const hosts = useHosts();
  return useMemo(() => {
    if (!serverId) return null;
    return serverHttpBaseUrl(hosts.find((host) => host.serverId === serverId));
  }, [hosts, serverId]);
}

export function useServerHttpAuthorizationHeader(serverId: string | null): string | null {
  const hosts = useHosts();
  return useMemo(() => {
    if (!serverId) return null;
    return serverHttpAuthorizationHeader(hosts.find((host) => host.serverId === serverId));
  }, [hosts, serverId]);
}
