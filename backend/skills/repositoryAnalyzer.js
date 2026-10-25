"use strict";

const { InputError, normalizeRepository } = require("../lib/github");

function parseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function languageFromPath(path) {
  const extension = path.toLowerCase().split(".").pop();
  const names = {
    js: "JavaScript",
    jsx: "JavaScript",
    cjs: "JavaScript",
    mjs: "JavaScript",
    ts: "TypeScript",
    tsx: "TypeScript",
    py: "Python",
    go: "Go",
    rs: "Rust",
    java: "Java",
    kt: "Kotlin",
    php: "PHP",
    rb: "Ruby",
    vue: "Vue",
    svelte: "Svelte",
    swift: "Swift",
    cs: "C#"
  };
  return names[extension] || null;
}

function detectFrameworks(files) {
  const dependencies = {};
  for (const packageFile of files.filter((file) => file.path.split("/").pop() === "package.json")) {
    const manifest = parseJson(packageFile.content);
    Object.assign(
      dependencies,
      manifest?.dependencies || {},
      manifest?.devDependencies || {},
      manifest?.peerDependencies || {}
    );
  }
  const frameworks = [];
  const known = [
    ["react", "React"],
    ["next", "Next.js"],
    ["vite", "Vite"],
    ["express", "Express"],
    ["vue", "Vue"],
    ["@angular/core", "Angular"],
    ["svelte", "Svelte"],
    ["fastify", "Fastify"],
    ["nestjs", "NestJS"],
    ["@nestjs/core", "NestJS"],
    ["remix", "Remix"]
  ];
  for (const [dependency, label] of known) {
    if (dependencies[dependency] && !frameworks.includes(label)) frameworks.push(label);
  }

  const pyproject = files.find((file) => file.path.split("/").pop() === "pyproject.toml");
  const pythonText = pyproject?.content || "";
  for (const [pattern, label] of [
    [/\bfastapi\b/i, "FastAPI"],
    [/\bdjango\b/i, "Django"],
    [/\bflask\b/i, "Flask"]
  ]) {
    if (pattern.test(pythonText)) frameworks.push(label);
  }
  if (files.some((file) => file.path.split("/").pop() === "go.mod")) frameworks.push("Go modules");
  if (files.some((file) => file.path.split("/").pop() === "Cargo.toml")) frameworks.push("Cargo");
  return [...new Set(frameworks)];
}

function extractScripts(files) {
  const scripts = [];
  for (const file of files) {
    if (file.path.split("/").pop() !== "package.json") continue;
    const manifest = parseJson(file.content);
    if (manifest?.scripts && typeof manifest.scripts === "object") {
      scripts.push({
        manifest: file.path,
        values: Object.fromEntries(
          Object.entries(manifest.scripts).filter(([, value]) => typeof value === "string")
        )
      });
    }
  }
  return scripts;
}

function analyzeStructure(paths) {
  const directories = new Set();
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length > 1) directories.add(parts[0]);
  }
  return {
    topLevelDirectories: [...directories].sort().slice(0, 30),
    sampleFiles: paths.slice(0, 30)
  };
}

async function analyzeRepository(input, { github }) {
  const candidate = input?.repository ?? input?.repositoryUrl;
  const repository = normalizeRepository(candidate);
  if (!repository) {
    throw new InputError("Provide a valid public GitHub repository URL or owner/repository.");
  }

  const evidence = await github.getEvidence(repository.fullName);
  const detectedLanguages = Object.entries(evidence.languages || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([name, bytes]) => ({ name, bytes }));
  const languages =
    detectedLanguages.length > 0
      ? detectedLanguages
      : [...new Set(evidence.treePaths.map(languageFromPath).filter(Boolean))].map((name) => ({
          name,
          bytes: null,
          source: "file extensions; GitHub language metadata unavailable"
        }));

  const contributingFile = evidence.files.find((file) =>
    /^contributing(?:\.|$)/i.test(file.path.split("/").pop() || "")
  );
  const contributionRequirements = contributingFile
    ? {
        source: contributingFile.path,
        excerpt: contributingFile.content.slice(0, 3000)
      }
    : null;

  return {
    success: true,
    data: {
      repository: evidence.repository,
      status: evidence.status,
      languages,
      frameworks: detectFrameworks(evidence.files),
      scripts: extractScripts(evidence.files),
      projectStructure: analyzeStructure(evidence.treePaths),
      contributionRequirements,
      evidence: evidence.files.map((file) => ({
        path: file.path,
        url: file.url,
        truncated: Boolean(file.truncated)
      })),
      missingEvidence: evidence.missing,
      warnings: evidence.warnings
    }
  };
}

module.exports = {
  analyzeRepository,
  analyzeStructure,
  detectFrameworks,
  extractScripts,
  languageFromPath
};
