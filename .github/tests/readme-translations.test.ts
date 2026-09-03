import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const translatedReadmes = [
  'README.de.md',
  'README.es.md',
  'README.fr.md',
  'README.pl.md',
  'README.pt-BR.md',
  'README.zh-CN.md',
];
const allReadmes = ['README.md', ...translatedReadmes];
const sourceReadme = readFileSync(`${repoRoot}/README.md`, 'utf8');
const sourceUrls = [...sourceReadme.matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url).sort();
const localizedBehaviorFragments: Record<
  string,
  { homeAssistantUpdate: string; portwingEventSource: string; rawInventoryAuthority: string }
> = {
  'README.de.md': {
    homeAssistantUpdate: 'Installieren-Schaltfläche ein echtes Update auslöst',
    portwingEventSource: 'Portwing bleibt Ereignisquelle',
    rawInventoryAuthority: 'Rohinventar kann Controller-Ergebnisse nicht löschen',
  },
  'README.es.md': {
    homeAssistantUpdate: 'botón Instalar ejecuta una actualización real',
    portwingEventSource: 'Portwing sigue siendo la fuente de eventos',
    rawInventoryAuthority: 'inventario sin procesar no puede borrar resultados del controlador',
  },
  'README.fr.md': {
    homeAssistantUpdate: 'bouton Installer déclenche une véritable mise à jour',
    portwingEventSource: 'Portwing reste la source des événements de cycle de vie',
    rawInventoryAuthority:
      'inventaire brut ne peut pas effacer les résultats de mise à jour enrichis par le contrôleur',
  },
  'README.pl.md': {
    homeAssistantUpdate: 'przycisk Instaluj uruchamia rzeczywistą aktualizację',
    portwingEventSource: 'Portwing pozostaje źródłem zdarzeń cyklu życia',
    rawInventoryAuthority:
      'surowy spis nie może usunąć wyników aktualizacji wzbogaconych przez kontroler',
  },
  'README.pt-BR.md': {
    homeAssistantUpdate: 'botão Instalar aciona uma atualização real',
    portwingEventSource: 'Portwing continua sendo a fonte de eventos de ciclo de vida',
    rawInventoryAuthority:
      'inventário bruto não pode apagar resultados de atualização enriquecidos pelo controlador',
  },
  'README.zh-CN.md': {
    homeAssistantUpdate: '“安装”按钮会触发实际更新',
    portwingEventSource: 'Portwing 仍是生命周期事件源',
    rawInventoryAuthority: '原始清单无法抹除控制器增强的更新结果',
  },
};

const localizedSurfaceFragments: Record<
  string,
  {
    featureTableHeader: string;
    builtWithHeading: string;
    communityQaHeading: string;
    releaseHeading: string;
  }
> = {
  'README.de.md': {
    featureTableHeader: '| | Funktion | Beschreibung |',
    builtWithHeading: '<h2 align="center" id="built-with">Gebaut mit</h2>',
    communityQaHeading: '### Community-QA',
    releaseHeading: '<summary><strong>Highlights von v1.7.0-rc.8</strong></summary>',
  },
  'README.es.md': {
    featureTableHeader: '| | Característica | Descripción |',
    builtWithHeading: '<h2 align="center" id="built-with">Construido con</h2>',
    communityQaHeading: '### Control de calidad de la comunidad',
    releaseHeading: '<summary><strong>Aspectos destacados de v1.7.0-rc.8</strong></summary>',
  },
  'README.fr.md': {
    featureTableHeader: '| | Fonctionnalité | Descriptif |',
    builtWithHeading: '<h2 align="center" id="built-with">Construit avec</h2>',
    communityQaHeading: '### Contrôle qualité de la communauté',
    releaseHeading: '<summary><strong>Points forts de la v1.7.0-rc.8</strong></summary>',
  },
  'README.pl.md': {
    featureTableHeader: '| | Funkcja | Opis |',
    builtWithHeading: '<h2 align="center" id="built-with">Zbudowany z</h2>',
    communityQaHeading: '### Kontrola jakości społeczności',
    releaseHeading:
      '<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.8</strong></summary>',
  },
  'README.pt-BR.md': {
    featureTableHeader: '| | Recurso | Descrição |',
    builtWithHeading: '<h2 align="center" id="built-with">Construído com</h2>',
    communityQaHeading: '### Controle de qualidade da comunidade',
    releaseHeading: '<summary><strong>Destaques da v1.7.0-rc.8</strong></summary>',
  },
  'README.zh-CN.md': {
    featureTableHeader: '| |特色|描述 |',
    builtWithHeading: '<h2 align="center" id="built-with">技术栈</h2>',
    communityQaHeading: '### 社区质量检查',
    releaseHeading: '<summary><strong>v1.7.0-rc.8 亮点</strong></summary>',
  },
};

