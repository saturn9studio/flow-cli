import type { TerminalImageData } from "./image.js";
import type { MarkdownImageSpan } from "./presentation/spans.js";

export type ImageLoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly image: TerminalImageData }
  | { readonly status: "unavailable" }
  | { readonly status: "error"; readonly error: unknown };

export type ImageLoader = (
  image: MarkdownImageSpan,
) => TerminalImageData | undefined | Promise<TerminalImageData | undefined>;

export class ImageController {
  private readonly states = new Map<string, ImageLoadState>();
  private readonly requests = new Map<string, number>();
  private readonly listeners = new Set<(src: string, state: ImageLoadState | undefined) => void>();
  private nextRequest = 0;
  private disposed = false;

  constructor(private readonly loader: ImageLoader) {}

  resolve(image: MarkdownImageSpan): TerminalImageData | undefined {
    const state = this.states.get(image.src);
    if (!state) this.start(image);
    return state?.status === "loaded" ? state.image : undefined;
  }

  getState(src: string): ImageLoadState | undefined {
    return this.states.get(src);
  }

  retry(image: MarkdownImageSpan): void {
    if (this.disposed) return;
    this.invalidate(image.src);
    this.start(image);
  }

  invalidate(src?: string): void {
    if (this.disposed) return;
    if (src === undefined) {
      const sources = [...this.states.keys()];
      this.states.clear();
      sources.forEach((source) => {
        this.requests.set(source, ++this.nextRequest);
        this.emit(source, undefined);
      });
      return;
    }
    this.states.delete(src);
    this.requests.set(src, ++this.nextRequest);
    this.emit(src, undefined);
  }

  onUpdate(
    listener: (src: string, state: ImageLoadState | undefined) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.states.clear();
    this.requests.clear();
    this.listeners.clear();
  }

  private start(image: MarkdownImageSpan): void {
    if (this.disposed) return;
    const request = ++this.nextRequest;
    this.requests.set(image.src, request);
    this.states.set(image.src, { status: "loading" });
    let result: ReturnType<ImageLoader>;
    try {
      result = this.loader(image);
    } catch (error: unknown) {
      const state: ImageLoadState = { status: "error", error };
      this.states.set(image.src, state);
      this.emit(image.src, state);
      return;
    }
    void Promise.resolve(result).then(
        (loaded) => {
          if (this.disposed || this.requests.get(image.src) !== request) return;
          const state: ImageLoadState = loaded
            ? { status: "loaded", image: loaded }
            : { status: "unavailable" };
          this.states.set(image.src, state);
          this.emit(image.src, state);
        },
        (error: unknown) => {
          if (this.disposed || this.requests.get(image.src) !== request) return;
          const state: ImageLoadState = { status: "error", error };
          this.states.set(image.src, state);
          this.emit(image.src, state);
        },
      );
  }

  private emit(src: string, state: ImageLoadState | undefined): void {
    this.listeners.forEach((listener) => listener(src, state));
  }
}
