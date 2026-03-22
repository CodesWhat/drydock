# Drydock E2E Tests

Cucumber-based end-to-end tests and Artillery load tests for Drydock.

## Setup

```bash
npm install
```

## Running E2E Tests

```bash
npm run test:local     # Full E2E suite against a running Drydock instance
npm run test:setup     # Set up test containers only
npm run test:cleanup   # Clean up test containers
```

## Load Tests

```bash
npm run load:ci          # CI load test (default)
npm run load:behavior    # Behavioral test suite
npm run load:stress      # Stress test
npm run load:rate-limit  # Rate limit verification
```
