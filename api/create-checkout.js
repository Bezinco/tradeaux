import Stripe from '\''stripe'\'';

export default async function handler(req, res) {
  res.setHeader('\''Access-Control-Allow-Credentials'\'', true);
  res.setHeader('\''Access-Control-Allow-Origin'\'', '\''*'\'');
  res.setHeader('\''Access-Control-Allow-Methods'\'', '\''GET,OPTIONS,PATCH,DELETE,POST,PUT'\'');
  res.setHeader('\''Access-Control-Allow-Headers'\'', '\''X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'\'');
  
  if (req.method === '\''OPTIONS'\'') {
    return res.status(200).end();
  }
  
  if (req.method !== '\''POST'\'') {
    return res.status(405).json({ error: '\''Method not allowed'\'' });
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { amount, userId, userEmail } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['\''card'\''],
      mode: '\''payment'\'',
      customer_email: userEmail,
      line_items: [{
        price_data: {
          currency: '\''usd'\'',
          product_data: {
            name: '\''TradeAux Deposit'\'',
            description: `Deposit of $${amount} to your TradeAux account`
          },
          unit_amount: amount * 100,
        },
        quantity: 1,
      }],
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/cancel.html`,
      metadata: {
        user_id: userId,
        amount: amount.toString()
      }
    });

    res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('\''Checkout error:'\'', error);
    res.status(500).json({ error: error.message });
  }
}
