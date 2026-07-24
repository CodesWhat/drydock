<div align="center">

<p><a href="README.md">English</a> · <a href="README.es.md">Español</a> · <strong>Polski</strong> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português (Brasil)</a></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whale-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/whale-logo.png" />
  <img src="docs/assets/whale-logo.png" alt="drydock" width="220">
</picture>

<h1>drydock</h1>

**Obserwator aktualizacji obrazów kontenerów — 23 rejestry, 20 dostawców powiadomień i działań.**

</div>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/badge/version-1.6.0--rc.2-blue" alt="Version"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-C9A227" alt="License AGPL-3.0"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/test_coverage.svg" alt="Code Coverage"></a>
  <a href="https://dashboard.stryker-mutator.io/reports/github.com/CodesWhat/drydock/main"><img src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FCodesWhat%2Fdrydock%2Fmain" alt="Mutation testing"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/pkgs/container/drydock"><img src="https://img.shields.io/badge/GHCR-150K%2B_pulls-2ea44f?logo=github&logoColor=white" alt="GHCR pulls"></a>
  <a href="https://github.com/veggiemonk/awesome-docker#container-management"><img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Docker"></a>
  <a href="https://crowdin.com/project/drydock"><img src="https://badges.crowdin.net/drydock/localized.svg" alt="Crowdin localization"></a>
</p>

<hr>

> [!WARNING]
> **Aktualizacja ze starszej wersji? Najpierw przeczytaj uwagi dotyczące aktualizacji.** Trzy poprawki zwiększające bezpieczeństwo zostały dostarczone po raz pierwszy w **1.4.6** i działają w całej linii **1.5**, więc każdy, kto dokonuje aktualizacji z wersji starszej niż 1.4.6, będzie miał wpływ na dowolną wersję, na której wyląduje (1.4.6, dowolna wersja 1.5.x lub nowsza). Nie są one wycofane i nie mają okresu karencji: OIDC wymaga teraz `authorization_endpoint` w metadanych wykrywania Twojego dostawcy, nieuwierzytelnionych kluczy ograniczających szybkość na adresie równorzędnym TCP (współdzielony zasobnik za odwrotnym proxy), a adresy URL proxy wyzwalacza HTTP muszą używać `http(s)://`. Przed aktualizacją zobacz **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)**.

<h2 align="center">📑Spis treści</h2>

