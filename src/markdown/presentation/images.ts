import {
  absoluteOffset,
  normalizeRange,
  positionFromOffset,
  type EditorDocument,
  type Selection,
  type WidgetDecoration,
  type WidgetPlacement,
  type WidgetRenderer,
} from "../../engine/index.js";
import {
  terminalImageWidgetRenderer,
  type TerminalImageData,
  type TerminalImageWidgetProps,
} from "../image.js";
import type {
  ImageController,
  ImageLoadState,
} from "../image-controller.js";
import {
  findMarkdownImages,
  type MarkdownImageSpan,
} from "./spans.js";

export { findMarkdownImages, type MarkdownImageSpan } from "./spans.js";

export interface MarkdownImageWidgetOptions {
  readonly resolve?: (image: MarkdownImageSpan) => TerminalImageData | undefined;
  readonly controller?: ImageController;
  readonly placement?: WidgetPlacement;
  readonly maxColumns?: number;
  readonly maxRows?: number;
  readonly revealSourceOnSelection?: boolean;
  readonly fallback?: false | WidgetRenderer<MarkdownImageFallbackProps>;
  /** Custom inline renderers must return at most one line. */
  readonly renderer?: WidgetRenderer<TerminalImageWidgetProps>;
}

export interface MarkdownImageFallbackProps {
  readonly status: Exclude<ImageLoadState["status"], "loaded">;
  readonly alt: string;
  readonly src: string;
  readonly retry?: () => void;
}

export interface MarkdownImageExcludedRange {
  readonly from: number;
  readonly to: number;
}

const interactiveImageRenderer = <TProps>(
  renderer: WidgetRenderer<TProps>,
): WidgetRenderer<TProps> => ({
  render: (context) => renderer.render(context),
  handleInput(context) {
    if (renderer.handleInput?.(context)) return true;
    if (context.event.kind !== "key") return false;
    if (context.event.key === "Enter" || context.event.key === "Escape") {
      context.focusEditor();
      return true;
    }
    if (context.event.key === "Delete" || context.event.key === "Backspace") {
      return context.deleteSelf();
    }
    return false;
  },
});

const crop = (text: string, width: number): string => {
  const characters = [...text];
  if (characters.length <= width) return text;
  return width <= 1 ? "…" : `${characters.slice(0, width - 1).join("")}…`;
};

export const markdownImageFallbackRenderer:
WidgetRenderer<MarkdownImageFallbackProps> = {
  render({ props, width, focused }) {
    const label = props.alt || props.src || "image";
    const state = props.status === "loading"
      ? "loading"
      : props.status === "error"
        ? "failed"
        : "unavailable";
    const hint = focused
      ? `${props.retry && props.status !== "loading" ? " · R: retry" : ""} · Enter: source`
      : "";
    return {
      lines: [[{
        text: crop(`▣ ${label} · ${state}${hint}`, width),
        style: {
          role: `markdownImage.${props.status}`,
          bold: focused,
          dim: props.status === "loading",
        },
      }]],
    };
  },
};

const interactiveImageFallbackRenderer = (
  fallback: WidgetRenderer<MarkdownImageFallbackProps>,
): WidgetRenderer<MarkdownImageFallbackProps> => {
  const renderer = interactiveImageRenderer(fallback);
  return {
    render: renderer.render,
    handleInput(context) {
      if (
        context.event.kind === "key" &&
        context.event.key.toLowerCase() === "r" &&
        context.props.retry
      ) {
        context.props.retry();
        return true;
      }
      return renderer.handleInput?.(context) ?? false;
    },
  };
};

const selectionTouches = (
  doc: EditorDocument,
  selection: Selection,
  image: MarkdownImageSpan,
): boolean => {
  const range = normalizeRange(selection);
  const from = absoluteOffset(doc, range.from);
  const to = absoluteOffset(doc, range.to);
  // Widget focus anchors the caret at the range start; keep that boundary
  // interactive while revealing source once the caret moves into the range.
  if (from === to) return image.from < from && from <= image.to;
  return from <= image.to && to >= image.from;
};

export const createMarkdownImageWidgets = (
  doc: EditorDocument,
  selection: Selection,
  content: string,
  options: MarkdownImageWidgetOptions,
  excludedRanges: readonly MarkdownImageExcludedRange[] = [],
): readonly WidgetDecoration[] => {
  const placement = options.placement ?? "block";
  return findMarkdownImages(content).flatMap(
    (image): readonly WidgetDecoration[] => {
    if (excludedRanges.some((range) => image.from < range.to && image.to > range.from)) {
      return [];
    }
    if (
      options.revealSourceOnSelection !== false &&
      selectionTouches(doc, selection, image)
    ) {
      return [];
    }
    const terminalImage =
      options.controller?.resolve(image) ?? options.resolve?.(image);
    if (!terminalImage) {
      if (options.fallback === false) return [];
      const state = options.controller?.getState(image.src);
      const status = state?.status === "loaded"
        ? "unavailable"
        : state?.status ?? "unavailable";
      return [{
        key: `scribecli.markdown:image-${image.from}`,
        placement: "inline",
        range: {
          from: positionFromOffset(doc, image.from),
          to: positionFromOffset(doc, image.to),
        },
        props: {
          status,
          alt: image.alt,
          src: image.src,
          retry: options.controller
            ? () => options.controller?.retry(image)
            : undefined,
        },
        render: interactiveImageFallbackRenderer(
          typeof options.fallback === "object"
            ? options.fallback
            : markdownImageFallbackRenderer,
        ),
        selection: "atom",
      }];
    }
    return [{
      key: `scribecli.markdown:image-${image.from}`,
      placement,
      range: {
        from: positionFromOffset(doc, image.from),
        to: positionFromOffset(doc, image.to),
      },
      props: {
        image: terminalImage,
        alt: image.alt,
        src: image.src,
        maxColumns: options.maxColumns,
        maxRows: placement === "inline" ? 1 : options.maxRows,
      },
      render: interactiveImageRenderer(
        options.renderer ?? terminalImageWidgetRenderer,
      ),
      selection: placement === "inline" ? "atom" : "block",
      focusable: placement === "block",
    }];
    },
  );
};
