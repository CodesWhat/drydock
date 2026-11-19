const MAC_ADDRESS_PATTERN = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;

type ComposeDocument = {
  services?: unknown;
  networks?: unknown;
};

type ComposeMacIntentInput = {
  /** Parsed compose documents, in override order (later files win). */
  composeDocuments: ComposeDocument[];
  service: string;
  /** `com.docker.compose.project` label of the running container. */
  project: string | undefined;
  /** Names of the networks the running container is attached to. */
  runtimeNetworkNames: string[];
  /** Network Docker treats as primary for the running container. */
  primaryNetworkName: string | undefined;
  warn?: (message: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMac(
  value: unknown,
  describe: string,
  warn: ((message: string) => void) | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (MAC_ADDRESS_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase().replaceAll('-', ':');
  }
  warn?.(
    `Ignore ${describe} mac_address "${trimmed}" because it is not a literal MAC address ` +
      '(interpolated values cannot be resolved from the running container)',
  );
  return undefined;
}

/**
 * Read the MAC addresses a Compose service explicitly configures and map them
 * to the runtime network names of the running container. Docker's inspect
 * output cannot tell a configured MAC from a daemon-generated one, so the only
 * authoritative source is the Compose definition. Anything that cannot be
 * resolved unambiguously is skipped, never guessed.
 */
function resolveExplicitComposeMacAddresses(input: ComposeMacIntentInput): Record<string, string> {
  const { composeDocuments, service, project, runtimeNetworkNames, primaryNetworkName, warn } =
    input;

  let serviceMac: string | undefined;
  const networkMacs = new Map<string, string>();
  const networkDefinitions = new Map<string, Record<string, unknown>>();

  for (const document of composeDocuments) {
    if (isRecord(document?.networks)) {
      for (const [key, definition] of Object.entries(document.networks)) {
        networkDefinitions.set(key, {
          ...networkDefinitions.get(key),
          ...(isRecord(definition) ? definition : {}),
        });
      }
    }

    const serviceDefinition = isRecord(document?.services) ? document.services[service] : undefined;
    if (!isRecord(serviceDefinition)) {
      continue;
    }
    if (serviceDefinition.mac_address !== undefined) {
      serviceMac = normalizeMac(serviceDefinition.mac_address, `service ${service}`, warn);
    }
    const serviceNetworks = serviceDefinition.networks;
    if (isRecord(serviceNetworks)) {
      for (const [key, attachment] of Object.entries(serviceNetworks)) {
        if (isRecord(attachment) && attachment.mac_address !== undefined) {
          const mac = normalizeMac(attachment.mac_address, `network ${key} of ${service}`, warn);
          if (mac) {
            networkMacs.set(key, mac);
          } else {
            networkMacs.delete(key);
          }
        }
      }
    }
  }

  const toRuntimeNetworkName = (key: string): string | undefined => {
    const definition = networkDefinitions.get(key);
    const declaredName = definition?.name;
    let candidate: string | undefined;
    if (typeof declaredName === 'string') {
      candidate = declaredName.includes('$') ? undefined : declaredName;
    } else if (definition?.external !== undefined && definition.external !== false) {
      candidate = key;
    } else if (project) {
      candidate = `${project}_${key}`;
    }
    return candidate !== undefined && runtimeNetworkNames.includes(candidate)
      ? candidate
      : undefined;
  };

  const explicit: Record<string, string> = {};
  for (const [key, mac] of networkMacs) {
    const runtimeName = toRuntimeNetworkName(key);
    if (runtimeName) {
      explicit[runtimeName] = mac;
    } else {
      warn?.(
        `Ignore mac_address for network ${key} of ${service} because it does not match a network of the running container`,
      );
    }
  }

  // Compose applies a service-level mac_address to the primary network only
  // and lets a per-network address take precedence.
  if (serviceMac && networkMacs.size === 0 && primaryNetworkName) {
    explicit[primaryNetworkName] = serviceMac;
  }
  return explicit;
}

export { resolveExplicitComposeMacAddresses };
