"use strict";

const API_ORIGIN = "https://api.github.com";
const MAX_GITHUB_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FILE_CHARS = 12_000;

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
    this.statusCode = 400;
  }
}

class GitHubError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "GitHubError";
    this.statusCode = statusCode;
  }
}

function validateOwnerRepo(owner, repo) {
  const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const repoPattern = /^[A-Za-z0-9_.-]{1,100}$/;

  if (
    !ownerPattern.test(owner) ||
    !repoPattern.test(repo) ||
    repo === "." ||
    repo === ".."
  ) {
    return null;
  }

  return {
    owner,
    repo,
    fullName: `${owner}/${repo.replace(/\.git$/i, "")}`,
    url: `https://github.com/${owner}/${repo.replace(/\.git$/i, "")}`
  };
}

function normalizeRepository(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > 500) return null;

  let segments;
  if (/^https?:\/\//i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 2 && /\.git$/i.test(segments[1])) {
      segments[1] = segments[1].replace(/\.git$/i, "");
    }
    if (segments.length !== 2) return null;
  } else {
    const shorthand = value.replace(/^github\.com\//i, "").replace(/\/+$/, "");
    segments = shorthand.split("/");
    if (segments.length !== 2) return null;
    segments[1] = segments[1].replace(/\.git$/i, "");
  }

  return validateOwnerRepo(segments[0], segments[1]);
}

function parseIssueUrl(input) {
  if (typeof input !== "string" || input.length > 1000) return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[2] !== "issues" || !/^\d+$/.test(parts[3])) {
    return null;
  }
  const repository = validateOwnerRepo(parts[0], parts[1]);
  const number = Number(parts[3]);
  if (!repository || !Number.isSafeInteger(number) || number < 1) return null;

  return {
    ...repository,
    number,
    issueUrl: `https://github.com/${repository.fullName}/issues/${number}`
  };
}

async function readResponseText(response, maxBytes = MAX_GITHUB_RESPONSE_BYTES) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new GitHubError("GitHub returned a response larger than the allowed limit.");
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new GitHubError("GitHub returned a response larger than the allowed limit.");
    }
    return text;
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
        throw new GitHubError("GitHub returned a response larger than the allowed limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function humanGitHubError(statusCode) {
  if (statusCode === 404) return "Repository or issue not found, or it is not publicly accessible.";
  if (statusCode === 401) return "GitHub did not accept the configured authentication.";
  if (statusCode === 403 || statusCode === 429) {
    return "GitHub API rate limit or permission restriction prevented this lookup.";
  }
  return `GitHub request failed (HTTP ${statusCode}).`;
}

