"use strict";

const { InputError, normalizeRepository, parseIssueUrl } = require("../lib/github");

function readText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeChangedFiles(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 30);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 30);
  }
  return [];
}

function writePrDraft(input) {
  const problem = readText(input?.problem ?? input?.issueDescription, 10_000);
  const solution = readText(input?.solution ?? input?.changes, 10_000);
  if (!problem || !solution) {
    throw new InputError("Provide the problem and the solution or changes made.");
  }

  let issueReference = "";
  let issueUrl = "";
  if (input?.issueUrl) {
    const parsedIssue = parseIssueUrl(readText(input.issueUrl, 1000));
    if (!parsedIssue) {
      throw new InputError("Issue URL must be an https://github.com/owner/repo/issues/number URL.");
    }
    issueReference = `#${parsedIssue.number}`;
    issueUrl = parsedIssue.issueUrl;
  } else if (input?.issueNumber !== undefined && input?.issueNumber !== "") {
    const issueNumber = Number(input.issueNumber);
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
      throw new InputError("Issue number must be a positive integer.");
    }
    issueReference = `#${issueNumber}`;
    const repository = input.repository ? normalizeRepository(input.repository) : null;
    if (input.repository && !repository) {
      throw new InputError("Repository must be a GitHub owner/repository or public repository URL.");
    }
    if (repository) {
      issueUrl = `https://github.com/${repository.fullName}/issues/${issueNumber}`;
    }
  }

  const issueTitle = readText(input?.issueTitle ?? input?.title, 500);
  const explicitTitle = readText(input?.prTitle, 250);
  const title = (explicitTitle || (issueTitle ? `Fix: ${issueTitle}` : "Contribution update")).slice(0, 250);
  const changedFiles = normalizeChangedFiles(input?.changedFiles);
  const testsRun = readText(input?.testsRun ?? input?.tests, 3000);
  const risks = readText(input?.risks, 3000);
  const filesText = changedFiles.length
    ? changedFiles.map((file) => `- \`${file.replace(/[`]/g, "")}\``).join("\n")
    : "- Not provided.";
  const testingText = testsRun
    ? `Reported by the author (not independently verified):\n\n${testsRun}`
    : "Not provided. No test result is verified; add the checks you actually ran before submitting.";
  const relatedIssue = issueReference
    ? `Closes ${issueReference}${issueUrl ? ` ([issue](${issueUrl}))` : ""}`
    : "No issue reference provided.";

  const description = [
    "## Summary",
    problem,
    "",
    "## Changes",
    solution,
    "",
    "## Files changed",
    filesText,
    "",
    "## Testing",
    testingText,
    "",
    "## Risks and follow-up",
    risks || "No risks or follow-up notes provided.",
    "",
    "## Related issue",
    relatedIssue
  ].join("\n");

  return {
    success: true,
    data: {
      title,
      description,
      draftOnly: true,
      issueUrl: issueUrl || null,
      testingVerified: false,
      disclosure: "This is a local draft only. It is not submitted to GitHub."
    }
  };
}

module.exports = { writePrDraft, normalizeChangedFiles };
