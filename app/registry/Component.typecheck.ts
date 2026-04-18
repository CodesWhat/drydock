import Component from './Component.js';

const component = new Component();

// @ts-expect-error Component instances should not allow arbitrary properties.
component.undocumentedProperty = true;

interface ExampleConfiguration {
  secret: string;
}

class ExampleComponent extends Component<ExampleConfiguration> {}

const exampleComponent = new ExampleComponent();
const secret: string = exampleComponent.configuration.secret;
void secret;
