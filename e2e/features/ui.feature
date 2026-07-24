Feature: Drydock UI Exposure

  Scenario: Drydock must serve the ui
    When I GET /
    Then response code should be 200
    And response header Content-Type should contain text/html

  Scenario: Drydock must redirect to the ui if resource not found
    When I GET /nowhere
    Then response code should be 200
    And response header Content-Type should contain text/html
