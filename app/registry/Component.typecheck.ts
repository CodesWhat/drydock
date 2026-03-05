import type { ComponentConfiguration } from './Component.js';
import Component from './Component.js';

const component = new Component();

// @ts-expect-error Component instances should not allow arbitrary properties.
component.undocumentedProperty = true;

const configuration: ComponentConfiguration = { secret: 'token' };

// @ts-expect-error ComponentConfiguration values should require narrowing.
const secret: string = configuration.secret;