function createGitHubClient({
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || "",
  timeoutMs = 12_000
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("This Node.js runtime must provide fetch().");
  }

  async function requestJson(path, { optional = false, maxBytes, authenticated = true } = {}) {
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error("GitHub API paths must be relative paths.");
    }

    let response;
    try {
      response = await fetchImpl(`${API_ORIGIN}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "OpenSource-Mate-AI",
          ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {})
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new GitHubError(
        timedOut
          ? "GitHub did not respond before the request timed out."
          : "Could not connect to GitHub.",
        502
      );
    }

    if (optional && response.status === 404) return null;
    if (!response.ok) {
      throw new GitHubError(humanGitHubError(response.status), response.status);
    }

    let text;
    try {
      text = await readResponseText(response, maxBytes);
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError("GitHub returned an unreadable response.", 502);
    }
  }

  async function getFile(owner, repo, path, ref) {
    if (
      typeof path !== "string" ||
      path.length > 1000 ||
      path.split("/").some((part) => part === "." || part === ".." || part === "")
    ) {
      return null;
    }
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const file = await requestJson(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${query}`,
      { optional: true }
    );

    if (
      !file ||
      Array.isArray(file) ||
      file.type !== "file" ||
      file.encoding !== "base64" ||
      typeof file.content !== "string"
    ) {
      return null;
    }

    const content = Buffer.from(file.content, "base64").toString("utf8");
    return {
      path: typeof file.path === "string" ? file.path : path,
      url: typeof file.html_url === "string" ? file.html_url : null,
      content: content.slice(0, MAX_FILE_CHARS),
      truncated: content.length > MAX_FILE_CHARS
    };
  }

  async function getIssue(repository, number) {
    return requestJson(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues/${number}`,
      { authenticated: false }
    );
  }

  async function getEvidence(repositoryInput, relevantText = "", options = {}) {
    const repository = normalizeRepository(repositoryInput);
    if (!repository) {
      throw new InputError("Enter a public GitHub repository URL or owner/repository.");
    }

    const { owner, repo } = repository;
    const metadata = await requestJson(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { authenticated: false }
    );
    if (metadata.private === true) {
      throw new GitHubError("Private repositories are not supported; use a public repository.", 403);
    }
    let languagesResult;
    try {
      languagesResult = { status: "fulfilled", value: await requestJson(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`
      ) };
    } catch (error) {
      languagesResult = { status: "rejected", reason: error };
    }
    const defaultBranch = metadata.default_branch || null;
    const warnings = [];
    let languages = {};
    if (languagesResult.status === "fulfilled" && languagesResult.value) {
      languages = languagesResult.value;
    } else {
      warnings.push("GitHub language metadata was unavailable.");
    }
    if (!defaultBranch) {
      warnings.push("GitHub did not provide a default branch.");
    }

    let treePaths = [];
    if (defaultBranch) {
      try {
        const tree = await requestJson(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`
        );
        treePaths = Array.isArray(tree?.tree)
          ? tree.tree
              .filter((item) => item?.type === "blob" && typeof item.path === "string")
              .slice(0, 10_000)
              .map((item) => item.path)
          : [];
        if (tree?.truncated) {
          warnings.push("GitHub returned a truncated file tree; some paths may be missing.");
        }
      } catch {
        warnings.push("GitHub's file tree was unavailable; source-file discovery was skipped.");
      }
    }

    const rootFiles = treePaths.filter((path) => !path.includes("/"));
    const findRoot = (pattern, fallbacks) =>
      rootFiles.find((path) => pattern.test(path)) || fallbacks.find((path) => rootFiles.includes(path));
    const manifestPattern = /(?:^|\/)(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|requirements\.txt)$/i;
    const rootManifestPaths = rootFiles.filter((path) => manifestPattern.test(path)).slice(0, 4);
    const nestedManifestPaths = treePaths
      .filter((path) => path.includes("/") && manifestPattern.test(path) && !/(^|\/)(node_modules|vendor|dist|build)(\/|$)/i.test(path))
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
      .slice(0, 2);
    const documentationAndManifests = [
      findRoot(/^readme(?:\.|$)/i, ["README.md"]),
      findRoot(/^contributing(?:\.|$)/i, ["CONTRIBUTING.md"]),
      ...rootManifestPaths,
      ...nestedManifestPaths
    ].filter(Boolean);
    const standardPaths = [...new Set(documentationAndManifests)].slice(0, 8);
    const standardResults = await Promise.allSettled(
      standardPaths.map((path) => getFile(owner, repo, path, defaultBranch))
    );
    const files = standardResults
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    for (const result of standardResults) {
      if (result.status === "rejected") {
        warnings.push("One or more repository documentation or manifest files could not be read.");
        break;
      }
    }

    const issueWords = new Set(
      String(relevantText)
        .toLowerCase()
        .match(/[a-z][a-z0-9_-]{2,}/g)
        ?.filter((word) => !["the", "and", "for", "with", "this", "that", "issue"].includes(word))
        .slice(0, 20) || []
    );
    const excludedPath = /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|target)(\/|$)|\.(lock|map|min\.js|svg|png|jpe?g|gif|ico|woff2?|ttf|pdf|zip)$/i;
    const sourcePath = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|php|rb|vue|svelte|swift|cs)$/i;
    const existing = new Set(files.map((file) => file.path));
    const maxSourceFiles = Math.min(Number(options.maxSourceFiles) || 4, 6);
    const sourceCandidates = treePaths
      .filter((path) => sourcePath.test(path) && !excludedPath.test(path) && !existing.has(path))
      .map((path) => {
        const lower = path.toLowerCase();
        const termScore = [...issueWords].reduce(
          (score, word) => score + (lower.includes(word) ? 3 : 0),
          0
        );
        const commonScore = /(?:src|lib|app|server|client|api|test|spec)\//i.test(path) ? 2 : 0;
        return { path, score: termScore + commonScore };
      })
      .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
      .slice(0, maxSourceFiles)
      .map((item) => item.path);
    const sourceResults = await Promise.allSettled(
      sourceCandidates.map((path) => getFile(owner, repo, path, defaultBranch))
    );
    for (const result of sourceResults) {
      if (result.status === "fulfilled" && result.value) files.push(result.value);
    }

    const missing = [];
    if (!files.some((file) => /^readme(?:\.|$)/i.test(file.path.split("/").pop() || ""))) {
      missing.push("README");
    }
    if (!files.some((file) => /^contributing(?:\.|$)/i.test(file.path.split("/").pop() || ""))) {
      missing.push("CONTRIBUTING guide");
    }
    if (
      !files.some((file) =>
        /^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|requirements\.txt)$/i.test(
          file.path.split("/").pop() || ""
        )
      )
    ) {
      missing.push("recognized package manifest");
    }
    if (files.length === 0) {
      warnings.push("No readable repository files were retrieved.");
    }

    return {
      repository: {
        fullName: repository.fullName,
        url: metadata.html_url || repository.url,
        description: typeof metadata.description === "string" ? metadata.description : "",
        defaultBranch,
        private: Boolean(metadata.private)
      },
      languages,
      files,
      treePaths,
      missing,
      warnings,
      status: files.length > 0 ? "retrieved" : "partial"
    };
  }

  return { requestJson, getFile, getIssue, getEvidence };
}

module.exports = {
  GitHubError,
  InputError,
  createGitHubClient,
  normalizeRepository,
  parseIssueUrl
};
