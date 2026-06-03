import { createClient } from '\''@supabase/supabase-js'\'';

export default async function handler(req, res) {
  if (req.method !== '\''POST'\'') {
    return res.status(405).json({ error: '\''Method not allowed'\'' });
  }

  try {
    const Stripe = require('\''stripe'\'');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    const sig = req.headers['\''stripe-signature'\''];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error(`Webhook error: ${err.message}`);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    if (event.type === '\''checkout.session.completed'\'') {
      const session = event.data.object;
      const userId = session.metadata.user_id;
      const amount = parseInt(session.metadata.amount);
      
      console.log(`✅ Payment: User ${userId} deposited $${amount}`);
      
      const { error } = await supabase
        .from('\''deposits'\'')
        .insert([{
          user_id: userId,
          amount: amount,
          stripe_payment_intent: session.payment_intent,
          stripe_session_id: session.id,
          status: '\''completed'\''
        }]);

      if (error) console.error('\''Supabase error:'\'', error);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('\''Webhook error:'\'', error);
    res.status(500).json({ error: error.message });
  }
}
