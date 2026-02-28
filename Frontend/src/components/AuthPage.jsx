import { useState } from "react";
import {
  sendPasswordResetEmail,
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from "../services/authService.js";
import { toUserErrorMessage } from "../utils/errorText.js";

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const isLoginMode = mode === "login";

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setInfo("");

    if (!email.trim() || !password) {
      setError("Fyll i både e-post och lösenord.");
      return;
    }

    if (!isLoginMode && password !== confirmPassword) {
      setError("Lösenorden matchar inte.");
      return;
    }

    setLoading(true);
    try {
      const session = isLoginMode
        ? await signInWithEmailPassword(email, password)
        : await signUpWithEmailPassword(email, password);

      onAuthenticated?.(session);
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Inloggningen misslyckades. Försök igen."));
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordReset() {
    setError("");
    setInfo("");

    if (!email.trim()) {
      setError("Fyll i e-postadressen först, så skickar vi återställningslänk.");
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(email);
      setInfo("Återställningslänk skickad. Kontrollera din e-post.");
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte skicka återställningslänk."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="panel auth-panel">
        <div className="panel-header">
          <span className="step-badge">Säkerhet</span>
          <h2>{isLoginMode ? "Logga In" : "Skapa Konto"}</h2>
        </div>

        <p className="placeholder-text">
          Historiken kopplas till ditt konto så varje användare får sin egen data.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            E-post
            <input
              className="metric-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="namn@exempel.se"
            />
          </label>

          <label className="auth-field">
            Lösenord
            <input
              className="metric-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isLoginMode ? "current-password" : "new-password"}
              placeholder="Minst 6 tecken"
            />
          </label>

          {!isLoginMode && (
            <label className="auth-field">
              Bekräfta Lösenord
              <input
                className="metric-input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="Skriv lösenord igen"
              />
            </label>
          )}

          {error ? <p className="error-message">{error}</p> : null}
          {info ? <p className="placeholder-text">{info}</p> : null}

          {isLoginMode && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={handlePasswordReset}
            >
              Skicka lösenordsåterställning
            </button>
          )}

          <div className="button-row auth-button-row">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Vänta..." : isLoginMode ? "Logga in" : "Skapa konto"}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => {
                setMode(isLoginMode ? "signup" : "login");
                setError("");
                setInfo("");
              }}
            >
              {isLoginMode ? "Skapa konto istället" : "Jag har redan konto"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
