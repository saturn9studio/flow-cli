#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = require(join(root, "package.json"));
const target = `${process.platform}-${process.arch}`;
const executableName = process.platform === "win32" ? "flow-cli.exe" : "flow-cli";
const executablePath = join(root, "dist", "standalone", executableName);
const releaseDir = join(root, "dist", "release");
const packageName = `flow-cli-v${packageJson.version}-${target}`;
const packageDir = join(root, "dist", "package", packageName);
const archiveName = `${packageName}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
const archivePath = join(releaseDir, archiveName);

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
};

await rm(join(root, "dist", "package"), { recursive: true, force: true });
await rm(releaseDir, { recursive: true, force: true });
await mkdir(packageDir, { recursive: true });
await mkdir(releaseDir, { recursive: true });

await copyFile(executablePath, join(packageDir, executableName));
await copyFile(join(root, "README.md"), join(packageDir, "README.md"));
await copyFile(join(root, "LICENSE"), join(packageDir, "LICENSE"));

if (process.platform === "win32") {
  run("powershell", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${packageDir}\\*' -DestinationPath '${archivePath}' -Force`,
  ]);
} else {
  run("tar", ["-czf", archivePath, "-C", packageDir, "."]);
}

const archive = await readFile(archivePath);
const sha256 = createHash("sha256").update(archive).digest("hex");
await writeFile(
  `${archivePath}.sha256`,
  `${sha256}  ${basename(archivePath)}\n`,
);

process.stdout.write(`${archivePath}\n`);
