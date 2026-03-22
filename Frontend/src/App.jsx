import { useCallback, useEffect, useState } from "react";
import "./App.css";
import ActionPanel from "./components/ActionPanel.jsx";
import AnalysisPanel from "./components/AnalysisPanel.jsx";
import AuthPage from "./components/AuthPage.jsx";
import HeroSection from "./components/HeroSection.jsx";
import HistoryPage from "./components/HistoryPage.jsx";
import InvoiceInputPanel from "./components/InvoiceInputPanel.jsx";
import ImportInboxBadge from "./components/ImportInboxBadge.jsx";
import MailAutoImportHint from "./components/MailAutoImportHint.jsx";
import MailSyncQuickActions from "./components/MailSyncQuickActions.jsx";
import MailSyncResultsModal from "./components/MailSyncResultsModal.jsx";
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
  const [mailSetupRequest, setMailSetupRequest] = useState(0);
  const [mailStatusRefreshKey, setMailStatusRefreshKey] = useState(0);
  const [reviewToast, setReviewToast] = useState({ visible: false, count: 0 });
  const [actionToast, setActionToast] = useState(createEmptyActionToast);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [dismissedReviewCount, setDismissedReviewCount] = useState(0);
  const history = useInvoiceHistory({ enabled: Boolean(session) });
  const loadHistory = history.loadHistory;
  const scanner = useInvoiceScanner({ onHistoryChanged: loadHistory, historyItems: history.items });
  const [activeView, setActiveView] = useState("scan");
  const identityLabel =
    String(session?.displayName || "").trim() || session?.email || "Inloggad användare";

  function handleLogout() {
    clearStoredAuthSession();
    setSession(null);
    setActiveView("scan");
    setActionToast(createEmptyActionToast());
    setSyncDetailsOpen(false);
  }

  const handleOpenMailSetup = useCallback(() => {
    setMailSetupRequest((prev) => prev + 1);
  }, []);

  const handleMailStatusRefresh = useCallback(() => {
    setMailStatusRefreshKey((prev) => prev + 1);
  }, []);

  const handlePendingReviewChange = useCallback((count) => {
    const safeCount = Number(count || 0);
    if (safeCount <= 0) {
      setReviewToast((prev) => {
        if (!prev.visible && Number(prev.count || 0) === 0) {
          return prev;
        }
        return { visible: false, count: 0 };
      });
      setDismissedReviewCount((prev) => (prev === 0 ? prev : 0));
      return;
    }

    const message =
      safeCount === 1
        ? "1 mejl väntar på granskning innan det kan importeras."
        : `${safeCount} mejl väntar på granskning innan de kan importeras.`;

    setReviewToast({
      visible: safeCount !== dismissedReviewCount,
      count: safeCount,
      tone: "info",
      message,
    });
  }, [dismissedReviewCount]);

  const handleDismissReviewToast = useCallback(() => {
    setDismissedReviewCount((prev) => Math.max(prev, reviewToast.count || 0));
    setReviewToast((prev) => ({ ...prev, visible: false }));
  }, [reviewToast.count]);

  const handleMailSyncFeedback = useCallback((payload, tone = "success") => {
    const nextToast = normalizeActionToastPayload(payload, tone);
    if (!nextToast.message) return;

    setActionToast({
      visible: true,
      ...nextToast,
    });
    setSyncDetailsOpen(false);
  }, []);

  const handleDismissActionToast = useCallback(() => {
    setActionToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleOpenSyncDetails = useCallback(() => {
    setActionToast((prev) => ({ ...prev, visible: false }));
    setSyncDetailsOpen(true);
  }, []);

  const handleCloseSyncDetails = useCallback(() => {
    setSyncDetailsOpen(false);
  }, []);

  const handleQueueBlockedSyncItem = useCallback((messageId, payload = {}) => {
    setActionToast((prev) => {
      const currentItems = Array.isArray(prev.items) ? prev.items : [];
      const currentStats = prev.stats && typeof prev.stats === "object" ? prev.stats : {};
      const targetItem = currentItems.find((item) => String(item?.id || "") === String(messageId || ""));
      const nextItems = currentItems.map((item) => {
        if (String(item?.id || "") !== String(messageId || "")) {
          return item;
        }

        return {
          ...item,
          outcome: "review",
          outcomeReason: String(payload.message || "Meddelandet skickades till manuell granskning."),
          canQueueForReview: false,
          selectedType: String(payload?.item?.selectedType || item?.selectedType || "").trim().toLowerCase(),
          classification:
            payload?.item?.classification && typeof payload.item.classification === "object"
              ? payload.item.classification
              : item?.classification,
          attachmentCandidates: Array.isArray(payload?.item?.attachmentCandidates)
            ? payload.item.attachmentCandidates
            : item?.attachmentCandidates,
        };
      });

      const nextStats = { ...currentStats };
      if (String(targetItem?.outcome || "") === "blocked") {
        nextStats.blocked = Math.max(0, Number(nextStats.blocked || 0) - 1);
        nextStats.queuedForReview = Number(nextStats.queuedForReview || 0) + 1;
      }

      return {
        ...prev,
        stats: nextStats,
        items: nextItems,
        message: buildSyncSummaryToastMessage(nextStats),
      };
    });

    handlePendingReviewChange(Number(payload.pendingReviewCount || 0));
    handleMailStatusRefresh();
  }, [handleMailStatusRefresh, handlePendingReviewChange]);

  useEffect(() => {
    if (!actionToast.visible || syncDetailsOpen) return undefined;

    const timerId = window.setTimeout(() => {
      setActionToast((prev) => ({ ...prev, visible: false }));
    }, 4800);

    return () => window.clearTimeout(timerId);
  }, [actionToast.message, actionToast.tone, actionToast.visible, syncDetailsOpen]);

  function openQueueResult(itemId) {
    const opened = scanner.onShowQueueItemResult(itemId);
    if (!opened) return;

    requestAnimationFrame(() => {
      const target = document.getElementById("analysis-result-panel");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
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
          <div className="session-main">
            <strong className="session-identity">{identityLabel}</strong>
            <ImportInboxBadge />
            <MailSyncQuickActions
              onOpenSetup={handleOpenMailSetup}
              onPendingReviewChange={handlePendingReviewChange}
              onSyncFeedback={handleMailSyncFeedback}
              refreshKey={mailStatusRefreshKey}
            />
          </div>
          <div className="session-actions">
            <ProfileMenu
              session={session}
              onLogout={handleLogout}
              openMailSetupRequest={mailSetupRequest}
              onMailConnectionsUpdated={handleMailStatusRefresh}
              onMailSyncFeedback={handleMailSyncFeedback}
              mailStatusRefreshKey={mailStatusRefreshKey}
            />
          </div>
        </div>

        <MailAutoImportHint onOpenSetup={handleOpenMailSetup} />

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
                queueItems={scanner.queueItems}
                queueProgress={scanner.queueProgress}
                analyzableQueueCount={scanner.analyzableQueueCount}
                analyzedFileSummaries={scanner.analyzedFileSummaries}
                isQueueBatchComplete={scanner.isQueueBatchComplete}
                selectedQueueItemId={scanner.selectedQueueItemId}
                activeQueueItemId={scanner.activeQueueItemId}
                maxQueueFiles={scanner.maxQueueFiles}
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
                onSelectQueueItem={scanner.onSelectQueueItem}
                onShowQueueItemResult={openQueueResult}
                onRemoveQueueItem={scanner.onRemoveQueueItem}
                onAnalyze={scanner.analyze}
                onAnalyzeSelected={scanner.analyzeSelected}
                onClear={scanner.clearAll}
                onOpenPreview={scanner.openPreview}
                duplicateCandidateCount={scanner.duplicateCandidateCount}
                onAddDuplicateCandidates={scanner.addDuplicateItemsAnyway}
              />

              <AnalysisPanel
                panelId="analysis-result-panel"
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

      <MailSyncResultsModal
        open={syncDetailsOpen}
        onClose={handleCloseSyncDetails}
        syncResult={actionToast}
        onQueueBlockedItem={handleQueueBlockedSyncItem}
      />

      {actionToast.visible || reviewToast.visible ? (
        <div className="mail-toast-stack" aria-live="polite">
          {actionToast.visible ? (
            <aside
              className={`mail-review-toast mail-review-toast-${actionToast.tone || "info"}`}
              role="status"
            >
              {Array.isArray(actionToast.items) && actionToast.items.length > 0 ? (
                <button type="button" className="mail-review-toast-trigger" onClick={handleOpenSyncDetails}>
                  <div className="mail-review-toast-copy">
                    <strong>{actionToast.tone === "error" ? "Mejlstatus" : "Mejlsynk"}</strong>
                    <p>{actionToast.message}</p>
                    <span className="mail-review-toast-hint">Klicka för att visa detaljer</span>
                  </div>
                </button>
              ) : (
                <div className="mail-review-toast-copy">
                  <strong>{actionToast.tone === "error" ? "Mejlstatus" : "Mejlsynk"}</strong>
                  <p>{actionToast.message}</p>
                </div>
              )}
              <div className="mail-review-toast-actions">
                {Array.isArray(actionToast.items) && actionToast.items.length > 0 ? (
                  <button type="button" className="btn btn-secondary" onClick={handleOpenSyncDetails}>
                    Visa detaljer
                  </button>
                ) : null}
                <button type="button" className="mail-review-toast-close" onClick={handleDismissActionToast}>
                  Stäng
                </button>
              </div>
            </aside>
          ) : null}

          {reviewToast.visible ? (
            <aside
              className={`mail-review-toast mail-review-toast-${reviewToast.tone || "info"}`}
              role="status"
            >
              <div className="mail-review-toast-copy">
                <strong>Granskningskö</strong>
                <p>{reviewToast.message}</p>
              </div>
              <div className="mail-review-toast-actions">
                {reviewToast.count > 0 ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      handleOpenMailSetup();
                      handleDismissReviewToast();
                    }}
                  >
                    Öppna granskning
                  </button>
                ) : null}
                <button type="button" className="mail-review-toast-close" onClick={handleDismissReviewToast}>
                  Stäng
                </button>
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}

      <SiteFooter />
    </div>
  );
}

function createEmptyActionToast() {
  return {
    visible: false,
    tone: "success",
    message: "",
    provider: "",
    stats: {},
    items: [],
  };
}

function normalizeActionToastPayload(payload, fallbackTone) {
  if (typeof payload === "string") {
    return {
      tone: fallbackTone,
      message: payload,
      provider: "",
      stats: {},
      items: [],
    };
  }

  const source = payload && typeof payload === "object" ? payload : {};

  return {
    tone: String(source.tone || fallbackTone || "success").trim().toLowerCase() || "success",
    message: String(source.message || "").trim(),
    provider: String(source.provider || "").trim().toLowerCase(),
    stats: source.stats && typeof source.stats === "object" ? source.stats : {},
    items: Array.isArray(source.items) ? source.items : [],
  };
}

function buildSyncSummaryToastMessage(stats) {
  const safeStats = stats && typeof stats === "object" ? stats : {};
  const parts = [`${Number(safeStats.scanned || 0)} meddelanden skannades`];

  if (Number(safeStats.importedMessages || 0) > 0) {
    parts.push(`${Number(safeStats.importedMessages || 0)} autoimporterades`);
  }
  if (Number(safeStats.queuedForReview || 0) > 0) {
    parts.push(`${Number(safeStats.queuedForReview || 0)} skickades till granskning`);
  }
  if (Number(safeStats.blocked || 0) > 0) {
    parts.push(`${Number(safeStats.blocked || 0)} blockerades`);
  }
  if (Number(safeStats.errors || 0) > 0) {
    parts.push(`${Number(safeStats.errors || 0)} gav fel`);
  }

  return `Synk klar: ${parts.join(", ")}.`;
}
