Feature: Drydock Config API Exposure
  Scenario: Drydock must expose the effective, merged configuration
    When I GET /api/v1/config
    Then response code should be 200
    And response body should be valid json
    And response body path $.file.present should be true
    And response body path $.file.path should be /config/drydock.yml
    And response body path $.sections.server.name should be qa-config-file-fixture
    And response body path $.sources.DD_SERVER_NAME should be file

  Scenario: Drydock must expose one section of the effective configuration
    When I GET /api/v1/config/server
    Then response code should be 200
    And response body should be valid json
    And response body path $.name should be qa-config-file-fixture

  Scenario: An unknown configuration section is a 404
    When I GET /api/v1/config/notasection
    Then response code should be 404