const localizedReleaseFragments: Record<
  string,
  {
    digestPin: string;
    selfUpdateCleanup: string;
    snapshotPrune: string;
    registryLookup: string;
    phantomAgent: string;
    unknownRegistry: string;
    debugDump: string;
    qaSweep: string;
  }
> = {
  'README.de.md': {
    digestPin:
      '**Die Docker-native und die Compose-Update-Pfade pinnen jetzt einen unveränderlichen Digest des gezogenen Images vor Signaturprüfung, Scan und Ersetzung**',
    selfUpdateCleanup:
      '**Ein Self-Update macht einen bereits gesundheitsgeprüften Ersatz nicht mehr rückgängig, wenn die Bereinigung des alten Containers fehlschlägt**',
    snapshotPrune:
      'der Watcher-Snapshot-Handler behandelt eine leere Container-Liste nicht mehr als Massenentfernung',
    registryLookup:
      '**`dd.registry.lookup.image` gilt jetzt auch für Container, die von Controller-Docker-Transport-Agents gemeldet werden**',
    phantomAgent:
      '**`DD_AGENT_ALLOW_INSECURE_SECRET` erzeugt keinen Phantom-Agent namens `allow` mehr**',
    unknownRegistry:
      'ein Container, der als `unknown` markiert war, bevor seine Registry konfiguriert wurde, erholt sich jetzt bei der Aktualisierung',
    debugDump:
      '**Debug-Dumps redigieren jetzt Apprise-Service-URLs, Rocket.Chat-Benutzer-IDs und Telegram-Chat-IDs**',
    qaSweep: '**Vier Fixes aus dem QA-Sweep von rc.6 landen**',
  },
  'README.es.md': {
    digestPin:
      '**Las rutas de actualización nativa de Docker y de Compose ahora fijan un digest inmutable de la imagen extraída antes de la verificación de firma, el escaneo y el reemplazo**',
    selfUpdateCleanup:
      '**La autoactualización ya no revierte un reemplazo verificado por salud cuando falla la limpieza del contenedor antiguo**',
    snapshotPrune:
      'el manejador de instantáneas del watcher deja de tratar una lista de contenedores vacía como una eliminación masiva',
    registryLookup:
      '**`dd.registry.lookup.image` ahora se aplica a los contenedores reportados por agentes de transporte Docker del controlador**',
    phantomAgent:
      '**`DD_AGENT_ALLOW_INSECURE_SECRET` ya no crea un agente fantasma llamado `allow`**',
    unknownRegistry:
      'un contenedor marcado como `unknown` antes de configurar su registro ahora se recupera al actualizar',
    debugDump:
      '**Los volcados de depuración redactan las URL de servicio de Apprise, los ID de usuario de Rocket.Chat y los ID de chat de Telegram**',
    qaSweep: '**Llegan cuatro correcciones del barrido de control de calidad de rc.6**',
  },
  'README.fr.md': {
    digestPin:
      "**Les chemins de mise à jour Docker natif et Compose épinglent désormais un digest immuable de l'image récupérée avant la vérification de signature, l'analyse et le remplacement**",
    selfUpdateCleanup:
      "**Une auto-mise à jour n'annule plus un remplacement vérifié par le contrôle de santé lorsque le nettoyage de l'ancien conteneur échoue**",
    snapshotPrune:
      "le gestionnaire d'instantané du watcher ne traite plus une liste de conteneurs vide comme une suppression massive",
    registryLookup:
      "**`dd.registry.lookup.image` s'applique désormais aux conteneurs signalés par les agents à transport Docker du contrôleur**",
    phantomAgent: "**`DD_AGENT_ALLOW_INSECURE_SECRET` ne crée plus d'agent fantôme nommé `allow`**",
    unknownRegistry:
      "un conteneur marqué `unknown` avant la configuration de son registre se rétablit désormais à l'actualisation",
    debugDump:
      '**Les vidages de débogage occultent désormais les URL de service Apprise, les ID utilisateur Rocket.Chat et les ID de discussion Telegram**',
    qaSweep: '**Quatre correctifs du balayage QA de la rc.6 arrivent**',
  },
  'README.pl.md': {
    digestPin:
      '**Ścieżki aktualizacji natywnej Docker i Compose przypinają teraz niezmienny skrót pobranego obrazu przed weryfikacją podpisu, skanowaniem i podmianą**',
    selfUpdateCleanup:
      '**Samoaktualizacja nie wycofuje już zweryfikowanej pod względem kondycji podmiany, gdy czyszczenie starego kontenera się nie powiedzie**',
    snapshotPrune:
      'moduł obsługi migawek watchera przestaje traktować pustą listę kontenerów jako masowe usunięcie',
    registryLookup:
      '**`dd.registry.lookup.image` dotyczy teraz kontenerów zgłaszanych przez agentów transportu Docker kontrolera**',
    phantomAgent:
      '**`DD_AGENT_ALLOW_INSECURE_SECRET` nie tworzy już agenta widmo o nazwie `allow`**',
    unknownRegistry:
      'kontener oznaczony jako `unknown` przed skonfigurowaniem rejestru teraz odzyskuje stan przy odświeżeniu',
    debugDump:
      '**Zrzuty debugowania ukrywają teraz adresy URL usługi Apprise, identyfikatory użytkowników Rocket.Chat i identyfikatory czatów Telegram**',
    qaSweep: '**Cztery poprawki z przeglądu QA rc.6 trafiają do wydania**',
  },
  'README.pt-BR.md': {
    digestPin:
      '**Os caminhos de atualização nativa do Docker e do Compose agora fixam um digest imutável da imagem baixada antes da verificação de assinatura, da varredura e da substituição**',
    selfUpdateCleanup:
      '**A autoatualização não reverte mais uma substituição verificada por saúde quando a limpeza do contêiner antigo falha**',
    snapshotPrune:
      'o manipulador de snapshot do watcher para de tratar uma lista de contêineres vazia como uma remoção em massa',
    registryLookup:
      '**`dd.registry.lookup.image` agora se aplica a contêineres reportados por agentes de transporte Docker do controlador**',
    phantomAgent:
      '**`DD_AGENT_ALLOW_INSECURE_SECRET` não cria mais um agente fantasma chamado `allow`**',
    unknownRegistry:
      'um contêiner marcado como `unknown` antes de seu registro ser configurado agora se recupera na atualização',
    debugDump:
      '**Os dumps de depuração agora redigem URLs de serviço do Apprise, IDs de usuário do Rocket.Chat e IDs de chat do Telegram**',
    qaSweep: '**Chegam quatro correções da varredura de QA da rc.6**',
  },
  'README.zh-CN.md': {
    digestPin:
      '**Docker 原生和 Compose 更新路径现在会在签名验证、扫描和替换之前锁定已拉取镜像的不可变摘要**',
    selfUpdateCleanup: '**当旧容器清理失败时，自更新不再回滚已通过健康检查的替换**',
    snapshotPrune: 'watcher 快照处理器也不再将空容器列表当作批量删除处理',
    registryLookup: '**`dd.registry.lookup.image` 现在适用于由控制器 Docker 传输代理上报的容器**',
    phantomAgent: '**`DD_AGENT_ALLOW_INSECURE_SECRET` 不再创建名为 `allow` 的幽灵代理**',
    unknownRegistry: '在配置注册表之前被标记为 `unknown` 的容器现在会在刷新时恢复',
    debugDump:
      '**调试转储现在会对 Apprise 服务 URL、Rocket.Chat 用户 ID 和 Telegram 聊天 ID 进行脱敏**',
    qaSweep: '**rc.6 QA 排查中的四项修复已合入**',
  },
};

