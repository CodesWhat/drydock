import { execFile } from 'node:child_process';
import {
  getSecurityConfiguration,
  type SecuritySbomFormat,
} from '../configuration/index.js';

export type SecurityRuntimeToolStatus = {
  enabled: boolean;
  command: string;
  commandAvailable: boolean | null;
  status: 'ready' | 'missing' | 'disabled';
  message: string;
};

export interface SecurityRuntimeStatus {
  checkedAt: string;
  ready: boolean;
  scanner: SecurityRuntimeToolStatus & {
    scanner: string;
    server: string;
  };
  signature: SecurityRuntimeToolStatus;
  sbom: {
    enabled: boolean;
    formats: SecuritySbomFormat[];
  };
  requirements: string[];
}

interface CommandAvailabilityResult {
  available: boolean;
}

const COMMAND_CHECK_TIMEOUT_MS = 4_000;
const COMMAND_CHECK_BUFFER_BYTES = 256 * 1024;

function checkCommandAvailability(command: string): Promise<CommandAvailabilityResult> {
  const commandValue = `${command || ''}`.trim();
  if (!commandValue) {
    return Promise.resolve({ available: false });
  }

  return new Promise((resolve) => {
    execFile(
      commandValue,
      ['--version'],
      {
        timeout: COMMAND_CHECK_TIMEOUT_MS,
        maxBuffer: COMMAND_CHECK_BUFFER_BYTES,
        env: process.env,
      },
      (error) => {
        if (!error) {
          resolve({ available: true });
          return;
        }

        const errorCode = (error as NodeJS.ErrnoException)?.code;
        if (
          errorCode === 'ENOENT' ||
          errorCode === 'EACCES' ||
          errorCode === 'EPERM' ||
          errorCode === 'ETIMEDOUT'
        ) {
          resolve({ available: false });
          return;
        }

        // A non-zero exit code still means the command exists and can be invoked.
        resolve({ available: true });
      },
    );
  });
}

function buildDisabledToolStatus(message: string): SecurityRuntimeToolStatus {
  return {
    enabled: false,
    command: '',
    commandAvailable: null,
    status: 'disabled',
    message,
  };
}

export async function getSecurityRuntimeStatus(): Promise<SecurityRuntimeStatus> {
  const configuration = getSecurityConfiguration();

  const scannerEnabled = configuration.enabled && configuration.scanner === 'trivy';
  const scannerCommand = scannerEnabled ? configuration.trivy.command || 'trivy' : '';
  const scannerAvailability = scannerEnabled
    ? await checkCommandAvailability(scannerCommand)
    : { available: false };

  const signatureEnabled = Boolean(configuration.signature.verify);
  const signatureCommand = signatureEnabled
    ? configuration.signature.cosign.command || 'cosign'
    : '';
  const signatureAvailability = signatureEnabled
    ? await checkCommandAvailability(signatureCommand)
    : { available: false };

  const scannerStatus: SecurityRuntimeToolStatus & { scanner: string; server: string } =
    scannerEnabled
      ? {
          enabled: true,
          command: scannerCommand,
          commandAvailable: scannerAvailability.available,
          status: scannerAvailability.available ? 'ready' : 'missing',
          message: scannerAvailability.available
            ? configuration.trivy.server
              ? 'Trivy client is ready (server mode enabled)'
              : 'Trivy client is ready'
            : `Trivy command "${scannerCommand}" is not available in this runtime`,
          scanner: 'trivy',
          server: configuration.trivy.server || '',
        }
      : {
          ...buildDisabledToolStatus('Vulnerability scanner is disabled'),
          scanner: configuration.scanner || '',
          server: configuration.trivy.server || '',
        };

  const signatureStatus: SecurityRuntimeToolStatus = signatureEnabled
    ? {
        enabled: true,
        command: signatureCommand,
        commandAvailable: signatureAvailability.available,
        status: signatureAvailability.available ? 'ready' : 'missing',
        message: signatureAvailability.available
          ? 'Cosign is ready for signature verification'
          : `Cosign command "${signatureCommand}" is not available in this runtime`,
      }
    : buildDisabledToolStatus('Signature verification is disabled');

  const requirements: string[] = [];
  if (scannerEnabled && !scannerAvailability.available) {
    requirements.push(`Install trivy (configured command: "${scannerCommand}")`);
  }
  if (signatureEnabled && !signatureAvailability.available) {
    requirements.push(`Install cosign (configured command: "${signatureCommand}")`);
  }

  const ready = scannerEnabled && scannerAvailability.available;

  return {
    checkedAt: new Date().toISOString(),
    ready,
    scanner: scannerStatus,
    signature: signatureStatus,
    sbom: {
      enabled: configuration.sbom.enabled,
      formats: configuration.sbom.formats,
    },
    requirements,
  };
}
