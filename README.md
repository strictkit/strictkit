# StrictKit

**Architecture & Security Baseline for Next.js projects**

StrictKit is not a linter. It's an opinionated execution engine that enforces a non-negotiable technical baseline: if your project doesn't meet the standard, it shouldn't deploy.

## Quick start

Run the audit from your project root (no global install required):

```bash
npx strictkit audit
```

### Machine-readable output

To get JSON output for integrations:

```bash
npx strictkit audit --json
```

## Doctrine — Core pillars

StrictKit evaluates projects against three pillars:

1. **INTEGRITY** [SK-INT-001]
  - Philosophy: `any` is a silent virus that weakens the type system.
  - Enforcement: scans for explicit `any` usage in TypeScript files.

2. **SECURITY** [SK-SEC-001]
  - Philosophy: hardcoded secrets are a liability, even in tests.
  - Enforcement: detects likely API keys and credentials in the codebase.

3. **INFRA** [SK-INF-001]
  - Philosophy: unpinned base images create non-deterministic builds.
  - Enforcement: requires pinned Docker base images (e.g. `node:18-alpine` instead of `:latest`).

## CI/CD Integration

StrictKit exits with code `1` on failure, so it integrates naturally with pipelines.

### GitHub Actions

Add this step to `.github/workflows/ci.yml` to run StrictKit on every push:

```yaml
- name: "🛡️ StrictKit Architecture Audit"
  run: npx strictkit audit
```

## Debugging

To understand the reasoning behind a specific violation, query the doctrine engine:

```bash
npx strictkit explain INTEGRITY
```

## License

MIT License | strictkit.dev
