import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteCurrentAccount,
  sendPasswordResetEmail,
  updateAccountPassword,
  updateAccountProfile,
} from "../services/authService.js";
import { apiFetch } from "../utils/apiClient.js";
import { toUserErrorMessage } from "../utils/errorText.js";

export default function ProfileMenu({ session, onLogout }) {
  const wrapRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const avatarLabel = useMemo(() => {
    const source = String(session?.displayName || session?.email || "U");
    return source.charAt(0).toUpperCase();
  }, [session?.displayName, session?.email]);

  useEffect(() => {
    if (!profileOpen) return;
    setDisplayName(String(session?.displayName || ""));
    setEmail(String(session?.email || ""));
    setNewPassword("");
    setConfirmPassword("");
    setDeleteConfirmText("");
    setError("");
    setInfo("");
  }, [profileOpen, session?.displayName, session?.email]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setProfileOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;

    function handlePointerDown(event) {
      const root = wrapRef.current;
      if (!root) return;
      if (root.contains(event.target)) return;
      setMenuOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("touchstart", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("touchstart", handlePointerDown);
    };
  }, [menuOpen]);

  async function handleSaveProfile() {
    setError("");
    setInfo("");

    if (!email.trim()) {
      setError("E-post kan inte vara tom.");
      return;
    }

    setLoading(true);
    try {
      await updateAccountProfile({
        displayName,
        email,
      });
      setInfo("Profilen är uppdaterad.");
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte uppdatera profilen."));
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword() {
    setError("");
    setInfo("");

    if (!newPassword || !confirmPassword) {
      setError("Fyll i och bekräfta nytt lösenord.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Lösenorden matchar inte.");
      return;
    }

    setLoading(true);
    try {
      await updateAccountPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setInfo("Lösenordet är uppdaterat.");
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte uppdatera lösenordet."));
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordReset() {
    setError("");
    setInfo("");

    const resetEmail = String(email || session?.email || "").trim();
    if (!resetEmail) {
      setError("Saknar e-postadress för återställning.");
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(resetEmail);
      setInfo("Återställningsmail skickat.");
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte skicka återställningsmail."));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount() {
    setError("");
    setInfo("");

    if (deleteConfirmText.trim().toUpperCase() !== "RADERA") {
      setError("Skriv RADERA för att bekräfta.");
      return;
    }

    setLoading(true);
    try {
      const purgeResponse = await apiFetch("/api/account/purge", {
        method: "POST",
      });
      const purgeJson = await purgeResponse.json();
      if (!purgeResponse.ok || !purgeJson.ok) {
        throw new Error(purgeJson.error || "Kunde inte radera kontodata just nu.");
      }

      await deleteCurrentAccount();
      onLogout?.();
    } catch (caughtError) {
      setError(toUserErrorMessage(caughtError, "Kunde inte radera kontot just nu."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="profile-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className="profile-icon-button"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Profil"
        >
          <span className="profile-avatar">{avatarLabel}</span>
        </button>

        {menuOpen && (
          <div className="profile-popover" role="menu">
            <button
              type="button"
              className="profile-popover-item"
              onClick={() => {
                setMenuOpen(false);
                setProfileOpen(true);
              }}
            >
              Profilinställningar
            </button>
            <button
              type="button"
              className="profile-popover-item profile-popover-item-danger"
              onClick={() => {
                setMenuOpen(false);
                onLogout?.();
              }}
            >
              Logga ut
            </button>
          </div>
        )}
      </div>

      {profileOpen && (
        <div className="profile-modal" role="dialog" aria-modal="true" onClick={() => !loading && setProfileOpen(false)}>
          <article className="profile-modal-card" onClick={(event) => event.stopPropagation()}>
            <header className="profile-modal-header">
              <div>
                <h3>Profil</h3>
                <p>Hantera konto, säkerhet och radering av konto.</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => setProfileOpen(false)}
              >
                Stäng
              </button>
            </header>

            <div className="profile-modal-body">
              <section className="profile-section">
                <h4>Kontouppgifter</h4>
                <div className="profile-grid">
                  <label className="auth-field">
                    Visningsnamn
                    <input
                      className="metric-input"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Ditt namn"
                    />
                  </label>
                  <label className="auth-field">
                    E-post
                    <input
                      className="metric-input"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="namn@exempel.se"
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button type="button" className="btn btn-primary" disabled={loading} onClick={handleSaveProfile}>
                    {loading ? "Sparar..." : "Spara profil"}
                  </button>
                </div>
              </section>

              <section className="profile-section">
                <h4>Lösenord</h4>
                <div className="profile-grid">
                  <label className="auth-field">
                    Nytt lösenord
                    <input
                      className="metric-input"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="auth-field">
                    Bekräfta nytt lösenord
                    <input
                      className="metric-input"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={loading}
                    onClick={handlePasswordReset}
                  >
                    Skicka återställningsmail
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={loading}
                    onClick={handleChangePassword}
                  >
                    {loading ? "Uppdaterar..." : "Byt lösenord"}
                  </button>
                </div>
              </section>

              <section className="profile-section profile-danger-zone">
                <h4>Farlig zon</h4>
                <p>
                  Raderar konto och all historik kopplad till användaren. Åtgärden kan inte ångras.
                </p>
                <label className="auth-field">
                  Skriv <strong>RADERA</strong> för att bekräfta
                  <input
                    className="metric-input"
                    value={deleteConfirmText}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                    placeholder="RADERA"
                  />
                </label>
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={loading}
                    onClick={handleDeleteAccount}
                  >
                    {loading ? "Raderar..." : "Ta bort konto"}
                  </button>
                </div>
              </section>

              {error ? <p className="error-message">{error}</p> : null}
              {info ? <p className="placeholder-text">{info}</p> : null}
            </div>
          </article>
        </div>
      )}
    </>
  );
}
