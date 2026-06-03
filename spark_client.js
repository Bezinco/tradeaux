/**
 * TradeAux Spark Plan — Client-Side Firestore Helpers
 * No Cloud Functions needed. All logic enforced by Firestore Rules.
 * 
 * Usage: Include after Firebase init. Call these instead of functions.httpsCallable().
 */

// ========== 1. POST SELLER INVENTORY ==========
async function postSellerInventory(data) {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const {
    coopName, commodity, variety, quantity, grade,
    origin, fobPort, minPrice, duration
  } = data;

  if (!coopName || !commodity || !origin || !fobPort) {
    throw new Error("Missing required fields");
  }
  const qty = parseInt(quantity, 10);
  const price = parseFloat(minPrice);
  const dur = parseInt(duration, 10) || 2;

  const briefRef = db.collection("seller_briefs").doc();
  await briefRef.set({
    sellerId: uid,
    coopName: coopName.trim(),
    commodity,
    variety: variety || null,
    quantity_mt: qty,
    remaining_mt: qty,
    grade: grade || "Grade A",
    origin: origin.trim(),
    fobPort: fobPort.trim(),
    minPrice: price,
    est_price: price,
    duration: dur,
    status: "active",
    fees_collected: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    startedAt: null,
    endedAt: null
  });

  return { success: true, briefId: briefRef.id };
}

// ========== 2. DEPOSIT FUNDS (client-side transaction) ==========
async function depositFunds(amount) {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < 100) {
    throw new Error("Minimum deposit is $100");
  }

  const walletRef = db.collection("wallets").doc(uid);

  const result = await db.runTransaction(async (t) => {
    const doc = await t.get(walletRef);
    const current = doc.exists ? (doc.data().balance || 0) : 0;
    const next = current + amt;

    const tx = {
      type: "deposit",
      amount: amt,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      description: `Deposit $${amt.toFixed(2)}`
    };

    if (doc.exists) {
      t.update(walletRef, {
        balance: next,
        transactions: firebase.firestore.FieldValue.arrayUnion(tx),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      t.set(walletRef, {
        userId: uid,
        balance: next,
        transactions: [tx],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    return next;
  });

  return { success: true, newBalance: result };
}

// ========== 3. ACCEPT BID (client-side transaction) ==========
async function acceptBid(bidId, briefId) {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const bidRef = db.collection("bids").doc(bidId);
  const briefRef = db.collection("seller_briefs").doc(briefId);

  const result = await db.runTransaction(async (t) => {
    const bidSnap = await t.get(bidRef);
    const briefSnap = await t.get(briefRef);

    if (!bidSnap.exists) throw new Error("Bid not found");
    if (!briefSnap.exists) throw new Error("Brief not found");

    const bid = bidSnap.data();
    const brief = briefSnap.data();

    if (brief.sellerId !== uid) {
      throw new Error("Brief does not belong to you");
    }
    if (bid.status !== "pending") {
      throw new Error("Bid is no longer pending");
    }

    const qty = bid.quantity_mt || 20;
    const remaining = brief.remaining_mt || 0;
    if (qty > remaining) {
      throw new Error(`Only ${remaining} MT remaining`);
    }

    const nextRemaining = remaining - qty;
    const nextFees = (brief.fees_collected || 0) + 25;

    t.update(bidRef, {
      status: "accepted",
      acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const briefUpdate = {
      remaining_mt: nextRemaining,
      fees_collected: nextFees,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (nextRemaining <= 0) {
      briefUpdate.status = "completed";
      briefUpdate.endedAt = firebase.firestore.FieldValue.serverTimestamp();
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
}

// ========== 4. PLACE BID (buyer side) ==========
async function placeBid(briefId, amount, quantity_mt) {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const bidAmount = parseFloat(amount);
  const qty = parseInt(quantity_mt, 10);
  if (isNaN(bidAmount) || bidAmount <= 0 || isNaN(qty) || qty < 1) {
    throw new Error("Invalid bid amount or quantity");
  }

  // Load buyer profile for display fields
  const profileSnap = await db.collection("profiles").doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() : {};

  // Load brief to get sellerId
  const briefSnap = await db.collection("seller_briefs").doc(briefId).get();
  if (!briefSnap.exists) throw new Error("Auction brief not found");
  const brief = briefSnap.data();

  // Check if buyer already has a pending bid on this brief
  const existing = await db.collection("bids")
    .where("buyerId", "==", uid)
    .where("briefId", "==", briefId)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  let bidRef;
  let previousAmount = 0;
  let bidCount = 1;

  if (!existing.empty) {
    bidRef = existing.docs[0].ref;
    const old = existing.docs[0].data();
    previousAmount = old.amount || 0;
    bidCount = (old.bid_count || 1) + 1;

    await bidRef.update({
      amount: bidAmount,
      quantity_mt: qty,
      previous_amount: previousAmount,
      bid_count: bidCount,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    bidRef = db.collection("bids").doc();
    await bidRef.set({
      briefId,
      brief_id: briefId,
      sellerId: brief.sellerId,
      buyerId: uid,
      buyer_name: profile.coop_name || profile.full_name || uid.slice(0, 8),
      buyer_contact: profile.contact_person || profile.full_name || "Buyer",
      buyer_email: profile.email || firebase.auth().currentUser.email || "",
      buyer_phone: profile.phone || "",
      buyer_whatsapp: profile.whatsapp || profile.phone || "",
      amount: bidAmount,
      quantity_mt: qty,
      previous_amount: 0,
      bid_count: 1,
      status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  return { success: true, bidId: bidRef.id, amount: bidAmount, quantity_mt: qty };
}
