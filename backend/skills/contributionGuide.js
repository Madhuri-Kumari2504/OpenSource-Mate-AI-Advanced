"use strict";

const { InputError, normalizeRepository } = require("../lib/github");

function parseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function fileByName(files, name) {
  return files.find((file) => file.path.split("/").pop().toLowerCase() === name.toLowerCase());
}

function markdownSection(text, keywords) {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  let capturing = false;
  const output = [];
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)/);
    if (heading) {
      if (capturing) break;
      capturing = keywords.some((keyword) => keyword.test(heading[1]));
      if (capturing) output.push(line);
      continue;
    }
    if (capturing) output.push(line);
  }
  return output.join("\n").trim().slice(0, 5000);
}

async function buildContributionGuide(input, { github }) {
  const repositoryInput = input?.repository ?? input?.repositoryUrl;
  const repository = normalizeRepository(repositoryInput);
  if (!repository) {
    throw new InputError("Provide a valid public GitHub repository URL or owner/repository.");
  }

  const evidence = await github.getEvidence(repository.fullName);
  const readme = evidence.files.find((file) =>
    /^readme(?:\.|$)/i.test(file.path.split("/").pop() || "")
  );
  const contributing = evidence.files.find((file) =>
    /^contributing(?:\.|$)/i.test(file.path.split("/").pop() || "")
  );
  const packageFile = fileByName(evidence.files, "package.json");
  const packageData = packageFile ? parseJson(packageFile.content) : null;
  const paths = new Set(evidence.treePaths);
  const manifestDirectory = packageFile?.path.includes("/")
    ? packageFile.path.slice(0, packageFile.path.lastIndexOf("/"))
    : "";
  const lockPath = (name) => [manifestDirectory, name].filter(Boolean).join("/");
  const quotedManifestDirectory = manifestDirectory
    ? `'${manifestDirectory.replace(/'/g, "'\\''")}'`
    : "";
  const npmPrefix = manifestDirectory ? `npm --prefix ${quotedManifestDirectory} ` : "npm ";
  const setupSteps = [
    {
      step: "Clone the public repository.",
      command: `git clone ${evidence.repository.url}.git`,
      evidence: "The public repository URL returned by GitHub."
    },
    { step: "Change into the repository folder.", command: `cd ${repository.repo}` }
  ];
  const prerequisites = [];
  const installCommands = [];
  const testCommands = [];
  const otherScripts = [];

  if (packageData) {
    const nodeRequirement = packageData.engines?.node;
    if (typeof nodeRequirement === "string") {
      prerequisites.push(`Node.js ${nodeRequirement} (from ${packageFile.path}).`);
    } else {
      prerequisites.push(`Node.js (a package.json was retrieved at ${packageFile.path}; no version requirement was declared there).`);
    }

    if (paths.has(lockPath("package-lock.json")) || paths.has(lockPath("npm-shrinkwrap.json"))) {
      installCommands.push(`${npmPrefix}ci`);
      setupSteps.push({
        step: "Install the lockfile-pinned Node dependencies.",
        command: `${npmPrefix}ci`,
        evidence: `A package.json and npm lockfile are present beside ${packageFile.path}.`
      });
    } else if (paths.has(lockPath("pnpm-lock.yaml"))) {
      installCommands.push(`${manifestDirectory ? `pnpm --dir ${quotedManifestDirectory} ` : "pnpm "}install --frozen-lockfile`);
      setupSteps.push({
        step: "Install the Node dependencies with the detected pnpm lockfile.",
        command: `${manifestDirectory ? `pnpm --dir ${quotedManifestDirectory} ` : "pnpm "}install --frozen-lockfile`,
        evidence: `A package.json and pnpm-lock.yaml are present beside ${packageFile.path}.`
      });
      prerequisites.push("pnpm (the repository has a pnpm lockfile).");
    } else if (paths.has(lockPath("yarn.lock"))) {
      installCommands.push(`${manifestDirectory ? `yarn --cwd ${quotedManifestDirectory} ` : "yarn "}install --frozen-lockfile`);
      setupSteps.push({
        step: "Install the Node dependencies with the detected Yarn lockfile.",
        command: `${manifestDirectory ? `yarn --cwd ${quotedManifestDirectory} ` : "yarn "}install --frozen-lockfile`,
        evidence: `A package.json and yarn.lock are present beside ${packageFile.path}.`
      });
      prerequisites.push("Yarn (the repository has a yarn.lock file).");
    } else {
      installCommands.push(`${npmPrefix}install`);
      setupSteps.push({
        step: "Install dependencies from package.json.",
        command: `${npmPrefix}install`,
        evidence: `The retrieved manifest is ${packageFile.path}; no supported lockfile was found at the repository root.`
      });
    }

    const scripts = packageData.scripts && typeof packageData.scripts === "object"
      ? packageData.scripts
      : {};
    if (typeof scripts.test === "string") testCommands.push({ command: `${npmPrefix}test`, script: scripts.test });
    if (typeof scripts.build === "string") otherScripts.push({ command: `${npmPrefix}run build`, script: scripts.build });
    if (typeof scripts.dev === "string") otherScripts.push({ command: `${npmPrefix}run dev`, script: scripts.dev });
    if (typeof scripts.lint === "string") otherScripts.push({ command: `${npmPrefix}run lint`, script: scripts.lint });
    for (const [name, command] of Object.entries(scripts)) {
      if (!["test", "build", "dev", "lint"].includes(name) && typeof command === "string") {
        otherScripts.push({ command: `${npmPrefix}run ${name}`, script: command });
      }
    }
    if (!scripts.test) {
      testCommands.push({
        command: null,
        note: "No test script was declared in the retrieved package.json."
      });
    }
  } else if (fileByName(evidence.files, "pyproject.toml")) {
    const pythonFile = fileByName(evidence.files, "pyproject.toml");
    const requirement = pythonFile.content.match(/requires-python\s*=\s*["']([^"']+)/i)?.[1];
    prerequisites.push(requirement ? `Python ${requirement} (from ${pythonFile.path}).` : `Python (a ${pythonFile.path} manifest was retrieved).`);
    setupSteps.push({
      step: "Follow the installation command documented by the repository.",
      command: null,
      evidence: "A pyproject.toml was retrieved, but the package manager/build backend was not established from the available files."
    });
    testCommands.push({ command: null, note: "No verified test command was identified in the retrieved files." });
  } else if (fileByName(evidence.files, "Cargo.toml")) {
    prerequisites.push("Rust toolchain (Cargo.toml was retrieved).");
    setupSteps.push({ step: "Use Cargo to build the project after reviewing its README.", command: "cargo build", evidence: "Cargo.toml was retrieved." });
    testCommands.push({ command: "cargo test", note: "Standard Cargo test command; verify project-specific guidance in README/CONTRIBUTING." });
  } else if (fileByName(evidence.files, "go.mod")) {
    prerequisites.push("Go toolchain (go.mod was retrieved).");
    setupSteps.push({ step: "Download Go module dependencies.", command: "go mod download", evidence: "go.mod was retrieved." });
    testCommands.push({ command: "go test ./...", note: "Standard Go test command; verify project-specific guidance in README/CONTRIBUTING." });
  } else {
    setupSteps.push({
      step: "Review the repository README and use its documented setup instructions.",
      command: null,
      evidence: readme ? readme.path : "No README or supported package manifest was retrieved."
    });
    testCommands.push({ command: null, note: "No verified test command was identified from the retrieved evidence." });
  }

  const setupSection = markdownSection(readme?.content || "", [
    /getting started/i, /installation/i, /setup/i, /development/i, /prerequisites/i
  ]);
  const testSection = markdownSection(readme?.content || "", [
    /test/i, /testing/i, /quality/i
  ]);
  const contributionSection = markdownSection(contributing?.content || "", [
    /contribut/i, /pull request/i, /development/i, /workflow/i
  ]);

  return {
    success: true,
    data: {
      repository: evidence.repository,
      status: evidence.status,
      prerequisites: prerequisites.length
        ? prerequisites
        : ["No language runtime or toolchain requirement was verified in the retrieved files."],
      setupSteps,
      installCommands,
      testCommands,
      projectScripts: otherScripts,
      contributionWorkflow: contributing
        ? {
            source: contributing.path,
            instructions: contributionSection || contributing.content.slice(0, 3000)
          }
        : {
            source: null,
            instructions: "No CONTRIBUTING guide was retrieved. Check the repository README and open a discussion with maintainers before opening a pull request."
          },
      documentedSetup: setupSection || null,
      documentedTesting: testSection || null,
      evidence: evidence.files.map((file) => ({ path: file.path, url: file.url })),
      missingEvidence: evidence.missing,
      warnings: evidence.warnings
    }
  };
}

module.exports = { buildContributionGuide, markdownSection };