- [📖 Dokumentacja](https://getdrydock.com/docs)
- [🚀 Szybki start](#quick-start)
- [🆕 Ostatnie aktualizacje](#recent-updates)
- [📸 Zrzuty ekranu i demonstracja na żywo](#screenshots)
- [🤔 Dlaczego Drydock](#why-drydock)
- [✨ Funkcje](#features)
- [🔌 Obsługiwane integracje](#supported-integrations)
- [⚖️ Porównanie funkcji](#feature-comparison)
- [🔄 Migracja](#migration)
- [🗺️ Plan działania](#roadmap)
- [⭐ Historia gwiazd](#star-history)
- [🔧 Zbudowany z](#zbudowany-z)
- [🤝 Społeczność QA](#kontrola-jakości-społeczności)

<hr>

<h2 align="center" id="quick-start">🚀 Szybki start</h2>

**Zalecane: użyj gniazda proxy**, aby ograniczyć punkty końcowe Docker API, do których Drydock może uzyskać dostęp. Pozwala to uniknąć zapewnienia kontenerowi pełnego dostępu do gniazda Docker.

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
<summary>Alternatywa:<a href="https://github.com/CodesWhat/sockguard">sockguard</a>proxy gniazda</summary>

[sockguard](https://github.com/CodesWhat/sockguard) to filtr gniazda Docker z domyślną odmową z tego samego ekosystemu CodesWhat, z ustawieniem wstępnym zbudowanym dla drydock:

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

Zobacz ustawienie wstępne sockguard [`app/configs/portwing.yaml`](https://github.com/CodesWhat/sockguard/blob/dev/v1.5/app/configs/portwing.yaml) dla początkowego `sockguard.yaml` (to samo ustawienie wstępne portwing jest dostarczane we własnych przykładach).

</details>

<details>
<summary>Alternatywa: szybki start z bezpośrednim montażem na gnieździe</summary>

```bash
docker run -d \
  --name drydock \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e DD_AUTH_BASIC_ADMIN_USER=admin \
  -e "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>" \
  codeswhat/drydock:latest
```

> **Ostrzeżenie:** Bezpośredni dostęp do gniazda zapewnia kontenerowi pełną kontrolę nad demonem Dockera. W przypadku wdrożeń produkcyjnych użyj powyższej konfiguracji gniazda proxy. Zobacz [Przewodnik dotyczący zabezpieczeń gniazd Docker](https://getdrydock.com/docs/configuration/watchers#docker-socket-security), aby zapoznać się ze wszystkimi opcjami, w tym zdalnym TLS i Dockerem bez rootowania.

</details>

> Wygeneruj skrót hasła (`argon2` CLI — zainstaluj za pośrednictwem menedżera pakietów):
>
> ```bash
> echo -n "yourpassword" | argon2 $(openssl rand -base64 32) -id -m 16 -t 3 -p 4 -l 64 -e
> ```
>
> Lub z Node.js 24.7+ (nie są potrzebne żadne dodatkowe pakiety):
>
> ```bash
> node -e 'const c=require("node:crypto");const s=c.randomBytes(32);const h=c.argon2Sync("argon2id",{message:process.argv[1],nonce:s,memory:65536,passes:3,parallelism:4,tagLength:64});console.log("argon2id$65536$3$4$"+s.toString("base64")+"$"+h.toString("base64"));' "yourpassword"
> ```
>
> Drydock v1.6 akceptuje tylko skróty uwierzytelniające argon2id Basic. Starsze wersje `{SHA}`, `$apr1$`/`$1$`, `crypt` i skróty zwykłego tekstu są odrzucane; zregeneruj je przed aktualizacją.
> Uwierzytelnienie jest **wymagane domyślnie**. Zobacz [auth docs](https://getdrydock.com/docs/configuration/authentications) dla OIDC, dostępu anonimowego i innych opcji.
> Aby jawnie zezwolić na anonimowy dostęp w przypadku nowych instalacji, ustaw `DD_ANONYMOUS_AUTH_CONFIRM=true`.

Obraz zawiera pliki binarne `trivy` i `cosign` do lokalnego skanowania pod kątem luk i weryfikacji obrazu.

Zobacz [Przewodnik szybkiego startu](https://getdrydock.com/docs/quickstart) dla Docker Compose, bezpieczeństwo gniazd, odwrotne proxy i alternatywne rejestry.

<hr>

<h2 align="center" id="recent-updates">🆕 Ostatnie aktualizacje</h2>

<details open>
<summary><strong>Najważniejsze informacje w wersji 1.6.0-rc.2</strong></summary>

- **Powiadomienia** — szablony tytułów i treści dla poszczególnych reguł/dostawców z podglądem na żywo oraz wspierane audytem kategorie dzwonków w aplikacji i progi ważności aktualizacji.
- **Panel** — Wymiana siatki CSS o zerowej zależności z możliwością zmiany kolejności myszy/dotyku, ograniczonej zmiany rozmiaru, responsywnych układów, widoczności widżetów, resetowania i opcjonalnej synchronizacji preferencji na różnych urządzeniach.
- **Zasady aktualizacji** — Deklarowane pierwszeństwo obserwatora/etykiety/UI, zastąpienie/przywrócenie ścieżki audytu, odliczanie terminu zapadalności/ręczne zastąpienie oraz widoczność informacji przypiętych tagów z skumulowanym bieżącym → nowszym widokiem tagów.
- **Wydajność i odzyskiwanie** — Deduplikacja listy tagów dla poszczególnych ankiet, lżejsze prognozy zbiorcze, zwirtualizowane historie dużych dzienników, niezmienne przerzucanie logów na żywo, przekroczenie limitu czasu ładowania początkowego uwierzytelniania, pełna migracja preferencji i samonaprawa nieaktualnych fragmentów.
- **Wymuszone migracje wersji 1.6** — aliasy env/label WUD, starsze formaty uwierzytelniania, przestarzałe przełączniki obserwatorów, aliasy szablonów, Kafka `clientId` i zniekształcone publiczne konfiguracje Hub/DHI zawierające tylko token nie są już uruchamiane. Aliasy taksonomii wyzwalaczy pozostają w wersji ostatecznej z ostrzeżeniem o poziomie błędów.

Pełne wskazówki dotyczące migracji znajdują się w [DEPRECATIONS.md](./DEPRECATIONS.md).

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji 1.5.2</strong></summary>

- **Zasady aktualizacji bezpiecznej dla rozrywki** — Bramy dojrzałości, pominięte tagi/streszczenia i drzemki teraz przetrwają odtwarzanie kontenera w przypadku obciążeń lokalnych i zdalnych agentów.
- **Niezawodność przypiętego tagu** — Całkowicie przypięte tagi wykrywają ponowne przebudowanie podsumowania tego samego tagu, podczas gdy interfejs użytkownika może wyświetlać niewykonalny nowszy tag tej samej rodziny bez zmiany zachowania aktualizacji lub wyzwalacza.
- **Odzyskiwanie wycofywania** — Nieudane utworzenie zamiennika, połączenie sieciowe lub uruchomienie powoduje teraz oczyszczenie kandydata przed przywróceniem oryginalnego kontenera, a powtarzające się błędy nie mogą kaskadować się poprzez zagnieżdżone zmiany nazw wycofywania.
- **Bezpieczniejsze odtwarzanie kontenerów** — Adresy MAC przypisane przez demona nie są już przypinane do zamienników, natomiast jawnie skonfigurowane adresy MAC sieci podstawowej pozostają zachowane.
- **Cichsze odpytywanie obrazów lokalnych** — Obrazy tworzone lub ładowane lokalnie bez skrótu rejestru pomijają zdalne wyszukiwanie, zamiast generować powtarzające się błędy autoryzacji.

Pełna historia w [CHANGELOG.md](./CHANGELOG.md).

</details>

<hr>

<h2 align="center" id="screenshots">📸 Zrzuty ekranu i demonstracja na żywo</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>Znajdź aktualizację, zobacz dokładnie, jakie zmiany i zastosuj ją. Obsługiwane kopie zapasowe, sprawdzanie stanu i przywracanie zmian.</em></p>

<table>
<tr>
<td width="50%" align="center"><strong>Światło</strong></td>
<td width="50%" align="center"><strong>Ciemny</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</table>

<div align="center">

**Po co oglądać zrzuty ekranu, skoro możesz tego doświadczyć na własnej skórze?**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

W pełni interaktywny — prawdziwy interfejs użytkownika, próbne dane, nie wymaga instalacji. Działa całkowicie w przeglądarce.

</div>

<hr>

<h2 align="center" id="why-drydock">🤔 Dlaczego Drydock</h2>

Obrazy kontenerów po cichu stają się nieaktualne. Obraz bazowy łata CVE, aplikacja wycofuje wersję, tag się przenosi. Jeśli nie będziesz oglądać każdego rejestru ręcznie, działające kontenery pozostaną w tyle, dopóki coś się nie zepsuje lub nie zostanie wykorzystane.

Większość narzędzi wymusza kompromis. Automatyczne aktualizacje (Watchtower, Ouroboros) pobierają się i uruchamiają ponownie przy niewielkiej widoczności lub kontroli i obecnie w dużej mierze nie są konserwowane. Pulpity nawigacyjne (Portainer) zarządzają kontenerami, ale nie są zbudowane pod kątem analizy aktualizacji. Drydock to **najpierw monitor**: obserwuje 23 rejestry i dokładnie informuje Cię, co się zmieniło (główne, poboczne, poprawki lub podsumowanie), zanim cokolwiek się wydarzy, a następnie działa tylko wtedy, gdy na to pozwolisz. I sięga dalej niż którykolwiek z nich. Skanowanie pod kątem luk w zabezpieczeniach Trivy/Grype blokuje niebezpieczne aktualizacje, cosign weryfikuje podpisy, kopie zapasowe obrazów przed aktualizacją przywracają się automatycznie w przypadku niepowodzenia kontroli stanu, rozproszoni agenci obsługują zdalne hosty, a 20 integracji powiadomień i działań zamyka pętlę. Pełny cykl życia aktualizacji z interfejsem internetowym i interfejsem API REST.

<hr>

<h2 align="center" id="features">✨ Funkcje</h2>

| | Funkcja | Opis |
|---|---|---|
| 🔭 | **Wykrywanie najpierw na monitorze** | Obserwuje każdy działający kontener i zanim cokolwiek się wydarzy, klasyfikuje każdą dostępną aktualizację jako główną, pomocniczą, poprawkę lub podsumowanie. Nic się nie zmieni, dopóki tak nie powiesz. |
| 📦 | **23 Dostawcy rejestru** | Docker Hub, GHCR, ECR, ACR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus i 12 innych. Publiczne i prywatne, w chmurze i na własnym serwerze, z TLS i uwierzytelnianiem dla poszczególnych rejestrów. |
| 🔔 | **20 wyzwalaczy** | 17 kanałów powiadomień (Slack, Discord, Telegram, Teams, SMTP, MQTT, ntfy i więcej) oraz Docker, Docker Compose i akcje poleceń, z szablonami dla poszczególnych zdarzeń/dostawców, podglądem na żywo, filtrowaniem progów i trybem wsadowym. |
| 🥊 | **Update Bouncer** | Skanowanie pod kątem luk w zabezpieczeniach Trivy/Grype blokuje niebezpieczne aktualizacje przed ich wdrożeniem, z weryfikacją podpisu Cosign i generowaniem SBOM (CycloneDX i SPDX). |
| ↩️ | **Kopia zapasowa obrazu i automatyczne przywracanie** | Wstępnie aktualizuj migawki obrazów z konfigurowalnym przechowywaniem, automatycznym przywracaniem w przypadku niepowodzenia kontroli stanu i ręcznym przywracaniem jednym kliknięciem z poziomu interfejsu użytkownika. |
| 🪝 | **Haki cyklu życia** | Polecenia powłoki przed i po aktualizacji za pośrednictwem etykiet kontenerów, z limitami czasu dla poszczególnych haków i kontrolą przerwania w przypadku awarii. |
| 🗂️ | **Aktualizacje Docker Compose** | Pobieraj i odtwarzaj usługi Compose za pośrednictwem interfejsu API Docker Engine z łataniem obrazów zachowującym YAML. |
| 🎛️ | **Zasady dotyczące kontenera** | Reguły tagów Regex i routing wyzwalaczy korzystają z etykiet `dd.*`; bramki dojrzałości, pomijanie/odkładanie/przypinanie i okna konserwacji są przechowywane za pośrednictwem interfejsu użytkownika/API lub konfiguracji obserwatora. |
| 🛰️ | **Agenci rozproszoni** | Monitoruj zdalne hosty Dockera za pośrednictwem SSE. Agenci brzegowi za NAT wybierają numer przez WebSocket z uwierzytelnianiem za pomocą klucza Ed25519, nie jest wymagany port wejściowy (`DD_EXPERIMENTAL_PORTWING=true`). |
| 🖥️ | **Panel sieciowy** | Interfejs użytkownika Vue 3 z konfigurowalną siatką widżetów o zerowej zależności, responsywnymi widokami tabel/kart, aktualizacjami SSE na żywo, sterowaniem dzwonkiem powiadomień oraz szczegółami, dziennikami i statystykami dotyczącymi poszczególnych kontenerów. |
| 🔗 | **REST API i webhooki** | Punkty końcowe uwierzytelniane tokenem dla wyzwalaczy monitorowania i aktualizacji CI/CD oraz pozyskiwania podpisanego elementu webhook rejestru dla zdarzeń push. |
| 🔐 | **Uwierzytelnianie OIDC** | Zabezpiecz deskę rozdzielczą za pomocą OpenID Connect (Authelia, Auth0, Authentik). Domyślnie wszystkie przepływy uwierzytelniania nie są zamykane. |
| 📈 | **Dane Prometheus** | Wbudowany punkt końcowy `/metrics` z opcjonalnym obejściem uwierzytelniania dla stosów monitorowania Prometheus i Grafana. |
| 🌍 | **17 ustawień regionalnych interfejsu użytkownika** | W pełni przewodowy system tłumaczeń z pełnym językiem angielskim i 16 obsługiwanymi przez społeczność lokalizacjami zsynchronizowanymi za pośrednictwem Crowdin, przełączalny w konfiguracji. |
| 🔒 | **ReDoS-Regex immunologiczny** | Każdy wzorzec znacznika dostarczony przez użytkownika jest kompilowany przez re2js (port oparty wyłącznie na JS RE2) w celu uzyskania liniowego dopasowania, którego nie może zatrzymać katastrofalny wzorzec cofania się. |

<hr>

<h2 align="center" id="supported-integrations">🔌 Obsługiwane integracje</h2>

### 📦 Rejestry (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Quay · LSCR · Port · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Niestandardowy · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### ⚡ Akcje (3)

Doker · Docker Compose · Polecenie

### 🔔 Powiadomienia (17)

Appprise · Discord · Czat Google · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### 🔐 Uwierzytelnianie

Anonimowy (opcja poprzez `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Podstawowy (nazwa użytkownika + skrót hasła) · OIDC (Authelia, Auth0, Authentik). Domyślnie wszystkie przepływy uwierzytelniania nie są zamykane.

### 🥊 Update Bouncer

Skanowanie pod kątem luk w zabezpieczeniach oparte na Trivy lub Grype blokuje niebezpieczne aktualizacje przed ich wdrożeniem. Obejmuje weryfikację podpisu Cosign i generowanie SBOM (CycloneDX i SPDX).

<hr>

<h2 align="center" id="feature-comparison">⚖️ Porównanie funkcji</h2>

<details>
<summary><strong>Jak drydock wypada w porównaniu z innymi narzędziami do aktualizacji kontenerów?</strong></summary>

> ✅ = obsługiwane &nbsp; ❌ = nieobsługiwane &nbsp; ⚠️ = częściowy / ograniczony &nbsp; † = zarchiwizowane, nie jest już obsługiwane

| Feature | drydock | WUD | Diun | *Watchtower †* | *Ouroboros †* |
|---|:---:|:---:|:---:|:---:|:---:|
| Interfejs webowy / pulpit | ✅ | ✅ | ❌ | ❌ | ❌ |
| Automatyczna aktualizacja kontenerów | ✅ | ✅ | ❌ | ✅ | ✅ |
| Aktualizacje Docker Compose | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| Kanały wyzwalaczy / powiadomień | 20 | 16 | 17 | ~19 | ~6 |
| Dostawcy rejestrów | 23 | 13 | ⚠️ | ⚠️ | ⚠️ |
| Uwierzytelnianie OIDC / SSO | ✅ | ✅ | ❌ | ❌ | ❌ |
| REST API | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| Metryki Prometheus | ✅ | ✅ | ❌ | ✅ | ✅ |
| MQTT / Home Assistant | ✅ | ✅ | ✅ | ❌ | ❌ |
| Kopia i przywracanie obrazów | ✅ | ❌ | ❌ | ❌ | ❌ |
| Grupowanie kontenerów / stosy | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| Hooki cyklu życia (przed/po) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Webhook API dla CI/CD | ✅ | ❌ | ❌ | ✅ | ❌ |
| Start/stop/restart/aktualizacja kontenerów | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agenci rozproszeni (zdalni) | ✅ | ❌ | ✅ | ⚠️ | ❌ |
| Dziennik audytu | ✅ | ❌ | ❌ | ❌ | ❌ |
| Skanowanie bezpieczeństwa (Trivy/Grype) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Aktualizacje zgodne z SemVer | ✅ | ✅ | ✅ | ❌ | ❌ |
| Monitorowanie digestów | ✅ | ✅ | ✅ | ✅ | ✅ |
| Wiele architektur (amd64/arm64) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Podgląd logów kontenera | ✅ | ❌ | ❌ | ❌ | ❌ |
| Aktywnie utrzymywane | ✅ | ✅ | ✅ | ❌ | ❌ |

> Dane na podstawie publicznie dostępnej dokumentacji, stan na marzec 2026 r.
> Komentarze są mile widziane, jeśli jakiekolwiek informacje są niedokładne.

</details>

<hr>

<h2 align="center" id="migration">🔄 Migracja</h2>

<details>
<summary><strong>Migracja z WUD (Co słychać w oknie dokowanym?)</strong></summary>

Drydock v1.6 nie ładuje już zmiennych środowiskowych `WUD_*` ani etykiet `wud.*` w czasie wykonywania. Przepisz je przed uruchomieniem uaktualnionej usługi; stan utrwalony nadal migruje automatycznie. Użyj `docker exec -it drydock node dist/index.js config migrate --dry-run`, aby wyświetlić podgląd, a następnie `docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml`, aby przepisać konfigurację na nazewnictwo `DD_*` i `dd.*`.

</details>

<hr>

<h2 align="center" id="roadmap">🗺️ Plan działania</h2>

<details>
<summary><strong>Motywy i najważniejsze wersje wersji</strong></summary>

Tylko motywy wysokiego poziomu — zobacz [CHANGELOG.md](CHANGELOG.md), aby uzyskać szczegółowe informacje na temat poszczególnych wersji.

| Wersja | Motyw | Najważniejsze |
| --- | --- | --- |
| **v1.3.x** ✅ | Bezpieczeństwo i stabilność | Skanowanie Trivy, Update Bouncer, SBOM, 7 nowych rejestrów, 4 nowe wyzwalacze, silnik re2js regex |
| **v1.4.x** ✅ | Modernizacja i wzmocnienie interfejsu użytkownika | Tailwind 4 + niestandardowe komponenty, 6 motywów, paleta Cmd/K, OpenAPI 3.1, natywne aktualizacje YAML, skanowanie z dwoma gniazdami, utwardzanie OIDC |
| **v1.5.0** ✅ | Obserwowalność i i18n | wyzwalacz podziału taksonomii (`DD_ACTION_*`/`DD_NOTIFICATION_*`), przeglądarka logów WebSocket, dostosowywanie pulpitu nawigacyjnego, monitorowanie zasobów, skrzynka nadawcza powiadomień + DLQ, podsumowanie skanowania bezpieczeństwa, 17 ustawień regionalnych, odtwarzanie identyfikatora ostatniego zdarzenia SSE, wybieranie numeru agenta brzegowego z uwierzytelnianiem Ed25519 (eksperymentalne, `DD_EXPERIMENTAL_PORTWING=true`) |
| **v1.5.1** ✅ | Bezpieczeństwo i konserwacja | Poprawka autoryzacji pull-auth GCR/GAR, zakończenie TLS rejestru (M-2), utwardzanie wtrysku hook env-var, obsługa `DD_SESSION_SECRET__FILE`, redakcja poświadczeń debug-dump, sprawdzanie uprawnień do plików tajnych, naprawa zakleszczenia bramy dojrzałości, pełna translacja interfejsu użytkownika + tłumaczenia społeczności, bramka automatycznego stosowania okna konserwacji, wyświetlanie czasu pracy kontenera, wersja oprogramowania z podziałem kolumny tagu/wersji (etykieta OCI, z `dd.inspect.tag.path` podwójny zapis + opcjonalne routing `dd.inspect.tag.version-only`), opcjonalne tworzenie dopasowywania prefiksów montowania, szablon `${currentReleaseNotes}` var |
| **v1.5.2** ✅ | Niezawodność zasad i przypiętych tagów | Bezpieczne dla celów rekreacyjnych zachowywanie zasad dotyczących dojrzałości/pomiń/odłóż, wykrywanie odbudowy podsumowania przypiętych tagów i informacyjne spostrzeżenia dotyczące tej samej rodziny, czyszczenie kandydatów do wycofania, zapobieganie kaskadzie wycofywania, jawne zachowywanie adresów MAC i zachowanie pomijania rejestru obrazów lokalnych |
| **v1.6.0** | Powiadomienia, zasady i wydania Intel | Szablony powiadomień dla poszczególnych reguł/wyzwalaczy z podglądem na żywo, preferencjami dzwonka powiadomień, synchronizacją preferencji między urządzeniami, niestandardową siatką pulpitu nawigacyjnego o zerowej zależności ([#281](https://github.com/CodesWhat/drydock/issues/281)), deklaratywną polityką aktualizacji ([#320](https://github.com/CodesWhat/drydock/issues/320)), odliczaniem stabilizacji dojrzałości + natychmiastową widocznością kandydata + ręcznym zastąpieniem ([#406](https://github.com/CodesWhat/drydock/discussions/406)), praktycznym panelem stanu aktualizacji i globalnym `notify` / `manual` / `auto` tryb aktualizacji ([#325](https://github.com/CodesWhat/drydock/discussions/325)), dziedziczenie zasad tagów obserwatora/imgset/kontenera plus skumulowany prąd → nowsza widoczność przypiętych tagów ([#498](https://github.com/CodesWhat/drydock/issues/498)), ujednolicone źródło 44px / informacje o wersji / akcje zasobów rejestru w tabelach, kartach i szczegóły ([#295](https://github.com/CodesWhat/drydock/discussions/295)), powiadomienia o zdarzeniach dotyczących stanu zdrowia ([#198](https://github.com/CodesWhat/drydock/discussions/198)), dwukierunkowy Home Assistant MQTT, responsywne widoki tabel/list kart, Trivy/Grype/oba skanowanie za pośrednictwem poleceń lub przypiętych backendów Docker-worker, kontrola ściągania/ogrzewania zasobów skanera, praca poza stertą deduplikowana pamięć SBOM, poprawność długiego skanowania Trivy ([#490](https://github.com/CodesWhat/drydock/issues/490)), ostrzeżenia o migracji wyzwalacza-taksonomii, usunięcie zgodności z wersją 1.6, higiena dokumentów/API oraz zakończenie migracji `/api` → `/api/v1` z opcjonalną podkładką zgodności wud-card/strony głównej (`DD_COMPAT_WUDCARD`). |
| **v1.7.0** | Inteligentne aktualizacje i UX | Zamawianie uwzględniające zależności ([#219](https://github.com/CodesWhat/drydock/discussions/219)), selektywne aktualizacje zbiorcze ([#232](https://github.com/CodesWhat/drydock/discussions/232)), zasady aktualizacji według akcji ([#511](https://github.com/CodesWhat/drydock/discussions/511)), czyszczenie obrazu, monitorowanie obrazu statycznego, wskaźnik dojrzałości obrazu, ujednolicony zegar dojrzałości/wieku aktualizacji, klikalne łącza do portów, skróty klawiaturowe, PWA, usuwanie `DD_TRIGGER_*` (koniec wycofania wersji 1.5.0 okno), zawijanie usunięte z obrazu |
| **v1.8.0** | Zarządzanie flotą i konfiguracja na żywo | Konfiguracja YAML, konfiguracja interfejsu użytkownika na żywo, przeglądarka woluminów, aktualizacje równoległe, migracja sklepu SQLite |
| **v2.0+** | Rozszerzanie platformy i nie tylko | Obserwatorzy roju/Kubernetes, GitOps, bramki kondycji, wdrożenia Canary, terminal sieciowy, RBAC, rotacyjne klucze API o określonym zakresie (statyczne tokeny nośnika do integracji HA/pulpitu nawigacyjnego, [#469](https://github.com/CodesWhat/drydock/discussions/469)), LDAP/AD, natywny dostawca Podman poza interfejsem API zgodnym z Dockerem, CLI, wzmocniony obraz Wolfi, proxy gniazda |

</details>

<hr>

<h2 align="center" id="documentation">📖 Dokumentacja</h2>

| Zasób | Link |
| --- | --- |
| Strona internetowa | [getdrydock.com](https://getdrydock.com/) |
| Demo na żywo | [demo.getdrydock.com](https://demo.getdrydock.com) |
| Dokumenty | [getdrydock.com/docs](https://getdrydock.com/docs) |
| Konfiguracja | [Konfiguracja](https://getdrydock.com/docs/configuration) |
| Szybki start | [Szybki start](https://getdrydock.com/docs/quickstart) |
| Dziennik zmian | [`CHANGELOG.md`](CHANGELOG.md) |
| Wycofanie | [`DEPRECATIONS.md`](DEPRECATIONS.md) |
| Mapa drogowa | Zobacz sekcję [Roadmap](#roadmap) powyżej |
| Wkład | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Problemy | [Problemy z GitHubem](https://github.com/CodesWhat/drydock/issues) |
| Dyskusje | [GitHub Discussions](https://github.com/CodesWhat/drydock/discussions) — prośby o nowe funkcje i pomysły mile widziane |

<hr>

<a id="star-history"></a>

<div align="center">
  <a href="https://star-history.com/#CodesWhat/drydock&Date">
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=Date" />
  </a>
</div>

---

<div align="center">

### Zbudowany z

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

### Społeczność

Pytania, opinie i wczesne wsparcie: **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

Prosimy o zgłaszanie konkretnych błędów i propozycji nowych funkcji w **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)**, aby nie zgubiły się na czacie.

### Kontrola jakości społeczności

Dziękujemy użytkownikom, którzy pomogli w testowaniu wersji 1.4.0 i 1.5.0 oraz zgłosili błędy:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

### Część ekosystemu CodesWhat

<table>
  <tr><th>Narzędzie</th><th>Rola</th></tr>
  <tr><td><b>drydock</b></td><td>Monitorowanie aktualizacji kontenera — interfejs WWW i silnik powiadomień</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>Zdalny agent Docker — bezpieczny dostęp na poziomie gniazda z poziomu Drydock lub samodzielnego</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Serwer proxy gniazda Docker — domyślny filtr listy dozwolonych chroniący gniazdo</td></tr>
</table>

Te trzy narzędzia zaprojektowano z myślą o nakładaniu warstw: sockguard filtruje gniazdo, portwing udostępnia je zdalnie, a drydock monitoruje stan kontenera i oddziałuje na niego.

Zobacz plik [portwing's COMPATIBILITY.md](https://github.com/CodesWhat/portwing/blob/main/COMPATIBILITY.md), aby zapoznać się z pełną matrycą kompatybilności wszystkich trzech narzędzi.

---

**[Licencja AGPL-3.0](LICENSE)**

<a href="https://github.com/CodesWhat">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/codeswhat-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/codeswhat-logo-original.svg" />
    <img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28">
  </picture>
</a>

[![Sponsor](https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CodesWhat)

<a href="#drydock">Powrót do góry</a>

</div>
