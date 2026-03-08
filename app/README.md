# Drydock Backend

TypeScript (ESM, `NodeNext`) backend for Drydock — Docker container update manager.

## Setup

```bash
npm install
```

## Development

```bash
npm run build     # TypeScript compilation (tsc)
npm test          # Vitest with coverage (100% thresholds enforced)
npx vitest run path/to/file.test.ts   # Run a single test file
```

## Quality Checks

```bash
npm run lint       # biome check .
npm run lint:fix   # biome check --fix .
npm run format     # biome format --write .
```
