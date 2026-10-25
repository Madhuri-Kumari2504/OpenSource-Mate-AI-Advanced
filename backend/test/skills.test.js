"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRepository, parseIssueUrl } = require("../lib/github");
const { analyzeRepository } = require("../skills/repositoryAnalyzer");
const { explainIssue } = require("../skills/issueExplainer");
const { buildContributionGuide } = require("../skills/contributionGuide");
const { writePrDraft } = require("../skills/prWriter");

function sampleEvidence() {
  const files = [
    {
      path: "README.md",
      url: "https://github.com/example/project/blob/main/README.md",
      content: "# Project\n\nInstall with npm ci.\n\n## Testing\n\nRun npm test."
    },
    {
      path: "CONTRIBUTING.md",
      url: "https://github.com/example/project/blob/main/CONTRIBUTING.md",
      content: "# Contributing\n\nPlease add a regression test and describe your changes."
    },
    {
      path: "package.json",
      url: "https://github.com/example/project/blob/main/package.json",
      content: JSON.stringify({
        engines: { node: ">=20" },
        dependencies: { react: "^19.0.0", express: "^5.0.0" },
        scripts: { test: "node --test", build: "vite build", dev: "vite" }
      })
    },
    {
      path: "src/search.ts",
      url: "https://github.com/example/project/blob/main/src/search.ts",
      content: "export function search() { return true; }"
    }
  ];
  return {
    repository: {
      fullName: "example/project",
      url: "https://github.com/example/project",
      description: "Example project",
      defaultBranch: "main",
      private: false
    },
    languages: { TypeScript: 1200, JavaScript: 300 },
    files,
    treePaths: [
      "README.md", "CONTRIBUTING.md", "package.json", "package-lock.json",
      "src/search.ts", "src/main.tsx"
    ],
    missing: [],
    warnings: [],
    status: "retrieved"
  };
}

function fakeDependencies() {
  return {
    github: {
      getEvidence: async () => sampleEvidence(),
      getIssue: async () => ({
        title: "Search results are empty",
        body: "The search returns no results for valid input."
      })
    },
    ollama: {
      generate: async () => ({
        available: false,
        modelAvailable: false,
        model: "llama3.2:1b",
        response: null,
        reason: "Ollama unavailable in test."
      })
    }
  };
}

test("repository and issue URLs reject non-GitHub or malformed targets", () => {
  assert.equal(normalizeRepository("https://github.com/example/project").fullName, "example/project");
  assert.equal(normalizeRepository("example/project.git").fullName, "example/project");
  assert.equal(normalizeRepository("https://github.com.evil.test/example/project"), null);
  assert.equal(normalizeRepository("https://github.com/example/project/issues/2"), null);
  assert.equal(parseIssueUrl("https://github.com/example/project/issues/42").number, 42);
  assert.equal(parseIssueUrl("https://github.com/example/project/pull/42"), null);
});

test("repository analyzer reports actual manifest scripts, technologies, and evidence", async () => {
  const result = await analyzeRepository(
    { repository: "https://github.com/example/project" },
    fakeDependencies()
  );
  assert.equal(result.success, true);
  assert.equal(result.data.repository.fullName, "example/project");
  assert.deepEqual(result.data.languages.map((language) => language.name), ["TypeScript", "JavaScript"]);
  assert.ok(result.data.frameworks.includes("React"));
  assert.ok(result.data.frameworks.includes("Express"));
  assert.equal(result.data.scripts[0].values.test, "node --test");
  assert.ok(result.data.evidence.some((file) => file.path === "CONTRIBUTING.md"));
  assert.deepEqual(result.data.missingEvidence, []);
});

test("issue explainer returns a deterministic fallback and labels uncertainty when Ollama is unavailable", async () => {
  const result = await explainIssue(
    { title: "Search results are empty", description: "A valid query returns no results.", repository: "example/project" },
    fakeDependencies()
  );
  assert.equal(result.success, true);
  assert.equal(result.data.ai.used, false);
  assert.match(result.data.ai.reason, /unavailable/i);
  assert.match(result.data.explanation, /report says/i);
  assert.ok(result.data.likelyFiles.some((file) => file.path === "src/search.ts"));
  assert.ok(result.data.hypotheses.some((item) => /not been confirmed/i.test(item)));
});

test("issue explainer retrieves issue details from a validated public issue URL", async () => {
  const deps = fakeDependencies();
  const result = await explainIssue(
    { issueUrl: "https://github.com/example/project/issues/7" },
    deps
  );
  assert.equal(result.data.title, "Search results are empty");
  assert.equal(result.data.issueUrl, "https://github.com/example/project/issues/7");
  assert.equal(result.data.ai.used, false);
});

test("contribution guide only reports scripts present in retrieved evidence", async () => {
  const result = await buildContributionGuide(
    { repository: "example/project" },
    fakeDependencies()
  );
  assert.equal(result.success, true);
  assert.equal(result.data.setupSteps.find((step) => step.command === "npm ci")?.evidence.includes("lockfile"), true);
  assert.ok(result.data.testCommands.some((item) => item.command === "npm test"));
  assert.equal(result.data.projectScripts.some((item) => item.command === "npm run build"), true);
  assert.equal(result.data.contributionWorkflow.source, "CONTRIBUTING.md");
});

test("PR draft clearly discloses missing test results and never submits", () => {
  const result = writePrDraft({
    issueUrl: "https://github.com/example/project/issues/42",
    problem: "Search results are empty for valid queries.",
    solution: "Corrected the query normalization.",
    changedFiles: ["src/search.ts"]
  });
  assert.equal(result.data.draftOnly, true);
  assert.equal(result.data.testingVerified, false);
  assert.match(result.data.description, /Not provided\. No test result is verified/);
  assert.match(result.data.description, /Closes #42/);
  assert.match(result.data.description, /src\/search\.ts/);
});

test("PR writer rejects missing problem or solution instead of fabricating a draft", () => {
  assert.throws(
    () => writePrDraft({ problem: "A problem only" }),
    { name: "InputError", statusCode: 400 }
  );
});
