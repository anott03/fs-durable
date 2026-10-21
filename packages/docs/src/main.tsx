import { Runtime } from "foldkit";
import { docsElement } from "./page.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing documentation root");

const handle = Runtime.embed(docsElement(root));
if (import.meta.hot) import.meta.hot.dispose(() => handle.dispose());
