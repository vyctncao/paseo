import { describe, expect, it, vi } from "vitest";
import type { HostProfile } from "@/types/host-connection";
import { serverHttpAuthorizationHeader, serverHttpBaseUrl } from "./use-server-http-base-url";

vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));

function hostWithConnections(
  connections: HostProfile["connections"],
  preferredConnectionId: string | null,
): HostProfile {
  return {
    serverId: "host-1",
    label: "Host",
    lifecycle: {},
    connections,
    preferredConnectionId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("daemon HTTP helpers", () => {
  it("uses one preferred direct connection for the origin and bearer header", () => {
    const host = hostWithConnections(
      [
        {
          id: "direct-old",
          type: "directTcp",
          endpoint: "old.example.test:6767",
          password: "old-secret",
        },
        {
          id: "direct-current",
          type: "directTcp",
          endpoint: "current.example.test:443",
          useTls: true,
          password: "current-secret",
        },
      ],
      "direct-current",
    );

    expect(serverHttpBaseUrl(host)).toBe("https://current.example.test");
    expect(serverHttpAuthorizationHeader(host)).toBe("Bearer current-secret");
  });

  it("falls back to the first direct connection when another transport is preferred", () => {
    const host = hostWithConnections(
      [
        { id: "relay", type: "relay", relayEndpoint: "relay.test", daemonPublicKeyB64: "key" },
        {
          id: "direct",
          type: "directTcp",
          endpoint: "localhost:6767",
          password: " secret ",
        },
      ],
      "relay",
    );

    expect(serverHttpBaseUrl(host)).toBe("http://localhost:6767");
    expect(serverHttpAuthorizationHeader(host)).toBe("Bearer secret");
  });

  it("returns null when the host has no direct HTTP transport", () => {
    const host = hostWithConnections(
      [{ id: "socket", type: "directSocket", path: "/tmp/paseo.sock" }],
      "socket",
    );

    expect(serverHttpBaseUrl(host)).toBeNull();
    expect(serverHttpAuthorizationHeader(host)).toBeNull();
  });
});
