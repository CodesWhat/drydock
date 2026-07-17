Feature: Drydock App infos API Exposure
  Scenario: Drydock must allow to get App infos
    When I GET /api/v1/app
    Then response code should be 200
    And response body should be valid json
    And response body path $.name should be drydock
