import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";
import {
  boot,
  findMarkdownImages,
  renderTerminalImage,
  terminalImageFromRgba,
} from "../../src/markdown/index.js";
import { decodeTerminalImage } from "../../src/markdown/image-node.js";

const testImage = terminalImageFromRgba(
  2,
  2,
  Uint8Array.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]),
);

const setCaret = (
  editor: ReturnType<typeof boot>["editor"],
  offset: number,
): void => {
  editor.dispatch(
    editor.createTransaction().setSelection({
      anchor: { paragraph: 0, offset },
      head: { paragraph: 0, offset },
    }).build(),
  );
};

describe("terminal image approximation", () => {
  it("decodes and bounds encoded images with Jimp", async () => {
    const encoded = await new Jimp({
      width: 8,
      height: 4,
      color: 0xff0000ff,
    }).getBuffer("image/png");

    const decoded = await decodeTerminalImage(encoded, {
      maxPixelWidth: 4,
      maxPixelHeight: 4,
    });

    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(2);
    expect(decoded.rgba).toHaveLength(4 * 2 * 4);
  });

  it("renders semantic half-block runs without ANSI control strings", () => {
    const lines = renderTerminalImage(testImage, 2);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.map((run) => run.text).join("")).toBe("▀▀");
    expect(lines[0]?.[0]?.style).toEqual({
      foreground: { red: 255, green: 0, blue: 0 },
      background: { red: 0, green: 0, blue: 255 },
    });
    expect(JSON.stringify(lines)).not.toContain("\\u001b");
  });

  it("fills available width without distorting aspect ratio", () => {
    const image = terminalImageFromRgba(
      4,
      8,
      new Uint8Array(4 * 8 * 4).fill(255),
    );
    const fullWidth = renderTerminalImage(image, 10);
    expect(fullWidth).toHaveLength(10);
    expect(fullWidth.every((line) =>
      line.reduce((width, run) => width + [...run.text].length, 0) === 10
    )).toBe(true);

    const rowLimited = renderTerminalImage(image, 10, { maxRows: 3 });
    expect(rowLimited).toHaveLength(3);
    expect(rowLimited.every((line) =>
      line.reduce((width, run) => width + [...run.text].length, 0) === 3
    )).toBe(true);
  });

  it("supports a perceptual ANSI fallback with optional dithering", () => {
    const lines = renderTerminalImage(testImage, 2, {
      colorMode: "ansi16",
      sampling: "nearest",
      dithering: true,
    });
    expect(lines[0]?.[0]?.style?.foreground).toBe("red");
    expect(typeof lines[0]?.[0]?.style?.background).toBe("string");
  });

  it("composites partial alpha against a configurable background", () => {
    const translucent = terminalImageFromRgba(
      1,
      1,
      Uint8Array.from([255, 0, 0, 128]),
    );
    const lines = renderTerminalImage(translucent, 1, {
      background: { red: 0, green: 0, blue: 255 },
    });
    expect(lines[0]?.[0]).toEqual({
      text: "█",
      style: {
        foreground: { red: 128, green: 0, blue: 127 },
      },
    });
  });

  it("renders inactive Markdown images as inline widgets and reveals active source", () => {
    const content = "before ![gradient](demo.png) after";
    const flowEditor = boot({
      content,
      markdown: {
        imageWidgets: {
          resolve: ({ src }) => src === "demo.png" ? testImage : undefined,
          placement: "inline",
          maxColumns: 2,
        },
      },
    });
    setCaret(flowEditor.editor, content.length);

    expect(flowEditor.editor.output().widgets).toHaveLength(1);
    const rendered = flowEditor.editor.frame(80, 2).rows[0]?.cells
      .filter((cell) => !cell.continuation)
      .map((cell) => cell.text)
      .join("");
    expect(rendered).toBe("before ▀▀ after");
    expect(flowEditor.getContent()).toBe(content);

    setCaret(flowEditor.editor, content.indexOf("gradient"));
    expect(flowEditor.editor.output().widgets).toEqual([]);
    expect(flowEditor.editor.frame(80, 2).rows[0]?.cells
      .filter((cell) => !cell.continuation)
      .map((cell) => cell.text)
      .join(""),
    ).toBe(content);
  });

  it("renders block image widgets across bounded rows", () => {
    const image = terminalImageFromRgba(
      4,
      8,
      Uint8Array.from(Array.from({ length: 4 * 8 }, (_value, index) => [
        index * 7 % 256,
        index * 13 % 256,
        index * 19 % 256,
        255,
      ]).flat()),
    );
    const content = "![portrait](portrait.png)\nafter";
    const flowEditor = boot({
      content,
      markdown: {
        mode: "focus",
        imageWidgets: {
          resolve: () => image,
          maxColumns: 4,
          maxRows: 3,
        },
      },
    });
    flowEditor.editor.dispatch(
      flowEditor.editor.createTransaction().setSelection({
        anchor: { paragraph: 1, offset: 5 },
        head: { paragraph: 1, offset: 5 },
      }).build(),
    );

    const widget = flowEditor.editor.output().widgets[0];
    expect(widget?.placement).toBe("block");
    const inactive = widget?.render.render({
      props: widget.props,
      sourceText: "![portrait](portrait.png)",
      width: 20,
      readOnly: false,
      focused: false,
    });
    expect(inactive?.lines).toHaveLength(3);
    expect(inactive?.graphic).toBeDefined();
    expect(inactive?.lines.flatMap((line) => line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          style: expect.objectContaining({
            role: "focusInactive",
            dim: true,
          }),
        }),
      ]),
    );
    expect(inactive?.lines.flatMap((line) => line).every((run) => {
      if (typeof run === "string") return true;
      return [run.style?.foreground, run.style?.background].every((color) =>
        !color ||
        typeof color === "string" ||
        (color.red === color.green && color.green === color.blue)
      );
    })).toBe(true);
    expect(inactive?.graphic?.data[0]).toBe(inactive?.graphic?.data[1]);
    expect(inactive?.graphic?.data[1]).toBe(inactive?.graphic?.data[2]);
    expect(inactive?.graphic?.data[3]).toBe(128);
    expect(widget?.render.render({
      props: widget.props,
      sourceText: "![portrait](portrait.png)",
      width: 20,
      readOnly: false,
      focused: true,
    }).graphic).toBeDefined();
    expect(flowEditor.getContent()).toBe(content);
  });

  it("focuses block images during vertical navigation without entering source", () => {
    const content = "before\nInline image: ![cover](cover.png)\nafter";
    const flowEditor = boot({
      content,
      markdown: {
        imageWidgets: {
          resolve: () => testImage,
          maxColumns: 2,
        },
      },
    });
    flowEditor.editor.dispatch(
      flowEditor.editor.createTransaction().setSelection({
        anchor: { paragraph: 1, offset: "Inline image: ".length },
        head: { paragraph: 1, offset: "Inline image: ".length },
      }).build(),
    );

    expect(flowEditor.editor.handleInput({
      kind: "key",
      key: "ArrowDown",
    })).toBe(true);
    expect(flowEditor.editor.focusedWidgetKey).toBe(
      "scribecli.markdown:image-21",
    );
    expect(flowEditor.editor.handleInput({
      kind: "key",
      key: "ArrowDown",
    })).toBe(true);
    expect(flowEditor.editor.focusedWidgetKey).toBeNull();
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 2, offset: 0 },
      head: { paragraph: 2, offset: 0 },
    });
    expect(flowEditor.editor.handleInput({
      kind: "key",
      key: "ArrowUp",
    })).toBe(true);
    expect(flowEditor.editor.focusedWidgetKey).toBe(
      "scribecli.markdown:image-21",
    );
    expect(flowEditor.editor.handleInput({
      kind: "key",
      key: "ArrowUp",
    })).toBe(true);
    expect(flowEditor.editor.focusedWidgetKey).toBeNull();
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 1, offset: "Inline image: ".length },
      head: { paragraph: 1, offset: "Inline image: ".length },
    });
  });

  it("validates raw RGBA dimensions", () => {
    expect(() => terminalImageFromRgba(2, 2, new Uint8Array(3)))
      .toThrow("Expected 16 RGBA bytes");
    expect(() => terminalImageFromRgba(0, 2, new Uint8Array()))
      .toThrow("positive integers");
  });

  it("does not create image widgets for Markdown-looking fenced code", () => {
    const content = "```md\n![gradient](demo.png)\n```\noutside";
    const flowEditor = boot({
      content,
      blockWidgets: false,
      markdown: {
        imageWidgets: {
          resolve: () => testImage,
          placement: "inline",
        },
      },
    });
    flowEditor.editor.dispatch(
      flowEditor.editor.createTransaction().setSelection({
        anchor: { paragraph: 3, offset: 7 },
        head: { paragraph: 3, offset: 7 },
      }).build(),
    );

    expect(flowEditor.editor.output().widgets).toEqual([]);
  });

  it("supports image source handoff, deletion, and undo", () => {
    const content = "![cover](cover.png)\nafter";
    const flowEditor = boot({
      content,
      markdown: {
        imageWidgets: {
          resolve: () => testImage,
        },
      },
    });
    flowEditor.editor.dispatch(
      flowEditor.editor.createTransaction().setSelection({
        anchor: { paragraph: 1, offset: 5 },
        head: { paragraph: 1, offset: 5 },
      }).build(),
    );
    expect(flowEditor.editor.focusWidget("scribecli.markdown:image-0")).toBe(true);
    expect(flowEditor.editor.handleInput({
      kind: "key",
      key: "Enter",
    })).toBe(true);
    expect(flowEditor.editor.output().widgets).toEqual([]);
    expect(flowEditor.editor.snapshot().selection.head).toEqual({
      paragraph: 0,
      offset: "![cover](cover.png)".length,
    });
    flowEditor.editor.dispatch(
      flowEditor.editor.createTransaction().setSelection({
        anchor: { paragraph: 1, offset: 5 },
        head: { paragraph: 1, offset: 5 },
      }).build(),
    );
    expect(flowEditor.editor.focusWidget("scribecli.markdown:image-0")).toBe(true);
    expect(flowEditor.editor.handleInput({
      kind: "key",
      key: "Delete",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    })).toBe(true);
    expect(flowEditor.getContent()).toBe("\nafter");
    expect(flowEditor.editor.execute("editor.undo")).toBe(true);
    expect(flowEditor.getContent()).toBe(content);
  });

  it("keeps image widgets disabled in source mode", () => {
    const flowEditor = boot({
      content: "![cover](cover.png)",
      markdown: {
        mode: "source",
        imageWidgets: { resolve: () => testImage },
      },
    });
    expect(flowEditor.editor.output().widgets).toEqual([]);
    expect(flowEditor.editor.frame(80, 2).rows[0]?.cells
      .filter((cell) => !cell.continuation)
      .map((cell) => cell.text)
      .join("")).toBe("![cover](cover.png)");
  });

  it("supports reference images and balanced or bracketed destinations", () => {
    const content = [
      "![reference][cover]",
      "",
      "![nested](image(foo).png)",
      "",
      "![spaced](<path with spaces.png>)",
      "",
      "[cover]: cover.png \"Cover\"",
    ].join("\n");
    const resolved: string[] = [];
    const flowEditor = boot({
      content,
      markdown: {
        imageWidgets: {
          resolve: (image) => {
            resolved.push(image.src);
            return testImage;
          },
          placement: "inline",
        },
      },
    });
    flowEditor.editor.dispatch(
      flowEditor.editor.createTransaction().setSelection({
        anchor: { paragraph: 6, offset: 26 },
        head: { paragraph: 6, offset: 26 },
      }).build(),
    );
    expect(flowEditor.editor.output().widgets).toHaveLength(3);
    expect(findMarkdownImages(content).map(({ from, to }) => [from, to]))
      .toEqual([
        [
          content.indexOf("![reference]"),
          content.indexOf("![reference]") + "![reference][cover]".length,
        ],
        [
          content.indexOf("![nested]"),
          content.indexOf("![nested]") + "![nested](image(foo).png)".length,
        ],
        [
          content.indexOf("![spaced]"),
          content.indexOf("![spaced]") + "![spaced](<path with spaces.png>)".length,
        ],
      ]);
    expect(resolved).toEqual([
      "cover.png",
      "image(foo).png",
      "path with spaces.png",
    ]);
  });
});
