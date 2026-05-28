import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/reset.css";
import "./styles/colors.css";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/typography.css";
import "./styles/components.css";
import App from "./App";
import { SessionProvider } from "./state/SessionContext";
import { CorpusProvider } from "./state/CorpusContext";
import { UIProvider } from "./state/UIContext";
import { DevLogProvider } from "./state/DevLogContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DevLogProvider>
      <UIProvider>
        <CorpusProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </CorpusProvider>
      </UIProvider>
    </DevLogProvider>
  </React.StrictMode>
);
