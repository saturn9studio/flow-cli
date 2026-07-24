#!/usr/bin/env node

import { copyFile, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = join(root, "dist", "standalone");
const workDir = join(standaloneDir, "work");
const bundlePath = join(workDir, "flow-cli.cjs");
const seaConfigPath = join(workDir, "sea-config.json");
const blobPath = join(workDir, "flow-cli.blob");
const executableName = process.platform === "win32" ? "flow-cli.exe" : "flow-cli";
const executablePath = join(standaloneDir, executableName);
const postjectCli = require.resolve("postject/dist/cli.js");

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
};

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  throw new Error("Standalone packaging requires Node.js 22 or newer.");
}

await rm(standaloneDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

await build({
  entryPoints: [join(root, "src", "app", "cli.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
});

await writeFile(
  seaConfigPath,
  `${JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  }, null, 2)}\n`,
);

run(process.execPath, ["--experimental-sea-config", seaConfigPath]);
await copyFile(process.execPath, executablePath);

if (process.platform === "darwin") {
  run("codesign", ["--remove-signature", executablePath]);
}

const postjectArgs = [
  executablePath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
];

if (process.platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}

run(process.execPath, [postjectCli, ...postjectArgs]);

if (process.platform === "darwin") {
  run("codesign", ["--sign", "-", executablePath]);
}

if (process.platform !== "win32") {
  await chmod(executablePath, 0o755);
}

run(executablePath, ["--version"]);
