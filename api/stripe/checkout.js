import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amount, userId, userEmail } = req.body;

  if (!amount || amount < 100) {
    return res.status(400).json({ error: 'Minimum deposit is $100' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'TradeAux Wallet Deposit',
              description: `Deposit $${amount} USD to your TradeAux wallet`,
            },
            unit_amount: amount * 100,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_URL || req.headers.origin}/buyer_dashboard.html?deposit=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL || req.headers.origin}/buyer_dashboard.html?deposit=cancelled`,
      client_reference_id: userId,
      customer_email: userEmail || undefined,
      metadata: {
        userId: userId,
        depositAmount: amount.toString(),
        type: 'wallet_deposit',
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return res.status(500).json({ error: error.message });
  }
}
