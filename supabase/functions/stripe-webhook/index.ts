import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEYS') || '';

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature || '', webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  console.log('Webhook received:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.supabase_user_id;
    const amount = parseFloat(session.metadata?.amount || '0');

    console.log('Processing payment for user:', userId, 'amount:', amount);

    if (userId && amount > 0) {
      // Parse service key if it's JSON
      let serviceKey = supabaseServiceKey;
      try {
        const parsed = JSON.parse(supabaseServiceKey);
        serviceKey = parsed.service_role || Object.values(parsed)[0] || supabaseServiceKey;
      } catch (e) {
        // Not JSON, use as-is
      }

      const supabase = createClient(supabaseUrl, serviceKey);

      // Get current balance
      const { data: profile } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      const currentBalance = parseFloat(profile?.wallet_balance || '0');
      const newBalance = currentBalance + amount;

      // Update wallet
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ wallet_balance: newBalance })
        .eq('id', userId);

      if (updateError) {
        console.error('Failed to update wallet:', updateError);
        return new Response(JSON.stringify({ error: 'Failed to update wallet' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      console.log(`Wallet updated: $${currentBalance} → $${newBalance} for user ${userId}`);

      return new Response(JSON.stringify({ success: true, newBalance }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});