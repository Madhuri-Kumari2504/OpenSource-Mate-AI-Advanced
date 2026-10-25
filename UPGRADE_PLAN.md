# OpenSource Mate AI — practical upgrade plan

This upgrade intentionally preserves the existing React/Vite interface, current routes, Ollama integration, and skill handlers. The first implementation is a low-risk reliability pass rather than a visual redesign.

## Included now

1. **GitHub GET response cache** — successful repository lookups are cached in backend memory for 60 seconds to reduce duplicate requests and help avoid rate limits. Cache is bounded to 100 entries and expires automatically. Errors and 404s are not cached.
2. **Safer GitHub request failures** — network/time-out and invalid JSON responses return controlled status results instead of crashing the request handler.
3. **Health diagnostics** — `/api/health` reports whether a server-side GitHub token is configured and the configured cache TTL. It never returns the token itself.
4. **Verification script** — a PowerShell script checks project layout, JavaScript syntax, backend tests, and frontend production build.
5. **Explicit setup and rollback guidance** — the original project should be backed up before replacing anything.

## Recommended next improvements

### Phase 1 — verify core flows
- Test Analyze Repository, Contribution Guide, Issue Finder, Issue Explainer, AI Contribution Planner, and PR Writer against a few public repositories.
- Confirm empty input, malformed repository URLs, missing issues, GitHub rate limits, Ollama offline, and long-running requests show useful messages.
- Keep UI changes small and preserve the existing layout/theme toggle.

### Phase 2 — improve issue discovery
- Add pagination and filters only after confirming current Issue Finder request/response contracts.
- Prefer GitHub Search API filters such as `is:issue is:open label:"good first issue"` and language/repository filters.
- Show source links, labels, updated dates, and a clear note when results are limited by API rate limits.

### Phase 3 — strengthen AI output quality
- Keep repository evidence and AI-generated suggestions visibly distinct.
- Include citations/links to the repository files and issue used as context.
- Add a small set of deterministic tests for prompts and output shape; don't claim the AI ran tests or executed code unless it actually did.

### Phase 4 — launch readiness
- Add automated CI checks, screenshots, a clear README, deployment instructions, and secret-management checks.
- Keep `GITHUB_TOKEN` and any AI-provider secrets in `backend/.env` only; never put secrets in `frontend/.env` or commit `.env`.

## Configuration

In `backend/.env`, optional setting:

```env
GITHUB_CACHE_TTL_MS=60000
```

Set it to `0` to disable cache. Restart the backend after changing environment variables. This is an in-memory cache and is cleared when the backend restarts; it is not shared across multiple server instances.
