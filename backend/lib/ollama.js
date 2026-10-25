"use strict";

function parseBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.toString().replace(/\/+$/, "");
}

async function readJsonLimited(response, maxBytes = 512 * 1024) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Ollama response exceeded the size limit.");
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("Ollama response exceeded the size limit.");
    }
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Ollama response exceeded the size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createOllamaClient({
  fetchImpl = globalThis.fetch,
  baseUrl = process.env.OLLAMA_URL || "http://localhost:11434",
  model = process.env.OLLAMA_MODEL || "llama3.2:1b",
  availabilityTimeoutMs = 2500,
  generationTimeoutMs = 180_000
} = {}) {
  const url = parseBaseUrl(baseUrl);

  async function availability() {
    if (!url) {
      return {
        available: false,
        modelAvailable: false,
        model,
        reason: "OLLAMA_URL must be a valid HTTP(S) URL without credentials."
      };
    }

    try {
      const response = await fetchImpl(`${url}/api/tags`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(availabilityTimeoutMs)
      });
      if (!response.ok) {
        return {
          available: false,
          modelAvailable: false,
          model,
          reason: `Ollama availability check failed (HTTP ${response.status}).`
        };
      }
      const payload = await readJsonLimited(response);
      const models = Array.isArray(payload?.models) ? payload.models : [];
      const modelAvailable = models.some(
        (item) => item?.name === model || item?.model === model
      );
      return {
        available: true,
        modelAvailable,
        model,
        reason: modelAvailable ? null : `The configured Ollama model "${model}" is not installed.`
      };
    } catch (error) {
      return {
        available: false,
        modelAvailable: false,
        model,
        reason:
          error?.name === "TimeoutError" || error?.name === "AbortError"
            ? "Ollama did not respond before the availability check timed out."
            : "Ollama is unreachable from the backend. Check OLLAMA_URL and network access."
      };
    }
  }

  async function generate(prompt) {
    const status = await availability();
    if (!status.available || !status.modelAvailable) {
      return { ...status, response: null };
    }

    try {
      const result = await fetchImpl(`${url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.2, num_predict: 2048 }
        }),
        signal: AbortSignal.timeout(generationTimeoutMs)
      });
      if (!result.ok) {
        return {
          available: true,
          modelAvailable: true,
          model,
          response: null,
          reason: `Ollama generation failed (HTTP ${result.status}).`
        };
      }
      const data = await readJsonLimited(result);
      if (typeof data?.response !== "string" || !data.response.trim()) {
        return {
          available: true,
          modelAvailable: true,
          model,
          response: null,
          reason: "Ollama returned an empty response."
        };
      }
      return {
        available: true,
        modelAvailable: true,
        model,
        response: data.response.trim(),
        reason: null
      };
    } catch (error) {
      return {
        available: true,
        modelAvailable: true,
        model,
        response: null,
        reason:
          error?.name === "TimeoutError" || error?.name === "AbortError"
            ? "Ollama generation timed out."
            : "Ollama could not complete generation."
      };
    }
  }

  return {
    model,
    configured: Boolean(url),
    availability,
    generate
  };
}

module.exports = { createOllamaClient, parseBaseUrl };
