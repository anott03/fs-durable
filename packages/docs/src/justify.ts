import { lineText, prepare, solve } from "@kitlangton/justice";

/** Enhance the static Foldkit prose once it mounts; native wrapping is the fallback. */
export function justifyProse(container: HTMLElement) {
  let disposed = false;
  let resize: ResizeObserver | undefined;
  let frame = 0;
  const originals = new Map<HTMLParagraphElement, string>();
  const measurements = new Map<HTMLParagraphElement, { font: string; prepared: ReturnType<typeof prepare>; width: number }>();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  const mount = () => {
    const main = container.querySelector("main");
    if (!main || !context || disposed) return;
    mutation.disconnect();
    for (const paragraph of main.querySelectorAll<HTMLParagraphElement>(":scope > p")) {
      originals.set(paragraph, paragraph.textContent ?? "");
    }

    const render = () => {
      const selection = window.getSelection();
      const saveEndpoint = (node: Node | null, offset: number) => {
        if (!node) return;
        for (const paragraph of originals.keys()) {
          if (!paragraph.contains(node)) continue;
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          range.setEnd(node, offset);
          return { paragraph, offset: range.toString().length };
        }
      };
      const anchor = saveEndpoint(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0);
      const focus = saveEndpoint(selection?.focusNode ?? null, selection?.focusOffset ?? 0);
      for (const [paragraph, text] of originals) {
        const style = getComputedStyle(paragraph);
        const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.font = font;
        context.fontKerning = "none";
        const width = paragraph.getBoundingClientRect().width;
        if (width <= 0) continue;
        const cached = measurements.get(paragraph);
        if (cached?.font === font && cached.width === width) continue;
        const prepared = cached?.font === font
          ? cached.prepared
          : prepare(text, (word) => context.measureText(word).width);
        measurements.set(paragraph, { font, prepared, width });
        const layout = solve(prepared, width);
        if (layout.lines.length === 0) {
          paragraph.textContent = text;
          continue;
        }
        const lines = layout.lines.map((line, index) => {
          const span = document.createElement("span");
          span.className = "justice-line";
          span.textContent = lineText(prepared, line);
          span.style.wordSpacing = `${line.wordSpacing}px`;
          span.style.letterSpacing = `${line.tracking}px`;
          span.style.marginLeft = `${-line.opening}px`;
          return index < layout.lines.length - 1 ? [span, document.createTextNode(" ")] : [span];
        });
        paragraph.replaceChildren(...lines.flat());
      }
      if (selection && anchor && focus) {
        const resolveEndpoint = (endpoint: typeof anchor): [Node, number] => {
          const walker = document.createTreeWalker(endpoint.paragraph, NodeFilter.SHOW_TEXT);
          let remaining = endpoint.offset;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const length = node.textContent?.length ?? 0;
            if (remaining <= length) return [node, remaining];
            remaining -= length;
          }
          return [endpoint.paragraph, endpoint.paragraph.childNodes.length];
        };
        selection.setBaseAndExtent(...resolveEndpoint(anchor), ...resolveEndpoint(focus));
      }
    };

    resize = new ResizeObserver(render);
    resize.observe(main);
    void document.fonts.ready.then(() => {
      if (!disposed) render();
    });
  };

  const scheduleMount = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(mount);
  };
  const mutation = new MutationObserver(scheduleMount);
  mutation.observe(container, { childList: true, subtree: true });
  scheduleMount();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    mutation.disconnect();
    resize?.disconnect();
    for (const [paragraph, text] of originals) paragraph.textContent = text;
  };
}
