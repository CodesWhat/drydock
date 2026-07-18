import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const RC_VERSION = '1.6.0-rc.2';
const RC_DATE = '2026-07-18';
const RC_DISPLAY_DATE = 'July 18, 2026';
const DOC_ROOTS = ['content/docs/current', 'content/docs/v1.5'];

function read(path) {
  return readFileSync(path, 'utf8');
}

test('public release surfaces identify the v1.6 release candidate', () => {
  const readme = read('README.md');
  const siteConfig = read('apps/web/src/lib/site-config.ts');
  const updates = read('content/docs/current/updates/index.mdx');
  const appApi = read('content/docs/current/api/app.mdx');
  const agentApi = read('content/docs/current/api/agent.mdx');
  const portwingApi = read('content/docs/current/api/portwing.mdx');
  const quickstart = read('content/docs/current/quickstart/index.mdx');
  const changelog = read('CHANGELOG.md');

  assert.match(readme, /version-1\.6\.0--rc\.2-blue/u);
  assert.match(readme, /v1\.6\.0-rc\.2 highlights/u);
  assert.match(siteConfig, new RegExp(`version: "${RC_VERSION.replaceAll('.', '\\.')}"`, 'u'));
  assert.ok(updates.includes(`## v${RC_VERSION} Highlights — ${RC_DISPLAY_DATE}`));
  assert.match(appApi, /"version":"1\.6\.0-rc\.2"/u);
  assert.match(agentApi, /"version": "1\.6\.0-rc\.2"/u);
  assert.match(portwingApi, /"version": "1\.6\.0-rc\.2"/u);
  assert.match(portwingApi, /"drydockVersion": "1\.6\.0-rc\.2"/u);
  assert.match(quickstart, /\| `1\.6\.0-rc\.2` \| Immutable release candidate/u);
  assert.doesNotMatch(quickstart, /\| `1\.6\.0-rc\.(?!2\b)\d+` \| Immutable release candidate/u);
  assert.ok(changelog.includes(`## [${RC_VERSION}] — ${RC_DATE}`));
  assert.ok(
    changelog.includes(
      `[Unreleased]: https://github.com/CodesWhat/drydock/compare/v${RC_VERSION}...HEAD`,
    ),
  );
  assert.ok(
    changelog.includes(
      `[${RC_VERSION}]: https://github.com/CodesWhat/drydock/compare/v1.6.0-rc.1...v${RC_VERSION}`,
    ),
  );
});

