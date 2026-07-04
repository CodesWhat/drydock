Feature: Drydock API 404 management

  Scenario: Drydock must respond 404 if no API endpoint matches
    When I GET /api/v1/nowhere
    Then response code should be 404
