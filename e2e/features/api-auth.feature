Feature: Drydock auth API Exposure

  Scenario: Drydock must return a 410 tombstone for the removed /auth/strategies alias
    When I GET /auth/strategies
    Then response code should be 410
    And response body should be valid json
    And response body path $.error should be GET /auth/strategies was removed in v1.8.0. Use GET /api/v1/auth/status instead.
    And response body path $.details.migration should be /api/v1/auth/status
    And response body path $.details.docs should be https://getdrydock.com/docs/deprecations#legacy-auth-strategies-shape

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
