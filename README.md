# OpenSource Mate AI

OpenSource Mate AI helps developers inspect public GitHub repositories, understand contribution opportunities, plan work, and draft pull requests.

## Requirements
- Node.js 20 or newer
- Internet access for GitHub repository features
- Ollama is optional unless using local AI generation.

## Setup (Windows PowerShell)
Open PowerShell in the folder that contains this README and `package.json`:

```powershell
npm install
npm install --prefix backend
npm install --prefix frontend
```

Create the backend environment file only if it does not already exist:

```powershell
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Never overwrite an existing `.env` automatically; it may contain your local settings. `GITHUB_TOKEN` is optional and must remain server-side in `backend/.env`. Never paste a token into frontend code or commit `.env`.

## Start both services

```powershell
npm run dev
```

- Frontend: http://localhost:5174
- Backend health: http://localhost:8000/api/health

Alternatively, open two terminals and run `npm run dev:backend` and `npm run dev:frontend`.

## Verify the project

```powershell
npm test
npm run build
.\scripts\verify-project.ps1
```

## GitHub API reliability

Successful GitHub GET requests are cached in backend memory for 60 seconds by default (maximum 100 entries). Configure `GITHUB_CACHE_TTL_MS` in `backend/.env`; use `0` to disable caching. Restart the backend after changing this setting. A configured `GITHUB_TOKEN` increases the API rate limit for authenticated requests; use a least-privilege token and keep it private.

See [UPGRADE_PLAN.md](UPGRADE_PLAN.md) for the implementation plan, limitations, and next steps.
