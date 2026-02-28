import { useEffect, useState } from "react";
import "./App.css";
import ActionPanel from "./components/ActionPanel.jsx";
import AnalysisPanel from "./components/AnalysisPanel.jsx";
import AuthPage from "./components/AuthPage.jsx";
import HeroSection from "./components/HeroSection.jsx";
import HistoryPage from "./components/HistoryPage.jsx";
import InvoiceInputPanel from "./components/InvoiceInputPanel.jsx";
import PreviewModal from "./components/PreviewModal.jsx";
import ProfileMenu from "./components/ProfileMenu.jsx";
import SavingsAnalysisPage from "./components/SavingsAnalysisPage.jsx";
import SiteFooter from "./components/SiteFooter.jsx";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  getValidIdToken,
  subscribeToAuthChanges,
} from "./services/authService.js";
import { useInvoiceHistory } from "./hooks/useInvoiceHistory.js";
import { useInvoiceScanner } from "./hooks/useInvoiceScanner.js";

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const history = useInvoiceHistory({ enabled: Boolean(session) });
  const loadHistory = history.loadHistory;
  const scanner = useInvoiceScanner({ onHistoryChanged: loadHistory });
  const [activeView, setActiveView] = useState("scan");
  const identityLabel = String(session?.displayName || "").trim() || session?.email || "Inloggad användare";

  function handleLogout() {
    clearStoredAuthSession();
    setSession(null);
    setActiveView("scan");
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrapAuth() {
      const stored = getStoredAuthSession();
      if (!stored) {
        if (mounted) {
          setSession(null);
          setAuthReady(true);
        }
        return;
      }

      const token = await getValidIdToken();
      if (!mounted) return;

      if (!token) {
        clearStoredAuthSession();
        setSession(null);
        setAuthReady(true);
        return;
      }

      setSession(getStoredAuthSession());
      setAuthReady(true);
    }

    void bootstrapAuth();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return subscribeToAuthChanges((nextSession) => {
      setSession(nextSession);
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    if (scanner.result) {
      void loadHistory();
    }
  }, [scanner.result, loadHistory, session]);

  if (!authReady) {
    return (
      <div className="page-shell">
        <main className="app-shell">
          <section className="panel auth-loading-panel">
            <p>Laddar inloggning...</p>
          </section>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="page-shell">
        <main className="app-shell">
          <HeroSection />
          <AuthPage
            onAuthenticated={(nextSession) => {
              setSession(nextSession);
            }}
          />
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="ambient-orb ambient-orb-left" />
      <div className="ambient-orb ambient-orb-right" />

      <main className="app-shell">
        <HeroSection />
        <div className="session-bar">
          <strong className="session-identity">{identityLabel}</strong>
          <div className="session-actions">
            <ProfileMenu session={session} onLogout={handleLogout} />
          </div>
        </div>

        <div className="view-switcher">
          <button
            className={`view-switcher-btn ${activeView === "scan" ? "view-switcher-btn-active" : ""}`}
            onClick={() => setActiveView("scan")}
          >
            Fakturaskanning
          </button>
          <button
            className={`view-switcher-btn ${activeView === "history" ? "view-switcher-btn-active" : ""}`}
            onClick={() => setActiveView("history")}
          >
            Historik
          </button>
          <button
            className={`view-switcher-btn ${activeView === "savings" ? "view-switcher-btn-active" : ""}`}
            onClick={() => setActiveView("savings")}
          >
            Sparanalys
          </button>
        </div>

        {activeView === "scan" && (
          <>
            <section className="panel-grid">
              <InvoiceInputPanel
                invoiceFile={scanner.invoiceFile}
                isDragging={scanner.isDragging}
                text={scanner.text}
                error={scanner.error}
                warning={scanner.warning}
                loading={scanner.loading}
                onTextChange={scanner.setText}
                onFileChange={scanner.onFileChange}
                onDragOver={scanner.onDragOver}
                onDragLeave={scanner.onDragLeave}
                onDrop={scanner.onDrop}
                onAnalyze={scanner.analyze}
                onClear={scanner.clearAll}
                onOpenPreview={scanner.openPreview}
              />

              <AnalysisPanel
                result={scanner.result}
                extracted={scanner.editedExtracted}
                fieldMeta={scanner.fieldMeta}
                onFieldChange={scanner.updateExtractedField}
              />
            </section>

            <ActionPanel
              email={scanner.email}
              emailTemplates={scanner.emailTemplates}
              selectedTemplateId={scanner.selectedTemplateId}
              onCopyEmail={scanner.copyEmail}
              onSelectTemplate={scanner.selectTemplate}
            />
          </>
        )}

        {activeView === "history" && <HistoryPage history={history} />}
        {activeView === "savings" && <SavingsAnalysisPage history={history} />}
      </main>

      <PreviewModal
        isOpen={scanner.previewModalOpen}
        invoiceFile={scanner.invoiceFile}
        onClose={scanner.closePreview}
      />

      <SiteFooter />
    </div>
  );
}
