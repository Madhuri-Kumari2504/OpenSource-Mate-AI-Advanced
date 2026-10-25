"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server");

function createFakeServices() {
  const evidence = {
    repository: {
      fullName: "example/project",
      url: "https://github.com/example/project",
      description: "An example repository",
      defaultBranch: "main",
      private: false
    },
    languages: { TypeScript: 900 },
    files: [
      {
        path: "README.md",
        url: "https://github.com/example/project/blob/main/README.md",
        content: "# Example\n\nInstall with npm ci."
      },
      {
        path: "CONTRIBUTING.md",
        url: "https://github.com/example/project/blob/main/CONTRIBUTING.md",
        content: "# Contributing\n\nAdd tests for changes."
      },
      {
        path: "package.json",
        url: "https://github.com/example/project/blob/main/package.json",
        content: JSON.stringify({ scripts: { test: "node --test", build: "vite build" }, dependencies: { react: "^19.0.0" } })
      },
      {
        path: "src/search.ts",
        url: "https://github.com/example/project/blob/main/src/search.ts",
        content: "export const search = true;"
      }
    ],
    treePaths: ["README.md", "CONTRIBUTING.md", "package.json", "package-lock.json", "src/search.ts"],
    missing: [],
    warnings: [],
    status: "retrieved"
  };
  return {
    github: {
      getEvidence: async () => evidence,
      getIssue: async () => ({ title: "Search issue", body: "Search returns no results." })
    },
    ollama: {
      model: "llama3.2:1b",
      configured: false,
      generate: async () => ({
        response: null,
        model: "llama3.2:1b",
        reason: "Ollama unavailable in API test."
      })
    }
  };
}

const server = createApp({
  env: { CORS_ORIGINS: "http://localhost:5173" },
  ...createFakeServices()
}).listen(0, "127.0.0.1");

test.before(async () => {
  await once(server, "listening");
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test("root and health routes respond without revealing credentials", async () => {
  const root = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(root.status, 200);
  assert.equal((await root.json()).name, "OpenSource Mate AI");
  const health = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  const payload = await health.json();
  assert.equal(health.status, 200);
  assert.equal(payload.status, "healthy");
  assert.equal(Object.hasOwn(payload, "githubToken"), false);
});

test("planner route returns a documented fallback when Ollama is unavailable", async () => {
  const result = await post("/api/ai/plan", {
    title: "Search issue",
    description: "Search returns no results.",
    repository: "example/project"
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.aiUsed, false);
  assert.match(result.body.plan, /What We Verified/);
  assert.match(result.body.note, /Ollama was unavailable/);
});

test("all four skill routes return structured results", async () => {
  const analyzer = await post("/api/skills/repository-analyzer", { repository: "example/project" });
  assert.equal(analyzer.status, 200);
  assert.equal(analyzer.body.data.repository.fullName, "example/project");

  const explainer = await post("/api/skills/issue-explainer", {
    title: "Search issue",
    description: "Search returns no results.",
    repository: "example/project"
  });
  assert.equal(explainer.status, 200);
  assert.equal(explainer.body.data.ai.used, false);

  const guide = await post("/api/skills/contribution-guide", { repository: "example/project" });
  assert.equal(guide.status, 200);
  assert.ok(guide.body.data.testCommands.some((item) => item.command === "npm test"));

  const pr = await post("/api/skills/pr-writer", {
    problem: "Search returns no results.",
    solution: "Corrected the search behavior.",
    changedFiles: ["src/search.ts"]
  });
  assert.equal(pr.status, 200);
  assert.equal(pr.body.data.draftOnly, true);
  assert.match(pr.body.data.description, /No test result is verified/);
});

test("invalid bodies return readable 400 responses", async () => {
  const missingPlan = await post("/api/ai/plan", { title: "", description: "" });
  assert.equal(missingPlan.status, 400);
  assert.match(missingPlan.body.error, /title/i);

  const invalidRepository = await post("/api/skills/repository-analyzer", { repository: "https://example.com/repo" });
  assert.equal(invalidRepository.status, 400);
  assert.match(invalidRepository.body.error, /GitHub/i);

  const invalidPr = await post("/api/skills/pr-writer", { problem: "Only a problem" });
  assert.equal(invalidPr.status, 400);
  assert.match(invalidPr.body.error, /solution/i);
});

test("oversized request bodies are rejected with HTTP 413", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Issue", description: "x".repeat(40_000) })
  });
  assert.equal(response.status, 413);
  const payload = await response.json();
  assert.match(payload.error, /too large/i);
});
