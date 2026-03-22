import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseInitError, getFirestoreDb } from "./firebaseAdminService.js";
import { validateInboundAttachments, sanitizeInboundFilename } from "./mailgunInboundService.js";
import { processInboundAttachments } from "./mailgunInboundInvoiceService.js";
import { getMailConnectionAccessContext } from "./mailOAuthService.js";

const DEFAULT_REVIEW_COLLECTION = "mail_import_reviews";
const DEFAULT_CONNECTION_COLLECTION = "mail_oauth_connections";
const DEFAULT_SYNC_MAX_MESSAGES = 20;
const DEFAULT_REVIEW_LIMIT = 20;
const DEFAULT_LOOKBACK_DAYS = 21;
const AUTO_IMPORT_THRESHOLD = 9;
const REVIEW_THRESHOLD = 5;
const AUTO_IMPORT_SCORE_MARGIN = 3;
const MAX_IMPORTED_MESSAGE_IDS = 200;

const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const TYPE_RULES = {
  invoices: {
    label: "Faktura",
    strongText: [
      /\bfaktura\b/i,
      /\bfakturanummer\b/i,
      /\binvoice\b/i,
      /\binvoice number\b/i,
      /\bocr\b/i,
      /forfallodatum/i,
      /förfallodatum/i,
      /\bdue date\b/i,
      /\bbankgiro\b/i,
      /\bplusgiro\b/i,
      /\bbelopp att betala\b/i,
    ],
    mediumText: [
      /\bbilling\b/i,
      /\bpayment due\b/i,
      /\bkundnummer\b/i,
      /\bcustomer number\b/i,
      /\be-faktura\b/i,
      /\befaktura\b/i,
      /\bautogiro\b/i,
      /\bbetalningsuppgifter\b/i,
    ],
    attachmentText: [/\bfaktura\b/i, /\binvoice\b/i, /\bbilling\b/i, /\bstatement\b/i, /\bocr\b/i],
    senderText: [/\bfaktura\b/i, /\binvoice\b/i, /\bbilling\b/i, /\bfinance\b/i],
  },
  receipts: {
    label: "Kvitto",
    strongText: [
      /\bkvitto\b/i,
      /\breceipt\b/i,
      /\borderkvitto\b/i,
      /\bpurchase receipt\b/i,
      /\bpayment receipt\b/i,
    ],
    mediumText: [
      /\btack for ditt kop\b/i,
      /\btack for ditt köp\b/i,
      /\bpayment received\b/i,
      /\bpaid\b/i,
      /\bbetalning mottagen\b/i,
    ],
    attachmentText: [/\bkvitto\b/i, /\breceipt\b/i, /\borderkvitto\b/i],
    senderText: [/\breceipt\b/i, /\bkvitto\b/i, /\borders\b/i],
  },
  confirmations: {
    label: "Bekraftelse",
    strongText: [
      /\borderbekraftelse\b/i,
      /\borderbekr[aä]ftelse\b/i,
      /\border confirmation\b/i,
      /\bbooking confirmation\b/i,
      /\bbokningsbekraftelse\b/i,
      /\bbokningsbekr[aä]ftelse\b/i,
      /\breservation confirmation\b/i,
    ],
    mediumText: [/\byour order\b/i, /\bdin bestallning\b/i, /\bdin beställning\b/i],
    attachmentText: [/\bconfirmation\b/i, /\bbekraftelse\b/i, /\bbekr[aä]ftelse\b/i],
    senderText: [/\bbooking\b/i, /\border\b/i, /\bconfirmation\b/i],
  },
};

const NEGATIVE_TEXT_PATTERNS = [
  /\bnyhetsbrev\b/i,
  /\bnewsletter\b/i,
  /\berbjudande\b/i,
  /\boffer\b/i,
  /\bkampanj\b/i,
  /\bpromotion\b/i,
  /\btracking\b/i,
  /\bleverans\b/i,
  /\bshipped\b/i,
  /\bpassword\b/i,
  /\bsecurity alert\b/i,
  /\bverify your email\b/i,
  /\b2fa\b/i,
  /\botp\b/i,
];

const INLINE_ATTACHMENT_PATTERNS = [
  /\blogo\b/i,
  /\bicon\b/i,
  /\bbanner\b/i,
  /\bheader\b/i,
  /\bfooter\b/i,
  /\bsignature\b/i,
  /\bfacebook\b/i,
  /\binstagram\b/i,
  /\blinkedin\b/i,
  /\btwitter\b/i,
  /\bthumb\b/i,
];

