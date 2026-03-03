import Component from './Component.js';

const component = new Component();

// @ts-expect-error Component instances should not allow arbitrary properties.
component.undocumentedProperty = true;
