import { describe, expect, it } from "vitest";
import {
  editorChromeGeometry,
  editorVerticalGeometry,
} from "../../src/app/chrome.js";

describe("FlowCLI editor chrome", () => {
  it("reserves an 82-column surface around an 80-column body", () => {
    const geometry = editorChromeGeometry(101);

    expect(geometry.contentWidth).toBe(80);
    expect(geometry.leftPadding).toBe(1);
    expect(geometry.rightPadding).toBe(1);
    expect(geometry.leftMargin + 82 + geometry.rightMargin).toBe(100);
  });

  it("degrades padding without shrinking content in constrained terminals", () => {
    const widths = Array.from(
      { length: 100 },
      (_value, index) => editorChromeGeometry(index + 1).contentWidth,
    );
    const heights = Array.from(
      { length: 20 },
      (_value, index) => editorVerticalGeometry(index + 1).contentHeight,
    );

    expect(widths).toEqual([...widths].sort((left, right) => left - right));
    expect(heights).toEqual([...heights].sort((left, right) => left - right));
  });
});
