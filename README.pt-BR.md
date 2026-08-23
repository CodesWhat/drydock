<div align="center">

<p><a href="README.md">English</a> · <a href="README.es.md">Español</a> · <a href="README.pl.md">Polski</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <strong>Português (Brasil)</strong></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whale-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/whale-logo.png" />
  <img src="docs/assets/whale-logo.png" alt="drydock" width="220">
</picture>

<h1>drydock</h1>

**Observador de atualização de imagem de contêiner — 23 registros, 20 provedores de notificação e ação.**

</div>

<p align="center"><a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/github/v/release/CodesWhat/drydock?include_prereleases&label=release" alt="Release"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/CodesWhat/drydock" alt="License"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <a href="https://www.bestpractices.dev/projects/11915"><img src="https://www.bestpractices.dev/projects/11915/badge" alt="OpenSSF Best Practices"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/maintainability.svg" alt="Maintainability"></a>
  <a href="https://dashboard.stryker-mutator.io/reports/github.com/CodesWhat/drydock/main"><img src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FCodesWhat%2Fdrydock%2Fmain" alt="Mutation testing"></a>
  <a href="https://codecov.io/gh/CodesWhat/drydock"><img src="https://codecov.io/gh/CodesWhat/drydock/graph/badge.svg" alt="Coverage"></a>
  <br>
  <a href="https://hub.docker.com/r/codeswhat/drydock"><img src="https://img.shields.io/docker/pulls/codeswhat/drydock?logo=docker&logoColor=white&label=Docker+Hub" alt="Docker Hub pulls"></a>
  <a href="https://github.com/CodesWhat/drydock/stargazers"><img src="https://img.shields.io/github/stars/CodesWhat/drydock?style=flat" alt="Stars"></a>
  <a href="https://github.com/veggiemonk/awesome-docker#container-management"><img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Docker"></a>
  <a href="https://crowdin.com/project/drydock"><img src="https://badges.crowdin.net/drydock/localized.svg" alt="Crowdin localization"></a>
  <a href="https://github.com/sponsors/CodesWhat"><img src="https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white" alt="Sponsor"></a>
</p>

<hr>

> [!WARNING]
> **Atualizando de uma versão mais antiga? Leia as notas de atualização primeiro.** Três correções de reforço de segurança enviadas pela primeira vez em **1.4.6** e executadas em toda a linha **1.5**, portanto, qualquer pessoa que atualizar de uma versão anterior a 1.4.6 será afetada, independentemente da versão em que chegar (1.4.6, qualquer 1.5.x ou posterior). Eles não são obsoletos e não têm período de carência: o OIDC agora requer `authorization_endpoint` nos metadados de descoberta do seu provedor, chaves de limitação de taxa não autenticadas no endereço de peer TCP (depósito compartilhado atrás de um proxy reverso) e URLs de proxy de acionamento HTTP devem usar `http(s)://`. Consulte **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)** antes de atualizar.

<!-- separate alerts: a blank-line-only gap between blockquotes trips markdownlint MD028 -->

