const { After, Before, setDefaultTimeout } = require('@cucumber/cucumber');
const config = require('../../config');
const { registerStateRestorationHooks } = require('./state-restoration-hooks');
const { createApiRequest } = require('./state-restoration');

setDefaultTimeout(60 * 1000);
registerStateRestorationHooks({ After, Before }, createApiRequest(config));

Before(function initScope() {
  this.scenarioScope = {
    username: config.username,
  };
});
