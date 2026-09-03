Feature: Drydock auth API Exposure

  Scenario: Drydock must fall through to the ui for the removed /auth/strategies alias
    When I GET /auth/strategies
    Then response code should be 200
    And response header Content-Type should contain text/html

  Scenario: Drydock must allow to login with basic auth
    When I POST to /auth/login
    Then response code should be 200
    And response body should be valid json
    And response body path $.username should be `username`

  Scenario: Drydock must allow to get current user
    When I GET /auth/user
    Then response code should be 200
    And response body should be valid json
    And response body path $.username should be `username`

  Scenario: Drydock must allow to logout
    When I POST to /auth/logout
    Then response code should be 200
    And response body should be valid json
