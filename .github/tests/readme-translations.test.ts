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
    releaseHeading: '<summary><strong>Highlights von v1.7.0-rc.9</strong></summary>',
  },
  'README.es.md': {
    featureTableHeader: '| | Característica | Descripción |',
    builtWithHeading: '<h2 align="center" id="built-with">Construido con</h2>',
    communityQaHeading: '### Control de calidad de la comunidad',
    releaseHeading: '<summary><strong>Aspectos destacados de v1.7.0-rc.9</strong></summary>',
  },
  'README.fr.md': {
    featureTableHeader: '| | Fonctionnalité | Descriptif |',
    builtWithHeading: '<h2 align="center" id="built-with">Construit avec</h2>',
    communityQaHeading: '### Contrôle qualité de la communauté',
    releaseHeading: '<summary><strong>Points forts de la v1.7.0-rc.9</strong></summary>',
  },
  'README.pl.md': {
    featureTableHeader: '| | Funkcja | Opis |',
    builtWithHeading: '<h2 align="center" id="built-with">Zbudowany z</h2>',
    communityQaHeading: '### Kontrola jakości społeczności',
    releaseHeading:
      '<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.9</strong></summary>',
  },
  'README.pt-BR.md': {
    featureTableHeader: '| | Recurso | Descrição |',
    builtWithHeading: '<h2 align="center" id="built-with">Construído com</h2>',
    communityQaHeading: '### Controle de qualidade da comunidade',
    releaseHeading: '<summary><strong>Destaques da v1.7.0-rc.9</strong></summary>',
  },
  'README.zh-CN.md': {
    featureTableHeader: '| |特色|描述 |',
    builtWithHeading: '<h2 align="center" id="built-with">技术栈</h2>',
    communityQaHeading: '### 社区质量检查',
    releaseHeading: '<summary><strong>v1.7.0-rc.9 亮点</strong></summary>',
  },
};

const localizedReleaseFragments: Record<
  string,
  {
    singleFlight: string;
    deadline: string;
    onceKey: string;
    deprecationBanner: string;
    docsAudit: string;
    getStarted: string;
  }
