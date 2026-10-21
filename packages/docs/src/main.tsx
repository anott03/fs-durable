import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Runtime } from "foldkit";
import { docsElement } from "./page.js";
import "./styles.css";

function Documentation() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (container.current === null) return;
    const handle = Runtime.embed(docsElement(container.current));
    return () => handle.dispose();
  }, []);

  return <div id="docs-content" ref={container} />;
}

function App() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12 font-mono text-sm leading-7 sm:py-20 sm:text-base">
      <header className="mb-12 flex items-center justify-between gap-6">
        <a href="/" className="font-semibold">fs-durable</a>
        <a href="https://github.com/anott03/fs-durable" className="underline">GitHub</a>
      </header>
      <Documentation />
      <footer className="mt-12 text-xs text-zinc-400">
        Built with <a href="https://foldkit.dev/" className="underline">Foldkit</a>, React, and Tailwind CSS.
      </footer>
    </div>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing documentation root");

createRoot(root).render(<StrictMode><App /></StrictMode>);
