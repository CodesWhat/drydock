/**
 * Parsing/formatting helpers for `Container.details.ports` entries (formatted strings
 * produced by `app/watchers/providers/docker/runtime-details.ts`) and the `dd.port.label`
 * Docker label. Pure functions only — no DOM/Vue imports — so they're safe to unit test
 * and reuse from any render site (detail tabs, list cell, card view).
 */

export interface ParsedContainerPort {
  raw: string;
  containerPort: number;
  protocol: 'tcp' | 'udp';
  hostIp?: string;
  hostPort?: number;
  published: boolean;
}

const UNBINDABLE_HOST_IPS = new Set(['0.0.0.0', '::', '::0']);

/** Parses a string as a finite non-negative integer (digits only), or undefined. */
function parseNonNegativeInt(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parses one entry from Container.details.ports (see format examples above). Returns
 * null for a string that doesn't parse as a port (defensive — shouldn't happen from the
 * backend, but keep this pure/safe).
 */
export function parsePortEntry(raw: string): ParsedContainerPort | null {
  const arrowIdx = raw.indexOf('->');
  const left = arrowIdx === -1 ? undefined : raw.slice(0, arrowIdx);
  const right = arrowIdx === -1 ? raw : raw.slice(arrowIdx + 2);

  const slashIdx = right.lastIndexOf('/');
  if (slashIdx === -1) {
    return null;
  }
  const portStr = right.slice(0, slashIdx);
  const protoStr = right.slice(slashIdx + 1);
  const containerPort = parseNonNegativeInt(portStr);
  if (containerPort === undefined) {
    return null;
  }
  const protocol: 'tcp' | 'udp' = protoStr === 'udp' ? 'udp' : 'tcp';

  let hostIp: string | undefined;
  let hostPort: number | undefined;
  if (left !== undefined) {
    const colonIdx = left.lastIndexOf(':');
    const hostPortStr = colonIdx === -1 ? left : left.slice(colonIdx + 1);
    hostIp = colonIdx === -1 ? undefined : left.slice(0, colonIdx);
    hostPort = parseNonNegativeInt(hostPortStr);
  }

  return {
    raw,
    containerPort,
    protocol,
    hostIp,
    hostPort,
    published: typeof hostPort === 'number' && Number.isFinite(hostPort),
  };
}

/** 443 and 8443 → https, everything else → http. */
export function detectPortScheme(port: number): 'https' | 'http' {
  return port === 443 || port === 8443 ? 'https' : 'http';
}

function wrapIpv6Host(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * Builds a clickable URL for a published port, or undefined if not published.
 * Uses parsed.hostIp when it's a real bindable address (not 0.0.0.0 / :: / ::0 / unset),
 * else falls back to `browsingHost` (caller-supplied — the UI's own hostname, or a
 * resolved agent host for agent-watched containers). IPv6 hosts get bracket-wrapped
 * (`[::1]:8080`) per URL syntax rules — only wrap if the host string contains ':' and
 * isn't already bracketed.
 */
export function buildPortLink(
  parsed: ParsedContainerPort,
  browsingHost: string,
): string | undefined {
  if (!parsed.published || parsed.hostPort === undefined) {
    return undefined;
  }

  const rawHost =
    parsed.hostIp && !UNBINDABLE_HOST_IPS.has(parsed.hostIp) ? parsed.hostIp : browsingHost;
  const host = wrapIpv6Host(rawHost);
  const scheme = detectPortScheme(parsed.containerPort);

  return `${scheme}://${host}:${parsed.hostPort}`;
}

/** Bare "80" → "80/tcp" (default protocol); "80/udp" stays "80/udp". Trims whitespace. */
export function normalizePortLabelKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.includes('/') ? trimmed : `${trimmed}/tcp`;
}

/**
 * Parses the raw dd.port.label value into a lookup map keyed by normalizePortLabelKey().
 * Comma-separated `<port>=<label>` pairs, split each pair on the FIRST '=' (so a label
 * itself may contain '=' characters). Trims whitespace off both port and label. Skips
 * entries with no '=', an empty port, or an empty (post-trim) label. Returns {} for
 * undefined/empty input.
 */
export function parsePortLabelOverrides(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }

  const overrides: Record<string, string> = {};
  for (const entry of raw.split(',')) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const portPart = entry.slice(0, eqIdx).trim();
    const labelPart = entry.slice(eqIdx + 1).trim();
    if (!portPart || !labelPart) {
      continue;
    }
    overrides[normalizePortLabelKey(portPart)] = labelPart;
  }
  return overrides;
}

export function getPortLabelOverride(
  parsed: ParsedContainerPort,
  overrides: Record<string, string>,
): string | undefined {
  return overrides[`${parsed.containerPort}/${parsed.protocol}`];
}

export interface EnrichedContainerPort {
  raw: string;
  /** dd.port.label override if one matches this port, else the raw formatted string. */
  label: string;
  /** Present only for published ports with a usable link target. */
  href?: string;
}

/**
 * Top-level convenience used by every render site: parses every port string, applies
 * label overrides, and builds link targets. Ports that fail to parse fall back to
 * {raw, label: raw, href: undefined} (rendered as inert text — fail safe, never throw).
 */
export function enrichContainerPorts(
  ports: string[],
  portLabelRaw: string | undefined,
  browsingHost: string,
): EnrichedContainerPort[] {
  const overrides = parsePortLabelOverrides(portLabelRaw);
  return ports.map((raw) => {
    const parsed = parsePortEntry(raw);
    if (!parsed) {
      return { raw, label: raw, href: undefined };
    }
    return {
      raw,
      label: getPortLabelOverride(parsed, overrides) ?? raw,
      href: buildPortLink(parsed, browsingHost),
    };
  });
}
