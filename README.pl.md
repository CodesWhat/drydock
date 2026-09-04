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
> **Aktualizacja ze starszej wersji? Najpierw przeczytaj uwagi dotyczące aktualizacji.** Trzy poprawki zwiększające bezpieczeństwo zostały dostarczone po raz pierwszy w **1.4.6** i działają w całej linii **1.5**, więc każdy, kto dokonuje aktualizacji z wersji starszej niż 1.4.6, będzie miał wpływ na dowolną wersję, na której wyląduje (1.4.6, dowolna wersja 1.5.x lub nowsza). Nie są one wycofane i nie mają okresu karencji: OIDC wymaga teraz `authorization_endpoint` w metadanych wykrywania Twojego dostawcy, nieuwierzytelnionych kluczy ograniczających szybkość na adresie równorzędnym TCP (współdzielony zasobnik za odwrotnym proxy), a adresy URL proxy wyzwalacza HTTP muszą używać `http(s)://`. Przed aktualizacją zobacz **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)**.

<!-- separate alerts: a blank-line-only gap between blockquotes trips markdownlint MD028 -->

> [!WARNING]
> **Aktualizujesz do 1.6.0-rc.3 lub nowszej wersji?** Dodatkowe zabezpieczenia obowiązują bez okresu przejściowego. Instancja bez skonfigurowanego uwierzytelniania albo z włączonym, lecz niepotwierdzonym dostępem anonimowym po aktualizacji działa teraz w trybie zamkniętym, tak samo jak nowa instalacja: kontener działa, chronione żądania API zwracają `401`, publiczne trasy wykrywania i stanu uwierzytelniania pozostają dostępne, a `/health` zwraca `503`. Powłoka SPA może się załadować, ale nie odczyta chronionych danych. Przed aktualizacją ustaw `DD_ANONYMOUS_AUTH_CONFIRM=true` lub skonfiguruj `DD_AUTH_BASIC_*`/OIDC. Nazwa cookie sesji zmienia się z `connect.sid` na `drydock.sid`, co jednorazowo wyloguje użytkowników. Wyzwalacze powiadomień HTTP, webhook Hass i pobieranie ikon rejestrów rozwiązują teraz nazwy hostów za pomocą chronionego wyszukiwania DNS, które blokuje cele metadanych chmurowych i adresy link-local oraz nigdy nie podąża za przekierowaniami — ustaw `allowmetadata=true` dla konkretnego wyzwalacza `DD_NOTIFICATION_HTTP_*` tylko wtedy, gdy rzeczywiście jest to potrzebne. Pełne wskazówki zawiera **[DEPRECATIONS.md](DEPRECATIONS.md#enforced-security-changes-no-deprecation-window)**.

<h2 align="center">Spis treści</h2>

- [Dokumentacja](#documentation)
- [Szybki start](#quick-start)
- [Ostatnie aktualizacje](#recent-updates)
- [Zrzuty ekranu i demonstracja na żywo](#screenshots)
- [Dlaczego Drydock](#why-drydock)
- [Funkcje](#features)
- [Obsługiwane integracje](#supported-integrations)
- [Porównanie funkcji](#feature-comparison)
- [Migracja](#migration)
- [Plan działania](#roadmap)
- [Historia gwiazd](#star-history)
- [Zbudowany z](#built-with)
- [Społeczność i wsparcie](#community-support)
- [Ekosystem CodesWhat](#codeswhat-ecosystem)

<h2 align="center" id="documentation">Dokumentacja</h2>

| Zasób                      | Link                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Strona internetowa         | [getdrydock.com](https://getdrydock.com/)                                                              |
| Demo na żywo               | [demo.getdrydock.com](https://demo.getdrydock.com)                                     |
| Dokumenty                  | [getdrydock.com/docs](https://getdrydock.com/docs)                                                     |
| Konfiguracja               | [Konfiguracja](https://getdrydock.com/docs/configuration)                                                              |
| Szybki start               | [Szybki start](https://getdrydock.com/docs/quickstart)                                                                 |
| Dziennik zmian             | [`CHANGELOG.md`](CHANGELOG.md)                                                                                         |
| Deprecations               | [`DEPRECATIONS.md`](DEPRECATIONS.md)                                                                                   |
| Mapa drogowa               | Zobacz sekcję [Roadmap](#roadmap) poniżej                                                                              |
| Contributing               | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                                                                   |
| Kodeks postępowania        | [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)                                                                             |
| Zarządzanie                | [`GOVERNANCE.md`](GOVERNANCE.md)                                                                                       |
| Zapewnienie bezpieczeństwa | [`SECURITY-ASSURANCE.md`](SECURITY-ASSURANCE.md)                                                                       |
| Polityka bezpieczeństwa    | [`SECURITY.md`](SECURITY.md)                                                                                           |
| Problemy                   | [Problemy z GitHubem](https://github.com/CodesWhat/drydock/issues)                                                     |
| Dyskusje                   | [GitHub Discussions](https://github.com/CodesWhat/drydock/discussions) — prośby o nowe funkcje i pomysły mile widziane |

<hr>

<h2 align="center" id="quick-start">Szybki start</h2>

**Zalecane: użyj gniazda proxy**, aby ograniczyć punkty końcowe Docker API, do których Drydock może uzyskać dostęp. Pozwala to uniknąć zapewnienia kontenerowi pełnego dostępu do gniazda Docker.

> **Uwaga:** Compose traktuje `$` jako składnię interpolacji zmiennych, więc wklejony hash argon2id z pojedynczym `$` dotrze do Drydock uszkodzony. Podwój każdy `$` do `$$` przy wklejaniu prawdziwego hasha, na przykład `$$argon2id$$v=19$$m=65536,t=3,p=4$$salt$$hash`.

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      socket-proxy:
        condition: service_healthy
    volumes:
      - drydock-store:/store
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

volumes:
  drydock-store:
```

<details>
<summary>Alternatywa: <a href="https://github.com/CodesWhat/sockguard">sockguard</a> proxy gniazda</summary>

[sockguard](https://github.com/CodesWhat/sockguard) to filtr gniazda Docker z domyślną odmową z tego samego ekosystemu CodesWhat, z ustawieniem wstępnym zbudowanym dla drydock:

> **Uwaga:** Compose traktuje `$` jako składnię interpolacji zmiennych, więc wklejony hash argon2id z pojedynczym `$` dotrze do Drydock uszkodzony. Podwój każdy `$` do `$$` przy wklejaniu prawdziwego hasha, na przykład `$$argon2id$$v=19$$m=65536,t=3,p=4$$salt$$hash`.

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      sockguard:
        condition: service_healthy
    volumes:
      - drydock-store:/store
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

volumes:
  drydock-store:
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
  -v drydock-store:/store \
  -e DD_AUTH_BASIC_ADMIN_USER=admin \
  -e 'DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>' \
  codeswhat/drydock:latest
```

> **Ostrzeżenie:** Bezpośredni dostęp do gniazda zapewnia kontenerowi pełną kontrolę nad demonem Dockera. W przypadku wdrożeń produkcyjnych użyj powyższej konfiguracji gniazda proxy. Zobacz [Przewodnik dotyczący zabezpieczeń gniazd Docker](https://getdrydock.com/docs/configuration/watchers#docker-socket-security), aby zapoznać się ze wszystkimi opcjami, w tym zdalnym TLS i Dockerem bez rootowania.
>
> Użyj pojedynczych cudzysłowów wokół wartości hasha, jak pokazano. Podwójne cudzysłowy nadal pozwalają powłoce rozwinąć `$`, zanim docker go zobaczy, uszkadzając prawdziwy hash argon2id.

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
> Dostęp anonimowy musi zostać jawnie potwierdzony ustawieniem `DD_ANONYMOUS_AUTH_CONFIRM=true` zarówno w nowych, jak i aktualizowanych instalacjach. Bez tego instancja bez skonfigurowanego uwierzytelniania lub z niepotwierdzonym trybem anonimowym uruchamia się w trybie zamkniętym: chronione żądania API zwracają `401`, publiczne trasy wykrywania i stanu uwierzytelniania pozostają dostępne, a `/health` zwraca `503`.

Obraz zawiera pliki binarne `trivy` i `cosign` do lokalnego skanowania pod kątem luk i weryfikacji obrazu.

Zobacz [Przewodnik szybkiego startu](https://getdrydock.com/docs/quickstart) dla Docker Compose, bezpieczeństwo gniazd, odwrotne proxy i alternatywne rejestry.

<hr>

<h2 align="center" id="recent-updates">Ostatnie aktualizacje</h2>

<details open>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.10</strong></summary>

- **Wysyłki zbiorcze i skrótowe z `once=true` biorą teraz tę samą rezerwację slotu powiadomienia co ścieżka prosta, dzięki czemu ręczny skan nakładający się na skan crona nie może już zgłosić tej samej aktualizacji dwukrotnie.** Opróżnianie bufora skrótów pomija i usuwa wynik z bufora, który wcześniejsze opróżnianie już wysłało, a bufor ponowień wsadowych nie przekazuje już do wyzwalacza wpisu bez rezerwacji. ([#998](https://github.com/CodesWhat/drydock/pull/998))
- **Wyrejestrowanie watchera czyści teraz licznik terminu skanu crona**, dzięki czemu zdemontowany watcher nie zapisuje już ostrzeżenia o terminie, który do niego nie należy, każdy wywołujący czekający na ten skan zostaje rozwiązany, a skan zlecony po demontażu jest odrzucany zamiast uruchamiany. ([#998](https://github.com/CodesWhat/drydock/pull/998))
- **Przewodnik pierwszych kroków mówi teraz, że skrypty hooków działają wewnątrz kontenera Drydock**, więc ścieżka istniejąca tylko na hoście lub w zaktualizowanym kontenerze kończy się niepowodzeniem, a poprawka wyszukiwania rejestru dla agenta wskazuje teraz jej autora. ([#996](https://github.com/CodesWhat/drydock/pull/996))
- **Ten sam akapit o hookach mówi teraz, że nieudany pre-hook domyślnie przerywa aktualizację, i wskazuje `dd.hook.pre.abort=false` jako sposób rezygnacji**, zamiast opisywać to przerwanie jako bezwarunkowe. ([#1001](https://github.com/CodesWhat/drydock/pull/1001))

Pełne informacje o wydaniu: [CHANGELOG.md](./CHANGELOG.md#170-rc10--2026-09-04).

</details>

<details open>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.9</strong></summary>

- **`watchFromCron()` działa teraz w trybie single-flight, dzięki czemu nakładające się skany w dużej flocie nie uruchamiają już tego samego wyzwalacza wielokrotnie dla jednej aktualizacji.** Skan, który nigdy się nie kończy, jest teraz uruchamiany z terminem, dzięki czemu nie może zablokować kolejnych cykli crona. ([#979](https://github.com/CodesWhat/drydock/pull/979))
- **Wyzwalacz `once=true` nie uruchamia się już ponownie godziny później dla aktualizacji tagu, którą już zgłosił, gdy rejestr ogranicza liczbę zapytań o digest**, ponieważ klucz historii powiadomień jest teraz stabilny przy takim błędzie zamiast przełączać się między dwoma formatami skrótu. ([#979](https://github.com/CodesWhat/drydock/pull/979))
- **Banery przestarzałości w interfejsie dla usuniętych zmiennych środowiskowych `DD_TRIGGER_*` oraz nadpisania healthchecka opartego na curl teraz informują, że te rzeczy już zniknęły**, zamiast wskazywać na termin usunięcia, który już minął. ([#988](https://github.com/CodesWhat/drydock/pull/988))
- **Audyt dokumentacji poprawił README, DEPRECATIONS.md oraz dokumentację konfiguracji/wyzwalaczy/rejestrów/API/monitoringu/agentów zgodnie z rzeczywistym kodem tego drzewa**, a fragmenty Get Started na stronie marketingowej wdrażają teraz instancję, która faktycznie staje się zdrowa. ([#988](https://github.com/CodesWhat/drydock/pull/988))

Pełne informacje o wydaniu: [CHANGELOG.md](./CHANGELOG.md#170-rc9--2026-09-03).

</details>

<details open>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.8</strong></summary>

- **Ścieżki aktualizacji natywnej Docker i Compose przypinają teraz niezmienny skrót pobranego obrazu przed weryfikacją podpisu, skanowaniem i podmianą**, zamykając okno na zmianę repozytorium rejestru na obu ścieżkach. ([#961](https://github.com/CodesWhat/drydock/pull/961), [#952](https://github.com/CodesWhat/drydock/pull/952))
- **Samoaktualizacja nie wycofuje już zweryfikowanej pod względem kondycji podmiany, gdy czyszczenie starego kontenera się nie powiedzie**, a moduł obsługi migawek watchera przestaje traktować pustą listę kontenerów jako masowe usunięcie. ([#951](https://github.com/CodesWhat/drydock/pull/951), [#929](https://github.com/CodesWhat/drydock/pull/929))
- **`dd.registry.lookup.image` dotyczy teraz kontenerów zgłaszanych przez agentów transportu Docker kontrolera**, dzięki czemu kontenery zgłaszane przez Portwing respektują to samo przekierowanie rejestru co obserwowane lokalnie. ([#956](https://github.com/CodesWhat/drydock/pull/956))
- **`DD_AGENT_ALLOW_INSECURE_SECRET` nie tworzy już agenta widmo o nazwie `allow`**, a kontener oznaczony jako `unknown` przed skonfigurowaniem rejestru teraz odzyskuje stan przy odświeżeniu. ([#954](https://github.com/CodesWhat/drydock/pull/954), [#955](https://github.com/CodesWhat/drydock/pull/955))
- **Zrzuty debugowania ukrywają teraz adresy URL usługi Apprise, identyfikatory użytkowników Rocket.Chat i identyfikatory czatów Telegram**, zamykając ostatnią lukę poświadczeń właściwą dla dostawcy w tym punkcie końcowym. ([#953](https://github.com/CodesWhat/drydock/pull/953))
- **Cztery poprawki z przeglądu QA rc.6 trafiają do wydania**: poprawione ostrzeżenie Trivy, prawdziwa strona 404, dokładne liczniki wyszukiwania audytu i panel serwerów respektujący własny przycisk Odśwież. ([#928](https://github.com/CodesWhat/drydock/pull/928))

Pełne informacje o wydaniu: [CHANGELOG.md](./CHANGELOG.md#170-rc8--2026-09-03).

</details>

<details open>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.7</strong></summary>

- **Paginacja rejestrów korzysta teraz z kursora właściwego dla każdego rejestru**, więc sprawdzanie aktualizacji nie pomija stron ani nie kończy się przedwcześnie. ([#927](https://github.com/CodesWhat/drydock/pull/927))
- **Aktualizacje pozostają pomyślne, gdy czyszczenie nie powiedzie się po kontroli stanu**; ładunki SSE są mniejsze, a samoaktualizacje czekają na zakończenie aktywnych cykli przed przejęciem wyłącznej blokady. ([#931](https://github.com/CodesWhat/drydock/pull/931), [#942](https://github.com/CodesWhat/drydock/pull/942))
- **Redakcja poświadczeń obejmuje teraz wyzwalacze, rejestry, zrzuty debugowania i podobne hosty**, chroniąc sekrety przed logowaniem i wysyłką do złośliwych hostów rejestru. ([#932](https://github.com/CodesWhat/drydock/pull/932))
- **Przepisywanie Compose sprawdza repozytorium uruchomieniowe przed zapisem**; bezpiecznie obsługiwane są też przycinanie agentów i nieudane wycofania. ([#933](https://github.com/CodesWhat/drydock/pull/933))
- **Żądania uwierzytelnione nagłówkiem nie zapisują już sesji**, więc odpytywanie Basic Auth nie powiększa magazynu sesji. ([#935](https://github.com/CodesWhat/drydock/pull/935))
- **Porównanie konkurencji i mapa drogowa zostały odświeżone na 2026 rok**, aby dokumentacja wydania pozostała aktualna. ([#936](https://github.com/CodesWhat/drydock/pull/936))

Pełne informacje o wydaniu: [CHANGELOG.md](./CHANGELOG.md#170-rc7--2026-08-29).

</details>

<details open>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.6</strong></summary>

- **Zamknięto dwie kolejne luki we własności kontenerów agentów, oprócz wcześniejszej poprawki #904** — zupełnie nowy identyfikator kontenera w ogóle nie miał sprawdzania własności, co pozwalało agentowi przejąć nazwę watchera należącą do samego kontrolera; a ścieżki masowego pozyskiwania danych (handshake, mechanizm zastępczy migawki watchera, `watch`/`watchContainer` na żądanie oraz brzegowy `handleContainerSync`) docierały do `processAuthoritativeContainer` bez żadnej pośredniej kontroli, więc agent nadal mógł przejąć kontener innego agenta lub samego kontrolera przy kolejnej rutynowej migawce. Obie ścieżki egzekwują teraz te same kontrole własności, które wprowadziła pierwotna poprawka.
- **Uwierzytelnianie pobierania z registry, wycieki w odpowiedziach błędów oraz maskowanie błędów podglądu zostały zaostrzone** — trzynaście registry (Hub, Custom, DHI, DOCR, Harbor, Gitea, Forgejo, Codeberg, Nexus, Artifactory, Alibaba CR, OCIR, IBM CR) uwierzytelniało się przy sprawdzaniu wersji, po czym pobierało obraz anonimowo, ponieważ generator poświadczeń pobierania nie miał gałęzi dla skonfigurowanej wartości `auth`; teraz dekoduje tę wartość tak samo, jak od dawna robił to generator poświadczeń wyszukiwania, a nieprawidłowa wartość kończy się teraz zamkniętym błędem zamiast po cichu zwracać nic. Osiem handlerów API przestało wstawiać surowy komunikat wyjątku — który mógł zawierać nagłówek `Authorization` lub adres URL webhooka z poświadczeniami — do odpowiedzi 500, kierując go teraz przez istniejący skruber `sanitizePreviewErrorReason`, który teraz redaguje też poświadczenia osadzone w segmencie ścieżki adresu URL (adresy webhooków Telegrama, IFTTT i Discorda), a nie tylko w nagłówkach czy danych użytkownika.
- **Walidacja parametrów zapytania jest teraz spójna w punktach końcowych log, agent i audit** — niepoprawny liczbowo `tail` lub `since` trafiał wcześniej jako `NaN` do odczytu bufora pierścieniowego zamiast zostać odrzucony, puste `?tail=` było odczytywane jako brakujące zamiast nieprawidłowe, a `limit`/`offset` z liczbowym prefiksem takim jak `?limit=25logs` był walidowany na podstawie wiodących cyfr zamiast zawieść; cała trójka odrzuca teraz wszystko, co nie jest czystą, całkowitą liczbą.
- **Naprawiono sześć błędów interfejsu** — zaznaczanie wiersza w siedmiu widokach w ogóle nigdy nie podświetlało niczego, ponieważ współdzielona tabela danych deklaruje `selectedKey`, a każdy widok przekazywał jej zamiast tego `active-row`; biały tekst o kontraście zaledwie 1,37:1 na przycisku testowym triggera i na dwóch awatarach jest teraz spłaszczony do tokenu osiągającego 4,5:1 we wszystkich dwunastu motywach; skrzynka nadawcza powiadomień i pełnoekranowy widok szczegółów kontenera miały każda swój własny wyścig, w którym widok renderował się, zanim jego dane się rozstrzygnęły, oba są teraz zabezpieczone; dwa watchery na dashboardzie pomijały każdą aktualizację SSE w miejscu, ponieważ obserwowały zwykłą ref zamiast źródła świadomego długości lub odcisku wiersza; a tekst statusu, który w pięciu miejscach renderował się jako surowe angielskie wartości enum, jest teraz przetłumaczony we wszystkich 16 językach.
- **2109 ciągów znaków, które nadal pokazywały angielski tekst źródłowy, jest teraz faktycznie przetłumaczonych** we wszystkich 16 nieanglojęzycznych lokalizacjach — duże części listy kontenerów, okien dialogowych aktualizacji i wycofywania, palety wyszukiwania oraz skrzynki nadawczej powiadomień po cichu wracały do angielskiego niezależnie od wybranego języka. Cotygodniowa synchronizacja Crowdin również nie przywraca już sześciu przetłumaczonych plików README do angielskiego: `README.md` nie jest już zarejestrowany jako źródło Crowdin, a przetłumaczone README są teraz pisane ręcznie w repozytorium i sprawdzane fraza po frazie przy każdym cięciu wydania. ([#919](https://github.com/CodesWhat/drydock/pull/919))
- **Poprawki niezawodności release i CI** — wieloarchitekturowy build dymny ponawia teraz próbę wokół otwartego wyścigu w BuildKit (moby/buildkit#7089), który mógł dwukrotnie dodać ścieżkę emulatora QEMU i całkowicie zabić build wieloarchitekturowy, a samo cięcie wydania zyskuje teraz pełne ponowienie builda na wypadek, gdyby pierwsza próba nie wyprodukowała żadnego digestu; cotygodniowy skan DAST, który nigdy się nie kończył, ponieważ sam ZAP zużywał 39m46s z 40-minutowego budżetu i głodził Nuclei, uruchamia teraz oba skanery jako osobne, równoległe zadania; a wyszukiwarka dokumentacji, która wcześniej zwracała około 1600 trafień rozłożonych na pięć zarchiwizowanych wersji z najstarszym changelogiem na górze, jest teraz ograniczona do czytanej wersji.

Pełne informacje o wersji znajdują się w [CHANGELOG.md](./CHANGELOG.md#170-rc6--2026-08-29).

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.5</strong></summary>

- **Przegląd wzmacniający bezpieczeństwo usuwa pięć problemów w Portwing i na powierzchni debugowania/diagnostyki** — nieprawidłowy ładunek hello Portwing jest teraz walidowany przed parsowaniem, zamiast zgłaszać wyjątek poza granicą obsługi błędów callbacku; własność kontenerów agenta jest teraz egzekwowana na granicy aktualizacji/usuwania; ukrywanie danych wykrywa teraz również wartości `*_PAT` oraz dane uwierzytelniające osadzone w adresach URL (w tym względne wobec schematu); a ścieżka diagnostyczna odrzuconego originu ma teraz ograniczoną częstotliwość. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Ciemne motywy spełniają teraz minimalny kontrast WCAG 2.2** — kolor tekstu drugorzędnego/przygaszonego, kolory tonalne, powierzchnie powiadomień toast oraz etykiety głównych przycisków są podniesione tak, by osiągnąć 4,5:1 względem powierzchni, na których faktycznie są malowane, we wszystkich sześciu ciemnych motywach. ([#850](https://github.com/CodesWhat/drydock/issues/850), [#865](https://github.com/CodesWhat/drydock/discussions/865))
- **Duże floty i wolni klienci nie przerywają już połączenia z kontrolerem** — agent, którego zbuforowany replay watchera przekraczał 256 KiB, nigdy nie mógł się ponownie połączyć; teraz strumień pozostaje otwarty, aby uwierzytelniony handshake dostarczył stan; klienci SSE, którzy zaczynają zostawać w tyle, otrzymują teraz ograniczone, świadome drenażu dostarczanie w kolejności zamiast porzuconych zapisów lub nieograniczonego zużycia pamięci; limiter dziennika systemowego nie wraca już do pustej tożsamości; a nieobsługiwany transport agenta jest teraz odrzucany już przy dopuszczaniu, zamiast zawodzić później. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Stan cyklu życia aktualizacji i watcherów pozostaje spójny mimo restartów i demontażu** — odzyskiwanie przy starcie nie oznacza już nietkniętego kontenera jako zaktualizowanego, restart nie tłumi już zdarzeń zakończenia partii dla wciąż trwających aktualizacji, aktualizacja, która nigdy się nie rozpoczęła, nie jest już zgłaszana jako nieudana, watcher zdemontowany w trakcie konfiguracji nie może już zostać wskrzeszony przez spóźnione wywołanie zwrotne, a równolegle przetwarzane fragmenty zdarzeń Dockera nie rywalizują już o wspólny bufor. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Poprawki poprawności kopii zapasowych, wycofywania i list kontenerów** — kopie zapasowe mają teraz stabilną, zakresową tożsamość zamiast kolidować przy współdzielonej nazwie kontenera; wycofanie przywraca teraz digest zapisany wraz z kopią zapasową, zamiast tego, na co aktualnie wskazuje zmienny tag; równoległe skanowania digestów nie anulują się już nawzajem; udana akcja na kontenerze nie zwraca już 500, gdy kolejne odświeżenie się nie powiedzie; a stronicowane listy kontenerów są teraz sortowane globalnie, a nie tylko w obrębie strony. ([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Przepływ synchronizacji Crowdin nie zawodzi już na niedomyślnych gałęziach dev** — push do gałęzi `dev/vX.Y`, która nie była najnowszą, kończył się konfliktem checkout, ponieważ resolver bazowy zawsze wybierał najwyższą gałąź dev niezależnie od tego, które odwołanie wyzwoliło uruchomienie; push kieruje się teraz bezpośrednio do własnej gałęzi. ([run 33047712284](https://github.com/CodesWhat/drydock/actions/runs/33047712284))

Pełne informacje o wersji znajdują się w [CHANGELOG.md](./CHANGELOG.md#170-rc5--2026-08-27).

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.4</strong></summary>

- **Strumienie logów WebSocket działają teraz za proxy z terminacją TLS** — gdy trust proxy jest włączone, a `X-Forwarded-Proto` jest nieobecne w żądaniu upgrade, sprawdzanie originu nie wraca już do stanu TLS lokalnego socketu (zwykły HTTP za terminacją TLS, przez co każde połączenie z przeglądarki kończyło się błędem 403); protokół jest teraz traktowany jako nieznany, a walidacja hosta pozostaje bez zmian. Traefik przekazuje schemat widoczny dla klienta jako `wss` zamiast `https` (traefik/traefik#6388), co sprawdzanie originu odrzucało wprost, więc sama pierwsza poprawka nadal kończyła się błędem 403 za domyślną konfiguracją Traefik; `ws`/`wss` są teraz mapowane na `http:`/`https:` na potrzeby porównania originu. ([#867](https://github.com/CodesWhat/drydock/issues/867), [#868](https://github.com/CodesWhat/drydock/pull/868), [#887](https://github.com/CodesWhat/drydock/pull/887))
- **Uruchomienie nie kończy się już awarią, gdy wolumin store odmawia `chmod`** — zaostrzenie uprawnień wprowadzone w 1.6.0 zgłaszało wyjątek przy `EPERM`, przez co montowania odrzucające `chmod` (woluminy NFS/CIFS, kontenery bez roota) wywracały cały proces przy starcie i całkowicie blokowały aktualizacje z 1.6.0; teraz przy `EPERM`/`EACCES`/`ENOTSUP` wypisywane jest tylko ostrzeżenie, a proces działa dalej; wolumin naprawdę tylko do odczytu (`EROFS`) nadal kończy się szybkim błędem przy starcie, ponieważ i tak nic nie dałoby się tam trwale zapisać. ([#874](https://github.com/CodesWhat/drydock/discussions/874), [#886](https://github.com/CodesWhat/drydock/pull/886))
- **Zrzut debugowania ukrywał nazwy zmiennych środowiskowych zamiast ich wartości** — wpisy środowiskowe to pary `{key, value}`, a mechanizm ukrywania danych porównywał dosłowną nazwę właściwości `key` z regułą wrażliwych tokenów, przez co zmienna taka jak `HF_TOKEN` była zwracana z ukrytą nazwą, ale jawną wartością sekretu; nazwy pozostają teraz widoczne, a wartości są ukrywane, gdy nazwa pasuje do reguły wrażliwości. ([#875](https://github.com/CodesWhat/drydock/issues/875), [#885](https://github.com/CodesWhat/drydock/pull/885))
- **Nagie tagi liczbowe nie wyprzedzają już wersji z kropkami** — tag licznika builda, taki jak `168`, nie jest już konwertowany na fikcyjny `168.0.0`, który wyprzedzałby prawdziwą wersję `1.43.3`; zarówno odznaka sugerowanego tagu, jak i ścieżka odzyskiwania `includeTags` korzystają teraz z jednej wspólnej reguły podziału, dzięki czemu nie mogą już się rozjechać. ([#859](https://github.com/CodesWhat/drydock/issues/859), [#871](https://github.com/CodesWhat/drydock/pull/871))
- **Obrazy bazowe usuwają sześć luk OpenSSL o wysokim priorytecie (HIGH)** — pinowania digestów `node:24-alpine` i `alpine:3.24` oraz pinowanie pakietu apk `openssl` są przesuwane do OpenSSL 3.5.8-r0. ([#881](https://github.com/CodesWhat/drydock/pull/881))
- **Strona demo wysyła teraz pełny zestaw nagłówków bezpieczeństwa** — nagłówki, których brak zgłaszał DAST na powierzchni demo, są teraz wysyłane. ([#878](https://github.com/CodesWhat/drydock/pull/878))
- **Kontenery, które wychodzą poza zakres obserwacji, są usuwane ze store i UI** — kontener wykluczony przez wyłączone `watchbydefault` lub przez usunięcie etykiety `dd.watch` zachowywał nieaktualny rekord, dopóki nadal dało się go zinspekcjonować w Dockerze; zatrzymane, ale wciąż obserwowane kontenery zachowują dotychczasowe zachowanie przycisku uruchamiania. ([#869](https://github.com/CodesWhat/drydock/issues/869), [#888](https://github.com/CodesWhat/drydock/pull/888))

Pełne informacje o wersji znajdują się w [CHANGELOG.md](./CHANGELOG.md#170-rc4--2026-08-26).

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.3</strong></summary>

- **Tunele brzegowe Portwing przenoszą teraz treści inne niż JSON** — ramka powitalna kontrolera ogłasza teraz możliwość `edge-response-body-b64` i dekoduje treści odpowiedzi Dockera negocjowane w base64 (na przykład zwykłą tekstową odpowiedź „OK" z `_ping`) od agentów, którzy to obsługują; addytywnie i w zależności od możliwości. ([#852](https://github.com/CodesWhat/drydock/pull/852))
- **Odznaki w README są teraz odczytywane na żywo** — odznaki wersji, licencji, liczby pobrań i gwiazdek są teraz renderowane z żywych punktów końcowych shields.io zamiast ze statycznych obrazów, a wykres historii gwiazdek jest teraz parą jasny/ciemny dopasowaną do motywu, regenerowaną przy wycięciu wydania zamiast przez cron. ([#851](https://github.com/CodesWhat/drydock/pull/851), [#844](https://github.com/CodesWhat/drydock/pull/844), [#847](https://github.com/CodesWhat/drydock/pull/847))
- **Bramki DAST i lintowania workflowów blokują teraz przy niepowodzeniu (fail-closed)** — skany ZAP nie ignorują już żadnych ostrzeżeń, więc ich znaleziska faktycznie zatrzymują bramkę, a krok zizmor przed pushem kończy się błędem z podpowiedzią instalacji zamiast być po cichu pomijany, gdy brakuje binarki. ([#842](https://github.com/CodesWhat/drydock/pull/842))
- **Codzienny monitor sprawdza, czy `main` ma tag wydania** — zaplanowany, tylko do odczytu workflow zapala się na czerwono, jeśli HEAD `main` nie ma tagu. ([#846](https://github.com/CodesWhat/drydock/pull/846))
- **Poprawki w pipeline wydania** — naprawiono awarię CI z cięcia rc.2: cofnięto błędne nadpisanie js-yaml, które psuło testy obciążeniowe Artillery, a dwa oczekiwania Playwright zostały wydłużone ponad własne budżety operacji aplikacji. ([#829](https://github.com/CodesWhat/drydock/pull/829), [#836](https://github.com/CodesWhat/drydock/pull/836))

Pełne informacje o wersji znajdują się w [CHANGELOG.md](./CHANGELOG.md#170-rc3--2026-08-23).

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.2</strong></summary>

- **Rozstrzyganie polityki akcji dla poszczególnych kontenerów** — API i interfejs użytkownika pokazują teraz rozstrzygnięty stan (blocked/manual/auto) oraz zwycięski wyzwalacz dla każdego kontenera, a także nową etykietę `dd.action.auto` i tryb `AUTO=onauto` umożliwiający wyłącznie ręczny dostęp bez automatycznego wywoływania.
- **Niezgodne zmiany w tym cyklu** — `DD_TRIGGER_*`/`dd.trigger.*` zostały całkowicie usunięte, `trigger-excluded`/`trigger-not-included` stają się twardymi blokadami aktualizacji, układ tematów MQTT Home Assistant domyślnie zyskuje segment `agent/<name>`, `GET /api/auth/methods` zwraca teraz 410, a `curl` zniknął z obrazu.
- **Poprawki poprawności sprawdzania aktualizacji** — błąd rejestru w trakcie sprawdzania nie zgłasza już fałszywie „Up to date”, uszkodzony kontener nie zeruje już całej synchronizacji inwentarza agenta, a zagnieżdżone indeksy obrazów OCI są teraz poprawnie rozwiązywane do właściwego manifestu. ([#814](https://github.com/CodesWhat/drydock/issues/814))
- **Poprawki zależności i samoaktualizacji** — odrzucony element zależności zachowuje teraz swój kontekst ponownego uruchomienia, odświeżenia Compose nie przenoszą już nieaktualnych wartości środowiskowych odziedziczonych z obrazu, a nadpisania polityki aktualizacji przetrwają teraz własną samoaktualizację drydock. ([#718](https://github.com/CodesWhat/drydock/pull/718), [#736](https://github.com/CodesWhat/drydock/pull/736), [#743](https://github.com/CodesWhat/drydock/pull/743))
- **Bezpieczeństwo** — zamknięto ścieżkę wstrzykiwania zdalnych właściwości w synchronizacji zapytań URL listy kontenerów oraz zawężono bramkę obrazu Grype wokół CVE dla Alpine oczekującego na poprawkę u dostawcy. ([#750](https://github.com/CodesWhat/drydock/pull/750))

Pełne informacje o wersji znajdują się w [CHANGELOG.md](./CHANGELOG.md#170-rc2--2026-08-20).

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.7.0-rc.1</strong></summary>

- **Aktualizacje uwzględniające zależności** — etykiety lub metadane Compose tworzą zweryfikowany graf zależności, pokazują dokładne fale aktualizacji i uruchamiają aktualizacje albo ponowne uruchomienia elementów zależnych w deterministycznej kolejności, bezpiecznie obsługując cykle, błędy i nieaktualne podglądy. ([Dyskusja #219](https://github.com/CodesWhat/drydock/discussions/219))
- **Wygoda operatora** — instalowalna aplikacja PWA, klikalne nazwane porty, bieżący czas działania kontenerów, skróty klawiaturowe i opóźnione wykrywanie nowych kontenerów.
- **Niezgodna migracja wyzwalaczy** — `DD_TRIGGER_*` uniemożliwia teraz uruchomienie, a starsze etykiety `dd.trigger.include` / `dd.trigger.exclude` nie kierują już zadań. Należy użyć `DD_ACTION_*`, `DD_NOTIFICATION_*` i odpowiadających im etykiet zakresowych.
- **Wzmocnienie bezpieczeństwa i cyklu życia** — uwierzytelnianie, żądania agentów, dzienniki, WebSockety i żądania do rejestrów mają jawne limity; poufne wartości poleceń i hooków są maskowane; wykrywanie Home Assistant ponownie synchronizuje się po starcie i wycofuje zadania dostawców bez publikowania nieaktualnych danych. ([#708](https://github.com/CodesWhat/drydock/issues/708))

Pełne informacje o wersji znajdują się w [CHANGELOG.md](./CHANGELOG.md#170-rc1--2026-08-14).

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.6.0</strong></summary>

- **Transport Edge/agent Portwing osiąga dojrzałość**: natywne kontrole i aktualizacje Dockera sterowane przez kontroler dla Portwing 0.9.0+, ciągłe logi Edge, podpisy Ed25519 v2 i nazwy agentów powiązane z kluczem. ([#632](https://github.com/CodesWhat/drydock/issues/632), [#637](https://github.com/CodesWhat/drydock/issues/637))
- **Deklaratywna polityka aktualizacji z bramką dojrzałości**: trójpoziomowy priorytet `dd.updatePolicy.*`, licznik odblokowania i powiadomienie `maturity-cleared`. ([Dyskusja #307](https://github.com/CodesWhat/drydock/discussions/307), [Dyskusja #406](https://github.com/CodesWhat/drydock/discussions/406))
- **Szablony dla reguł, preferencje dzwonka i zdarzenie `container-unhealthy`** oraz dwukierunkowy MQTT Home Assistant, w którym przycisk Instaluj uruchamia rzeczywistą aktualizację. ([Dyskusja #205](https://github.com/CodesWhat/drydock/discussions/205), [Dyskusja #198](https://github.com/CodesWhat/drydock/discussions/198))
- **Wszystkie główne widoki list są responsywne** dzięki wspólnej `DataTable` i trwałemu przełącznikowi tabela/karty. ([#498](https://github.com/CodesWhat/drydock/issues/498))
- **Pełna zgodność `/api/v1`**: usunięto `/api/*` i `WS /api/log/stream` (`410 Gone`), a opcjonalny `DD_COMPAT_WUDCARD` obsługuje wud-card/Homepage. ([Dyskusja #469](https://github.com/CodesWhat/drydock/discussions/469))
- **Wzmocnienia bezpieczeństwa**: anonimowy dostęp po aktualizacji działa w trybie zamkniętym, wyzwalacze HTTP są chronione przed SSRF, WebSocket sprawdza pełne źródło, a cookie nosi nazwę `drydock.sid`.

Pełne informacje w [CHANGELOG.md](./CHANGELOG.md#160--2026-08-11).

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.6.0-rc.13</strong></summary>

- **Porównanie digestów korzysta z pasujących repozytoriów**: `getOrderedRepoDigests` filtruje `RepoDigests` i samoczynnie naprawia stare kotwice. ([#670](https://github.com/CodesWhat/drydock/pull/670))
- **`nanoid` przypięto do 3.3.18** we wszystkich przestrzeniach roboczych dla CVE-2026-67213 i CVE-2026-67214. ([#673](https://github.com/CodesWhat/drydock/pull/673))
- **Star History jest hostowane lokalnie** pod `/api/star-history`, z pamięcią podręczną i zapasowym SVG. ([#672](https://github.com/CodesWhat/drydock/pull/672))
- **Odświeżono obrazy bazowe**: `node:24-alpine` używa Node 24.19.0, a etap `aquasec/trivy` wersji 0.73.0. ([#682](https://github.com/CodesWhat/drydock/pull/682))
- **Rozwiązywanie aliasów ikon** jest sprawdzane dla całego pakietu. ([#683](https://github.com/CodesWhat/drydock/pull/683))

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.6.0-rc.12</strong></summary>

- **Odświeżono zależności bezpieczeństwa**: `brace-expansion` 5.0.9, `ip-address` 10.3.1 i `fast-uri` 4.1.2. ([#659](https://github.com/CodesWhat/drydock/pull/659))
- **Zegar dojrzałości** wspólnie używa `updatePolicy.maturityMinAgeDays` w widoku i bramce, a błędy daty przechodzą z `debug` do `warn`. ([#604](https://github.com/CodesWhat/drydock/issues/604))
- **Okres łaski rejestracji agenta** łagodzi na ekranach przejściowe blokady `agent-mismatch` i `no-update-trigger-configured`, ale przyjęcie pozostaje zamknięte. ([#605](https://github.com/CodesWhat/drydock/issues/605))
- **Logi WebSocket i dostęp anonimowy** współpracują, gdy ten tryb jest zarejestrowany. ([#636](https://github.com/CodesWhat/drydock/issues/636))
- **Jawne odpowiedzi 501** opisują brak transportu Docker kontrolera. ([#637](https://github.com/CodesWhat/drydock/issues/637))

</details>

<details>
<summary><strong>Najważniejsze informacje w wersji v1.6.0-rc.11</strong></summary>

- **Transport Portwing**: znaczniki `transport=docker-api`, `execution=controller`, `events=portwing` włączają uwierzytelniony Standard HTTP lub Edge dla sterowanych przez kontroler kontroli, aktualizacji, działań cyklu życia, podglądów i przywracania. Portwing pozostaje źródłem zdarzeń cyklu życia, a surowy spis nie może usunąć wyników aktualizacji wzbogaconych przez kontroler. ([#632](https://github.com/CodesWhat/drydock/issues/632), [#637](https://github.com/CodesWhat/drydock/issues/637), [Portwing #76](https://github.com/CodesWhat/portwing/issues/76))
- **Powiadomienia** — szablony tytułów i treści dla poszczególnych reguł/dostawców z podglądem na żywo oraz wspierane audytem kategorie dzwonków w aplikacji i progi ważności aktualizacji.
- **Panel** — Wymiana siatki CSS o zerowej zależności z możliwością zmiany kolejności myszy/dotyku, ograniczonej zmiany rozmiaru, responsywnych układów, widoczności widżetów, resetowania i opcjonalnej synchronizacji preferencji na różnych urządzeniach.
- **Zasady aktualizacji** — Deklarowane pierwszeństwo obserwatora/etykiety/UI, zastąpienie/przywrócenie ścieżki audytu, odliczanie terminu zapadalności/ręczne zastąpienie oraz widoczność informacji przypiętych tagów z skumulowanym bieżącym → nowszym widokiem tagów.
- **Zasoby kontenera** — Kolumna Zasoby pozostaje domyślnie widoczna, ale można ją trwale ukryć; odsyłacze do źródła, informacji o wydaniu i rejestru pozostają w menu Więcej i stopkach kart.
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

<h2 align="center" id="screenshots">Zrzuty ekranu i demonstracja na żywo</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>Znajdź aktualizację, zobacz dokładnie, jakie zmiany i zastosuj ją. Obsługiwane kopie zapasowe, sprawdzanie stanu i przywracanie zmian.</em></p>

<table>
<tbody><tr>
<td width="50%" align="center"><strong>Światło</strong></td>
<td width="50%" align="center"><strong>Ciemny</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</tbody></table>

<div align="center">

**Po co oglądać zrzuty ekranu, skoro możesz tego doświadczyć na własnej skórze?**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

W pełni interaktywny — prawdziwy interfejs użytkownika, próbne dane, nie wymaga instalacji. Działa całkowicie w przeglądarce.

</div>

<hr>

<h2 align="center" id="why-drydock">Dlaczego Drydock</h2>

Obrazy kontenerów po cichu stają się nieaktualne. Obraz bazowy łata CVE, aplikacja wycofuje wersję, tag się przenosi. Jeśli nie będziesz oglądać każdego rejestru ręcznie, działające kontenery pozostaną w tyle, dopóki coś się nie zepsuje lub nie zostanie wykorzystane.

Większość narzędzi wymusza kompromis. Automatyczne aktualizacje (Watchtower, Ouroboros) pobierają się i uruchamiają ponownie przy niewielkiej widoczności lub kontroli i obecnie w dużej mierze nie są konserwowane. Pulpity nawigacyjne (Portainer) zarządzają kontenerami, ale nie są zbudowane pod kątem analizy aktualizacji. Drydock to **najpierw monitor**: obserwuje 23 rejestry i dokładnie informuje Cię, co się zmieniło (główne, poboczne, poprawki lub podsumowanie), zanim cokolwiek się wydarzy, a następnie działa tylko wtedy, gdy na to pozwolisz. I sięga dalej niż którykolwiek z nich. Skanowanie pod kątem luk w zabezpieczeniach Trivy/Grype blokuje niebezpieczne aktualizacje, cosign weryfikuje podpisy, kopie zapasowe obrazów przed aktualizacją przywracają się automatycznie w przypadku niepowodzenia kontroli stanu, rozproszoni agenci obsługują zdalne hosty, a 20 integracji powiadomień i działań zamyka pętlę. Pełny cykl życia aktualizacji z interfejsem internetowym i interfejsem API REST.

<hr>

<h2 align="center" id="features">Funkcje</h2>

| | Funkcja | Opis |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔭  | **Wykrywanie najpierw na monitorze**                  | Obserwuje każdy działający kontener i zanim cokolwiek się wydarzy, klasyfikuje każdą dostępną aktualizację jako główną, pomocniczą, poprawkę lub podsumowanie. Nic się nie zmieni, dopóki tak nie powiesz.                                                                                                                                                                                                                                                                                                                                     |
| 📦  | **23 Dostawcy rejestru**                              | Docker Hub, GHCR, ECR, ACR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus i 12 innych. Publiczne i prywatne, w chmurze i na własnym serwerze, z TLS i uwierzytelnianiem dla poszczególnych rejestrów.                                                                                                                                                                                                                                                                                                                                     |
| 🔔  | **20 wyzwalaczy**                                     | 17 kanałów powiadomień (Slack, Discord, Telegram, Teams, SMTP, MQTT, ntfy i więcej) oraz Docker, Docker Compose i akcje poleceń, z szablonami dla poszczególnych zdarzeń/dostawców, podglądem na żywo, filtrowaniem progów i trybem wsadowym.                                                                                                                                                                                                                                                                                               |
| 🥊  | **Update Bouncer**                                    | Skanowanie pod kątem luk w zabezpieczeniach Trivy/Grype blokuje niebezpieczne aktualizacje przed ich wdrożeniem, z weryfikacją podpisu Cosign i generowaniem SBOM (CycloneDX i SPDX).                                                                                                                                                                                                                                                                                                                                                       |
| ↩️  | **Kopia zapasowa obrazu i automatyczne przywracanie** | Wstępnie aktualizuj migawki obrazów z konfigurowalnym przechowywaniem, automatycznym przywracaniem w przypadku niepowodzenia kontroli stanu i ręcznym przywracaniem jednym kliknięciem z poziomu interfejsu użytkownika.                                                                                                                                                                                                                                                                                                                                       |
| 🪝  | **Haki cyklu życia**                                  | Polecenia powłoki przed i po aktualizacji za pośrednictwem etykiet kontenerów, z limitami czasu dla poszczególnych haków i kontrolą przerwania w przypadku awarii.                                                                                                                                                                                                                                                                                                                                                                                             |
| 🗂️ | **Aktualizacje Docker Compose**                       | Pobieraj i odtwarzaj usługi Compose za pośrednictwem interfejsu API Docker Engine z łataniem obrazów zachowującym YAML.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 🎛️ | **Zasady dotyczące kontenera**                        | Reguły tagów Regex i routing wyzwalaczy korzystają z etykiet `dd.*`; bramki dojrzałości, pomijanie/odkładanie/przypinanie i okna konserwacji są przechowywane za pośrednictwem interfejsu użytkownika/API lub konfiguracji obserwatora.                                                                                                                                                                                                                                                                                                                        |
| 🛰️ | **Agenci rozproszeni**                                | Monitoruj zdalne hosty Dockera przez SSE. Agenci Portwing 0.9.0+ działają przez przychodzący Standard HTTP lub wychodzący transport WebSocket Edge; Drydock 1.6.0-rc.11+ wykonuje po stronie kontrolera natywne kontrole rejestru oraz pojedyncze i zbiorcze aktualizacje Dockera przez oba uwierzytelnione kanały. Edge przesyła też ciągłe logi bez portu przychodzącego; `DD_EXPERIMENTAL_PORTWING=false` pozostaje wyłącznikiem awaryjnym. |
| 🖥️ | **Panel sieciowy**                                    | Interfejs użytkownika Vue 3 z konfigurowalną siatką widżetów o zerowej zależności, responsywnymi widokami tabel/kart, aktualizacjami SSE na żywo, sterowaniem dzwonkiem powiadomień oraz szczegółami, dziennikami i statystykami dotyczącymi poszczególnych kontenerów.                                                                                                                                                                                                                                                                                        |
| 🔗  | **REST API i webhooki**                               | Punkty końcowe uwierzytelniane tokenem dla wyzwalaczy monitorowania i aktualizacji CI/CD oraz pozyskiwania podpisanego elementu webhook rejestru dla zdarzeń push.                                                                                                                                                                                                                                                                                                                                                                                             |
| 🔐  | **Uwierzytelnianie OIDC**                             | Zabezpiecz deskę rozdzielczą za pomocą OpenID Connect (Authelia, Auth0, Authentik). Domyślnie każdy błąd przepływu uwierzytelniania powoduje odmowę dostępu (fail-closed).                                                                                                                                                                                                                                                                                                                                                  |
| 📈  | **Dane Prometheus**                                   | Wbudowany punkt końcowy `/metrics` z opcjonalnym obejściem uwierzytelniania dla stosów monitorowania Prometheus i Grafana.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 🌍  | **17 ustawień regionalnych interfejsu użytkownika**   | W pełni przewodowy system tłumaczeń z pełnym językiem angielskim i 16 obsługiwanymi przez społeczność lokalizacjami zsynchronizowanymi za pośrednictwem Crowdin, przełączalny w konfiguracji.                                                                                                                                                                                                                                                                                                                                                                  |
| 🔒  | **ReDoS-Regex immunologiczny**                        | Każdy wzorzec znacznika dostarczony przez użytkownika jest kompilowany przez re2js (port oparty wyłącznie na JS RE2) w celu uzyskania liniowego dopasowania, którego nie może zatrzymać katastrofalny wzorzec cofania się.                                                                                                                                                                                                                                                                                                                  |

<hr>

<h2 align="center" id="supported-integrations">Obsługiwane integracje</h2>

### Rejestry (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Quay · LSCR · Harbor · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Niestandardowy · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### Akcje (3)

Doker · Docker Compose · Polecenie

### Powiadomienia (17)

Appprise · Discord · Czat Google · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### Uwierzytelnianie

Anonimowy (opcja poprzez `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Podstawowy (nazwa użytkownika + skrót hasła) · OIDC (Authelia, Auth0, Authentik). Domyślnie każdy błąd przepływu uwierzytelniania powoduje odmowę dostępu (fail-closed).

### Update Bouncer

Skanowanie pod kątem luk w zabezpieczeniach oparte na Trivy lub Grype blokuje niebezpieczne aktualizacje przed ich wdrożeniem. Obejmuje weryfikację podpisu Cosign i generowanie SBOM (CycloneDX i SPDX).

<hr>

<h2 align="center" id="feature-comparison">Porównanie funkcji</h2>

<details>
<summary><strong>Jak drydock wypada w porównaniu z innymi narzędziami do aktualizacji kontenerów?</strong></summary>

> ✅ = obsługiwane &nbsp; ❌ = nieobsługiwane &nbsp; ⚠️ = częściowy / ograniczony &nbsp; ? = niepotwierdzone &nbsp; † = zarchiwizowane, nie jest już obsługiwane

<h4 align="center">Menedżery aktualizacji</h4>

<table>
<thead>
<tr>
<th width="32%">Funkcja</th>
<th width="17%" align="center">drydock</th>
<th width="17%" align="center">WUD</th>
<th width="17%" align="center">Diun</th>
<th width="17%" align="center"><em>Watchtower&nbsp;†</em></th>
</tr>
</thead>
<tbody>
<tr><td>Aktywnie utrzymywane</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Interfejs webowy / pulpit</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Automatyczna aktualizacja kontenerów</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Aktualizacje Docker Compose</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td></tr>
<tr><td>Aktualizacje zgodne z SemVer</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Monitorowanie digestów</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Filtrowanie progu aktualizacji (major/minor/patch/digest)</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Kolejność aktualizacji uwzględniająca zależności</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Kolejka oczekujących zatwierdzeń</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Kopia i przywracanie obrazów</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Hooki cyklu życia (przed/po)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Skanowanie podatności</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Dziennik audytu</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>RBAC / role wielu użytkowników</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Uwierzytelnianie OIDC / SSO</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Kanały wyzwalaczy / powiadomień</td><td align="center">20</td><td align="center">17</td><td align="center">17</td><td align="center">~20</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Dostawcy rejestrów</td><td align="center">23</td><td align="center">12</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>REST API</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Webhook API dla CI/CD</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Metryki Prometheus</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Agenci rozproszeni (zdalni)</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">⚠️</td></tr>
<tr><td>Grupowanie kontenerów / stosy</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Start/stop/restart/aktualizacja kontenerów</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Podgląd logów kontenera</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
</tbody>
</table>

> Watchtower zarchiwizowano w grudniu 2025 roku, a jego ostatnie wydanie to v1.7.1 (listopad 2023). Nieoficjalny fork społecznościowy, nicholas-fedor/watchtower, nadal jest aktywnie wydawany.

<h4 align="center">Platformy zarządzania</h4>

<table>
<thead>
<tr>
<th width="32%">Funkcja</th>
<th width="17%" align="center">drydock</th>
<th width="17%" align="center">Arcane</th>
<th width="17%" align="center">Komodo</th>
<th width="17%" align="center">Dockhand</th>
</tr>
</thead>
<tbody>
<tr><td>Aktywnie utrzymywane</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Interfejs webowy / pulpit</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Automatyczna aktualizacja kontenerów</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Aktualizacje Docker Compose</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Aktualizacje zgodne z SemVer</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Monitorowanie digestów</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Filtrowanie progu aktualizacji (major/minor/patch/digest)</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Kolejność aktualizacji uwzględniająca zależności</td><td align="center">⚠️</td><td align="center">✅</td><td align="center">✅</td><td align="center">?</td></tr>
<tr><td>Kolejka oczekujących zatwierdzeń</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Kopia i przywracanie obrazów</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Skanowanie podatności</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Dziennik audytu</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td></tr>
<tr><td>RBAC / role wielu użytkowników</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td></tr>
<tr><td>Uwierzytelnianie OIDC / SSO</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Kanały wyzwalaczy / powiadomień</td><td align="center">20</td><td align="center">11+</td><td align="center">5</td><td align="center">15+</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Dostawcy rejestrów</td><td align="center">23</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>Metryki Prometheus</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Agenci rozproszeni (zdalni)</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Grupowanie kontenerów / stosy</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">?</td></tr>
</tbody>
</table>

> Opracowano na podstawie publicznej dokumentacji i repozytoriów poszczególnych projektów, stan na 29.08.2026 r.
> Komentarze są mile widziane, jeśli jakiekolwiek informacje są niedokładne.

</details>

<hr>

<h2 align="center" id="migration">Migracja</h2>

<details>
<summary><strong>Migracja z WUD (Co słychać w oknie dokowanym?)</strong></summary>

Drydock v1.6 nie ładuje już zmiennych środowiskowych `WUD_*` ani etykiet `wud.*` w czasie wykonywania. Przepisz je przed uruchomieniem uaktualnionej usługi; stan utrwalony nadal migruje automatycznie. Użyj `docker exec -it drydock node dist/index.js config migrate --dry-run`, aby wyświetlić podgląd, a następnie `docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml`, aby przepisać konfigurację na nazewnictwo `DD_*` i `dd.*`.

</details>

<hr>

<h2 align="center" id="roadmap">Roadmap</h2>

<details>
<summary><strong>Motywy i najważniejsze wersje wersji</strong></summary>

Ten kierunek obejmuje co najmniej następne dwanaście miesięcy, do sierpnia 2027 r.
Tylko motywy ogólne; szczegóły poszczególnych wersji zawiera [CHANGELOG.md](CHANGELOG.md).

| Wersja                                       | Motyw                                             | Najważniejsze informacje                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1.3.x** ✅ | Bezpieczeństwo i stabilność                       | Skanowanie Trivy, Update Bouncer, SBOM, 7 nowych rejestrów, 4 nowe wyzwalacze, silnik re2js regex                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **v1.4.x** ✅ | Modernizacja i wzmocnienie interfejsu użytkownika | Tailwind 4 + niestandardowe komponenty, 6 motywów, paleta Cmd/K, OpenAPI 3.1, aktualizacje YAML natywne dla Compose, skanowanie z dwoma gniazdami, utwardzanie OIDC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **v1.5.0** ✅ | Obserwowalność i i18n                             | Podział taksonomii wyzwalaczy (`DD_ACTION_*`/`DD_NOTIFICATION_*`), przeglądarka dzienników WebSocket, dostosowywanie pulpitu, monitorowanie zasobów, skrzynka nadawcza powiadomień + DLQ, podsumowanie skanowania bezpieczeństwa, 17 ustawień regionalnych, odtwarzanie Last-Event-ID w SSE, wychodzące połączenie agenta Edge z uwierzytelnianiem Ed25519 (eksperymentalne, `DD_EXPERIMENTAL_PORTWING=true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **v1.5.1** ✅ | Bezpieczeństwo i konserwacja                      | Poprawka autoryzacji pull-auth GCR/GAR, zakończenie TLS rejestru (M-2), utwardzanie wtrysku hook env-var, obsługa `DD_SESSION_SECRET__FILE`, redakcja poświadczeń debug-dump, sprawdzanie uprawnień do plików tajnych, naprawa zakleszczenia bramy dojrzałości, pełna translacja interfejsu użytkownika + tłumaczenia społeczności, bramka automatycznego stosowania okna konserwacji, wyświetlanie czasu pracy kontenera, wersja oprogramowania z podziałem kolumny tagu/wersji (etykieta OCI, z `dd.inspect.tag.path` podwójny zapis + opcjonalne routowanie przez `dd.inspect.tag.version-only`), opcjonalne dopasowywanie prefiksu montowania w Compose, zmienna szablonu `${currentReleaseNotes}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **v1.5.2** ✅ | Niezawodność zasad i przypiętych tagów            | Zachowywanie zasad dojrzałości/pomijania/odraczania podczas ponownego tworzenia kontenera, wykrywanie przebudowy digestu przypiętych tagów i informacyjne spostrzeżenia dotyczące tej samej rodziny, czyszczenie kandydatów do wycofania, zapobieganie kaskadzie wycofywania, jawne zachowywanie adresów MAC i zachowanie pomijania rejestru obrazów lokalnych                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **v1.6.0**   | Powiadomienia, zasady i informacje o wydaniach    | Szablony powiadomień dla poszczególnych reguł/wyzwalaczy z podglądem na żywo, preferencjami dzwonka powiadomień, synchronizacją preferencji między urządzeniami, niestandardową siatką pulpitu nawigacyjnego o zerowej zależności ([#281](https://github.com/CodesWhat/drydock/issues/281)), deklaratywną polityką aktualizacji ([#320](https://github.com/CodesWhat/drydock/issues/320)), odliczaniem stabilizacji dojrzałości + natychmiastową widocznością kandydata + ręcznym zastąpieniem ([#406](https://github.com/CodesWhat/drydock/discussions/406)), praktycznym panelem stanu aktualizacji i globalnym trybem aktualizacji `notify` / `manual` / `auto` ([#325](https://github.com/CodesWhat/drydock/discussions/325)), dziedziczenie zasad tagów obserwatora/imgset/kontenera plus warstwowa widoczność bieżącego → nowszego przypiętego tagu ([#498](https://github.com/CodesWhat/drydock/issues/498)), ujednolicone do 44 px akcje zasobów: Źródło / informacje o wydaniu / rejestr w tabelach, kartach i widokach szczegółów ([#295](https://github.com/CodesWhat/drydock/discussions/295)), powiadomienia o zdarzeniach dotyczących stanu zdrowia ([#198](https://github.com/CodesWhat/drydock/discussions/198)), dwukierunkowy Home Assistant MQTT, responsywne widoki tabel/list kart, Trivy/Grype/oba skanowanie za pośrednictwem poleceń lub przypiętych backendów Docker-worker, kontrola ściągania/ogrzewania zasobów skanera, praca poza stertą deduplikowana pamięć SBOM, poprawność długiego skanowania Trivy ([#490](https://github.com/CodesWhat/drydock/issues/490)), ostrzeżenia o migracji wyzwalacza-taksonomii, usunięcie zgodności z wersją 1.6, higiena dokumentów/API oraz zakończenie migracji `/api` → `/api/v1` z opcjonalną podkładką zgodności wud-card/strony głównej (`DD_COMPAT_WUDCARD`). |
| **v1.7.0** | Inteligentne aktualizacje i UX | Zamawianie aktualizacji uwzględniające zależności ([#219](https://github.com/CodesWhat/drydock/discussions/219)), zasady aktualizacji według akcji ([#511](https://github.com/CodesWhat/drydock/discussions/511)), ujednolicony zegar dojrzałości/wieku aktualizacji, klikalne łącza do portów, skróty klawiaturowe, PWA, poprawa kontrastu ciemnego motywu (WCAG 2.2) ([#850](https://github.com/CodesWhat/drydock/issues/850), [#865](https://github.com/CodesWhat/drydock/discussions/865)), usuwanie `DD_TRIGGER_*` (koniec okresu wycofywania dla wersji 1.5.0), curl usunięty z obrazu |
| **v1.8.0** | Zarządzanie flotą i konfiguracja na żywo | Migracja sklepu SQLite, kolejka zatwierdzeń dla poszczególnych aktualizacji, konfiguracja YAML, konfiguracja interfejsu użytkownika na żywo, aktualizacje równoległe, selektywne aktualizacje zbiorcze ([#232](https://github.com/CodesWhat/drydock/discussions/232)), interfejs porządkowania zależności, menedżer obrazów i czyszczenie, obserwator statycznych list obrazów, okno konserwacji domyślnie ograniczone do instalacji ([#946](https://github.com/CodesWhat/drydock/discussions/946)), rotacyjne klucze API o określonym zakresie (statyczne tokeny nośnika do integracji HA/pulpitu nawigacyjnego, [#469](https://github.com/CodesWhat/drydock/discussions/469)), logowanie dwuskładnikowe TOTP, postęp aktualizacji Home Assistant + urządzenia przypisane do poszczególnych kontenerów ([#210](https://github.com/CodesWhat/drydock/discussions/210)) |
| **v2.0+** | Rozszerzanie platformy i nie tylko | Obserwatorzy roju/Kubernetes, synchronizacja GitOps, przeglądarka woluminów, lokalnie zbudowane obrazy monitorowane względem zadeklarowanej bazy upstream ([#897](https://github.com/CodesWhat/drydock/discussions/897)), bramki kondycji, wdrożenia Canary, terminal sieciowy, RBAC, LDAP/AD, podstawowe wsparcie dla Podman za pośrednictwem jego interfejsu API zgodnego z Dockerem, CLI, wzmocniony obraz Wolfi, proxy gniazda |

</details>

<hr>

<h2 align="center" id="star-history">Historia gwiazd</h2>

<div align="center">
  <a href="https://github.com/CodesWhat/drydock/stargazers">
    <img alt="Star History Chart" src="docs/assets/star-history.svg" />
  </a>
</div>

---

<div align="center">

<h2 align="center" id="built-with">Zbudowany z</h2>

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

<h2 align="center" id="community-support">Społeczność i wsparcie</h2>

Czat na żywo i wczesne wsparcie: **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

Błędy i konkretne prośby o nowe funkcje trafiają do **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)**; otwarte pytania, pomysły i prezentacje trafiają do **[GitHub Discussions](https://github.com/CodesWhat/drydock/discussions)**; czat na żywo odbywa się na **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**.

### Kontrola jakości społeczności

Dziękujemy użytkownikom, którzy pomogli w testowaniu wersji 1.4.0 i 1.5.0 oraz zgłosili błędy:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

<h2 align="center" id="codeswhat-ecosystem">Część ekosystemu CodesWhat</h2>

<table>
  <tbody><tr><th>Narzędzie</th><th>Rola</th></tr>
  <tr><td><b>drydock</b></td><td>Monitorowanie aktualizacji kontenera — interfejs WWW i silnik powiadomień</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>Zdalny agent Docker — bezpieczny dostęp na poziomie gniazda z poziomu Drydock lub samodzielnego</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Serwer proxy gniazda Docker — domyślny filtr listy dozwolonych chroniący gniazdo</td></tr>
</tbody></table>

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

<a href="#drydock">Powrót do góry</a>

</div>