const balancedTagPairs = [
  { name: 'details', opening: /<details(?:\s[^>]*)?>/g, closing: /<\/details>/g },
  { name: 'summary', opening: /<summary>/g, closing: /<\/summary>/g },
  { name: 'emphasis', opening: /<em>/g, closing: /<\/em>/g },
];

function getReleaseBlock(content: string, heading: string): string {
  const headingIndex = content.indexOf(heading);
  const startIndex = content.lastIndexOf('<details', headingIndex);
  const endIndex = content.indexOf('</details>', headingIndex);

  if (headingIndex === -1 || startIndex === -1 || endIndex === -1) {
    throw new Error(`could not find release block for ${heading}`);
  }

  return content.slice(startIndex, endIndex);
}

function getBullet(block: string, fragment: string): string | undefined {
  return block.split('\n').find((line) => line.startsWith('- ') && line.includes(fragment));
}

const forbiddenSourceEnglishProse = [
  'Most tools force a tradeoff.',
  'Nothing changes until you say so.',
  'Data based on publicly available documentation as of March 2026.',
  'Drydock v1.6 no longer loads `WUD_*` environment variables',
  'This direction covers at least the next twelve months',
  'High-level themes only; see [CHANGELOG.md](CHANGELOG.md)',
];

const requiredFragments = [
  'img.shields.io/github/v/release/CodesWhat/drydock?include_prereleases',
  'img.shields.io/github/license/CodesWhat/drydock',
  'img.shields.io/docker/pulls/codeswhat/drydock',
  'img.shields.io/github/stars/CodesWhat/drydock',
  'https://www.bestpractices.dev/projects/11915',
  '`drydock.sid`',
  '`allowmetadata=true`',
  '`DD_NOTIFICATION_HTTP_*`',
  'DEPRECATIONS.md#enforced-security-changes-no-deprecation-window',
  'v1.6.0-rc.13',
  'v1.6.0-rc.12',
  'v1.6.0-rc.11',
  './CHANGELOG.md#160--2026-08-11',
  './CHANGELOG.md#170-rc1--2026-08-14',
  './CHANGELOG.md#170-rc2--2026-08-20',
  './CHANGELOG.md#170-rc3--2026-08-23',
  './CHANGELOG.md#170-rc4--2026-08-26',
  './CHANGELOG.md#170-rc5--2026-08-27',
  './CHANGELOG.md#170-rc6--2026-08-29',
  './CHANGELOG.md#170-rc7--2026-08-29',
  './CHANGELOG.md#170-rc8--2026-09-03',
  'Portwing 0.9.0+',
  'Standard HTTP',
  '`DD_EXPERIMENTAL_PORTWING=false`',
  '2027',
  '[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)',
  '[`GOVERNANCE.md`](GOVERNANCE.md)',
  '[`SECURITY-ASSURANCE.md`](SECURITY-ASSURANCE.md)',
  '[`SECURITY.md`](SECURITY.md)',
  'https://github.com/CodesWhat/drydock/stargazers',
  'docs/assets/star-history.svg',
];

