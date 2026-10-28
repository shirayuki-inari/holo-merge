import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
const isAdmin = /^\/admin(?:\/(?:index\.html)?)?$/.test(
  window.location.pathname,
);
const App = lazy(() => (isAdmin ? import("./admin/Admin") : import("./App")));
import { I18nProvider } from "./i18n";
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </I18nProvider>
  </React.StrictMode>,
);
