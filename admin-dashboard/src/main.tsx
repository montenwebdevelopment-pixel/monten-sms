import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AdminRoot } from "../../src/admin/AdminRoot";
import "../../src/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdminRoot />
    </BrowserRouter>
  </React.StrictMode>,
);
