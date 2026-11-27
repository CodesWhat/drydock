export function parseScannerJson(
  output: string,
  scannerLabel: string,
  maxOutputEnvVar: string,
): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `${scannerLabel} output was incomplete or not valid JSON (${Buffer.byteLength(output, 'utf8')} bytes received); a socket proxy or timeout may have cut the scanner stream, so check proxy timeouts, DD_SECURITY_WORKER_MEMORY and ${maxOutputEnvVar}, or set DD_SECURITY_AVAILABILITY_POLICY=warn`,
    );
  }
}
