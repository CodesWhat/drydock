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
    releaseHeading: '<summary><strong>Highlights von v1.7.0-rc.7</strong></summary>',
  },
  'README.es.md': {
    featureTableHeader: '| | Característica | Descripción |',
    builtWithHeading: '<h2 align="center" id="built-with">Construido con</h2>',
    communityQaHeading: '### Control de calidad de la comunidad',
    releaseHeading: '<summary><strong>Aspectos destacados de v1.7.0-rc.7</strong></summary>',
  },
  'README.fr.md': {
    featureTableHeader: '| | Fonctionnalité | Descriptif |',
    builtWithHeading: '<h2 align="center" id="built-with">Construit avec</h2>',
    communityQaHeading: '### Contrôle qualité de la communauté',
    releaseHeading: '<summary><strong>Points forts de la v1.7.0-rc.7</strong></summary>',
  },
  'README.pl.md': {
    featureTableHeader: '| | Funkcja | Opis |',
    builtWithHeading: '<h2 align="center" id="built-with">Zbudowany z</h2>',
    communityQaHeading: '### Kontrola jakości społeczności',
    releaseHeading:
      '<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.7</strong></summary>',
  },
  'README.pt-BR.md': {
    featureTableHeader: '| | Recurso | Descrição |',
    builtWithHeading: '<h2 align="center" id="built-with">Construído com</h2>',
    communityQaHeading: '### Controle de qualidade da comunidade',
    releaseHeading: '<summary><strong>Destaques da v1.7.0-rc.7</strong></summary>',
  },
  'README.zh-CN.md': {
    featureTableHeader: '| |特色|描述 |',
    builtWithHeading: '<h2 align="center" id="built-with">技术栈</h2>',
    communityQaHeading: '### 社区质量检查',
    releaseHeading: '<summary><strong>v1.7.0-rc.7 亮点</strong></summary>',
  },
};

const localizedReleaseFragments: Record<
  string,
  {
    pagination: string;
    updates: string;
    selfUpdate: string;
    security: string;
    compose: string;
    sessions: string;
    roadmap: string;
  }
