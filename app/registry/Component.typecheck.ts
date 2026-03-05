import type { ComponentConfiguration } from './Component.js';
import Component from './Component.js';

const component = new Component();

// @ts-expect-error Component instances should not allow arbitrary properties.
component.undocumentedProperty = true;

const configuration: ComponentConfiguration = { secret: 'token' };

const secret: string = configuration.secret;
void secret;