> [!WARNING]
> **Atualizando para 1.6.0-rc.3 ou posterior?** Mais reforços de segurança entram em vigor sem período de carência. Uma instância sem autenticação configurada, ou com autenticação anônima ativada mas não confirmada, agora falha de forma fechada após a atualização, assim como uma instalação nova: o contêiner continua em execução, solicitações protegidas da API retornam `401`, as rotas públicas de descoberta e status de autenticação permanecem disponíveis e `/health` retorna `503`. A interface SPA pode carregar, mas não lê dados protegidos. Defina `DD_ANONYMOUS_AUTH_CONFIRM=true` ou configure `DD_AUTH_BASIC_*`/OIDC antes de atualizar. O cookie da sessão muda de `connect.sid` para `drydock.sid`, desconectando todos os usuários uma vez. Gatilhos HTTP, o webhook Hass e buscas de ícones de registro agora usam DNS protegido, bloqueiam destinos de metadados de nuvem e link-local e nunca seguem redirecionamentos. Use `allowmetadata=true` somente no gatilho `DD_NOTIFICATION_HTTP_*` específico que realmente precisar. Consulte **[DEPRECATIONS.md](DEPRECATIONS.md#enforced-security-changes-no-deprecation-window)** para a orientação completa.

<h2 align="center">Conteúdo</h2>

- [Documentação](#documentation)
- [Início rápido](#quick-start)
- [Atualizações recentes](#recent-updates)
- [Capturas de tela e demonstração ao vivo](#screenshots)
- [Por que Drydock](#why-drydock)
- [Recursos](#features)
- [Integrações suportadas](#supported-integrations)
- [Comparação de recursos](#feature-comparison)
- [Migração](#migration)
- [Roteiro](#roadmap)
- [História da estrela](#star-history)
- [Construído com](#built-with)
- [Comunidade e suporte](#community-support)
- [Ecossistema CodesWhat](#codeswhat-ecosystem)

<h2 align="center" id="documentation">Documentação</h2>

| Recurso                | Ligação                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Site                   | [getdrydock.com](https://getdrydock.com/)                                                                   |
| Demonstração ao vivo   | [demo.getdrydock.com](https://demo.getdrydock.com)                                          |
| Documentos             | [getdrydock.com/docs](https://getdrydock.com/docs)                                                          |
| Configuração           | [Configuração](https://getdrydock.com/docs/configuration)                                                                   |
| Início rápido          | [Início rápido](https://getdrydock.com/docs/quickstart)                                                                     |
| Registro de alterações | [`CHANGELOG.md`](CHANGELOG.md)                                                                                              |
| Deprecations           | [`DEPRECATIONS.md`](DEPRECATIONS.md)                                                                                        |
| Roadmap                | Consulte a seção [Roteiro](#roadmap) acima                                                                                  |
| Contribuindo           | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                                                                        |
| Código de Conduta      | [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)                                                                                  |
| Governança             | [`GOVERNANCE.md`](GOVERNANCE.md)                                                                                            |
| Garantia de Segurança  | [`SECURITY-ASSURANCE.md`](SECURITY-ASSURANCE.md)                                                                            |
| Política de Segurança  | [`SECURITY.md`](SECURITY.md)                                                                                                |
| Problemas              | [Problemas do GitHub](https://github.com/CodesWhat/drydock/issues)                                                          |
| Discussões             | [Discussões no GitHub](https://github.com/CodesWhat/drydock/discussions) - solicitações de recursos e ideias são bem-vindas |

<hr>

<h2 align="center" id="quick-start">Início rápido</h2>

**Recomendado: use um proxy de soquete** para restringir quais endpoints da API Docker que Drydock podem acessar. Isso evita dar ao contêiner acesso total ao soquete Docker.

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      socket-proxy:
        condition: service_healthy
    environment:
      - DD_WATCHER_LOCAL_HOST=socket-proxy
      - DD_WATCHER_LOCAL_PORT=2375
      - DD_AUTH_BASIC_ADMIN_USER=admin
      - "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>"
    ports:
      - 3000:3000

  socket-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - CONTAINERS=1
      - IMAGES=1
      - EVENTS=1
      - SERVICES=1
      - INFO=1          # Required for daemon identity detection (notification prefixes)
      # Add POST=1 and NETWORKS=1 for container actions and auto-updates
    healthcheck:
      test: wget --spider http://localhost:2375/version || exit 1
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped
```

<details>
<summary>Alternativa: <a href="https://github.com/CodesWhat/sockguard">sockguard</a> proxy de soquete</summary>

[sockguard](https://github.com/CodesWhat/sockguard) é um filtro de soquete Docker de negação padrão do mesmo ecossistema CodesWhat, com uma predefinição criada para drydock:

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      sockguard:
        condition: service_healthy
    environment:
      - DD_WATCHER_LOCAL_HOST=sockguard
      - DD_WATCHER_LOCAL_PORT=2375
      - DD_AUTH_BASIC_ADMIN_USER=admin
      - "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>"
    ports:
      - 3000:3000

  sockguard:
    image: codeswhat/sockguard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./sockguard.yaml:/etc/sockguard/config.yaml:ro
    environment:
      - SOCKGUARD_CONFIG_FILE=/etc/sockguard/config.yaml
    healthcheck:
      test: wget --spider http://localhost:2375/version || exit 1
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped
```

Consulte a [predefinição sockguard de `app/configs/portwing.yaml`](https://github.com/CodesWhat/sockguard/blob/dev/v1.5/app/configs/portwing.yaml) para um `sockguard.yaml` inicial (a mesma predefinição portwing vem em seus próprios exemplos).

</details>

<details>
<summary>Alternativa: início rápido com montagem direta em soquete</summary>

```bash
docker run -d \
  --name drydock \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e DD_AUTH_BASIC_ADMIN_USER=admin \
  -e "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>" \
  codeswhat/drydock:latest
```

> **Aviso:** O acesso direto ao soquete concede ao contêiner controle total sobre o daemon do Docker. Use a configuração do proxy de soquete acima para implantações de produção. Consulte o [Guia de segurança do soquete Docker](https://getdrydock.com/docs/configuration/watchers#docker-socket-security) para todas as opções, incluindo TLS remoto e Docker sem raiz.

</details>

> Gere um hash de senha (`argon2` CLI — instale através do seu gerenciador de pacotes):
>
> ```bash
> echo -n "yourpassword" | argon2 $(openssl rand -base64 32) -id -m 16 -t 3 -p 4 -l 64 -e
> ```
>
> Ou com Node.js 24.7+ (sem necessidade de pacotes extras):
>
> ```bash
> node -e 'const c=require("node:crypto");const s=c.randomBytes(32);const h=c.argon2Sync("argon2id",{message:process.argv[1],nonce:s,memory:65536,passes:3,parallelism:4,tagLength:64});console.log("argon2id$65536$3$4$"+s.toString("base64")+"$"+h.toString("base64"));' "yourpassword"
> ```
>
> Drydock v1.6 aceita apenas hashes de autenticação básicos argon2id. `{SHA}` legado, `$apr1$`/`$1$`, `crypt` e hashes de texto simples são rejeitados; regenere-os antes de atualizar.
> A autenticação é **exigida por padrão**. Consulte o [auth docs](https://getdrydock.com/docs/configuration/authentications) para OIDC, acesso anônimo e outras opções.
> O acesso anônimo deve ser confirmado explicitamente com `DD_ANONYMOUS_AUTH_CONFIRM=true` em instalações novas e atualizadas. Sem essa confirmação, uma instância sem autenticação configurada ou com autenticação anônima não confirmada inicia fechada: solicitações protegidas da API retornam `401`, as rotas públicas de descoberta e status de autenticação continuam disponíveis e `/health` retorna `503`.

A imagem inclui binários `trivy` e `cosign` para verificação de vulnerabilidade local e verificação de imagem.

Consulte o [Guia de início rápido](https://getdrydock.com/docs/quickstart) para Docker Compose, segurança de soquete, proxy reverso e registros alternativos.

<hr>

<h2 align="center" id="recent-updates">Atualizações recentes</h2>

<details open>
<summary><strong>Destaques da v1.7.0-rc.3</strong></summary>

- **Túneis de borda do Portwing agora carregam corpos que não são JSON** — o frame de boas-vindas do controlador agora anuncia a capacidade `edge-response-body-b64` e decodifica corpos de resposta do Docker negociados em base64 (por exemplo, a resposta em texto simples "OK" do `_ping`) de agentes que oferecem suporte a isso; aditivo e controlado por capacidade. ([#852](https://github.com/CodesWhat/drydock/pull/852))
- **Os selos do README agora são lidos ao vivo** — os selos de versão, licença, downloads e estrelas agora são renderizados a partir de endpoints ao vivo do shields.io em vez de imagens estáticas, e o gráfico de histórico de estrelas agora é exibido como um par claro/escuro combinando com o tema, regenerado no corte da versão em vez de por cron. ([#851](https://github.com/CodesWhat/drydock/pull/851), [#844](https://github.com/CodesWhat/drydock/pull/844), [#847](https://github.com/CodesWhat/drydock/pull/847))
- **Os gates de DAST e de lint de workflow agora falham fechados** — os scans do ZAP não ignoram mais todos os avisos, e a etapa zizmor no pre-push falha com uma dica de instalação em vez de ser ignorada silenciosamente quando o binário está ausente. ([#842](https://github.com/CodesWhat/drydock/pull/842))
- **Um monitor diário verifica se `main` carrega uma tag de versão** — um workflow agendado e somente leitura fica vermelho se o HEAD de `main` não estiver marcado. ([#846](https://github.com/CodesWhat/drydock/pull/846))
- **Correções no pipeline de release** — a quebra de CI do corte rc.2 foi corrigida: uma sobrescrita incorreta do js-yaml que quebrava os testes de carga do Artillery foi revertida, e duas esperas do Playwright foram ampliadas além dos próprios orçamentos de operação do app. ([#829](https://github.com/CodesWhat/drydock/pull/829), [#836](https://github.com/CodesWhat/drydock/pull/836))

Notas completas em [CHANGELOG.md](./CHANGELOG.md#170-rc3--2026-08-23).

</details>

<details>
<summary><strong>Destaques da v1.7.0-rc.2</strong></summary>

- **Resolução de política de ação por contêiner** — a API e a interface agora expõem o estado resolvido (blocked/manual/auto) e o acionador vencedor de cada contêiner, além de um novo rótulo `dd.action.auto` e o modo `AUTO=onauto` para acesso somente manual sem disparo automático.
- **Mudanças incompatíveis neste ciclo** — `DD_TRIGGER_*`/`dd.trigger.*` foram totalmente removidos, `trigger-excluded`/`trigger-not-included` passam a ser bloqueios definitivos de atualização, o layout de tópicos MQTT do Home Assistant ganha um segmento `agent/<name>` por padrão, `GET /api/auth/methods` agora retorna 410, e o `curl` foi removido da imagem.
- **Correções de exatidão na verificação de atualizações** — um erro de registry durante a verificação não relata mais “Up to date” indevidamente, um contêiner malformado não zera mais toda a sincronização de inventário de um agente, e índices de imagem OCI aninhados agora são resolvidos para o manifesto real. ([#814](https://github.com/CodesWhat/drydock/issues/814))
- **Correções de dependências e autoatualização** — um membro de dependência rejeitado mantém seu contexto de reinicialização, as atualizações do Compose não arrastam mais valores de ambiente obsoletos herdados da imagem, e substituições de política de atualização agora sobrevivem à própria autoatualização do drydock. ([#718](https://github.com/CodesWhat/drydock/pull/718), [#736](https://github.com/CodesWhat/drydock/pull/736), [#743](https://github.com/CodesWhat/drydock/pull/743))
- **Segurança** — foi fechado um caminho de injeção de propriedade remota na sincronização de consultas de URL da lista de contêineres, e o gate de imagem do Grype foi restrito a um CVE do Alpine ainda sem correção upstream. ([#750](https://github.com/CodesWhat/drydock/pull/750))

Notas completas em [CHANGELOG.md](./CHANGELOG.md#170-rc2--2026-08-20).

</details>

<details>
<summary><strong>Destaques da v1.7.0-rc.1</strong></summary>

- **Atualizações com reconhecimento de dependências** — rótulos ou metadados do Compose criam um grafo de dependências validado, mostram as ondas exatas na prévia e executam atualizações ou reinicializações de dependentes em ordem determinística, com tratamento seguro de ciclos, falhas e prévias obsoletas. ([Discussão #219](https://github.com/CodesWhat/drydock/discussions/219))
- **Experiência do operador** — PWA instalável, links clicáveis para portas nomeadas, tempo de atividade dos contêineres em tempo real, atalhos de teclado e detecção com intervalo para novos contêineres.
- **Migração incompatível de acionadores** — `DD_TRIGGER_*` agora impede a inicialização, e os rótulos antigos `dd.trigger.include` / `dd.trigger.exclude` não encaminham mais tarefas; use `DD_ACTION_*`, `DD_NOTIFICATION_*` e seus rótulos com escopo.
- **Reforço de segurança e ciclo de vida** — autenticação, solicitações de agentes, logs, WebSockets e solicitações a registros têm limites explícitos; valores sensíveis de comandos e hooks são ocultados; a descoberta do Home Assistant sincroniza novamente após a inicialização e encerra o trabalho dos provedores sem publicações obsoletas. ([#708](https://github.com/CodesWhat/drydock/issues/708))

Notas completas em [CHANGELOG.md](./CHANGELOG.md#170-rc1--2026-08-14).

</details>

<details>
<summary><strong>Destaques da v1.6.0</strong></summary>

- **O transporte Edge/agente do Portwing amadurece** com verificações e atualizações nativas do Docker controladas pelo controlador para Portwing 0.9.0+, logs Edge contínuos, assinatura Ed25519 v2 e nomes de exibição vinculados à chave do agente. ([#632](https://github.com/CodesWhat/drydock/issues/632), [#637](https://github.com/CodesWhat/drydock/issues/637))
- **Política declarativa de atualização com estabilização de maturidade**: precedência `dd.updatePolicy.*` em três níveis, contagem regressiva e notificação `maturity-cleared`. ([Discussão #307](https://github.com/CodesWhat/drydock/discussions/307), [Discussão #406](https://github.com/CodesWhat/drydock/discussions/406))
- **Modelos por regra, preferências do sino e evento `container-unhealthy`**, além de MQTT bidirecional do Home Assistant, cujo botão Instalar aciona uma atualização real. ([Discussão #205](https://github.com/CodesWhat/drydock/discussions/205), [Discussão #198](https://github.com/CodesWhat/drydock/discussions/198))
- **Todas as principais listas são responsivas** com uma `DataTable` compartilhada e alternância persistente entre tabela e cartões. ([#498](https://github.com/CodesWhat/drydock/issues/498))
- **Paridade `/api/v1` concluída**: `/api/*` e `WS /api/log/stream` foram removidos (`410 Gone`), com o shim opcional `DD_COMPAT_WUDCARD`. ([Discussão #469](https://github.com/CodesWhat/drydock/discussions/469))
- **Reforço de segurança**: acesso anônimo fecha em atualizações, gatilhos HTTP são protegidos contra SSRF, WebSocket valida a origem completa e o cookie passa a `drydock.sid`.

Notas completas em [CHANGELOG.md](./CHANGELOG.md#160--2026-08-11).

</details>

<details>
<summary><strong>Destaques da v1.6.0-rc.13</strong></summary>

- **Comparação de digests usa candidatos do mesmo repositório**: `getOrderedRepoDigests` filtra `RepoDigests` e corrige âncoras antigas automaticamente. ([#670](https://github.com/CodesWhat/drydock/pull/670))
- **`nanoid` fixado em 3.3.18** em todos os workspaces para CVE-2026-67213 e CVE-2026-67214. ([#673](https://github.com/CodesWhat/drydock/pull/673))
- **Star History auto-hospedado** na rota de mesma origem `/api/star-history`, com cache e SVG reserva. ([#672](https://github.com/CodesWhat/drydock/pull/672))
- **Imagens-base atualizadas**: `node:24-alpine` usa Node 24.19.0 e a etapa `aquasec/trivy` usa 0.73.0. ([#682](https://github.com/CodesWhat/drydock/pull/682))
- **Resolução de aliases de ícones** com verificação completa do pacote. ([#683](https://github.com/CodesWhat/drydock/pull/683))

</details>

<details>
<summary><strong>Destaques da v1.6.0-rc.12</strong></summary>

- **Dependências de segurança atualizadas**: `brace-expansion` 5.0.9, `ip-address` 10.3.1 e `fast-uri` 4.1.2. ([#659](https://github.com/CodesWhat/drydock/pull/659))
- **Relógio de maturidade** compartilha `updatePolicy.maturityMinAgeDays` entre exibição e bloqueio, e falhas de data passam de `debug` para `warn`. ([#604](https://github.com/CodesWhat/drydock/issues/604))
- **Período de graça no registro de agentes** suaviza `agent-mismatch` e `no-update-trigger-configured` na interface, mantendo a admissão fechada. ([#605](https://github.com/CodesWhat/drydock/issues/605))
- **Logs WebSocket e acesso anônimo** funcionam juntos quando esse modo está registrado. ([#636](https://github.com/CodesWhat/drydock/issues/636))
- **Respostas 501 explícitas** descrevem a falta do transporte Docker do controlador. ([#637](https://github.com/CodesWhat/drydock/issues/637))

</details>

<details>
<summary><strong>Destaques da v1.6.0-rc.11</strong></summary>

- **Transporte Portwing**: os marcadores `transport=docker-api`, `execution=controller`, `events=portwing` ativam Standard HTTP ou Edge autenticado para verificações, atualizações, ações de ciclo de vida, prévias e restaurações controladas pelo controlador. O Portwing continua sendo a fonte de eventos de ciclo de vida, e o inventário bruto não pode apagar resultados de atualização enriquecidos pelo controlador. ([#632](https://github.com/CodesWhat/drydock/issues/632), [#637](https://github.com/CodesWhat/drydock/issues/637), [Portwing #76](https://github.com/CodesWhat/portwing/issues/76))
- **Notificações** — Título e modelos de corpo por regra/por provedor com visualização ao vivo, além de categorias de sino no aplicativo apoiadas por auditoria e limites de gravidade de atualização.
- **Painel** — Substituição de grade CSS de dependência zero com reordenação de mouse/toque, redimensionamento limitado, layouts responsivos, visibilidade de widget, redefinição e sincronização opcional de preferências entre dispositivos.
- **Política de atualização** — Precedência declarativa do observador/rótulo/UI, trilha de auditoria de substituição/reversão, contagem regressiva de maturidade/substituição manual e visibilidade informativa de tag fixada com uma visualização de tag atual → mais recente empilhada.
- **Recursos do contêiner** — A coluna Recursos continua visível por padrão, mas pode ser ocultada de forma persistente; os links de origem, notas da versão e registro permanecem no menu Mais e nos rodapés dos cartões.
- **Desempenho e recuperação** — Desduplicação de lista de tags por enquete, projeções agregadas mais leves, grandes históricos de log virtualizados, rollover imutável de log ao vivo, tempo limite de inicialização de autenticação, migrações completas de preferências e autocorreção de pedaços obsoletos.
- **Migrações v1.6 aplicadas** — Aliases de ambiente/rótulo WUD, formatos de autenticação herdados, switches de inspetor obsoletos, aliases de modelo, Kafka `clientId` e configurações públicas de Hub/DHI somente de token malformadas não são mais executadas. Os aliases da taxonomia do gatilho permanecem para uma versão final do aviso de nível de erro.

Orientação completa sobre migração em [DEPRECATIONS.md](./DEPRECATIONS.md).

</details>

<details>
<summary><strong>Destaques da v1.5.2</strong></summary>

- **Política de atualização segura para recreação** — Portões de maturidade, tags/resumos ignorados e adiamentos agora sobrevivem à recriação de contêineres para cargas de trabalho de agentes locais e remotos.
- **Confiabilidade da tag fixada** — Tags totalmente fixadas detectam recriações de resumo da mesma tag novamente, enquanto a IU pode mostrar uma tag da mesma família mais recente e não acionável sem alterar a atualização ou o comportamento do acionador.
- **Recuperação de reversão** — Falha na criação de substituição, conexão de rede ou inicialização agora limpa o candidato antes de restaurar o contêiner original, e falhas repetidas não podem ser propagadas por meio de renomeações de reversão aninhadas.
- **Recriação de contêineres mais segura** — Os endereços MAC atribuídos ao daemon não são mais fixados em substitutos, enquanto os endereços MAC da rede primária configurados explicitamente permanecem preservados.
- **Pesquisa de imagem local mais silenciosa** — Imagens criadas ou carregadas localmente sem resumo do registro ignoram pesquisas remotas em vez de gerar erros de autorização recorrentes.

Histórico completo em [CHANGELOG.md](./CHANGELOG.md).

</details>

<hr>

<h2 align="center" id="screenshots">Capturas de tela e demonstração ao vivo</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>Identifique uma atualização, veja exatamente o que muda e aplique-a. Backup, verificação de integridade e reversão tratados.</em></p>

<table>
<tbody><tr>
<td width="50%" align="center"><strong>Luz</strong></td>
<td width="50%" align="center"><strong>Escuro</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</tbody></table>

<div align="center">

**Por que olhar as capturas de tela quando você mesmo pode experimentar?**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

Totalmente interativo – UI real, dados simulados, sem necessidade de instalação. Funciona inteiramente no navegador.

</div>

<hr>

<h2 align="center" id="why-drydock">Por que Drydock</h2>

As imagens dos contêineres ficam desatualizadas silenciosamente. Uma imagem base corrige um CVE, um aplicativo corta uma versão, uma tag se move. A menos que você observe cada registro manualmente, seus contêineres em execução ficarão para trás até que algo quebre ou seja explorado.

A maioria das ferramentas força uma compensação. Os atualizadores automáticos (Watchtower, Ouroboros) puxam e reiniciam com pouca visibilidade ou controle e agora não recebem manutenção. Os painéis (Portainer) gerenciam contêineres, mas não foram criados para inteligência de atualização. Drydock é **monitorar primeiro**: ele monitora 23 registros e informa exatamente o que mudou (principal, secundário, patch ou resumo) antes que algo aconteça, e então age apenas quando você permite. E vai além de qualquer um deles. A verificação de vulnerabilidades Trivy/Grype bloqueia atualizações inseguras, o Cosign verifica assinaturas, os backups de imagem pré-atualização são revertidos automaticamente em caso de falha na verificação de integridade, os agentes distribuídos cobrem hosts remotos e 20 integrações de notificação e ação fecham o ciclo. O ciclo de vida completo da atualização, com uma UI web e uma API REST.

<hr>

<h2 align="center" id="features">Recursos</h2>

| | Recurso | Descrição |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔭  | **Detecção que prioriza o monitoramento**  | Observa cada contêiner em execução e classifica cada atualização disponível como principal, secundária, patch ou resumo antes que algo aconteça. Nada muda até que você diga.                                                                                                                                                                                                                                                                                                                                                                |
| 📦  | **23 provedores de registro**              | Docker Hub, GHCR, ECR, ACR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus e mais 12. Público e privado, em nuvem e auto-hospedado, com TLS e autenticação por registro.                                                                                                                                                                                                                                                                                                                                                                 |
| 🔔  | **20 gatilhos**                            | 17 canais de notificação (Slack, Discord, Telegram, Teams, SMTP, MQTT, ntfy e mais) além de Docker, Docker Compose e ações de comando, com modelos por evento/provedor, visualização ao vivo, filtragem de limite e modo em lote.                                                                                                                                                                                                                                                                                                         |
| 🥊  | **Update Bouncer**                         | A verificação de vulnerabilidades Trivy/Grype bloqueia atualizações inseguras antes de serem implantadas, com verificação da assinatura Cosign e geração de SBOM (CycloneDX e SPDX).                                                                                                                                                                                                                                                                                                                                                      |
| ↩️  | **Backup de imagem e reversão automática** | Instantâneos de imagem pré-atualizados com retenção configurável, reversão automática em caso de falha na verificação de integridade e reversão manual com um clique na interface do usuário.                                                                                                                                                                                                                                                                                                                                                                |
| 🪝  | **Ganchos de ciclo de vida**               | Comandos shell pré e pós-atualização por meio de rótulos de contêiner, com tempos limite por gancho e controle de aborto em caso de falha.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 🗂️ | **Atualizações Docker Compose**            | Extraia e recrie serviços do Compose por meio da API Docker Engine com patch de imagem com preservação de YAML.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 🎛️ | **Política por contêiner**                 | As regras de tag Regex e o roteamento de gatilho usam rótulos `dd.*`; portas de maturidade, pular/adiar/fixar e janelas de manutenção são armazenadas via UI/API ou configuração do inspetor.                                                                                                                                                                                                                                                                                                                                                                |
| 🛰️ | **Agentes distribuídos**                   | Monitore hosts Docker remotos por SSE. Agentes Portwing 0.9.0+ usam Standard HTTP de entrada ou transporte WebSocket Edge de saída; o Drydock 1.6.0-rc.11+ executa no controlador verificações nativas de registro e atualizações Docker individuais ou em lote por qualquer caminho autenticado. O Edge também transporta logs contínuos sem porta de entrada; `DD_EXPERIMENTAL_PORTWING=false` continua sendo a desativação de emergência. |
| 🖥️ | **Painel Web**                             | UI Vue 3 com uma grade de widget personalizável de dependência zero, visualizações responsivas de tabela/cartão, atualizações SSE ao vivo, controles de sino de notificação e detalhes, registros e estatísticas por contêiner.                                                                                                                                                                                                                                                                                                                              |
| 🔗  | **API REST e webhooks**                    | Endpoints autenticados por token para monitoramento de CI/CD e gatilhos de atualização, além de ingestão de webhook de registro assinado para eventos push.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🔐  | **Autenticação OIDC**                      | Proteja o painel com OpenID Connect (Authelia, Auth0, Authentik). Por padrão, qualquer falha no fluxo de autenticação nega o acesso (fail-closed).                                                                                                                                                                                                                                                                                                                                                                      |
| 📈  | **Métricas Prometheus**                    | Endpoint `/metrics` integrado com bypass de autenticação opcional para pilhas de monitoramento Prometheus e Grafana.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 🌍  | **17 localidades da IU**                   | Sistema de tradução totalmente conectado com inglês completo e 16 localidades mantidas pela comunidade sincronizadas por meio de Crowdin, alternáveis ​​no Config.                                                                                                                                                                                                                                                                                                                                                                                           |
| 🔒  | **ReDoS-Imune Regex**                      | Cada padrão de tag fornecido pelo usuário é compilado via re2js (uma porta RE2 JS pura) para correspondência de tempo linear que não pode ser interrompida por um padrão de retrocesso catastrófico.                                                                                                                                                                                                                                                                                                                                      |

<hr>

<h2 align="center" id="supported-integrations">Integrações suportadas</h2>

### Registros (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Cais · LSCR · Porto · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Personalizado · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### Ações (3)

Docker · Docker Compose · Comando

### Notificações (17)

Apprise · Discord · Google Chat · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### Autenticação

Anônimo (opt-in via `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Básico (nome de usuário + hash de senha) · OIDC (Authelia, Auth0, Authentik). Por padrão, qualquer falha no fluxo de autenticação nega o acesso (fail-closed).

### Update Bouncer

A verificação de vulnerabilidades com tecnologia Trivy ou Grype bloqueia atualizações inseguras antes de serem implantadas. Inclui verificação da assinatura Cosign e geração de SBOM (CycloneDX e SPDX).

<hr>

<h2 align="center" id="feature-comparison">Comparação de recursos</h2>

<details>
<summary><strong>Como o drydock se compara a outras ferramentas de atualização de contêiner?</strong></summary>

> ✅ = suportado &nbsp; ❌ = não suportado &nbsp; ⚠️ = parcial/limitado † = arquivado, não é mais mantido

<table>
<thead>
<tr>
<th width="28%">Recurso</th>
<th width="15%" align="center">drydock</th>
<th width="15%" align="center">WUD</th>
<th width="15%" align="center">Diun</th>
<th width="13%" align="center"><em>Watchtower †</em></th>
<th width="14%" align="center"><em>Ouroboros †</em></th>
</tr>
</thead>
<tbody>
<tr><td>Interface web / painel</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Atualização automática de contêineres</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Atualizações do Docker Compose</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Canais de gatilho / notificação</td><td align="center">20</td><td align="center">16</td><td align="center">17</td><td align="center">~19</td><td align="center">~6</td></tr>
<tr><td>Provedores de registro</td><td align="center">23</td><td align="center">13</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Autenticação OIDC / SSO</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>API REST</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Métricas do Prometheus</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Backup e reversão de imagens</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Agrupamento de contêineres / stacks</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Hooks de ciclo de vida (pré/pós)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>API de webhook para CI/CD</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Iniciar/parar/reiniciar/atualizar contêineres</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Agentes distribuídos (remotos)</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Log de auditoria</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Verificação de segurança (Trivy/Grype)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Atualizações compatíveis com SemVer</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Monitoramento de digest</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Multi-arquitetura (amd64/arm64)</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Visualizador de logs</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Mantido ativamente</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
</tbody>
</table>

> Dados baseados em documentação publicamente disponível em março de 2026.
> Contribuições são bem-vindas se alguma informação for imprecisa.

</details>

<hr>

<h2 align="center" id="migration">Migração</h2>

<details>
<summary><strong>Migrando do WUD (E aí, Docker?)</strong></summary>

Drydock v1.6 não carrega mais variáveis ​​de ambiente `WUD_*` ou rótulos `wud.*` em tempo de execução. Reescreva-os antes de iniciar o serviço atualizado; o estado persistido ainda migra automaticamente. Use `docker exec -it drydock node dist/index.js config migrate --dry-run` para visualizar e, em seguida, `docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml` para reescrever a configuração para a nomenclatura `DD_*` e `dd.*`.

</details>

<hr>

<h2 align="center" id="roadmap">Roadmap</h2>

<details>
<summary><strong>Temas e destaques da versão</strong></summary>

Esta direção cobre pelo menos os próximos doze meses, até agosto de 2027.
Apenas temas gerais; consulte [CHANGELOG.md](CHANGELOG.md) para detalhes de cada versão.

| Versão                                       | Tema                                          | Destaques                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1.3.x** ✅ | Segurança e Estabilidade                      | Varredura Trivy, Update Bouncer, SBOM, 7 novos registros, 4 novos gatilhos, mecanismo regex re2js                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **v1.4.x** ✅ | Modernização e fortalecimento da UI           | Tailwind 4 + componentes personalizados, 6 temas, paleta Cmd/K, OpenAPI 3.1, atualizações YAML nativas de composição, digitalização de slot duplo, proteção OIDC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **v1.5.0** ✅ | Observabilidade e i18n                        | acionar divisão de taxonomia (`DD_ACTION_*`/`DD_NOTIFICATION_*`), visualizador de log WebSocket, personalização de painel, monitoramento de recursos, caixa de saída de notificação + DLQ, resumo de verificação de segurança, 17 localidades, repetição de ID de último evento SSE, discagem de agente de borda com autenticação Ed25519 (experimental, `DD_EXPERIMENTAL_PORTWING=true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **v1.5.1** ✅ | Segurança e Manutenção                        | Correção pull-auth GCR/GAR, conclusão de TLS de registro (M-2), endurecimento de injeção env-var de gancho, suporte `DD_SESSION_SECRET__FILE`, redação de credencial de despejo de depuração, verificação de permissão de arquivo secreto, correção de deadlock de portão de maturidade, capacidade de tradução completa da UI + traduções da comunidade, portão de aplicação automática da janela de manutenção, exibição de tempo de atividade do contêiner, versão do software de superfície dividida de coluna Tag/Versão (rótulo OCI, com `dd.inspect.tag.path` gravação dupla + roteamento `dd.inspect.tag.version-only` opcional), correspondência de prefixo de montagem de composição opcional, modelo `${currentReleaseNotes}` var                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **v1.5.2** ✅ | Confiabilidade de políticas e tags fixadas    | Retenção de política de maturidade/pular/suspender segura para recreação, detecção de reconstrução de resumo de tag fixada e insights informativos da mesma família, limpeza de candidato a reversão, prevenção de cascata de reversão, preservação de MAC explícito e comportamento de salto de registro de imagem local                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **v1.6.0**   | Notificações, Política e Liberação Intel      | Modelos de notificação por regra/por acionador com visualização ao vivo, preferências de sino de notificação, sincronização de preferências entre dispositivos, grade de painel personalizada de dependência zero ([#281](https://github.com/CodesWhat/drydock/issues/281)), política de atualização declarativa ([#320](https://github.com/CodesWhat/drydock/issues/320)), contagem regressiva de estabilização de maturidade + visibilidade imediata do candidato + substituição manual ([#406](https://github.com/CodesWhat/drydock/discussions/406)), painel de status de atualização acionável e global Modo de atualização `notify` / `manual` / `auto` ([#325](https://github.com/CodesWhat/drydock/discussions/325)), herança de política de tag de observador/imgset/container mais corrente empilhada → visibilidade de tag fixada mais recente ([#498](https://github.com/CodesWhat/drydock/issues/498)), fonte padronizada de 44px / notas de lançamento / ações de recurso de registro em tabela, cartões e detalhes ([#295](https://github.com/CodesWhat/drydock/discussions/295)), notificações de eventos de status de integridade ([#198](https://github.com/CodesWhat/drydock/discussions/198)), Home Assistant MQTT bidirecional, visualizações responsivas de tabela/lista de cartões, Trivy/Grype/ambas verificações em back-ends de comando ou de Docker-worker fixados, controles de extração/aquecimento de ativos do scanner, desduplicação off-heap Armazenamento SBOM, correção de varredura longa Trivy ([#490](https://github.com/CodesWhat/drydock/issues/490)), avisos de migração de taxonomia de gatilho, remoções de compatibilidade v1.6, higiene de documentos/API e conclusão de migração `/api` → `/api/v1` com um shim de compatibilidade wud-card/página inicial opcional (`DD_COMPAT_WUDCARD`). |
| **v1.7.0**   | Atualizações inteligentes e UX                | Ordenação com reconhecimento de dependência ([#219](https://github.com/CodesWhat/drydock/discussions/219)), atualizações seletivas em massa ([#232](https://github.com/CodesWhat/drydock/discussions/232)), política de atualização por ação ([#511](https://github.com/CodesWhat/drydock/discussions/511)), remoção de imagem, monitoramento de imagem estática, indicador de maturidade de imagem, relógio unificado de maturidade/idade de atualização, links de porta clicáveis, atalhos de teclado, PWA, remoção de `DD_TRIGGER_*` (fim da janela de descontinuação da v1.5.0), curl removido da imagem                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **v1.8.0**   | Gerenciamento de frota e configuração ao vivo | Configuração YAML, configuração de UI ao vivo, navegador de volume, atualizações paralelas, migração de armazenamento SQLite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **v2.0+**                    | Expansão da plataforma e muito mais           | Observadores Swarm/Kubernetes, GitOps, portas de saúde, implementações canary, terminal web, RBAC, chaves de API rotativas com escopo (tokens de portador estático para integrações HA/painel, [#469](https://github.com/CodesWhat/drydock/discussions/469)), LDAP/AD, provedor Podman nativo além da API compatível com Docker, CLI, imagem reforçada Wolfi, proxy de soquete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

</details>

<hr>

<h2 align="center" id="star-history">História da estrela</h2>

<div align="center">
  <a href="https://github.com/CodesWhat/drydock/stargazers">
    <img alt="Star History Chart" src="docs/assets/star-history.svg" />
  </a>
</div>

---

<div align="center">

<h2 align="center" id="built-with">Construído com</h2>

[![TypeScript](https://img.shields.io/badge/TypeScript_6.0-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue_3-42b883?logo=vuedotjs&logoColor=fff)](https://vuejs.org/)
[![Express 5](https://img.shields.io/badge/Express_5-000?logo=express&logoColor=fff)](https://expressjs.com/)
[![Vitest](https://img.shields.io/badge/Vitest_4-6E9F18?logo=vitest&logoColor=fff)](https://vitest.dev/)
[![Biome](https://img.shields.io/badge/Biome_2.5-60a5fa?logo=biome&logoColor=fff)](https://biomejs.dev/)
[![Node 24](https://img.shields.io/badge/Node_24_Alpine-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![Anthropic](https://img.shields.io/badge/Anthropic-CC785C?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/)
[![OpenAI](https://img.shields.io/badge/OpenAI-10A37F?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BT3BlbkFJPC90aXRsZT48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg%3D%3D)](https://openai.com)

[![SemVer](https://img.shields.io/badge/semver-2.0.0-blue)](https://semver.org/)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=fff)](https://www.conventionalcommits.org/)
[![Keep a Changelog](https://img.shields.io/badge/changelog-Keep%20a%20Changelog-E05735)](https://keepachangelog.com/)

<h2 align="center" id="community-support">Comunidade e suporte</h2>

Chat em tempo real e suporte antecipado: **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

Bugs e solicitações de recursos concretas vão para o **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)**; perguntas abertas, ideias e demonstrações vão para o **[GitHub Discussions](https://github.com/CodesWhat/drydock/discussions)**; o chat em tempo real acontece no **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**.

### Controle de qualidade da comunidade

Obrigado aos usuários que ajudaram a testar os release candidate v1.4.0 e v1.5.0 e relataram bugs:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

<h2 align="center" id="codeswhat-ecosystem">Parte do ecossistema CodesWhat</h2>

<table>
  <tbody><tr><th>Ferramenta</th><th>Função</th></tr>
  <tr><td><b>drydock</b></td><td>Monitoramento de atualização de contêiner — UI da web e mecanismo de notificação</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>Agente Docker remoto – acesso seguro em nível de soquete de Drydock ou independente</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Proxy de soquete Docker – filtro de lista de permissões de negação padrão que protege o soquete</td></tr>
</tbody></table>

Essas três ferramentas são projetadas para serem colocadas em camadas: sockguard filtra o soquete, portwing o expõe remotamente e drydock monitora e atua no estado do contêiner.

Consulte o [COMPATIBILITY.md do portwing](https://github.com/CodesWhat/portwing/blob/main/COMPATIBILITY.md) para obter a matriz de compatibilidade completa entre todas as três ferramentas.

---

**[Licença AGPL-3.0](LICENSE)**

<a href="https://github.com/CodesWhat">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/codeswhat-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/codeswhat-logo-original.svg" />
    <img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28">
  </picture>
</a>

<a href="#drydock">Voltar ao topo</a>

</div>
