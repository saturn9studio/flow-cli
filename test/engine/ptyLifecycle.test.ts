import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("real pseudo-terminal lifecycle", () => {
  it.skipIf(process.platform === "win32")(
    "restores every negotiated terminal mode",
    () => {
      const viteNode = [
        "../../node_modules/.bin/vite-node",
        "../../../node_modules/.bin/vite-node",
      ]
        .map((relativePath) => fileURLToPath(new URL(relativePath, import.meta.url)))
        .find((candidate) => existsSync(candidate));
      if (!viteNode) return;
      const fixture = fileURLToPath(new URL("./fixtures/ptyHost.ts", import.meta.url));
      const runner = fileURLToPath(new URL("./fixtures/runInPty.py", import.meta.url));
      const result = spawnSync(
        "python3",
        [runner, viteNode, fixture],
        { encoding: "utf8", timeout: 10_000 },
      );
      if (result.error && "code" in result.error && result.error.code === "ENOENT") return;

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("\u001b[?1049h");
      expect(result.stdout).toContain("\u001b[>1u");
      expect(result.stdout).toContain("\u001b[<u");
      expect(result.stdout).toContain("\u001b[?1049l");
      expect(result.stdout).toContain("PTY_OK");
    },
  );
});