> = {
  'README.de.md': {
    singleFlight:
      '**`watchFromCron()` ist jetzt Single-Flight, sodass überlappende Scans in einer großen Flotte nicht mehr denselben Trigger mehrfach für ein Update auslösen.**',
    deadline: 'läuft jetzt gegen eine Frist',
    onceKey:
      '**Ein `once=true`-Trigger löst nicht mehr Stunden später erneut für ein bereits gemeldetes Tag-Update aus, wenn eine Registry die Digest-Abfrage ratenbegrenzt**',
    deprecationBanner:
      '**Die Deprecation-Banner der UI für die entfernten `DD_TRIGGER_*`-Umgebungsvariablen und die curl-basierte Healthcheck-Überschreibung sagen jetzt, dass diese Dinge bereits entfernt sind**',
    docsAudit:
      '**Ein Dokumentations-Audit hat README, DEPRECATIONS.md und die Konfigurations-/Trigger-/Registry-/API-/Monitoring-/Agenten-Dokumentation gegen den tatsächlichen Code dieses Codebaums korrigiert**',
    getStarted:
      'die Get-Started-Snippets der Marketing-Website starten jetzt eine Instanz, die tatsächlich gesund wird',
  },
  'README.es.md': {
    singleFlight:
      '**`watchFromCron()` ahora es de ejecución única, de modo que los escaneos superpuestos en una flota grande ya no disparan el mismo activador varias veces para la misma actualización.**',
    deadline: 'compite contra un plazo límite',
    onceKey:
      '**Un activador `once=true` ya no se dispara de nuevo horas después para una actualización de etiqueta que ya había anunciado, cuando un registro limita la tasa de la consulta de digest**',
    deprecationBanner:
      '**Los banners de obsolescencia de la interfaz para las variables de entorno `DD_TRIGGER_*` eliminadas y la anulación del healthcheck basada en curl ahora indican que esas cosas ya desaparecieron**',
    docsAudit:
      '**Una auditoría de documentación corrigió el README, DEPRECATIONS.md y la documentación de configuración/activadores/registros/API/monitoreo/agentes frente al código real de este árbol**',
    getStarted:
      'los fragmentos de Get Started del sitio de marketing ahora despliegan una instancia que realmente queda saludable',
  },
  'README.fr.md': {
    singleFlight:
      '**`watchFromCron()` est désormais à exécution unique (single-flight), si bien que des scans qui se chevauchent sur une grande flotte ne déclenchent plus le même déclencheur plusieurs fois pour une seule mise à jour.**',
    deadline: 'confronté à une échéance',
    onceKey:
      "**Un déclencheur `once=true` ne se redéclenche plus des heures plus tard pour une mise à jour de tag déjà annoncée, lorsqu'un registre limite le débit de la recherche de digest**",
    deprecationBanner:
      "**Les bannières de dépréciation de l'interface pour les variables d'environnement `DD_TRIGGER_*` supprimées et la surcharge du healthcheck basée sur curl indiquent désormais que ces éléments ont déjà disparu**",
    docsAudit:
      '**Un audit de la documentation a corrigé le README, DEPRECATIONS.md et la documentation de configuration/déclencheurs/registres/API/supervision/agents par rapport au code réel de cet arbre**',
    getStarted:
      'les extraits Get Started du site marketing déploient désormais une instance qui devient réellement saine',
  },
  'README.pl.md': {
    singleFlight:
      '**`watchFromCron()` działa teraz w trybie single-flight, dzięki czemu nakładające się skany w dużej flocie nie uruchamiają już tego samego wyzwalacza wielokrotnie dla jednej aktualizacji.**',
    deadline: 'jest teraz uruchamiany z terminem',
    onceKey:
      '**Wyzwalacz `once=true` nie uruchamia się już ponownie godziny później dla aktualizacji tagu, którą już zgłosił, gdy rejestr ogranicza liczbę zapytań o digest**',
    deprecationBanner:
      '**Banery przestarzałości w interfejsie dla usuniętych zmiennych środowiskowych `DD_TRIGGER_*` oraz nadpisania healthchecka opartego na curl teraz informują, że te rzeczy już zniknęły**',
    docsAudit:
      '**Audyt dokumentacji poprawił README, DEPRECATIONS.md oraz dokumentację konfiguracji/wyzwalaczy/rejestrów/API/monitoringu/agentów zgodnie z rzeczywistym kodem tego drzewa**',
    getStarted:
      'fragmenty Get Started na stronie marketingowej wdrażają teraz instancję, która faktycznie staje się zdrowa',
  },
  'README.pt-BR.md': {
    singleFlight:
      '**`watchFromCron()` agora é single-flight, de modo que varreduras sobrepostas em uma frota grande não disparam mais o mesmo gatilho várias vezes para a mesma atualização.**',
    deadline: 'compete contra um prazo',
    onceKey:
      '**Um gatilho `once=true` não dispara mais horas depois para uma atualização de tag que já havia anunciado, quando um registro limita a taxa da consulta de digest**',
    deprecationBanner:
      '**Os banners de descontinuação da UI para as variáveis de ambiente `DD_TRIGGER_*` removidas e a substituição do healthcheck baseada em curl agora dizem que essas coisas já foram removidas**',
    docsAudit:
      '**Uma auditoria de documentação corrigiu o README, o DEPRECATIONS.md e a documentação de configuração/gatilhos/registros/API/monitoramento/agentes em relação ao código real desta árvore**',
    getStarted:
      'os trechos de Get Started do site de marketing agora implantam uma instância que realmente fica saudável',
  },
  'README.zh-CN.md': {
    singleFlight:
      '**`watchFromCron()` 现在是单次并发（single-flight）执行，因此大规模集群中重叠的扫描不会再为同一次更新多次触发同一个触发器。**',
    deadline: '与截止时间竞争',
    onceKey:
      '**当注册表对摘要查询进行限流时，`once=true` 触发器不会再在数小时后为已经通知过的标签更新重新触发**',
    deprecationBanner:
      '**界面中针对已移除的 `DD_TRIGGER_*` 环境变量和基于 curl 的健康检查覆盖的弃用横幅现在会说明这些内容已经移除**',
    docsAudit:
      '**一次文档审计根据本代码树的实际代码修正了 README、DEPRECATIONS.md 以及配置/触发器/注册表/API/监控/代理相关文档**',
    getStarted: '营销网站的 Get Started 代码片段现在部署的实例能够真正变为健康状态',
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
  './CHANGELOG.md#170-rc9--2026-09-03',
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
      release.singleFlight,
      release.onceKey,
      release.deprecationBanner,
      release.docsAudit,
    ].map((fragment) => getBullet(releaseBlock, fragment));
    const getUrls = (bullet: string | undefined) =>
      [...(bullet ?? '').matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url);

    expect(releaseBullets.every(Boolean)).toBe(true);
    expect(releaseBullets[0]).toContain(release.deadline);
    expect(releaseBullets[3]).toContain(release.getStarted);
    expect(releaseBullets.flatMap(getUrls).sort()).toEqual([
      'https://github.com/CodesWhat/drydock/pull/979',
      'https://github.com/CodesWhat/drydock/pull/979',
      'https://github.com/CodesWhat/drydock/pull/988',
      'https://github.com/CodesWhat/drydock/pull/988',
    ]);
    expect(getUrls(releaseBullets[0]).sort()).toEqual([
      'https://github.com/CodesWhat/drydock/pull/979',
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