export async function runMailImportSync({ userId, provider, maxMessages }) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailimport ar inte tillganglig eftersom Firestore saknar konfiguration.",
    };
  }

  const safeProvider = String(provider || "").trim().toLowerCase();
  if (safeProvider !== "gmail") {
    return {
      ok: false,
      statusCode: 501,
      reason: "Strikt mailimport ar just nu endast aktiverad for Gmail.",
    };
  }

  const access = await getMailConnectionAccessContext({ userId, provider: safeProvider });
  if (!access.ok) {
    return access;
  }

  const safeMaxMessages = clampNumber(
    maxMessages,
    1,
    clampNumber(process.env.MAIL_IMPORT_SYNC_MAX_MESSAGES, 1, 50, DEFAULT_SYNC_MAX_MESSAGES),
    DEFAULT_SYNC_MAX_MESSAGES
  );
  const importTypes = normalizeImportTypes(access.importTypes);
  const cursorMs = resolveSyncCursorMs(access.connectionData);
  const query = buildGmailSearchQuery({
    importTypes,
    cursorMs,
  });

  let listJson = null;
  try {
    listJson = await gmailApiRequestJson({
      accessToken: access.accessToken,
      path: `/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${safeMaxMessages}`,
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: 502,
      reason: toErrorMessage(error, "Kunde inte lasa meddelanden fran Gmail."),
    };
  }

  const messageRefs = Array.isArray(listJson?.messages) ? listJson.messages : [];
  const stats = {
    scanned: 0,
    importedMessages: 0,
    importedAttachments: 0,
    queuedForReview: 0,
    blocked: 0,
    errors: 0,
  };
  const items = [];

  let importedMessageIds = normalizeImportedMessageIds(access.connectionData?.sync?.importedMessageIds);
  let maxSeenInternalDateMs = resolveSyncCursorMs(access.connectionData);

  for (const messageRef of messageRefs) {
    const result = await processMessageRef({
      access,
      db,
      userId,
      provider: safeProvider,
      importTypes,
      messageRef,
      importedMessageIds,
      cursorMs,
    });

    if (!result) continue;
    stats.scanned += result.scanned;
    stats.importedMessages += result.importedMessages;
    stats.importedAttachments += result.importedAttachments;
    stats.queuedForReview += result.queuedForReview;
    stats.blocked += result.blocked;
    stats.errors += result.errors;
    if (result.detail) {
      items.push(result.detail);
    }
    if (result.importedMessageId) {
      importedMessageIds = normalizeImportedMessageIds([...importedMessageIds, result.importedMessageId]);
    }
    maxSeenInternalDateMs = Math.max(maxSeenInternalDateMs, clampNumber(result.internalDateMs, 0, Number.MAX_SAFE_INTEGER, 0));
  }

  const pendingReviewCount = await countPendingReviews({
    db,
    userId,
    provider: safeProvider,
  });

  await access.connectionRef.set(
    {
      sync: {
        ...(access.connectionData?.sync || {}),
        autoImportEnabled: false,
        mode: "manual_review",
        importTypes,
        lastSyncAt: FieldValue.serverTimestamp(),
        lastSyncStatus: stats.errors > 0 ? "warning" : "ok",
        lastSyncMessage: buildSyncSummaryMessage(stats),
        lastSyncStats: stats,
        pendingReviewCount,
        importedMessageIds: importedMessageIds.slice(-MAX_IMPORTED_MESSAGE_IDS),
        lastCursorInternalDateMs: maxSeenInternalDateMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    ok: true,
    provider: safeProvider,
    stats,
    pendingReviewCount,
    importTypes,
    items,
    message: buildSyncSummaryMessage(stats),
  };
}

export async function listMailImportReviews({ userId, provider, limit }) {
  return listPendingReviewsInternal({ userId, provider, limit });
}

export async function approveMailImportReview({ userId, provider, reviewId }) {
  return resolveReviewAction({
    userId,
    provider,
    reviewId,
    action: "approve",
  });
}

export async function rejectMailImportReview({ userId, provider, reviewId }) {
  return resolveReviewAction({
    userId,
    provider,
    reviewId,
    action: "reject",
  });
}

export async function queueBlockedMailImportReview({ userId, provider, messageId }) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailimport är inte tillgänglig eftersom Firestore saknar konfiguration.",
    };
  }

  const safeUserId = String(userId || "").trim();
  const safeProvider = String(provider || "").trim().toLowerCase();
  const safeMessageId = String(messageId || "").trim();
  if (!safeUserId || !safeProvider || !safeMessageId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Ogiltig begäran för manuell granskning.",
    };
  }

  if (safeProvider !== "gmail") {
    return {
      ok: false,
      statusCode: 501,
      reason: "Manuell granskning från blockerad synk stöds just nu bara för Gmail.",
    };
  }

  const access = await getMailConnectionAccessContext({ userId: safeUserId, provider: safeProvider });
  if (!access.ok) {
    return access;
  }

  const reviewRef = getReviewCollectionRef(db).doc(buildReviewDocId(safeUserId, safeProvider, safeMessageId));
  const existingReview = await reviewRef.get();
  if (existingReview.exists) {
    const status = String(existingReview.data()?.status || "").trim().toLowerCase();
    if (status === "pending_review") {
      const pendingReviewCount = await countPendingReviews({
        db,
        userId: safeUserId,
        provider: safeProvider,
      });

      return {
        ok: true,
        action: "queued",
        alreadyQueued: true,
        message: "Meddelandet ligger redan i granskningskön.",
        item: normalizeReviewItem(existingReview),
        pendingReviewCount,
      };
    }

    if (status === "imported" || status === "rejected") {
      return {
        ok: false,
        statusCode: 409,
        reason: resolveExistingReviewOutcomeReason(status),
      };
    }
  }

  let message = null;
  try {
    message = await fetchGmailMessage(access.accessToken, safeMessageId);
  } catch (error) {
    return {
      ok: false,
      statusCode: 502,
      reason: toErrorMessage(error, "Kunde inte hämta Gmail-meddelandet för manuell granskning."),
    };
  }

  const messageSummary = summarizeGmailMessage(message);
  const decision = classifyGmailMessage({
    message: messageSummary,
    importTypes: normalizeImportTypes(access.importTypes),
  });

  if (!canQueueBlockedDecisionForManualReview(decision)) {
    return {
      ok: false,
      statusCode: 409,
      reason: resolveManualReviewOverrideDeniedReason(decision),
    };
  }

  await storePendingReview({
    reviewRef,
    userId: safeUserId,
    provider: safeProvider,
    access,
    messageSummary,
    decision,
    manualOverride: true,
  });

  const pendingReviewCount = await updatePendingReviewCount({
    db,
    userId: safeUserId,
    provider: safeProvider,
    connectionRef: access.connectionRef,
  });

  return {
    ok: true,
    action: "queued",
    alreadyQueued: false,
    message: "Meddelandet skickades till manuell granskning.",
    item: normalizeReviewItem({
      id: reviewRef.id,
      ...buildPendingReviewData({
        userId: safeUserId,
        provider: safeProvider,
        access,
        messageSummary,
        decision,
        manualOverride: true,
      }),
    }),
    pendingReviewCount,
  };
}

