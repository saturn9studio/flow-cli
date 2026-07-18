import { describe, expect, it, vi } from "vitest";
import {
  boot,
  ImageController,
  terminalImageFromRgba,
  type MarkdownImageSpan,
  type TerminalImageData,
} from "../../src/markdown/index.js";

const imageSpan: MarkdownImageSpan = {
  from: 0,
  to: 18,
  alt: "cover",
  src: "cover.png",
};

const loadedImage = terminalImageFromRgba(
  1,
  1,
  Uint8Array.from([255, 0, 0, 255]),
);

const deferred = () => {
  let resolve!: (image: TerminalImageData | undefined) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<TerminalImageData | undefined>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("ImageController", () => {
  it("loads once, caches results, and publishes state", async () => {
    const pending = deferred();
    const loader = vi.fn(() => pending.promise);
    const controller = new ImageController(loader);
    const listener = vi.fn();
    controller.onUpdate(listener);

    expect(controller.resolve(imageSpan)).toBeUndefined();
    expect(controller.resolve(imageSpan)).toBeUndefined();
    expect(controller.getState(imageSpan.src)).toEqual({ status: "loading" });
    expect(loader).toHaveBeenCalledOnce();

    pending.resolve(loadedImage);
    await pending.promise;
    await Promise.resolve();
    expect(controller.resolve(imageSpan)).toBe(loadedImage);
    expect(listener).toHaveBeenCalledWith(imageSpan.src, {
      status: "loaded",
      image: loadedImage,
    });
  });

  it("distinguishes unavailable and failed images", async () => {
    const unavailable = new ImageController(() => undefined);
    unavailable.resolve(imageSpan);
    await Promise.resolve();
    await Promise.resolve();
    expect(unavailable.getState(imageSpan.src)).toEqual({
      status: "unavailable",
    });

    const error = new Error("decode failed");
    const failed = new ImageController(() => Promise.reject(error));
    failed.resolve(imageSpan);
    await Promise.resolve();
    await Promise.resolve();
    expect(failed.getState(imageSpan.src)).toEqual({
      status: "error",
      error,
    });
  });

  it("rejects stale results after invalidation", async () => {
    const first = deferred();
    const second = deferred();
    const controller = new ImageController(
      vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    );
    controller.resolve(imageSpan);
    await Promise.resolve();
    controller.invalidate(imageSpan.src);
    controller.resolve(imageSpan);
    await Promise.resolve();
    first.resolve(loadedImage);
    await first.promise;
    await Promise.resolve();
    expect(controller.getState(imageSpan.src)).toEqual({ status: "loading" });
    second.resolve(undefined);
    await second.promise;
    await Promise.resolve();
    expect(controller.getState(imageSpan.src)).toEqual({
      status: "unavailable",
    });
  });

  it("invalidates editor presentation when asynchronous data arrives", async () => {
    const pending = deferred();
    const controller = new ImageController(() => pending.promise);
    const onChange = vi.fn();
    const scribe = boot({
      content: "![cover](cover.png)",
      onChange,
      markdown: { imageWidgets: { controller } },
    });
    expect(scribe.editor.output().widgets[0]?.props).toMatchObject({
      status: "loading",
      alt: "cover",
      src: "cover.png",
    });
    pending.resolve(loadedImage);
    await pending.promise;
    await Promise.resolve();
    expect(onChange).toHaveBeenCalled();
    expect(scribe.editor.output().widgets).toHaveLength(1);
    expect(scribe.editor.output().widgets[0]?.props).toHaveProperty("image");
  });

  it("renders compact unavailable and failed fallbacks", async () => {
    const unavailable = new ImageController(() => undefined);
    const scribe = boot({
      content: "![cover](cover.png)",
      markdown: { imageWidgets: { controller: unavailable } },
    });
    scribe.editor.output();
    await Promise.resolve();
    const unavailableWidget = scribe.editor.output().widgets[0]!;
    expect(unavailableWidget.props).toMatchObject({ status: "unavailable" });
    expect(unavailableWidget.render.render({
      props: unavailableWidget.props,
      sourceText: "![cover](cover.png)",
      width: 18,
      readOnly: false,
      focused: false,
    }).lines).toEqual([[
      {
        text: "▣ cover · unavail…",
        style: {
          role: "markdownImage.unavailable",
          bold: false,
          dim: false,
        },
      },
    ]]);

    const failed = new ImageController(() => Promise.reject(new Error("bad")));
    const failedEditor = boot({
      content: "![cover](cover.png)",
      markdown: { imageWidgets: { controller: failed } },
    });
    failedEditor.editor.output();
    await Promise.resolve();
    await Promise.resolve();
    expect(failedEditor.editor.output().widgets[0]?.props).toMatchObject({
      status: "error",
    });
  });

  it("retries unavailable images from the fallback widget", async () => {
    const loader = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(loadedImage);
    const controller = new ImageController(loader);
    const scribe = boot({
      content: "![cover](cover.png)",
      markdown: { imageWidgets: { controller } },
    });
    scribe.editor.output();
    await Promise.resolve();
    await Promise.resolve();
    const widget = scribe.editor.output().widgets[0]!;

    expect(widget.render.handleInput?.({
      key: widget.key,
      props: widget.props,
      sourceText: "![cover](cover.png)",
      readOnly: false,
      focused: true,
      event: { kind: "key", key: "r" },
      dispatch: vi.fn(),
      replaceSelf: vi.fn(),
      deleteSelf: vi.fn(),
      focusEditor: vi.fn(),
    })).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(controller.getState(imageSpan.src)?.status).toBe("loaded");
  });
});
