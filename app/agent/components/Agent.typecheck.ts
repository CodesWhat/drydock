import Agent from './Agent.js';

const agent = new Agent();

const host: string = agent.configuration.host;
void host;

// @ts-expect-error Agent configuration should not allow arbitrary properties.
agent.configuration.unknownKey;
