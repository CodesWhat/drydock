const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const payloadPath = path.resolve(__dirname, '../artifacts/self-update-drill/payload-healthy.json');

function readPayload() {
  return JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
}

function writePayload(payload) {
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));
}

function loadSelfUpdatePayload() {
  const payload = readPayload();
  const containerName =
    typeof payload?.name === 'string' ? payload.name.trim() : '';

  if (containerName !== '') {
    try {
      const currentContainerId = execFileSync(
        'docker',
        ['inspect', '-f', '{{.Id}}', containerName],
        { encoding: 'utf8' },
      ).trim();
      if (currentContainerId !== '' && payload.id !== currentContainerId) {
        payload.id = currentContainerId;
        writePayload(payload);
      }
    } catch {
      // Keep existing payload id as a best-effort fallback.
    }
  }

  return payload;
}

module.exports = {
  loadSelfUpdatePayload,
};
