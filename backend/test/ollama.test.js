"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOllamaClient, parseBaseUrl } = require("../lib/ollama");

test("Ollama base URL rejects credentials and unsupported schemes", () => {
  assert.equal(parseBaseUrl("http://localhost:11434"), "http://localhost:11434");
  assert.equal(parseBaseUrl("file:///etc/passwd"), null);
  assert.equal(parseBaseUrl("http://user:pass@localhost:11434"), null);
});

test("generation checks model availability before calling the generate endpoint", async () => {
  const requests = [];
  const client = createOllamaClient({
    baseUrl: "http://ollama.test:11434",
    model: "llama3.2:1b",
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method || "GET" });
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "llama3.2:1b" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ response: "A structured answer." }), { status: 200 });
    }
  });

  const result = await client.generate("test prompt");
  assert.equal(result.response, "A structured answer.");
  assert.deepEqual(requests.map((request) => request.method), ["GET", "POST"]);
  assert.ok(requests[0].url.endsWith("/api/tags"));
  assert.ok(requests[1].url.endsWith("/api/generate"));
});

test("missing Ollama model avoids generating and returns a clear fallback reason", async () => {
  const requests = [];
  const client = createOllamaClient({
    baseUrl: "http://ollama.test:11434",
    model: "missing:1b",
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
  });
  const result = await client.generate("test prompt");
  assert.equal(result.response, null);
  assert.match(result.reason, /not installed/i);
  assert.equal(requests.length, 1);
});

test("Ollama timeout returns a fallback reason instead of hanging", async () => {
  const client = createOllamaClient({
    baseUrl: "http://ollama.test:11434",
    model: "llama3.2:1b",
    fetchImpl: async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }
  });
  const result = await client.generate("test prompt");
  assert.equal(result.response, null);
  assert.match(result.reason, /timed out/i);
});