test('v1.5.2 is archived and public release routing advances to v1.6', () => {
  const readme = read('README.md');
  const siteContent = read('apps/web/src/lib/site-content.ts');
  const docsVersions = read('apps/web/scripts/docs-versions.mjs');
  const archivedChangelog = read('content/docs/v1.5/changelog/index.mdx');
  const docsReadme = read('content/docs/README.md');

  assert.match(readme, /<summary><strong>v1\.5\.2 highlights<\/strong><\/summary>/u);
  assert.match(siteContent, /version: "v1\.5\.2",[\s\S]{0,500}?status: "released"/u);
  assert.match(siteContent, /version: "v1\.6\.0-rc\.2",[\s\S]{0,500}?status: "next"/u);
  assert.match(
    docsVersions,
    /\{ slug: "v1\.6", source: "current", title: "v1\.6" \},\s+\{ slug: "v1\.5", source: "v1\.5", title: "v1\.5" \}/u,
  );
  assert.match(archivedChangelog, /^## \[1\.5\.2\] — 2026-07-13$/mu);
  assert.doesNotMatch(archivedChangelog, /^## \[Unreleased\]$/mu);
  assert.doesNotMatch(archivedChangelog, /^\[Unreleased\]:/mu);
  assert.doesNotMatch(archivedChangelog, /^## \[1\.6\.0-rc\.1\]/mu);
  assert.match(
    docsReadme,
    /`v1\.5\/`: stable `1\.5` docs initialized from the published `v1\.5\.2` tag/u,
  );
  assert.match(docsReadme, /## Versioned-doc correction policy/u);
  assert.match(
    docsReadme,
    /Known-bad commands, unsafe credential examples, and incorrect behavior claims are corrected/u,
  );
  for (const relativePath of readdirSync('content/docs/v1.5', { recursive: true })) {
    if (typeof relativePath === 'string' && relativePath.endsWith('.mdx')) {
      assert.doesNotMatch(
        read(`content/docs/v1.5/${relativePath}`),
        /codeswhat\/drydock(?![:/@A-Za-z0-9._-])/u,
        `content/docs/v1.5/${relativePath} must pin Drydock images to the archived release`,
      );
    }
  }
});

test('README retains the published 150K+ pull count', () => {
  assert.match(read('README.md'), /GHCR-150K%2B_pulls/u);
});

test('current and archived docs prevent unsafe copy-paste configuration', () => {
  for (const root of DOC_ROOTS) {
    const gar = read(`${root}/configuration/registries/gar/index.mdx`);
    const dhi = read(`${root}/configuration/registries/dhi/index.mdx`);
    const hub = read(`${root}/configuration/registries/hub/index.mdx`);
    const gotify = read(`${root}/configuration/triggers/gotify/index.mdx`);
    const http = read(`${root}/configuration/triggers/http/index.mdx`);
    const rocketchat = read(`${root}/configuration/triggers/rocketchat/index.mdx`);
    const imgsets = read(`${root}/configuration/watchers/popular-imgsets.mdx`);
    const securityGuide = read(`${root}/guides/security/index.mdx`);

    assert.doesNotMatch(gar, /DD_REGISTRY_GAR_PRIVATE_PRIVATEKEY=/u);
    assert.match(gar, /DD_REGISTRY_GAR_PRIVATE_PRIVATEKEY__FILE=\/run\/secrets\/gar_private_key/u);
    assert.doesNotMatch(gar, /-----BEGIN PRIVATE KEY-----/u);
    assert.doesNotMatch(
      hub,
      /TOKEN[^\n]{0,180}(?:removed in|accepted as an alias until) v1\.6\.0/u,
    );
    if (root.endsWith('/v1.5')) {
      assert.match(hub, /`LOGIN` must be paired with `PASSWORD` or deprecated `TOKEN`/u);
      assert.match(dhi, /Required with `PASSWORD` or deprecated `TOKEN`/u);
      assert.doesNotMatch(
        dhi,
        /TOKEN[^\n]{0,180}(?:removed in|accepted as an alias until) v1\.6\.0/u,
      );
    } else {
      assert.match(hub, /`LOGIN`\+`PASSWORD`, `LOGIN`\+`TOKEN`/u);
      assert.match(dhi, /Required with `PASSWORD` or `TOKEN`/u);
    }
    assert.match(gotify, /DD_NOTIFICATION_GOTIFY_LOCAL_TOKEN=your-gotify-app-token/u);
    assert.doesNotMatch(gotify, /AWp8A\.TbBO3xpn4/u);
    assert.ok(http.includes('"includeTags":"^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$"'));
    assert.match(rocketchat, /DD_NOTIFICATION_ROCKETCHAT_LOCAL_USER_ID=your-rocketchat-user-id/u);
    assert.match(
      rocketchat,
      /DD_NOTIFICATION_ROCKETCHAT_LOCAL_AUTH_TOKEN=your-rocketchat-auth-token/u,
    );
    assert.doesNotMatch(
      rocketchat,
      /jDdn8oh9BfJKnWdDY|Rbqz90hnkRyVwRfcmE5PzkP5Pqwml_fo7ZUXzxv2_zx/u,
    );
    const imgsetExamples = {
      HOMEASSISTANT: '2026.7.0',
      TRAEFIK: '3.5.0',
      CADDY: '2.10.0',
      NGINX: '1.29.0',
      POSTGRES: '17.5',
      REDIS: '8.0',
      NODE: '22.14.0-alpine',
      N8N: '1.100.0',
      ADGUARDHOME: 'v0.107.0',
    };
    const imgsetPatterns = [
      ...imgsets.matchAll(/^ {2}- DD_WATCHER_LOCAL_IMGSET_([A-Z0-9]+)_TAG_INCLUDE=(.+)$/gmu),
    ];
    assert.equal(imgsetPatterns.length, Object.keys(imgsetExamples).length);
    for (const [, name, pattern] of imgsetPatterns) {
      assert.doesNotMatch(pattern, /\\\\/u);
      assert.match(imgsetExamples[name], new RegExp(pattern.replaceAll('$$', '$'), 'u'));
    }
    assert.match(securityGuide, /dd\.update\.mode=infrastructure/u);
    assert.match(
      securityGuide,
      /The socket proxy can use infrastructure self-update because its own container mounts the Docker socket directly/u,
    );
    assert.match(
      securityGuide,
      /DD_AUTH_BASIC_ADMIN_HASH=\$\$argon2id\$\$v=19\$\$m=65536,t=3,p=4\$\$\.\.\./u,
    );
  }
});

test('current and archived registry and trigger examples remain operational', () => {
  for (const root of DOC_ROOTS) {
    const gcr = read(`${root}/configuration/registries/gcr/index.mdx`);
    const ibmcr = read(`${root}/configuration/registries/ibmcr/index.mdx`);
    const logApi = read(`${root}/api/log.mdx`);
    const registryApi = read(`${root}/api/registry.mdx`);
    const triggers = read(`${root}/configuration/triggers/index.mdx`);

    assert.match(gcr, /Effective March 18, 2025/u);
    assert.doesNotMatch(gcr, /All `gcr\.io` traffic is now transparently served/u);
    assert.match(gcr, /Artifact Registry Reader \(`roles\/artifactregistry\.reader`\)/u);
    assert.match(
      gcr,
      /https:\/\/docs\.cloud\.google\.com\/artifact-registry\/docs\/docker\/authentication#json-key/u,
    );
    assert.doesNotMatch(gcr, /container-registry\/docs\/advanced-authentication/u);
    assert.ok(!ibmcr.includes('\\{REGISTRY_NAME\\}'));
    assert.match(registryApi, /"id": "agent1\.hub\.private"/u);
    assert.match(registryApi, /"agent": "agent1"/u);
    assert.doesNotMatch(registryApi, /dXNlcm5hbWU6cGFzc3dvcmQ=/u);
    assert.match(registryApi, /"auth": "\[REDACTED\]"/u);
    assert.match(logApi, /"component": "registry\.hub\.public"/u);
    assert.match(logApi, /"component": "api"/u);
    assert.doesNotMatch(logApi, /"component": "(?:registry:hub|api:websocket)"/u);
    assert.match(
      triggers,
      /^ {2}-e 'DD_NOTIFICATION_SMTP_GMAIL_SIMPLEBODY=[^'\n]+' \\\n {2}codeswhat\/drydock(?::v1\.5\.2)?$/mu,
    );
    assert.doesNotMatch(triggers, /^ {2}\.\.\.$/mu);
  }
});

test('current and archived container summaries document the runtime response', () => {
  for (const root of DOC_ROOTS) {
    const containerApi = read(`${root}/api/container.mdx`);

    assert.match(containerApi, /"updatesAvailable": 4/u);
    assert.match(containerApi, /"hotUpdates": 1/u);
    assert.match(containerApi, /"matureUpdates": 3/u);
    assert.match(
      containerApi,
      /\| `containers\.updatesAvailable` \| integer \| Number of containers with an available update \|/u,
    );
    assert.match(
      containerApi,
      /\| `hotUpdates` \| integer \| Number of containers with an available update whose `updateMaturityLevel` is `hot` \|/u,
    );
    assert.match(
      containerApi,
      /\| `matureUpdates` \| integer \| Number of containers with an available update whose `updateMaturityLevel` is `mature` or `established` \|/u,
    );
  }
});

test('current and archived provider setup remains copy-paste safe', () => {
  for (const root of DOC_ROOTS) {
    const oidc = read(`${root}/configuration/authentications/oidc/index.mdx`);
    const alicr = read(`${root}/configuration/registries/alicr/index.mdx`);
    const hub = read(`${root}/configuration/registries/hub/index.mdx`);
    const custom = read(`${root}/configuration/registries/custom/index.mdx`);
    const ocir = read(`${root}/configuration/registries/ocir/index.mdx`);
    const quay = read(`${root}/configuration/registries/quay/index.mdx`);
    const webhooks = read(`${root}/configuration/webhooks/index.mdx`);
    const command = read(`${root}/configuration/triggers/command/index.mdx`);
    const gotify = read(`${root}/configuration/triggers/gotify/index.mdx`);
    const storage = read(`${root}/configuration/storage/index.mdx`);
    const security = read(`${root}/guides/security/index.mdx`);
    const triggerApi = read(`${root}/api/trigger.mdx`);
    const apprise = read(`${root}/configuration/triggers/apprise/index.mdx`);
    const slack = read(`${root}/configuration/triggers/slack/index.mdx`);

    assert.doesNotMatch(oidc, /DD_AUTH_OIDC_AUTHENTIK_REDIRECT=true # optional[^\n]*\\/u);
    const authentikDocker = oidc.match(
      /<Tab value="Docker \(Authentik\)">[\s\S]*?```bash\n([\s\S]*?)```/u,
    )?.[1];
    const dexDocker = oidc.match(
      /<Tab value="Docker \(Dex\)">[\s\S]*?```bash\n([\s\S]*?)```/u,
    )?.[1];
    assert.ok(authentikDocker, `${root} must contain the Authentik Docker command`);
    assert.ok(dexDocker, `${root} must contain the Dex Docker command`);
    assert.doesNotMatch(authentikDocker, /DD_AUTH_OIDC_AUTHENTIK_REDIRECT/u);
    assert.doesNotMatch(dexDocker, /DD_AUTH_OIDC_DEX_LOGOUTURL/u);
    assert.match(oidc, /Opt in to direct Authentik redirect/u);
    assert.match(oidc, /Opt in to a real Dex logout endpoint/u);
    assert.match(oidc, /DD_AUTH_OIDC_DEX_DISCOVERY=[^\n]+\\\n {2}\.\.\.\n {2}codeswhat\/drydock/u);
    for (const hostname of [
      'registry.REGION.aliyuncs.com',
      'registry-intl.REGION.aliyuncs.com',
      'cr.aliyuncs.com',
      'cr.aliyuncs.com.cn',
    ]) {
      assert.ok(alicr.includes(hostname), `${root} AliCR docs must contain ${hostname}`);
    }
    assert.match(hub, /DD_REGISTRY_HUB_PUBLIC_(?:TOKEN|PASSWORD)=example-token/u);
    assert.match(hub, /Concatenate `login:password`/u);
    assert.match(hub, /if your login is `johndoe`/u);
    assert.match(hub, /am9obmRvZTpleGFtcGxlLXRva2Vu/u);
    assert.doesNotMatch(hub, /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/iu);
    assert.equal(hub.indexOf('base64encode.org'), -1);
    assert.match(hub, /Base64 is encoding, not encryption/u);
    assert.match(hub, /printf '%s' 'johndoe:example-token' \| base64/u);
    assert.doesNotMatch(custom, /localhost:500/u);
    assert.notEqual(custom.indexOf('https://registry.example.com'), -1);
    assert.match(ocir, /bare `ocir\.io` hostname and subdomains such as `iad\.ocir\.io`/u);
    assert.match(ocir, /tenancy-namespace\/user@example\.com/u);
    assert.match(ocir, /tenancy-namespace\/identity-domain\/user@example\.com/u);
    assert.equal(
      ocir.match(/dGVuYW5jeS9vcmFjbGVpZGVudGl0eWNsb3Vkc2VydmljZS91c2VyQGV4YW1wbGUuY29tOnh4eHh4/gu)
        ?.length,
      2,
    );
    assert.doesNotMatch(ocir, /dGVuYW5jeS91c2VyOnh4eHh4/u);
    assert.equal(quay.match(/YOUR_QUAY_ROBOT_TOKEN/gu)?.length, 2);
    assert.doesNotMatch(
      quay,
      /BA8JI3Y2BWQDH849RYT3YD5J0J6CYEORYTQMMJK364B4P88VPTJIAI704L0BBP8D6CYE4P88V/u,
    );
    assert.doesNotMatch(webhooks, /All webhook requests require a Bearer token/u);
    assert.match(webhooks, /`\/api\/v1\/webhook\/\*` requests require a Bearer token/u);
    assert.match(
      webhooks,
      /`POST \/api\/v1\/webhooks\/registry` does not use Bearer authentication/u,
    );
    assert.match(webhooks, /DD_SERVER_WEBHOOK_SECRET=your-registry-webhook-secret/u);
    assert.match(webhooks, /raw request body with HMAC-SHA256/u);
    assert.match(
      command,
      /-e 'DD_ACTION_COMMAND_LOCAL_CMD=echo \$\{display_name\} can be updated to \$\{update_kind_remote_value\}' \\\n/u,
    );
    assert.match(command, /-v \$\{PWD\}\/drydock\/trigger\.sh:\/drydock\/trigger\.sh \\\n/u);
    assert.match(storage, /-v \/path-on-my-host:\/store \\\n/u);
    assert.match(security, /DD_AUTH_OIDC_SSO_DISCOVERY=/u);
    assert.doesNotMatch(security, /DD_AUTH_OIDC_(?:ISSUER|CLIENT_ID|CLIENT_SECRET|REDIRECT_URI)=/u);
    assert.doesNotMatch(security, /setup prompt on first access/u);
    assert.match(security, /Fresh installs require authentication configuration before access/u);
    assert.doesNotMatch(apprise, /sns:\/\/[A-Z0-9]{20}\//u);
    assert.match(apprise, /replace-with-sns-access-key/u);
    assert.doesNotMatch(slack, /xox[pboa]-/u);
    assert.match(slack, /replace-with-slack-token/u);
    assert.equal(triggerApi.match(/-d "\$CONTAINER"/gu)?.length, 2);
    assert.doesNotMatch(triggerApi, /-d \$CONTAINER/u);
    assert.match(gotify, /The Gotify app token \|/u);
    assert.doesNotMatch(gotify, /Gotify app token url/u);
    assert.doesNotMatch(security, /npx argon2-cli/u);
    assert.match(
      security,
      /printf '%s' 'your-password' \| argon2 "\$\(openssl rand -base64 32\)" -id -m 16 -t 3 -p 4 -l 64 -e/u,
    );

    const registryRoot = `${root}/configuration/registries`;
    for (const relativePath of readdirSync(registryRoot, { recursive: true })) {
      if (typeof relativePath === 'string' && relativePath.endsWith('.mdx')) {
        assert.ok(
          !read(`${registryRoot}/${relativePath}`).includes('\\{REGISTRY_NAME\\}'),
          `${registryRoot}/${relativePath} must use a copyable registry placeholder`,
        );
      }
    }
  }
});

test('current and archived docs describe destructive and recovery behavior accurately', () => {
  for (const root of DOC_ROOTS) {
    const actions = read(`${root}/configuration/actions/index.mdx`);
    const authentications = read(`${root}/configuration/authentications/index.mdx`);
    const security = read(`${root}/configuration/security/index.mdx`);
    const selfUpdate = read(`${root}/configuration/self-update/index.mdx`);
    const deprecations = read(`${root}/deprecations/index.mdx`);

    assert.match(
      actions,
      /\*\*Delete\*\*[\s\S]{0,180}?Remove the container from Drydock tracking/u,
    );
    assert.match(actions, /does not delete the runtime container/u);
    assert.match(
      authentications,
      /Authentication protects all API routes and UI views unless anonymous access is enabled\. Fresh installs must opt in with `DD_ANONYMOUS_AUTH_CONFIRM=true`/u,
    );
    assert.match(
      authentications,
      /legacy upgrades without configured authentication retain anonymous access with a startup warning/u,
    );
    assert.match(security, /sbom\?format=\{format\}/u);
    assert.doesNotMatch(security, /sbom\?format=\\\{format\\\}/u);
    assert.doesNotMatch(selfUpdate, /zero downtime/iu);
    assert.match(selfUpdate, /stops the old container before starting its replacement/u);
    assert.match(selfUpdate, /`queued` and `pulling` self-update phases expire at startup/u);
    assert.match(
      selfUpdate,
      /Fresh in-progress self-updates outside `pulling` receive a 10-minute grace window/u,
    );
    assert.match(selfUpdate, /must be re-triggered manually/u);
    assert.match(
      selfUpdate,
      /uses the bind-mounted socket from that infrastructure container's own specification/u,
    );
    assert.doesNotMatch(selfUpdate, /bind-mounted socket from Drydock's container directly/u);
    assert.match(deprecations, /Detection methods and warning behavior vary by feature/u);
    assert.doesNotMatch(deprecations, /emit warnings at startup or in the UI/u);
  }
});

test('current and archived release examples use consistent tags, filenames, dates, and anchors', () => {
  for (const root of DOC_ROOTS) {
    const verification = read(`${root}/guides/verifying-releases/index.mdx`);
    const quickstart = read(`${root}/quickstart/index.mdx`);
    const appApi = read(`${root}/api/app.mdx`);

    assert.match(verification, /The examples on this page use `v1\.5\.2` as a placeholder/u);
    assert.doesNotMatch(verification, /TAG="v1\.5\.0(?:-rc\.9)?"/u);
    assert.equal(verification.match(/^TAG="v1\.5\.2"$/gmu)?.length, 2);
    assert.equal(
      verification.match(
        /--signer-workflow CodesWhat\/drydock\/\.github\/workflows\/release-cut\.yml/gu,
      )?.length,
      2,
    );
    assert.doesNotMatch(verification, /release workflow on the matching tag/u);
    assert.doesNotMatch(verification, /offline-capable/u);
    assert.match(verification, /Verification is not fully offline/u);
    assert.match(verification, /Sigstore's trusted root through TUF/u);
    for (const image of [
      'ghcr.io/codeswhat/drydock:1.5.2',
      'docker.io/codeswhat/drydock:1.5.2',
      'quay.io/codeswhat/drydock:1.5.2',
      'oci://ghcr.io/codeswhat/drydock:1.5.2',
    ]) {
      assert.ok(verification.includes(image), `${root} docs must contain ${image}`);
    }
    for (const suffix of ['', '.sha256', '.sig', '.pem', '.bundle', '.intoto.jsonl']) {
      assert.ok(verification.includes(`drydock-\${TAG}.tar.gz${suffix}`));
    }
    assert.ok(verification.includes('curl -fsSLO "${BASE_URL}/${ARCHIVE}.bundle"'));
    assert.doesNotMatch(verification, /drydock-v<tag>\.tar\.gz/u);
    assert.doesNotMatch(quickstart, /\/docs\/configuration\/watchers\/#docker-socket-security/u);
    assert.equal(
      quickstart.match(/\/docs\/configuration\/watchers#docker-socket-security/gu)?.length,
      3,
    );
    assert.match(appApi, /"checkedAt": "2026-03-18T19:33:00\.000Z"/u);
    assert.match(appApi, /drydock-debug-dump-2026-03-18T19-33-00-000Z\.json/u);
  }

  assert.match(
    read('.gitattributes'),
    /^# Suppress whitespace-error checks for the v1\.5 source snapshot during Git validation\.$/mu,
  );
});
