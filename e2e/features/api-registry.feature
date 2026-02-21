Feature: Drydock Registry API Exposure

  Scenario: Drydock must allow to get all Registries
    When I GET /api/registries
    Then response code should be 200
    And response body should be valid json
    And response body path $ should be of type array with minimum length 8

    And I store the index of registry id acr.private as registryIndex in scenario scope
    And response body path $[`registryIndex`].type should be acr
    And response body path $[`registryIndex`].name should be private
    And response body path $[`registryIndex`].configuration.clientid should be 89dcf54b-ef99-4dc1-bebb-8e0eacafdac8
    And response body path $[`registryIndex`].configuration.clientsecret should be .*

    And I store the index of registry id ecr.private as registryIndex in scenario scope
    And response body path $[`registryIndex`].type should be ecr
    And response body path $[`registryIndex`].name should be private
    And response body path $[`registryIndex`].configuration.region should be eu-west-1
    And response body path $[`registryIndex`].configuration.accesskeyid should be .*
    And response body path $[`registryIndex`].configuration.secretaccesskey should be .*

    And I store the index of registry id gcr.private as registryIndex in scenario scope
    And response body path $[`registryIndex`].type should be gcr
    And response body path $[`registryIndex`].name should be private
    And response body path $[`registryIndex`].configuration.clientemail should be gcr@.*\.iam\.gserviceaccount\.com
    And response body path $[`registryIndex`].configuration.privatekey should be .*

    And I store the index of registry id ghcr.private as registryIndex in scenario scope
    And response body path $[`registryIndex`].type should be ghcr
    And response body path $[`registryIndex`].name should be private

    And I store the index of registry id gitlab.private as registryIndex in scenario scope
    And response body path $[`registryIndex`].type should be gitlab
    And response body path $[`registryIndex`].name should be private

    And I store the index of registry id hub.public as registryIndex in scenario scope
    And response body path $[`registryIndex`].type should be hub
    And response body path $[`registryIndex`].name should be public

    And I store the index of registry id lscr.private as registryIndex in scenario scope
    And response body path $[`registryIndex`].type should be lscr
    And response body path $[`registryIndex`].name should be private

    And I store the index of registry id quay.public as registryIndex in scenario scope
    And response body path $[`registryIndex`].type should be quay
    And response body path $[`registryIndex`].name should be public

  Scenario: Drydock must allow to get specific Registry state
    When I GET /api/registries/acr/private
    Then response code should be 200
    And response body should be valid json
    And response body path $.id should be acr.private
    And response body path $.type should be acr
    And response body path $.name should be private
    And response body path $.configuration.clientid should be 89dcf54b-ef99-4dc1-bebb-8e0eacafdac8
    And response body path $.configuration.clientsecret should be .*