describe.each(translatedReadmes)('%s', (readme) => {
  const content = readFileSync(`${repoRoot}/${readme}`, 'utf8');

  test('carries every current language-neutral README contract', () => {
    for (const fragment of requiredFragments) {
      expect(content, `missing ${fragment}`).toContain(fragment);
    }
  });

  test('carries both security migration warnings', () => {
    expect(content.match(/^> \[!WARNING\]$/gm)).toHaveLength(2);
    expect(content).toContain('`401`');
    expect(content).toContain('`503`');
  });

  test('does not retain superseded release or star-history markup', () => {
    expect(content).not.toContain('img.shields.io/badge/version-');
    expect(content).not.toContain('GHCR-150K%2B_pulls');
    expect(content).not.toContain('https://api.star-history.com/svg');
    expect(content).not.toContain('https://star-history.com/#');
  });

  test('preserves Home Assistant update and Portwing result-authority behavior', () => {
    const behavior = localizedBehaviorFragments[readme];
    expect(content).toContain(behavior.homeAssistantUpdate);
    expect(content).toContain(behavior.portwingEventSource);
    expect(content).toContain(behavior.rawInventoryAuthority);
  });

  test('keeps public README labels in the target language', () => {
    const surface = localizedSurfaceFragments[readme];
    expect(content).toContain(surface.featureTableHeader);
    expect(content).toContain(surface.builtWithHeading);
    expect(content).toContain(surface.communityQaHeading);
    expect(content).toContain(surface.releaseHeading);
  });

  test('maps localized v1.7 release bullets to their source links', () => {
    const surface = localizedSurfaceFragments[readme];
    const release = localizedReleaseFragments[readme];
    const releaseBlock = getReleaseBlock(content, surface.releaseHeading);
    const releaseBullets = [
      release.digestPin,
      release.selfUpdateCleanup,
      release.registryLookup,
      release.phantomAgent,
      release.debugDump,
      release.qaSweep,
    ].map((fragment) => getBullet(releaseBlock, fragment));
    const getUrls = (bullet: string | undefined) =>
      [...(bullet ?? '').matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url);

    expect(releaseBullets.every(Boolean)).toBe(true);
    expect(releaseBullets[1]).toContain(release.snapshotPrune);
    expect(releaseBullets[3]).toContain(release.unknownRegistry);
    expect(releaseBullets.flatMap(getUrls).sort()).toEqual([
      'https://github.com/CodesWhat/drydock/pull/928',
      'https://github.com/CodesWhat/drydock/pull/929',
      'https://github.com/CodesWhat/drydock/pull/951',
      'https://github.com/CodesWhat/drydock/pull/952',
      'https://github.com/CodesWhat/drydock/pull/953',
      'https://github.com/CodesWhat/drydock/pull/954',
      'https://github.com/CodesWhat/drydock/pull/955',
      'https://github.com/CodesWhat/drydock/pull/956',
      'https://github.com/CodesWhat/drydock/pull/961',
    ]);
    expect(getUrls(releaseBullets[1]).sort()).toEqual([
      'https://github.com/CodesWhat/drydock/pull/929',
      'https://github.com/CodesWhat/drydock/pull/951',
    ]);
  });

  test('preserves the exact source URL multiset', () => {
    const urls = [...content.matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url).sort();

    expect(urls).toEqual(sourceUrls);
  });

  test('does not splice source-English prose into translated copy', () => {
    for (const prose of forbiddenSourceEnglishProse) {
      expect(content, `unexpected source-English prose: ${prose}`).not.toContain(prose);
    }
  });
});

