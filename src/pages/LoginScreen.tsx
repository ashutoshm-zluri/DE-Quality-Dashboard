import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { Activity } from "lucide-react";
import { useAuth } from "../api/auth";

export default function LoginScreen() {
  const { login } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid h-full place-items-center bg-ink-50 px-4">
      <div className="card w-full max-w-md px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-ink-900 text-white">
          <Activity className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold text-ink-900">
          DE-Quality Portal
        </h1>
        <p className="mt-1 text-sm text-ink-500">Zluri Inc</p>

        <p className="mt-6 text-[13px] leading-relaxed text-ink-700">
          Sign in with your Google account to continue.
          <br />
          New accounts default to <span className="mono">viewer</span> — an
          admin can promote you in Settings → Team members.
        </p>

        <div className="mt-6 flex justify-center">
          <GoogleLogin
            onSuccess={async (resp) => {
              if (!resp.credential) {
                setErr("No credential returned by Google");
                return;
              }
              setBusy(true);
              setErr(null);
              try {
                await login(resp.credential);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Sign-in failed");
              } finally {
                setBusy(false);
              }
            }}
            onError={() => setErr("Google sign-in was cancelled or failed")}
            theme="outline"
            size="large"
            width="280"
          />
        </div>

        {busy && (
          <p className="mt-4 text-[12px] text-ink-500">Signing you in…</p>
        )}
        {err && (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}