async function processMessageRef({
  access,
  db,
  userId,
  provider,
  importTypes,
  messageRef,
  importedMessageIds,
  cursorMs,
}) {
  const messageId = String(messageRef?.id || "").trim();
  if (!messageId) return null;
  if (importedMessageIds.includes(messageId)) return null;

  let message = null;
  try {
    message = await fetchGmailMessage(access.accessToken, messageId);
  } catch {
    return {
      scanned: 1,
      importedMessages: 0,
      importedAttachments: 0,
      queuedForReview: 0,
      blocked: 0,
      errors: 1,
      importedMessageId: "",
      internalDateMs: 0,
      detail: buildSyncDetailItem({
        provider,
        messageId,
        outcome: "error",
        outcomeReason: "Kunde inte läsa meddelandet från Gmail.",
      }),
    };
  }

  const messageSummary = summarizeGmailMessage(message);
  const safeCursorMs = clampNumber(cursorMs, 0, Number.MAX_SAFE_INTEGER, 0);
  if (safeCursorMs > 0 && messageSummary.internalDateMs > 0 && messageSummary.internalDateMs <= safeCursorMs) {
    return {
      scanned: 1,
      importedMessages: 0,
      importedAttachments: 0,
      queuedForReview: 0,
      blocked: 1,
      errors: 0,
      importedMessageId: "",
      internalDateMs: messageSummary.internalDateMs,
      detail: buildSyncDetailItem({
        provider,
        messageId,
        messageSummary,
        outcome: "blocked",
        outcomeReason: "Meddelandet var äldre än den senaste synkgränsen och hoppades över.",
      }),
    };
  }

  const reviewRef = getReviewCollectionRef(db).doc(buildReviewDocId(userId, provider, messageId));
  const existingReview = await reviewRef.get();
  if (existingReview.exists) {
    const status = String(existingReview.data()?.status || "").trim().toLowerCase();
    if (status === "pending_review" || status === "imported" || status === "rejected") {
      return {
        scanned: 1,
        importedMessages: 0,
        importedAttachments: 0,
        queuedForReview: 0,
        blocked: 1,
        errors: 0,
        importedMessageId: "",
        internalDateMs: messageSummary.internalDateMs,
        detail: buildSyncDetailItem({
          provider,
          messageId,
          messageSummary,
          outcome: "blocked",
          outcomeReason: resolveExistingReviewOutcomeReason(status),
        }),
      };
    }
  }

  const decision = classifyGmailMessage({
    message: messageSummary,
    importTypes,
  });

  if (decision.decision === "blocked") {
    return {
      scanned: 1,
      importedMessages: 0,
      importedAttachments: 0,
      queuedForReview: 0,
      blocked: 1,
      errors: 0,
      importedMessageId: "",
      internalDateMs: messageSummary.internalDateMs,
      detail: buildSyncDetailItem({
        provider,
        messageId,
        messageSummary,
        decision,
        outcome: "blocked",
        outcomeReason: resolveBlockedDecisionOutcomeReason(decision),
      }),
    };
  }

  if (decision.decision === "direct_import") {
    const imported = await importMessageAttachments({
      access,
      message: messageSummary,
      selectedType: decision.selectedType,
    });

    if (!imported.ok) {
      return {
        scanned: 1,
        importedMessages: 0,
        importedAttachments: 0,
        queuedForReview: 0,
        blocked: 0,
        errors: 1,
        importedMessageId: "",
        internalDateMs: messageSummary.internalDateMs,
        detail: buildSyncDetailItem({
          provider,
          messageId,
          messageSummary,
          decision,
          outcome: "error",
          outcomeReason: imported.reason || "Bilagorna kunde inte importeras efter skanning.",
        }),
      };
    }

    await reviewRef.set(
      {
        uid: String(userId || "").trim(),
        provider,
        accountEmail: String(access.accountEmail || "").trim(),
        messageId,
        threadId: messageSummary.threadId,
        status: "imported",
        selectedType: decision.selectedType,
        classification: decision.classification,
        from: messageSummary.from,
        subject: messageSummary.subject,
        snippet: messageSummary.snippet,
        internalDateMs: messageSummary.internalDateMs,
        attachmentCandidates: simplifyReviewAttachments(messageSummary.attachmentCandidates),
        importResult: {
          acceptedCount: clampNumber(imported.acceptedCount, 0, 100, 0),
          duplicateCount: clampNumber(imported.duplicateCount, 0, 100, 0),
          errorCount: clampNumber(imported.errorCount, 0, 100, 0),
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        importedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      scanned: 1,
      importedMessages: 1,
      importedAttachments: clampNumber(imported.acceptedCount, 0, 100, 0),
      queuedForReview: 0,
      blocked: 0,
      errors: 0,
      importedMessageId: messageId,
      internalDateMs: messageSummary.internalDateMs,
      detail: buildSyncDetailItem({
        provider,
        messageId,
        messageSummary,
        decision,
        outcome: "imported",
        outcomeReason: buildImportedOutcomeReason(imported),
        importResult: imported,
      }),
    };
  }

  await storePendingReview({
    reviewRef,
    userId,
    provider,
    access,
    messageSummary,
    decision,
  });

  return {
    scanned: 1,
    importedMessages: 0,
    importedAttachments: 0,
    queuedForReview: 1,
    blocked: 0,
    errors: 0,
    importedMessageId: "",
    internalDateMs: messageSummary.internalDateMs,
    detail: buildSyncDetailItem({
      provider,
      messageId,
      messageSummary,
      decision,
      outcome: "review",
      outcomeReason: "Meddelandet skickades till manuell granskning innan import.",
    }),
  };
}

function buildSyncDetailItem({
  provider,
  messageId,
  messageSummary = null,
  decision = null,
  outcome,
  outcomeReason = "",
  importResult = null,
}) {
  const summary = messageSummary && typeof messageSummary === "object" ? messageSummary : {};
  const internalDateMs = clampNumber(summary.internalDateMs, 0, Number.MAX_SAFE_INTEGER, 0);

  return {
    id: String(messageId || summary.id || "").trim(),
    provider: String(provider || "").trim().toLowerCase(),
    outcome: normalizeSyncOutcome(outcome),
    outcomeReason: String(outcomeReason || "").trim(),
    canQueueForReview: canQueueBlockedDecisionForManualReview(decision),
    from: String(summary.from || "").trim(),
    subject: String(summary.subject || "").trim(),
    snippet: String(summary.snippet || "").trim(),
    textPreview: String(summary.textPreview || "").trim(),
    internalDateMs,
    receivedAtIso: internalDateMs > 0 ? new Date(internalDateMs).toISOString() : "",
    attachmentCandidates: simplifyReviewAttachments(summary.attachmentCandidates),
    classification: normalizeClassificationSummary(decision?.classification),
    selectedType: String(
      decision?.selectedType || decision?.classification?.selectedType || ""
    )
      .trim()
      .toLowerCase(),
    importResult: normalizeImportResult(importResult),
  };
}

async function storePendingReview({
  reviewRef,
  userId,
  provider,
  access,
  messageSummary,
  decision,
  manualOverride = false,
}) {
  await reviewRef.set(
    {
      ...buildPendingReviewData({
        userId,
        provider,
        access,
        messageSummary,
        decision,
        manualOverride,
      }),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function buildPendingReviewData({
  userId,
  provider,
  access,
  messageSummary,
  decision,
  manualOverride = false,
}) {
  return {
    uid: String(userId || "").trim(),
    provider: String(provider || "").trim().toLowerCase(),
    accountEmail: String(access?.accountEmail || "").trim(),
    messageId: String(messageSummary?.id || "").trim(),
    threadId: String(messageSummary?.threadId || "").trim(),
    status: "pending_review",
    selectedType: String(decision?.selectedType || "").trim().toLowerCase(),
    classification: decision?.classification || {},
    from: String(messageSummary?.from || "").trim(),
    subject: String(messageSummary?.subject || "").trim(),
    snippet: String(messageSummary?.snippet || "").trim(),
    textPreview: String(messageSummary?.textPreview || "").trim(),
    internalDateMs: clampNumber(messageSummary?.internalDateMs, 0, Number.MAX_SAFE_INTEGER, 0),
    attachmentCandidates: simplifyReviewAttachments(messageSummary?.attachmentCandidates),
    queueSource: manualOverride ? "manual_override" : "automatic_review",
  };
}

async function listPendingReviewsInternal({ userId, provider, limit }) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailimport ar inte tillganglig eftersom Firestore saknar konfiguration.",
      items: [],
    };
  }

  const safeUserId = String(userId || "").trim();
  const safeProvider = String(provider || "").trim().toLowerCase();
  if (!safeUserId || !safeProvider) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Uid eller provider saknas for granskningskon.",
      items: [],
    };
  }

  const safeLimit = clampNumber(limit, 1, 50, DEFAULT_REVIEW_LIMIT);
  const collection = getReviewCollectionRef(db);
  let docs = [];

  try {
    const snapshot = await collection
      .where("uid", "==", safeUserId)
      .where("provider", "==", safeProvider)
      .where("status", "==", "pending_review")
      .limit(safeLimit)
      .get();
    docs = snapshot.docs;
  } catch {
    const snapshot = await collection.where("uid", "==", safeUserId).limit(safeLimit * 3).get();
    docs = snapshot.docs.filter((doc) => {
      const data = doc.data() || {};
      return (
        String(data.provider || "").trim().toLowerCase() === safeProvider &&
        String(data.status || "").trim().toLowerCase() === "pending_review"
      );
    });
  }

  const items = docs
    .map((doc) => normalizeReviewItem(doc))
    .sort((a, b) => (b.internalDateMs || 0) - (a.internalDateMs || 0))
    .slice(0, safeLimit);

  return {
    ok: true,
    items,
  };
}

