import { useEffect, useRef, type ReactNode } from "react";
import { justifyProse } from "./justify.js";

type DocsPage = "docs" | "benchmarks";

export function DocsLayout({ page, children }: { readonly page: DocsPage; readonly children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current === null) return;
    return justifyProse(container.current);
  }, []);

  return (
    <div ref={container} className="w-full overflow-x-clip font-mono text-sm leading-7 sm:text-base">
      <div className="mx-auto flex min-h-dvh w-full flex-col after:pointer-events-none after:fixed after:hidden md:after:block after:inset-y-0 after:left-1/2 after:z-20 after:w-full after:-translate-x-1/2 after:border-x after:border-zinc-700 md:max-w-4xl md:after:w-[calc(var(--container-4xl)+2px)]">
        <header className="sticky top-0 z-10 flex w-full md:top-8 justify-between border-b border-zinc-700 bg-zinc-950 md:mt-8 md:before:absolute md:before:-inset-x-[100vw] md:before:bottom-full md:before:h-8 md:before:border-b md:before:border-zinc-700 md:before:bg-zinc-950">
          <a href="/" className="bg-yellow-300 px-3 text-zinc-950 duration-200 hover:bg-yellow-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current">fs-durable</a>
          <nav aria-label="Main navigation" className="flex text-xs sm:text-sm">
            <a href="/" aria-current={page === "docs" ? "page" : undefined} className="flex items-center px-2 hover:bg-zinc-800 aria-[current=page]:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current sm:px-3">Docs</a>
            <a href="/benchmarks" aria-current={page === "benchmarks" ? "page" : undefined} className="flex items-center px-2 hover:bg-zinc-800 aria-[current=page]:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current sm:px-3">Benchmarks</a>
            <a href="https://github.com/anott03/fs-durable" className="flex items-center gap-1.5 bg-blue-500 px-2 text-white duration-200 hover:bg-blue-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current sm:px-3">
              GitHub
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
            </a>
          </nav>
        </header>
        <div className="flex-1">{children}</div>
        <div aria-hidden="true" className="sticky bottom-0 z-10 hidden h-8 md:block md:before:absolute md:before:-inset-x-[100vw] md:before:inset-y-0 md:before:border-t md:before:border-zinc-700 md:before:bg-zinc-950" />
      </div>
    </div>
  );
}
