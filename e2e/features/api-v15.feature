Feature: Drydock v1.5 API exposure

  Scenario: Drydock must expose operation cancellation errors as JSON
    When I POST to /api/operations/e2e-missing-operation/cancel
    Then response code should be 404
    And response body should be valid json
    And response body path $.error should be Operation not found

  Scenario: Drydock must expose notification outbox status buckets
    When I GET /api/notifications/outbox
    Then response code should be 200
    And response body should be valid json
    And response body path $.data should be of type array with minimum length 0
    And response body path $.total should be of type number
    And response body path $.counts.pending should be of type number
    And response body path $.counts.delivered should be of type number
    And response body path $.counts.deadLetter should be of type number
    When I GET /api/notifications/outbox?status=pending
    Then response code should be 200
    And response body should be valid json
    And response body path $.data should be of type array with minimum length 0
    When I GET /api/notifications/outbox?status=invalid
    Then response code should be 400
    And response body should be valid json
    And response body path $.error should be Invalid status query parameter. Must be one of: pending, delivered, dead-letter

  Scenario: Drydock must expose fleet stats summary
    When I GET /api/stats/summary
    Then response code should be 200
    And response body should be valid json
    And response body path $.data.timestamp should be of type string
    And response body path $.data.watchedCount should be of type number
    And response body path $.data.avgCpuPercent should be of type number
    And response body path $.data.totalMemoryUsageBytes should be of type number
    And response body path $.data.totalMemoryLimitBytes should be of type number
    And response body path $.data.totalMemoryPercent should be of type number
    And response body path $.data.topCpu should be of type array with minimum length 0
    And response body path $.data.topMemory should be of type array with minimum length 0
