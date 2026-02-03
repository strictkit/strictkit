
# StrictKit

**The Architecture & Security Baseline for Next.js Projects.**

StrictKit is not a linter. It is an opinionated execution engine designed to enforce a non-negotiable technical baseline. If your project doesn't meet the standard, it shouldn't deploy.

---

## Quick Start

Run the audit directly in your project root. No installation required.

```bash
npx strictkit audit
```

StrictKit exits with:

```
0 → PASS (Baseline met)

1 → FAIL (Pipeline stops)
```

## Doctrine

StrictKit evaluates your project against three core pillars:

1. **INTEGRITY** [SK-INT-001]
  - Philosophy: The `any` type is a silent virus that disables the compiler.
  - Enforcement: Scans for explicit `any` usage in TypeScript files.

2. **SECURITY** [SK-SEC-001]
  - Philosophy: Hardcoded secrets are a liability, even in "test" files.
  - Enforcement: Detects patterns of API keys and credentials in the codebase.

3. **INFRA** [SK-INF-001]
  - Philosophy: Unpinned Docker images create non-deterministic builds.
  - Enforcement: Ensures Dockerfile bases are strictly pinned (e.g., `node:18-alpine` instead of `:latest`).

## CI/CD Enforcement

StrictKit is designed for automation. It returns exit code `1` on failure, making it natively compatible with any pipeline.

### GitHub Actions

Add this step to your `.github/workflows/ci.yml` to enforce the baseline on every push:

```yaml
- name: 🛡️ StrictKit Architecture Audit
  run: npx strictkit audit
```

## Machine Readable Output

For custom reporting or integration with third-party tools (JSON contract):

```bash
npx strictkit audit --json
```

## Design Principles

- No plugins: It works or it doesn't.
- No config files: Standards are not negotiable.
- No dashboards: The CLI is the only interface.
- No vendor lock-in: Just an npm package.
- Only execution.

MIT License | strictkit.dev

