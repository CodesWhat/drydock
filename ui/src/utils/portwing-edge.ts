/** Helpers for registering a Portwing edge agent from the UI. */

const ED25519_KEY_BYTES = 32;
const PORTWING_IMAGE = 'ghcr.io/codeswhat/portwing:1.3.0';
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Pull the base64 public key out of what an operator pasted: either the bare
 * key or the `ed25519 <key> [comment]` line `portwing keygen -pub-from` prints.
 * Returns undefined unless it decodes to exactly 32 bytes.
 */
export function parsePublicKey(input: string): string | undefined {
  const tokens = input.trim().split(/\s+/);
  const candidate = tokens[0]?.toLowerCase() === 'ed25519' ? tokens[1] : tokens[0];
  if (!candidate || !BASE64_PATTERN.test(candidate)) {
    return undefined;
  }
  try {
    return atob(candidate).length === ED25519_KEY_BYTES ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** The trailing comment of an `ed25519 <key> <comment>` line, used to prefill the label. */
export function publicKeyComment(input: string): string {
  const tokens = input.trim().split(/\s+/);
  return tokens[0]?.toLowerCase() === 'ed25519' ? tokens.slice(2).join(' ') : '';
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Controller URL as the agent should dial it: no trailing slash; the agent adds /api/portwing/ws. */
export function normalizeControllerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function buildDockerRunSnippet(controllerUrl: string, agentName: string): string {
  return [
    'docker run -d \\',
    '  --name portwing \\',
    '  --restart unless-stopped \\',
    '  --read-only \\',
    '  --cap-drop ALL \\',
    '  --security-opt no-new-privileges:true \\',
    '  --tmpfs /tmp \\',
    '  --user 65532:65532 \\',
    `  --group-add "$(stat -c '%g' /var/run/docker.sock)" \\`,
    '  -v /var/run/docker.sock:/var/run/docker.sock:ro \\',
    '  -v portwing-stacks:/data/stacks \\',
    '  -v portwing-state:/data/credentials \\',
    '  -v "$PWD/portwing_ed25519.pem:/run/secrets/portwing_key:ro" \\',
    `  -e DRYDOCK_URL=${shellQuote(normalizeControllerUrl(controllerUrl))} \\`,
    '  -e PRIVATE_KEY_FILE=/run/secrets/portwing_key \\',
    `  -e AGENT_NAME=${shellQuote(agentName)} \\`,
    `  ${PORTWING_IMAGE}`,
  ].join('\n');
}

export function buildComposeSnippet(controllerUrl: string, agentName: string): string {
  return [
    'services:',
    '  portwing:',
    `    image: ${PORTWING_IMAGE}`,
    '    restart: unless-stopped',
    '    read_only: true',
    '    cap_drop:',
    '      - ALL',
    '    security_opt:',
    '      - no-new-privileges:true',
    '    tmpfs:',
    '      - /tmp',
    '    user: "65532:65532"',
    '    group_add:',
    '      - "${DOCKER_SOCK_GID:?set to the GID of /var/run/docker.sock}"',
    '    volumes:',
    '      - /var/run/docker.sock:/var/run/docker.sock:ro',
    '      - portwing-stacks:/data/stacks',
    '      - portwing-state:/data/credentials',
    '    environment:',
    `      - DRYDOCK_URL=${JSON.stringify(normalizeControllerUrl(controllerUrl)).slice(1, -1)}`,
    '      - PRIVATE_KEY_FILE=/run/secrets/portwing_key',
    `      - AGENT_NAME=${JSON.stringify(agentName).slice(1, -1)}`,
    '    secrets:',
    '      - portwing_key',
    '',
    'secrets:',
    '  portwing_key:',
    '    file: ./portwing_ed25519.pem',
    '',
    'volumes:',
    '  portwing-stacks:',
    '  portwing-state:',
  ].join('\n');
}
