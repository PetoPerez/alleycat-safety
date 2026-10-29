import {createRoot} from "react-dom/client";
import "./style.css";
import {App} from "./App";

// No StrictMode: its double effects would POST the single-use magic link twice in dev.
createRoot(document.getElementById("root")!).render(<App />);
