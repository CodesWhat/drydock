Feature: Drydock WebSocket Log Stream API

  Scenario: System log stream must deliver backfill entries as valid JSON
    When I authenticate for WebSocket
    And I open WebSocket at /api/v1/log/stream?tail=10
    Then WebSocket should have received at least 1 message
    And every WebSocket message should be valid json
    And every WebSocket message should have path $.timestamp
    And every WebSocket message should have path $.level
    And every WebSocket message should have path $.msg
    And every WebSocket message should have path $.component

  Scenario: System log stream must accept level filter without error
    When I authenticate for WebSocket
    And I open WebSocket at /api/v1/log/stream?tail=50&level=info
    Then WebSocket should have received at least 1 message
    And every WebSocket message should be valid json

  Scenario: Container log stream must close normally with follow disabled
    Given I GET /api/containers
    And I store the index of container named hub_nginx_120 as containerIndex in scenario scope
    And I store the value of body path $.data[`containerIndex`].id as containerId in scenario scope
    When I authenticate for WebSocket
    And I open WebSocket at /api/v1/containers/`containerId`/logs/stream?tail=5&follow=false
    Then WebSocket should have closed with code 1000

  Scenario: Container log stream must close with 4004 for unknown container
    When I authenticate for WebSocket
    And I open WebSocket at /api/v1/containers/nonexistent-e2e-container/logs/stream
    Then WebSocket should have closed with code 4004

  Scenario: Container log stream must deliver valid JSON messages when logs exist
    Given I GET /api/containers
    And I store the index of container named hub_nginx_120 as containerIndex in scenario scope
    And I store the value of body path $.data[`containerIndex`].id as containerId in scenario scope
    When I authenticate for WebSocket
    And I open WebSocket at /api/v1/containers/`containerId`/logs/stream?tail=10&follow=false
    Then WebSocket should have closed with code 1000
    And every WebSocket message should be valid json
    And every WebSocket message should have path $.type
    And every WebSocket message should have path $.ts
    And every WebSocket message should have path $.line
    And every WebSocket message path $.type should be one of stdout, stderr
