import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, CalendarDays, Users, ShieldCheck } from "lucide-react";
import { useAuth } from "./authContext";
import api from "./api";
import ForgotPassword from "./ForgotPassword";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function messageFor(error, fallback) {
  if (!error.response) {
    return "Cannot reach the server. Check that GST Office is running and try again.";
  }
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

export default function Login() {
  const { login, loginWithToken } = useAuth();
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleHint, setGoogleHint] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const poll = useRef(null);

  useEffect(() => {
    const notice = sessionStorage.getItem("gst_notice");
    if (notice) {
      setFlash(notice);
      sessionStorage.removeItem("gst_notice");
    }
    api.get("/api/auth/google/status")
      .then((res) => setGoogleConfigured(Boolean(res.data.configured)))
      .catch(() => setGoogleConfigured(false));
    return () => clearInterval(poll.current);
  }, []);

  if (forgot) return <ForgotPassword onBack={() => setForgot(false)} />;

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(messageFor(err, "Incorrect email or password."));
    } finally {
      setBusy(false);
    }
  }

  async function startGoogle() {
    setError("");
    setGoogleHint("");
    setGoogleUrl("");
    setGoogleBusy(true);
    try {
      const res = await api.post("/api/auth/google/start");
      const { state, url } = res.data;
      setGoogleUrl(url);
      setGoogleHint("Finish signing in in your browser, then come back here.");
      clearInterval(poll.current);
      let checks = 0;
      poll.current = setInterval(async () => {
        checks += 1;
        if (checks > 200) {
          clearInterval(poll.current);
          setGoogleBusy(false);
          setGoogleHint("");
          setError("Google sign-in timed out. Please try again.");
          return;
        }
        try {
          const result = await api.get("/api/auth/google/result", { params: { state } });
          if (result.data.status === "ok") {
            clearInterval(poll.current);
            loginWithToken(result.data.token, result.data.user);
          } else if (result.data.status === "error") {
            clearInterval(poll.current);
            setGoogleBusy(false);
            setGoogleHint("");
            setError(result.data.message || "Google sign-in failed.");
          }
        } catch (err) {
          if (err.response?.status === 404) {
            clearInterval(poll.current);
            setGoogleBusy(false);
            setGoogleHint("");
            setError("The sign-in request expired. Please try again.");
          }
        }
      }, 1500);
    } catch (err) {
      setGoogleBusy(false);
      setError(messageFor(err, "Could not start Google sign-in."));
    }
  }

  return (
    <div className="login-page">
      <aside className="login-side">
        <div className="brand">
          <div className="brand-icon">G</div>
          <div><strong>GST Office</strong><small>Client management</small></div>
        </div>
        <div>
          <h2>Every client and every GST deadline in one place.</h2>
          <ul>
            <li><Users size={18} /> Client and auditor records</li>
            <li><CalendarDays size={18} /> Filing status and due dates</li>
            <li><ShieldCheck size={18} /> Secure, role-based access</li>
          </ul>
        </div>
        <p className="login-foot">Works offline. Backs up to your Google Drive.</p>
      </aside>

      <main className="login-main">
        <form className="login-card" onSubmit={submit}>
          <div className="login-brand">
            <div className="brand-icon">G</div>
            <div><strong>GST Office</strong><small>Client management</small></div>
          </div>
          <h1>Sign in</h1>
          <p>Welcome back. Choose how you want to sign in.</p>

          {error && <div className="login-error" role="alert">{error}</div>}
          {flash && <div className="login-info" role="status">{flash}</div>}

          <button
            type="button"
            className="google-btn"
            onClick={startGoogle}
            disabled={!googleConfigured || busy || googleBusy}
          >
            <GoogleIcon />
            {googleBusy ? "Waiting for Google..." : "Continue with Google"}
          </button>

          {!googleConfigured && (
            <p className="google-hint">
              Google sign-in is not configured. Add your Google credentials to the
              app's <code>.env</code> file and restart.
            </p>
          )}
          {googleBusy && googleHint && (
            <p className="google-hint">
              {googleHint}{" "}
              {googleUrl && (
                <a href={googleUrl} target="_blank" rel="noreferrer">Open it manually</a>
              )}
            </p>
          )}

          <div className="login-divider"><span>or sign in with email</span></div>

          <label>
            Email
            <input type="email" required autoFocus autoComplete="username"
                   value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          <label>
            Password
            <div className="password-field">
              <input type={show ? "text" : "password"} required
                     autoComplete="current-password"
                     value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="eye-btn" onClick={() => setShow(!show)}
                      title={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <p className="login-forgot">
            <a href="#/" onClick={(e) => { e.preventDefault(); setForgot(true); }}>
              Forgot password?
            </a>
          </p>

          <button type="submit" className="primary-btn login-submit"
                  disabled={busy || googleBusy}>
            {busy ? "Please wait..." : "Sign in"}
          </button>

          <p className="login-note">
            New accounts are created by an administrator.
          </p>
        </form>
      </main>
    </div>
  );
}