test('English rc.7 update highlight scopes cleanup failures to the health gate', () => {
  const releaseBlock = getReleaseBlock(
    sourceReadme,
    '<summary><strong>v1.7.0-rc.7 highlights</strong></summary>',
  );
  const bullet = getBullet(releaseBlock, '**Update execution stays successful');
  const urls = [...(bullet ?? '').matchAll(/https?:\/\/[^)<>"]+/g)].map(([url]) => url);

  expect(bullet).toContain('after the health gate');
  expect(bullet).toContain('self-updates wait for active lifecycles');
  expect(urls.sort()).toEqual([
    'https://github.com/CodesWhat/drydock/pull/931',
    'https://github.com/CodesWhat/drydock/pull/942',
  ]);
});

test('German rc.7 release notes use registry terminology', () => {
  const german = readFileSync(`${repoRoot}/README.de.md`, 'utf8');

  expect(german).not.toContain('Registrierungspaginierung');
});

describe.each(allReadmes)('%s star history', (readme) => {
  const content = readFileSync(`${repoRoot}/${readme}`, 'utf8');

  test('uses only the committed star-history chart', () => {
    // The chart must be the committed asset wired into the actual <img>, not
    // merely mentioned somewhere in the file.
    expect(content).toMatch(/<img[^>]*src="docs\/assets\/star-history\.svg"/);
    // Match the retired hosts, not particular URL shapes. `star-history.com/#`
    // only caught the embed form, so a bare https://star-history.com/CodesWhat/
    // drydock link would have walked straight back in. The host assertion also
    // subsumes api.star-history.com. warpchart.dev is retired too: Warpchart
    // was the D12 replacement candidate before that decision was reversed in
    // favor of a committed SVG refreshed by a scheduled workflow. The retired
    // self-hosted route is forbidden in any attribute (src/href), absolute or
    // same-origin, but stays mentionable in prose: the v1.6.0 release-history
    // bullets describe what shipped and frozen history is never rewritten.
    expect(content).not.toContain('star-history.com');
    expect(content).not.toMatch(/=["'][^"']*\/api\/star-history/);
    expect(content).not.toContain('getdrydock.com/api/star-history');
    expect(content).not.toContain('warpchart.dev');
  });
});

describe('apps/web source', () => {
  const webSrcRoot = `${repoRoot}/apps/web/src`;
  const webSourceFiles = readdirSync(webSrcRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => /\.(ts|tsx|mjs|js|jsx|json|css|mdx?)$/.test(path));

  test('carries no retired star-history surface', () => {
    expect(webSourceFiles.length).toBeGreaterThan(0);
    for (const path of webSourceFiles) {
      const source = readFileSync(path, 'utf8');
      for (const retired of ['star-history.com', '/api/star-history', 'warpchart.dev']) {
        expect(source, `${path} references retired surface ${retired}`).not.toContain(retired);
      }
    }
  });
});

describe.each(allReadmes)('%s markup', (readme) => {
  const content = readFileSync(`${repoRoot}/${readme}`, 'utf8');

  test.each(balancedTagPairs)('balances $name tags', ({ opening, closing }) => {
    const openingCount = content.match(opening)?.length ?? 0;
    const closingCount = content.match(closing)?.length ?? 0;

    expect(openingCount).toBe(closingCount);
  });
});
