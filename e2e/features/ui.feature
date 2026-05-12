Feature: Drydock UI Exposure

  Scenario: Drydock must serve the ui
    When I GET /
    Then response code should be 200
    And response header Content-Type should contain text/html

  Scenario: Drydock must redirect to the ui if resource not found
    When I GET /nowhere
    Then response code should be 200
    And response header Content-Type should contain text/html

  Scenario: Login view renders in a browser
    When I open UI route /login
    Then the UI route should render Sign in to Drydock

  Scenario Outline: Authenticated UI view renders in a browser
    Given I am signed into the UI
    When I open UI route <path>
    Then the UI route should render <text>

    Examples:
      | view                 | path                               | text              |
      | Dashboard            | /                                  | Updates Available |
      | Containers           | /containers                        | Table view        |
      | Container logs       | /containers/missing-container/logs | Container Logs    |
      | Security             | /security                          | Scan Now          |
      | Hosts                | /servers                           | Host              |
      | Config               | /config                            | Application       |
      | Registries           | /registries                        | Registry          |
      | Agents               | /agents                            | Agent             |
      | Triggers             | /triggers                          | Trigger           |
      | Watchers             | /watchers                          | Watcher           |
      | Auth                 | /auth                              | Provider          |
      | Notifications        | /notifications                     | Rule              |
      | Notification outbox  | /notifications/outbox              | Dead-letter       |
      | Audit                | /audit                             | All events        |
      | Logs                 | /logs                              | Live              |
