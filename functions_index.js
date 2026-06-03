const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// ========== PLACE BID (Cloud Function) ==========
// Call with: functions.httpsCallable('placeBid')({ briefId, amount, quantity })
exports.placeBid = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be signed in to place a bid.");
  }

  const { briefId, amount, quantity } = data;
  const uid = context.auth.uid;

  if (!briefId || typeof briefId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "briefId is required.");
  }
  if (typeof amount !== "number" || amount < 1) {
    throw new functions.https.HttpsError("invalid-argument", "amount must be a positive number.");
  }
  if (typeof quantity !== "number" || quantity < 1) {
    throw new functions.https.HttpsError("invalid-argument", "quantity must be a positive number.");
  }

  const briefRef = db.collection("seller_briefs").doc(briefId);
  const bidRef = db.collection("bids").doc();

  try {
    const result = await db.runTransaction(async (t) => {
      const briefSnap = await t.get(briefRef);
      if (!briefSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Brief not found.");
      }
      const brief = briefSnap.data();

      if (brief.status !== "active" && brief.status !== "auctioning") {
        throw new functions.https.HttpsError("failed-precondition", "Auction is not active.");
      }

      const now = admin.firestore.FieldValue.serverTimestamp();

      t.set(bidRef, {
        brief_id: briefId,
        buyer_id: uid,
        buyer_name: context.auth.token.name || context.auth.token.email || "Anonymous",
        buyer_email: context.auth.token.email || "",
        amount: amount,
        quantity_mt: quantity,
        status: "pending",
        createdAt: now,
        updatedAt: now
      });

      t.update(briefRef, {
        bid_count: admin.firestore.FieldValue.increment(1),
        updatedAt: now
      });

      return { success: true, bidId: bidRef.id };
    });

    return result;
  } catch (err) {
    console.error("placeBid error:", err);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

// ========== ACCEPT BID (Seller side) ==========
exports.acceptBid = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be signed in.");
  }

  const { bidId, briefId } = data;
  const uid = context.auth.uid;

  const bidRef = db.collection("bids").doc(bidId);
  const briefRef = db.collection("seller_briefs").doc(briefId);

  const result = await db.runTransaction(async (t) => {
    const bidSnap = await t.get(bidRef);
    const briefSnap = await t.get(briefRef);

    if (!bidSnap.exists) throw new functions.https.HttpsError("not-found", "Bid not found");
    if (!briefSnap.exists) throw new functions.https.HttpsError("not-found", "Brief not found");

    const bid = bidSnap.data();
    const brief = briefSnap.data();

    if (brief.sellerId !== uid) {
      throw new functions.https.HttpsError("permission-denied", "Brief does not belong to you");
    }
    if (bid.status !== "pending") {
      throw new functions.https.HttpsError("failed-precondition", "Bid is no longer pending");
    }

    const qty = bid.quantity_mt || 20;
    const remaining = brief.remaining_mt || 0;
    if (qty > remaining) {
      throw new functions.https.HttpsError("failed-precondition", `Only ${remaining} MT remaining`);
    }

    const nextRemaining = remaining - qty;
    const nextFees = (brief.fees_collected || 0) + 25;

    t.update(bidRef, {
      status: "accepted",
      acceptedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const briefUpdate = {
      remaining_mt: nextRemaining,
      fees_collected: nextFees,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (nextRemaining <= 0) {
      briefUpdate.status = "completed";
      briefUpdate.endedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    t.update(briefRef, briefUpdate);

    return {
      success: true,
      remaining_mt: nextRemaining,
      fees_collected: nextFees,
      soldOut: nextRemaining <= 0
    };
  });

  return result;
});