async function resolveReviewAction({ userId, provider, reviewId, action }) {
  const db = getFirestoreDb();
  if (!db) {
    return {
      ok: false,
      statusCode: 503,
      reason:
        getFirebaseInitError() ||
        "Mailimport ar inte tillganglig eftersom Firestore saknar konfiguration.",
    };
  }

  const safeUserId = String(userId || "").trim();
  const safeProvider = String(provider || "").trim().toLowerCase();
  const safeReviewId = String(reviewId || "").trim();
  if (!safeUserId || !safeProvider || !safeReviewId) {
    return {
      ok: false,
      statusCode: 400,
      reason: "Ogiltig granskningsbegaran.",
    };
  }

  const reviewRef = getReviewCollectionRef(db).doc(safeReviewId);
  const snapshot = await reviewRef.get();
  if (!snapshot.exists) {
    return {
      ok: false,
      statusCode: 404,
      reason: "Granskningsposten hittades inte.",
    };
  }

  const data = snapshot.data() || {};
  if (
    String(data.uid || "").trim() !== safeUserId ||
    String(data.provider || "").trim().toLowerCase() !== safeProvider
  ) {
    return {
      ok: false,
      statusCode: 403,
      reason: "Du saknar behörighet till den här granskningsposten.",
    };
  }

  const currentStatus = String(data.status || "").trim().toLowerCase();
  if (currentStatus !== "pending_review") {
    return {
      ok: false,
      statusCode: 400,
      reason: "Granskningsposten ar inte langre aktiv.",
    };
  }

  if (action === "reject") {
    await reviewRef.set(
      {
        status: "rejected",
        rejectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await updatePendingReviewCount({ db, userId: safeUserId, provider: safeProvider });
    return {
      ok: true,
      action: "rejected",
    };
  }

  const access = await getMailConnectionAccessContext({ userId: safeUserId, provider: safeProvider });
  if (!access.ok) {
    return access;
  }

  let message = null;
  try {
    message = await fetchGmailMessage(access.accessToken, String(data.messageId || "").trim());
  } catch (error) {
    return {
      ok: false,
      statusCode: 502,
      reason: toErrorMessage(error, "Kunde inte hamta Gmail-meddelandet for granskning."),
    };
  }

  const summary = summarizeGmailMessage(message);
  const imported = await importMessageAttachments({
    access,
    message: summary,
    selectedType: String(data.selectedType || "").trim().toLowerCase(),
  });

  if (!imported.ok) {
    return {
      ok: false,
      statusCode: imported.statusCode || 400,
      reason: imported.reason || "Kunde inte importera granskningsposten.",
    };
  }

  await reviewRef.set(
    {
      status: "imported",
      approvedAt: FieldValue.serverTimestamp(),
      importedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      importResult: {
        acceptedCount: clampNumber(imported.acceptedCount, 0, 100, 0),
        duplicateCount: clampNumber(imported.duplicateCount, 0, 100, 0),
        errorCount: clampNumber(imported.errorCount, 0, 100, 0),
      },
    },
    { merge: true }
  );

  const nextImportedIds = normalizeImportedMessageIds([
    ...(Array.isArray(access.connectionData?.sync?.importedMessageIds)
      ? access.connectionData.sync.importedMessageIds
      : []),
    String(data.messageId || "").trim(),
  ]);

  const pendingReviewCount = await updatePendingReviewCount({
    db,
    userId: safeUserId,
    provider: safeProvider,
    connectionRef: access.connectionRef,
    importedMessageIds: nextImportedIds,
  });

  return {
    ok: true,
    action: "approved",
    acceptedCount: imported.acceptedCount,
    duplicateCount: imported.duplicateCount,
    errorCount: imported.errorCount,
    pendingReviewCount,
  };
}

async function importMessageAttachments({ access, message, selectedType }) {
  const attachmentCandidates = Array.isArray(message?.attachmentCandidates)
    ? message.attachmentCandidates.filter((item) => isLikelyDocumentAttachment(item))
    : [];

  if (!attachmentCandidates.length) {
    return {
      ok: false,
      statusCode: 202,
      reason: "Meddelandet inneholl inga stodda dokumentbilagor att importera.",
    };
  }

  const downloadedAttachments = [];
  for (const candidate of attachmentCandidates) {
    try {
      const attachmentJson = await gmailApiRequestJson({
        accessToken: access.accessToken,
        path: `/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(candidate.attachmentId)}`,
      });
      const buffer = decodeBase64Url(String(attachmentJson?.data || ""));
      if (!Buffer.isBuffer(buffer) || !buffer.length) continue;

      downloadedAttachments.push({
        fieldName: "attachment",
        fileName: sanitizeInboundFilename(candidate.fileName || "attachment"),
        encoding: "base64url",
        contentType: normalizeMimeType(candidate.mimeType),
        size: buffer.length,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        buffer,
      });
    } catch {
      continue;
    }
  }

  const validated = validateInboundAttachments(downloadedAttachments, {
    filesLimitHit: false,
    truncatedFiles: [],
  });
  if (!validated.ok) {
    return {
      ok: false,
      statusCode: validated.statusCode || 202,
      reason: validated.reason || "Bilagorna kunde inte valideras.",
    };
  }

  const imported = await processInboundAttachments({
    uid: String(access.connectionData?.uid || "").trim(),
    token: `gmail:${String(message.id || "").trim()}`,
    recipient: `oauth:${String(access.accountEmail || "").trim() || "gmail"}`,
    fields: {
      from: message.from,
      subject: message.subject,
      date: message.receivedAtIso || "",
      "selected-type": String(selectedType || "").trim(),
    },
    attachments: validated.attachments,
  });

  if (!imported.ok) {
    return imported;
  }

  return {
    ok: true,
    acceptedCount: imported.acceptedCount,
    duplicateCount: imported.duplicateCount,
    errorCount: imported.errorCount,
  };
}

async function fetchGmailMessage(accessToken, messageId) {
  return gmailApiRequestJson({
    accessToken,
    path: `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
  });
}

async function gmailApiRequestJson({ accessToken, path }) {
  const response = await fetch(`https://gmail.googleapis.com${path}`, {
    headers: {
      Authorization: `Bearer ${String(accessToken || "").trim()}`,
    },
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const detail =
      String(json?.error?.message || "").trim() ||
      String(json?.error_description || "").trim() ||
      `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return json || {};
}

function summarizeGmailMessage(message) {
  const payload = message?.payload || {};
  const headers = normalizeHeaders(payload.headers);
  const subject = headers.subject || "";
  const from = headers.from || "";
  const textPreview = extractTextPreview(payload).slice(0, 6000);
  const attachmentCandidates = collectAttachmentCandidates(payload);
  const internalDateMs = clampNumber(message?.internalDate, 0, Number.MAX_SAFE_INTEGER, 0);

  return {
    id: String(message?.id || "").trim(),
    threadId: String(message?.threadId || "").trim(),
    from,
    subject,
    snippet: String(message?.snippet || "").trim(),
    textPreview,
    internalDateMs,
    receivedAtIso: internalDateMs > 0 ? new Date(internalDateMs).toISOString() : "",
    attachmentCandidates,
    labelIds: Array.isArray(message?.labelIds) ? message.labelIds.map((entry) => String(entry || "")) : [],
  };
}

function classifyGmailMessage({ message, importTypes }) {
  const selectedImportTypes = normalizeImportTypes(importTypes);
  const fullText = normalizeMatchText(
    [message.subject, message.snippet, message.textPreview, message.from].filter(Boolean).join("\n")
  );
  const attachmentText = normalizeMatchText(
    message.attachmentCandidates.map((attachment) => attachment.fileName).join("\n")
  );
  const hasDocumentAttachment = message.attachmentCandidates.some((attachment) =>
    isLikelyDocumentAttachment(attachment)
  );

  const scores = [];
  for (const [typeId, enabled] of Object.entries(selectedImportTypes)) {
    if (!enabled) continue;

    const rules = TYPE_RULES[typeId];
    const strongTextHits = countPatternMatches(fullText, rules.strongText);
    const mediumTextHits = countPatternMatches(fullText, rules.mediumText);
    const attachmentHits = countPatternMatches(attachmentText, rules.attachmentText);
    const senderHits = countPatternMatches(normalizeMatchText(message.from), rules.senderText);
    const negativeHits = countPatternMatches(fullText, NEGATIVE_TEXT_PATTERNS);
    const pdfBonus = message.attachmentCandidates.some((attachment) => attachment.mimeType === "application/pdf")
      ? 1
      : 0;

    scores.push({
      typeId,
      label: rules.label,
      score:
        strongTextHits * 4 + mediumTextHits * 2 + attachmentHits * 5 + senderHits + pdfBonus - negativeHits * 4,
      strongTextHits,
      mediumTextHits,
      attachmentHits,
      senderHits,
      negativeHits,
    });
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0] || null;
  const second = scores[1] || null;

  const classification = {
    hasDocumentAttachment,
    candidates: scores,
    selectedType: top?.typeId || "",
    selectedLabel: top?.label || "",
    score: clampNumber(top?.score, 0, 100, 0),
    marginToNext: clampNumber((top?.score || 0) - (second?.score || 0), -100, 100, 0),
    reasons: buildClassificationReasons(top),
  };

  if (!top || !hasDocumentAttachment) {
    return {
      decision: "blocked",
      selectedType: "",
      classification,
    };
  }

  if (
    top.score >= AUTO_IMPORT_THRESHOLD &&
    classification.marginToNext >= AUTO_IMPORT_SCORE_MARGIN &&
    top.negativeHits === 0 &&
    (top.strongTextHits > 0 || top.attachmentHits > 0)
  ) {
    return {
      decision: "direct_import",
      selectedType: top.typeId,
      classification,
    };
  }

  if (top.score >= REVIEW_THRESHOLD) {
    return {
      decision: "review",
      selectedType: top.typeId,
      classification,
    };
  }

  return {
    decision: "blocked",
    selectedType: "",
    classification,
  };
}

function buildClassificationReasons(scoreEntry) {
  if (!scoreEntry) return [];
  const reasons = [];
  if (scoreEntry.strongTextHits > 0) reasons.push(`${scoreEntry.strongTextHits} starka sokord`);
  if (scoreEntry.attachmentHits > 0) reasons.push(`${scoreEntry.attachmentHits} dokumentfilnamn`);
  if (scoreEntry.mediumTextHits > 0) reasons.push(`${scoreEntry.mediumTextHits} metadata-traffar`);
  if (scoreEntry.negativeHits > 0) reasons.push(`${scoreEntry.negativeHits} negativa signaler`);
  return reasons;
}

function resolveExistingReviewOutcomeReason(status) {
  const safeStatus = String(status || "").trim().toLowerCase();
  if (safeStatus === "pending_review") {
    return "Meddelandet ligger redan i granskningskon.";
  }
  if (safeStatus === "imported") {
    return "Meddelandet har redan importerats tidigare.";
  }
  if (safeStatus === "rejected") {
    return "Meddelandet har redan avvisats tidigare.";
  }
  return "Meddelandet har redan hanterats tidigare.";
}

function resolveBlockedDecisionOutcomeReason(decision) {
  const classification = decision?.classification && typeof decision.classification === "object"
    ? decision.classification
    : {};

  if (!classification.hasDocumentAttachment) {
    return "Meddelandet saknade en tydlig PDF- eller bildbilaga.";
  }

  if (canQueueBlockedDecisionForManualReview(decision)) {
    return "AI:n hittade vissa fakturasignaler men var inte säker nog. Du kan skicka mejlet till manuell granskning.";
  }

  if (clampNumber(classification.score, 0, 100, 0) <= 0) {
    return "Meddelandet hade för svaga faktura- eller kvittosignaler för import.";
  }

  return "Meddelandet matchade inte dina importregler tillräckligt tydligt.";
}

function canQueueBlockedDecisionForManualReview(decision) {
  const safeDecision = String(decision?.decision || "").trim().toLowerCase();
  const classification = decision?.classification && typeof decision.classification === "object"
    ? decision.classification
    : {};
  const selectedType = String(decision?.selectedType || classification.selectedType || "").trim().toLowerCase();
  const score = clampNumber(classification.score, 0, 100, 0);

  return (
    safeDecision === "blocked" &&
    Boolean(classification.hasDocumentAttachment) &&
    Boolean(selectedType) &&
    score > 0
  );
}

function resolveManualReviewOverrideDeniedReason(decision) {
  const classification = decision?.classification && typeof decision.classification === "object"
    ? decision.classification
    : {};

  if (!classification.hasDocumentAttachment) {
    return "Meddelandet kan inte skickas vidare eftersom det saknar en tydlig PDF- eller bildbilaga.";
  }

  if (clampNumber(classification.score, 0, 100, 0) <= 0) {
    return "Meddelandet kan inte skickas vidare eftersom AI:n inte hittade tillräckliga fakturasignaler.";
  }

  return "Meddelandet kan inte skickas vidare manuellt just nu.";
}

function buildImportedOutcomeReason(imported) {
  const acceptedCount = clampNumber(imported?.acceptedCount, 0, 100, 0);
  const duplicateCount = clampNumber(imported?.duplicateCount, 0, 100, 0);
  const errorCount = clampNumber(imported?.errorCount, 0, 100, 0);
  const parts = [];

  if (acceptedCount > 0) {
    parts.push(`${acceptedCount} bilagor importerades`);
  }
  if (duplicateCount > 0) {
    parts.push(`${duplicateCount} dubbletter hoppades over`);
  }
  if (errorCount > 0) {
    parts.push(`${errorCount} bilagor gav fel`);
  }

  if (!parts.length) {
    return "Meddelandet autoimporterades.";
  }

  return `${parts.join(", ")}.`;
}

function simplifyReviewAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => ({
      attachmentId: String(attachment?.attachmentId || "").trim(),
      fileName: String(attachment?.fileName || "").trim(),
      mimeType: normalizeMimeType(attachment?.mimeType),
      size: clampNumber(attachment?.size, 0, Number.MAX_SAFE_INTEGER, 0),
      isInline: Boolean(attachment?.isInline),
      likelyDocument: isLikelyDocumentAttachment(attachment),
    }))
    .filter((attachment) => attachment.attachmentId || attachment.fileName)
    .slice(0, 12);
}

function normalizeReviewItem(snapshotOrData) {
  const data =
    snapshotOrData && typeof snapshotOrData.data === "function"
      ? snapshotOrData.data() || {}
      : snapshotOrData && typeof snapshotOrData === "object"
        ? snapshotOrData
        : {};
  const internalDateMs = clampNumber(data.internalDateMs, 0, Number.MAX_SAFE_INTEGER, 0);
  const classification =
    data.classification && typeof data.classification === "object" ? data.classification : {};

  return {
    id:
      snapshotOrData && typeof snapshotOrData.id === "string"
        ? snapshotOrData.id
        : String(data.id || "").trim(),
    provider: String(data.provider || "").trim().toLowerCase(),
    status: String(data.status || "").trim().toLowerCase(),
    selectedType: String(data.selectedType || classification.selectedType || "").trim().toLowerCase(),
    accountEmail: String(data.accountEmail || "").trim(),
    from: String(data.from || "").trim(),
    subject: String(data.subject || "").trim(),
    snippet: String(data.snippet || "").trim(),
    textPreview: String(data.textPreview || "").trim(),
    internalDateMs,
    receivedAtIso: internalDateMs > 0 ? new Date(internalDateMs).toISOString() : "",
    attachmentCandidates: simplifyReviewAttachments(data.attachmentCandidates),
    classification: normalizeClassificationSummary({
      ...classification,
      selectedType: classification.selectedType || data.selectedType || "",
    }),
    createdAt: toIsoTimestamp(data.createdAt),
    updatedAt: toIsoTimestamp(data.updatedAt),
  };
}

function normalizeClassificationSummary(classification) {
  const source = classification && typeof classification === "object" ? classification : {};

  return {
    selectedType: String(source.selectedType || "").trim().toLowerCase(),
    selectedLabel: String(source.selectedLabel || "").trim(),
    score: clampNumber(source.score, 0, 100, 0),
    marginToNext: clampNumber(source.marginToNext, -100, 100, 0),
    hasDocumentAttachment: Boolean(source.hasDocumentAttachment),
    reasons: Array.isArray(source.reasons)
      ? source.reasons.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 6)
      : [],
    candidates: Array.isArray(source.candidates)
      ? source.candidates
          .map((candidate) => ({
            typeId: String(candidate?.typeId || "").trim().toLowerCase(),
            label: String(candidate?.label || "").trim(),
            score: clampNumber(candidate?.score, -100, 100, 0),
          }))
          .filter((candidate) => candidate.typeId)
          .slice(0, 4)
      : [],
  };
}

function normalizeImportResult(importResult) {
  const source = importResult && typeof importResult === "object" ? importResult : {};
  return {
    acceptedCount: clampNumber(source.acceptedCount, 0, 100, 0),
    duplicateCount: clampNumber(source.duplicateCount, 0, 100, 0),
    errorCount: clampNumber(source.errorCount, 0, 100, 0),
  };
}

function normalizeSyncOutcome(outcome) {
  const safeOutcome = String(outcome || "").trim().toLowerCase();
  if (safeOutcome === "imported" || safeOutcome === "review" || safeOutcome === "blocked" || safeOutcome === "error") {
    return safeOutcome;
  }
  return "blocked";
}

async function countPendingReviews({ db, userId, provider }) {
  const safeUserId = String(userId || "").trim();
  const safeProvider = String(provider || "").trim().toLowerCase();
  if (!db || !safeUserId || !safeProvider) return 0;

  const collection = getReviewCollectionRef(db);
  try {
    const snapshot = await collection
      .where("uid", "==", safeUserId)
      .where("provider", "==", safeProvider)
      .where("status", "==", "pending_review")
      .get();
    return snapshot.size;
  } catch {
    const snapshot = await collection.where("uid", "==", safeUserId).get();
    return snapshot.docs.filter((doc) => {
      const data = doc.data() || {};
      return (
        String(data.provider || "").trim().toLowerCase() === safeProvider &&
        String(data.status || "").trim().toLowerCase() === "pending_review"
      );
    }).length;
  }
}

async function updatePendingReviewCount({
  db,
  userId,
  provider,
  connectionRef = null,
  importedMessageIds = null,
}) {
  const pendingReviewCount = await countPendingReviews({ db, userId, provider });
  const ref = connectionRef || getConnectionCollectionRef(db).doc(buildConnectionDocId(userId, provider));

  await ref.set(
    {
      sync: {
        pendingReviewCount,
        ...(importedMessageIds
          ? {
              importedMessageIds: normalizeImportedMessageIds(importedMessageIds),
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return pendingReviewCount;
}

function getReviewCollectionRef(db) {
  const name = String(process.env.FIREBASE_MAIL_IMPORT_REVIEW_COLLECTION || DEFAULT_REVIEW_COLLECTION).trim();
  return db.collection(name || DEFAULT_REVIEW_COLLECTION);
}

function getConnectionCollectionRef(db) {
  const name = String(process.env.FIREBASE_MAIL_CONNECTION_COLLECTION || DEFAULT_CONNECTION_COLLECTION).trim();
  return db.collection(name || DEFAULT_CONNECTION_COLLECTION);
}

function buildReviewDocId(userId, provider, messageId) {
  return crypto
    .createHash("sha256")
    .update(`${String(userId || "").trim()}:${String(provider || "").trim().toLowerCase()}:${String(messageId || "").trim()}`)
    .digest("hex");
}

function buildConnectionDocId(userId, provider) {
  return crypto
    .createHash("sha256")
    .update(`${String(userId || "").trim()}:${String(provider || "").trim().toLowerCase()}`)
    .digest("hex");
}

function resolveSyncCursorMs(connectionData) {
  const storedCursorMs = clampNumber(connectionData?.sync?.lastCursorInternalDateMs, 0, Number.MAX_SAFE_INTEGER, 0);
  if (storedCursorMs > 0) return storedCursorMs;
  return Date.now() - resolveLookbackDays() * 24 * 60 * 60 * 1000;
}

function buildGmailSearchQuery({ importTypes, cursorMs }) {
  const normalizedTypes = normalizeImportTypes(importTypes);
  const enabledNonInvoiceTypes = Boolean(normalizedTypes.receipts || normalizedTypes.confirmations);
  const ageDays = clampNumber(
    Math.ceil((Date.now() - clampNumber(cursorMs, 0, Number.MAX_SAFE_INTEGER, 0)) / (24 * 60 * 60 * 1000)),
    1,
    resolveLookbackDays(),
    resolveLookbackDays()
  );

  const parts = ["in:anywhere", "has:attachment", `newer_than:${ageDays}d`, "-label:spam", "-label:trash"];
  if (!enabledNonInvoiceTypes) {
    parts.push("-category:promotions");
  }
  return parts.join(" ");
}

function collectAttachmentCandidates(payload) {
  const attachments = [];
  walkPayloadParts(payload, (part) => {
    const body = part?.body && typeof part.body === "object" ? part.body : {};
    const attachmentId = String(body.attachmentId || "").trim();
    if (!attachmentId) return;

    const headers = normalizeHeaders(part?.headers);
    const fileName = String(part?.filename || "").trim();
    const mimeType = normalizeMimeType(part?.mimeType);
    const disposition = String(headers["content-disposition"] || "").trim().toLowerCase();
    const contentId = String(headers["content-id"] || "").trim();

    attachments.push({
      attachmentId,
      fileName,
      mimeType,
      size: clampNumber(body.size, 0, Number.MAX_SAFE_INTEGER, 0),
      disposition,
      contentId,
      isInline: disposition.includes("inline") || Boolean(contentId),
      partId: String(part?.partId || "").trim(),
    });
  });

  return attachments;
}

function extractTextPreview(payload) {
  const textParts = [];
  const htmlParts = [];

  walkPayloadParts(payload, (part) => {
    const mimeType = normalizeMimeType(part?.mimeType);
    const bodyData = String(part?.body?.data || "").trim();
    if (!bodyData) return;

    const decoded = decodeBase64Url(bodyData).toString("utf8").trim();
    if (!decoded) return;

    if (mimeType === "text/plain") {
      textParts.push(decoded);
      return;
    }

    if (mimeType === "text/html") {
      const stripped = stripHtml(decoded);
      if (stripped) htmlParts.push(stripped);
    }
  });

  const fallback = String(payload?.body?.data || "").trim();
  if (!textParts.length && !htmlParts.length && fallback) {
    const decoded = decodeBase64Url(fallback).toString("utf8").trim();
    if (decoded) textParts.push(decoded);
  }

  return [...textParts, ...htmlParts].filter(Boolean).join("\n\n").replace(/\s+\n/g, "\n").trim();
}

function walkPayloadParts(part, visitor) {
  if (!part || typeof part !== "object") return;
  visitor(part);

  const nestedParts = Array.isArray(part.parts) ? part.parts : [];
  for (const nested of nestedParts) {
    walkPayloadParts(nested, visitor);
  }
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const header of Array.isArray(headers) ? headers : []) {
    const name = String(header?.name || "").trim().toLowerCase();
    if (!name || normalized[name]) continue;
    normalized[name] = String(header?.value || "").trim();
  }
  return normalized;
}

function isLikelyDocumentAttachment(attachment) {
  const mimeType = normalizeMimeType(attachment?.mimeType);
  const fileName = String(attachment?.fileName || "").trim().toLowerCase();
  const size = clampNumber(attachment?.size, 0, Number.MAX_SAFE_INTEGER, 0);
  const isInline = Boolean(attachment?.isInline);

  if (!String(attachment?.attachmentId || "").trim()) return false;
  if (size <= 1024) return false;

  const extension = fileName.split(".").pop() || "";
  const mimeSupported =
    SUPPORTED_ATTACHMENT_MIME_TYPES.has(mimeType) ||
    ["pdf", "png", "jpg", "jpeg", "webp"].includes(extension);
  if (!mimeSupported) return false;

  if (INLINE_ATTACHMENT_PATTERNS.some((pattern) => pattern.test(fileName))) return false;
  if (isInline && mimeType.startsWith("image/") && size < 25000) return false;
  if (!fileName && mimeType.startsWith("image/")) return false;

  return true;
}

function normalizeImportTypes(importTypes) {
  const source = importTypes && typeof importTypes === "object" ? importTypes : {};
  return {
    invoices: source.invoices !== false,
    receipts: Boolean(source.receipts),
    confirmations: Boolean(source.confirmations),
  };
}

function normalizeImportedMessageIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => String(entry || "").trim()).filter(Boolean))]
    .slice(-MAX_IMPORTED_MESSAGE_IDS);
}

function normalizeMimeType(mimeType) {
  return String(mimeType || "").trim().toLowerCase();
}

function decodeBase64Url(value) {
  const raw = String(value || "").trim();
  if (!raw) return Buffer.alloc(0);

  let normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) {
    normalized += "=";
  }

  try {
    return Buffer.from(normalized, "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMatchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}@._:/+\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function countPatternMatches(text, patterns) {
  const safeText = String(text || "");
  return (Array.isArray(patterns) ? patterns : []).reduce((count, pattern) => {
    if (!(pattern instanceof RegExp)) return count;
    pattern.lastIndex = 0;
    return pattern.test(safeText) ? count + 1 : count;
  }, 0);
}

function buildSyncSummaryMessage(stats) {
  const safeStats = stats && typeof stats === "object" ? stats : {};
  const parts = [`${clampNumber(safeStats.scanned, 0, 9999, 0)} meddelanden skannades`];

  if (clampNumber(safeStats.importedMessages, 0, 9999, 0) > 0) {
    parts.push(`${clampNumber(safeStats.importedMessages, 0, 9999, 0)} autoimporterades`);
  }
  if (clampNumber(safeStats.queuedForReview, 0, 9999, 0) > 0) {
    parts.push(`${clampNumber(safeStats.queuedForReview, 0, 9999, 0)} skickades till granskning`);
  }
  if (clampNumber(safeStats.blocked, 0, 9999, 0) > 0) {
    parts.push(`${clampNumber(safeStats.blocked, 0, 9999, 0)} blockerades`);
  }
  if (clampNumber(safeStats.errors, 0, 9999, 0) > 0) {
    parts.push(`${clampNumber(safeStats.errors, 0, 9999, 0)} gav fel`);
  }

  return `Synk klar: ${parts.join(", ")}.`;
}

function resolveLookbackDays() {
  return clampNumber(process.env.MAIL_IMPORT_SYNC_LOOKBACK_DAYS, 1, 60, DEFAULT_LOOKBACK_DAYS);
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toErrorMessage(error, fallback) {
  if (error instanceof Error && String(error.message || "").trim()) {
    return String(error.message || "").trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function toIsoTimestamp(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return "";
    }
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
