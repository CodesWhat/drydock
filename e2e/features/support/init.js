const { Before, setDefaultTimeout } = require('@cucumber/cucumber');
const config = require('../../config');

setDefaultTimeout(20 * 1000);

Before(function initScope() {
  this.scenarioScope = {
    username: config.username,
  };
});
