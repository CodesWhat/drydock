Feature: Drydock Log API Exposure
  Scenario: Drydock must allow to get Log state
    When I GET /api/v1/log
    Then response code should be 200
    And response body should be valid json
    And response body path $.level should be info
