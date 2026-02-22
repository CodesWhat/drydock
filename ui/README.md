# Drydock UI

## Setup

```bash
npm install
```

## Local Development

```bash
npm run dev
```

## Quality Checks

```bash
npm run lint
npm run test:unit
npm run build
```

## Storybook + Visual Regression

```bash
npm run storybook
```

Build Storybook for regression smoke testing:

```bash
npm run test:storybook
```

Generate the full static Storybook bundle:

```bash
npm run build-storybook
```

Notes:
- `test:storybook` is the fast CI-oriented check (`storybook build --test --quiet`).
- PR visual diffs are handled in GitHub Actions via the Chromatic workflow.