> = {
  'README.de.md': {
    pagination: '**Die Registry-Paginierung folgt jetzt dem Cursor jeder Registry**',
    updates:
      '**Updates bleiben erfolgreich, wenn die Bereinigung nach der Gesundheitsprüfung fehlschlägt**',
    selfUpdate: 'Self-Updates warten vor dem exklusiven Gate auf aktive Lebenszyklen',
    security:
      '**Die Anmeldedaten-Redaktion deckt jetzt Trigger, Registries, Debug-Dumps und Lookalike-Hosts ab**',
    compose: '**Compose-Umschreibungen prüfen vor dem Schreiben das Laufzeit-Repository**',
    sessions: '**Header-authentifizierte Anfragen speichern keine Sessions mehr**',
    roadmap: '**Der Wettbewerbsvergleich und die Roadmap wurden für 2026 aktualisiert**',
  },
  'README.es.md': {
    pagination: '**La paginación de los registros sigue ahora el cursor de cada registro**',
    updates:
      '**Las actualizaciones siguen siendo exitosas cuando falla la limpieza después de la comprobación de salud**',
    selfUpdate:
      'las autoactualizaciones esperan a que terminen los ciclos activos antes de tomar el bloqueo exclusivo',
    security:
      '**La redacción de credenciales cubre ahora activadores, registros, volcados de depuración y hosts parecidos**',
    compose:
      '**Las reescrituras de Compose verifican el repositorio en ejecución antes de escribir**',
    sessions: '**Las solicitudes autenticadas por cabecera ya no persisten sesiones**',
    roadmap: '**La comparación de competidores y la hoja de ruta se actualizaron para 2026**',
  },
  'README.fr.md': {
    pagination:
      '**La pagination des registres suit désormais le curseur propre à chaque registre**',
    updates: '**Une mise à jour reste réussie si le nettoyage échoue après le contrôle de santé**',
    selfUpdate:
      'les auto-mises à jour attendent la fin des cycles actifs avant de prendre le verrou exclusif',
    security:
      '**La rédaction des identifiants couvre désormais les déclencheurs, registres, vidages de débogage et hôtes ressemblants**',
    compose: '**Les réécritures Compose vérifient le dépôt d’exécution avant toute écriture**',
    sessions: '**Les requêtes authentifiées par en-tête ne persistent plus de sessions**',
    roadmap:
      '**La comparaison des concurrents et la feuille de route ont été actualisées pour 2026**',
  },
  'README.pl.md': {
    pagination: '**Paginacja rejestrów korzysta teraz z kursora właściwego dla każdego rejestru**',
    updates:
      '**Aktualizacje pozostają pomyślne, gdy czyszczenie nie powiedzie się po kontroli stanu**',
    selfUpdate:
      'samoaktualizacje czekają na zakończenie aktywnych cykli przed przejęciem wyłącznej blokady',
    security:
      '**Redakcja poświadczeń obejmuje teraz wyzwalacze, rejestry, zrzuty debugowania i podobne hosty**',
    compose: '**Przepisywanie Compose sprawdza repozytorium uruchomieniowe przed zapisem**',
    sessions: '**Żądania uwierzytelnione nagłówkiem nie zapisują już sesji**',
    roadmap: '**Porównanie konkurencji i mapa drogowa zostały odświeżone na 2026 rok**',
  },
  'README.pt-BR.md': {
    pagination: '**A paginação dos registros agora segue o cursor de cada registro**',
    updates:
      '**As atualizações continuam bem-sucedidas quando a limpeza falha após a verificação de integridade**',
    selfUpdate:
      'as autoatualizações aguardam os ciclos ativos terminarem antes de assumir o bloqueio exclusivo',
    security:
      '**A redação de credenciais agora cobre gatilhos, registros, dumps de depuração e hosts semelhantes**',
    compose: '**As reescritas do Compose verificam o repositório em execução antes de gravar**',
    sessions: '**Solicitações autenticadas por cabeçalho não persistem mais sessões**',
    roadmap: '**A comparação com concorrentes e o roadmap foram atualizados para 2026**',
  },
  'README.zh-CN.md': {
    pagination: '**注册表分页现在遵循各注册表自己的游标**',
    updates: '**健康检查通过后即使清理失败，更新仍会保持成功**',
    selfUpdate: '自更新会等待活动生命周期完成后再获取独占闸门',
    security: '**凭据脱敏现在覆盖触发器、注册表、调试转储和相似主机**',
    compose: '**Compose 重写会在写入前验证运行时仓库**',
    sessions: '**通过请求头认证的请求不再持久化会话**',
    roadmap: '**竞争者对比和路线图已更新至 2026 年**',
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
      release.pagination,
      release.updates,
      release.security,
      release.compose,
      release.sessions,
      release.roadmap,
    ].map((fragment) => getBullet(releaseBlock, fragment));
    const getUrls = (bullet: string | undefined) =>
      [...(bullet ?? '').matchAll(/https?:\/\/[^)<>"\s]+/g)].map(([url]) => url);

    expect(releaseBullets.every(Boolean)).toBe(true);
    expect(releaseBullets[1]).toContain(release.selfUpdate);
    expect(releaseBullets.flatMap(getUrls).sort()).toEqual([
      'https://github.com/CodesWhat/drydock/pull/927',
      'https://github.com/CodesWhat/drydock/pull/931',
      'https://github.com/CodesWhat/drydock/pull/932',
      'https://github.com/CodesWhat/drydock/pull/933',
      'https://github.com/CodesWhat/drydock/pull/935',
      'https://github.com/CodesWhat/drydock/pull/936',
      'https://github.com/CodesWhat/drydock/pull/942',
    ]);
    expect(getUrls(releaseBullets[1]).sort()).toEqual([
      'https://github.com/CodesWhat/drydock/pull/931',
      'https://github.com/CodesWhat/drydock/pull/942',
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
