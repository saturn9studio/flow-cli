import { describe, expect, it } from "vitest";
import { parseArguments } from "../../src/app/args.js";

describe("FlowCLI arguments", () => {
  it("opens zero or one document", () => {
    expect(parseArguments([])).toEqual({ action: "edit" });
    expect(parseArguments(["draft.md"])).toEqual({
      action: "edit",
      path: "draft.md",
    });
  });

  it("supports help and version without a document", () => {
    expect(parseArguments(["--help"]).action).toBe("help");
    expect(parseArguments(["-v"]).action).toBe("version");
  });

  it("rejects unknown options and multiple documents", () => {
    expect(() => parseArguments(["--wat"])).toThrow("Unknown option");
    expect(() => parseArguments(["one.md", "two.md"])).toThrow(
      "one document at a time",
    );
  });
});
