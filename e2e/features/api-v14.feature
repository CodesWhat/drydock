Feature: Drydock v1.4 API exposure

  Scenario: Drydock must proxy bundled selfhst icons
    When I GET /api/icons/selfhst/docker
    Then response code should be 200
    And response header content-type should contain image/png
    And response header cache-control should contain immutable

  # The E2E instance registers docker.local (AUTO=false) via
  # scripts/start-drydock.sh, so lifecycle endpoints resolve a docker
  # trigger and actually act on the container instead of returning the
  # legacy "No docker trigger found" 404. The scenario now exercises the
  # full stop → start → restart round-trip and expects success responses.
  Scenario: Drydock must allow container lifecycle actions
    Given I GET /api/containers
    And I store the index of container named hub_nginx_120 as containerIndex in scenario scope
    And I store the value of body path $.data[`containerIndex`].id as containerId in scenario scope
    When I POST to /api/containers/`containerId`/stop
    Then response code should be 200
    And response body should be valid json
    And response body path $.message should be Container stopped successfully
    When I POST to /api/containers/`containerId`/start
    Then response code should be 200
    And response body should be valid json
    And response body path $.message should be Container started successfully
    When I POST to /api/containers/`containerId`/restart
    Then response code should be 200
    And response body should be valid json
    And response body path $.message should be Container restarted successfully

  Scenario: Drydock must persist settings through API
    When I GET /api/settings
    Then response code should be 200
    And response body should be valid json
    And response body path $.internetlessMode should be false
    When I PATCH /api/settings with json body:
      """
      {"internetlessMode": true}
      """
    Then response code should be 200
    And response body should be valid json
    And response body path $.internetlessMode should be true
    When I PATCH /api/settings with json body:
      """
      {"internetlessMode": false}
      """
    Then response code should be 200
    And response body should be valid json
    And response body path $.internetlessMode should be false

  Scenario: Drydock must allow notification rule updates
    When I GET /api/notifications
    Then response code should be 200
    And response body should be valid json
    And response body path $.data should be of type array with minimum length 5
    When I PATCH /api/notifications/update-available with json body:
      """
      {"enabled": false, "triggers": ["mock.example"]}
      """
    Then response code should be 200
    And response body should be valid json
    And response body path $.id should be update-available
    And response body path $.enabled should be false
    And response body path $.triggers should be of type array with length 1
    And response body path $.triggers[0] should be mock.example
    When I PATCH /api/notifications/update-available with json body:
      """
      {"enabled": true, "triggers": []}
      """
    Then response code should be 200
    And response body should be valid json
    And response body path $.enabled should be true
    And response body path $.triggers should be of type array with length 0

  Scenario: Drydock must expose SSE self-update ack flow contract
    When I open SSE connection at /api/events/ui
    Then response code should be 200
    And response body should contain event: dd:connected
    And scenario scope value sseClientId should match sse-client-.*
    And scenario scope value sseClientToken should match sse-token-.*
    When I POST json to /api/events/ui/self-update/e2e-op-ack/ack:
      """
      {"clientId":"`sseClientId`","clientToken":"`sseClientToken`"}
      """
    Then response code should be 202
    And response body should be valid json
    And response body path $.status should be ignored
    And response body path $.operationId should be e2e-op-ack
    And response body path $.reason should be no-pending-ack
