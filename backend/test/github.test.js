"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGitHubClient, normalizeRepository } = require("../lib/github");

test("GitHub client reports API rate limits with a user-readable message", async () => {
  const client = createGitHubClient({
    token: "",
    fetchImpl: async (url) => {
      assert.equal(url, "https://api.github.com/repos/example/project");
      return new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 429 });
    }
  });

  await assert.rejects(
    client.requestJson("/repos/example/project"),
    (error) => error.name === "GitHubError" &&
      error.statusCode === 429 &&
      /rate limit/i.test(error.message)
  );
});

test("GitHub client converts a timed out network request into a bounded error", async () => {
  const client = createGitHubClient({
    token: "",
    fetchImpl: async () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    }
  });

  await assert.rejects(
    client.requestJson("/repos/example/project"),
    (error) => error.statusCode === 502 && /timed out/i.test(error.message)
  );
});

test("private repository metadata stops inspection before content or tree requests", async () => {
  const requests = [];
  const client = createGitHubClient({
    token: "test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, authorization: options.headers.Authorization });
      return new Response(JSON.stringify({
        private: true,
        default_branch: "main"
      }), { status: 200 });
    }
  });
  const repository = normalizeRepository("example/private-project");
  await assert.rejects(
    client.getEvidence(repository.fullName),
    (error) => error.statusCode === 403 && /private repositories are not supported/i.test(error.message)
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, undefined);
});

test("issue detail lookup uses public unauthenticated access", async () => {
  const client = createGitHubClient({
    token: "test-token",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, undefined);
      return new Response(JSON.stringify({ title: "Public issue" }), { status: 200 });
    }
  });
  const issue = await client.getIssue(
    normalizeRepository("example/project"),
    9
  );
  assert.equal(issue.title, "Public issue");
});
