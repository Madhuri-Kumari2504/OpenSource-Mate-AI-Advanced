"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmOptions = process.platform === "win32" ? { shell: true } : {};
const children = [
  spawn(npmCommand, ["--prefix", path.join(root, "backend"), "run", "dev"], {
    cwd: root,
    stdio: "inherit",
    ...npmOptions
  }),
  spawn(npmCommand, ["--prefix", path.join(root, "frontend"), "run", "dev"], {
    cwd: root,
    stdio: "inherit",
    ...npmOptions
  })
];

let shuttingDown = false;
function stopAll(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
for (const child of children) {
  child.on("error", (error) => {
    console.error("Could not start a development process:", error.message);
    stopAll();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      if (code !== 0) process.exitCode = code || 1;
      stopAll();
    }
  });
}
