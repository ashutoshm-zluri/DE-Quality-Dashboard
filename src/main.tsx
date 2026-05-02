import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import { EnvProvider } from "./api/env";
import { AuthProvider } from "./api/auth";
import { ToastProvider } from "./components/Toast";
import "./styles/index.css";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

if (!googleClientId) {
  // The login flow won't work without it. Render a clear message instead of
  // a silently-broken Google button.
  console.error(
    "VITE_GOOGLE_CLIENT_ID is not set. Add it to reRunSyncs/.env (same value as GOOGLE_CLIENT_ID)."
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId ?? ""}>
      <ToastProvider>
        <AuthProvider>
          <EnvProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </EnvProvider>
        </AuthProvider>
      </ToastProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
