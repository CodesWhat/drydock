Feature: Drydock unversioned /api alias tombstone (removed in v1.6.0)

  Scenario: Drydock must return a 410 tombstone for a non-whitelisted unversioned /api/* request
    When I GET /api/containers
    Then response code should be 410
    And response body should be valid json
    And response body path $.error should be The unversioned /api/* path was removed in v1.6.0. Use /api/v1/* instead.
    And response body path $.details.canonicalBasePath should be /api/v1
    And response body path $.details.compat should be WUD-era clients (wud-card, Homepage whatsupdocker widget) can enable DD_COMPAT_WUDCARD
    And response body path $.details.docs should be https://getdrydock.com/docs/deprecations#unversioned-api-paths

  Scenario: Drydock must return the 410 tombstone for /api itself, not just its subpaths
    When I GET /api
    Then response code should be 410
    And response body should be valid json
    And response body path $.details.canonicalBasePath should be /api/v1
