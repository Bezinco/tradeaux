import Stripe from 'stripe';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        if (session.metadata?.type !== 'wallet_deposit') {
          return res.status(200).json({ received: true, ignored: true });
        }

        const userId = session.client_reference_id || session.metadata?.userId;
        const amount = parseFloat(session.metadata?.depositAmount || '0');
        const paymentStatus = session.payment_status;

        if (paymentStatus !== 'paid') {
          console.log(`Payment not completed. Status: ${paymentStatus}`);
          return res.status(200).json({ received: true, status: 'unpaid' });
        }

        if (!userId || !amount) {
          console.error('Missing userId or amount in session metadata');
          return res.status(200).json({ received: true, error: 'Missing metadata' });
        }

        const userRef = db.collection('profiles').doc(userId);

        await db.runTransaction(async (t) => {
          const doc = await t.get(userRef);
          const currentBalance = doc.exists ? (doc.data().wallet_balance || 0) : 0;
          const newBalance = currentBalance + amount;

          t.set(userRef, {
            wallet_balance: newBalance,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

          const txnRef = db.collection('transactions').doc();
          t.set(txnRef, {
            userId: userId,
            type: 'deposit',
            amount: amount,
            currency: 'usd',
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent,
            status: 'completed',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });

        console.log(`Deposited $${amount} to user ${userId}`);
        break;
      }

      case 'checkout.session.expired':
      case 'payment_intent.payment_failed': {
        console.log(`Payment failed or expired: ${event.type}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  return res.status(200).json({ received: true });
}
