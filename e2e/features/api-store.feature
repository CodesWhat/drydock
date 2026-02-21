Feature: Drydock Store API Exposure
  Scenario: Drydock must allow to get Store state
    When I GET /api/store
    Then response code should be 200
    And response body should be valid json
    And response body path $.configuration.path should be /store
    And response body path $.configuration.file should be dd.json
