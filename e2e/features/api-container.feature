Feature: Drydock Container API Exposure

  Scenario: Drydock must return enough containers for e2e checks
    When I GET /api/containers
    Then response code should be 200
    And response body should be valid json
    And response body path $ should be of type array with minimum length 10

  # Test one representative container per registry type + update pattern
  Scenario Outline: Drydock must handle different registry types and update patterns
    When I GET /api/containers
    Then response code should be 200
    And response body should be valid json
    And I store the index of container named <containerName> as containerIndex in scenario scope
    And response body path $[`containerIndex`].name should be <containerName>
    And response body path $[`containerIndex`].status should be running
    And response body path $[`containerIndex`].image.registry.name should be <registry>
    And response body path $[`containerIndex`].image.registry.url should be <registryUrl>
    And response body path $[`containerIndex`].image.name should be <imageName>
    And response body path $[`containerIndex`].image.tag.value should be <tag>
    Examples:
      | registry       | containerName            | registryUrl                                             | imageName                           | tag                | testCase                    |
      # | ecr.private    | ecr_sub_sub_test         | https://229211676173.dkr.ecr.eu-west-1.amazonaws.com/v2 | sub/sub/test                        | 1.0.0              | ECR semver major update     |
      | ghcr.private   | ghcr_radarr              | https://ghcr.io/v2                                      | linuxserver/radarr                  | 5.14.0.9383-ls245  | GHCR complex semver update  |
      | gitlab.private | gitlab_test              | https://registry.gitlab.com/v2                          | gitlab-org/gitlab-runner            | v16.0.0            | GitLab semver update        |
      | hub.public     | hub_homeassistant_202161 | https://registry-1.docker.io/v2                         | homeassistant/home-assistant        | 2021.6.1           | Hub date-based versioning   |
      | hub.public     | hub_homeassistant_latest | https://registry-1.docker.io/v2                         | homeassistant/home-assistant        | latest             | Hub latest tag no update    |
      | hub.public     | hub_nginx_120            | https://registry-1.docker.io/v2                         | library/nginx                       | 1.20-alpine        | Hub alpine minor update     |
      | hub.public     | hub_nginx_latest         | https://registry-1.docker.io/v2                         | library/nginx                       | latest             | Hub latest tag digest update|
      | hub.public     | hub_traefik_245          | https://registry-1.docker.io/v2                         | library/traefik                     | 2.4.5              | Hub semver major update     |
      | lscr.private   | lscr_radarr              | https://lscr.io/v2                                      | linuxserver/radarr                  | 5.14.0.9383-ls245  | LSCR complex semver update  |
      | quay.public    | quay_prometheus          | https://quay.io/v2                                      | prometheus/prometheus               | v2.52.0            | Quay semver major update    |

  # Test detailed container inspection (semver)
  Scenario: Drydock must provide detailed container information for semver containers
    Given I GET /api/containers
    And I store the index of container named gitlab_test as containerIndex in scenario scope
    And I store the value of body path $[`containerIndex`].id as containerId in scenario scope
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.watcher should be local
    And response body path $.name should be gitlab_test
    And response body path $.image.registry.name should be gitlab.private
    And response body path $.image.tag.semver should be true

  # Test detailed container inspection (digest)
  Scenario: Drydock must provide detailed container information for digest-based containers
    Given I GET /api/containers
    And I store the index of container named hub_nginx_latest as containerIndex in scenario scope
    And I store the value of body path $[`containerIndex`].id as containerId in scenario scope
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.watcher should be local
    And response body path $.name should be hub_nginx_latest
    And response body path $.image.tag.semver should be false
    And response body path $.image.digest.value should be a sha256 digest or undefined

  # Test link functionality
  Scenario: Drydock must generate correct links for containers with link templates
    Given I GET /api/containers
    And I store the index of container named hub_homeassistant_202161 as containerIndex in scenario scope
    And I store the value of body path $[`containerIndex`].id as containerId in scenario scope
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.link should be https://github.com/home-assistant/core/releases/tag/2021.6.1
    And response body path $.result.link should be https://github.com/home-assistant/core/releases/tag/.*

  # Test watch trigger functionality
  Scenario: Drydock must allow triggering container watch
    Given I GET /api/containers
    And I store the index of container named gitlab_test as containerIndex in scenario scope
    And I store the value of body path $[`containerIndex`].id as containerId in scenario scope
    When I POST to /api/containers/`containerId`/watch
    Then response code should be 200
    And response body should be valid json
    And response body path $.name should be gitlab_test
    And response body path $.watcher should be local
