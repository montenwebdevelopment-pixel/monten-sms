import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
