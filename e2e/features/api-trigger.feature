Feature: Drydock Trigger API Exposure

  # The E2E instance registers two triggers via scripts/start-drydock.sh:
  # docker.local (AUTO=false, keeps lifecycle endpoints wired for the
  # dashboard Playwright test without racing it) and mock.example. The
  # specific-trigger scenario below is the authoritative contract check
  # for the mock configuration; this scenario only verifies the list
  # endpoint returns both triggers with the right shape.

  Scenario: Drydock must allow to get all Triggers state
    When I GET /api/triggers
    Then response code should be 200
    And response body should be valid json
    And response body path $.data should be of type array with minimum length 2

  Scenario: Drydock must allow to get specific Triggers state
    When I GET /api/triggers/mock/example
    Then response code should be 200
    And response body should be valid json
    And response body path $.id should be mock.example
    And response body path $.type should be mock
    And response body path $.name should be example
    And response body path $.configuration.threshold should be all
    And response body path $.configuration.mode should be simple
    And response body path $.configuration.once should be true
    And response body path $.configuration.simpletitle should be ${isDigestUpdate ? container.notificationAgentPrefix + "New image available for container " + container.name + container.notificationWatcherSuffix + " (tag " + currentTag + ")" : container.notificationAgentPrefix + "New " + container.updateKind.kind + " found for container " + container.name + container.notificationWatcherSuffix}
    And response body path $.configuration.batchtitle should be ${containers.length} updates available
    And response body path $.configuration.mock should be mock
