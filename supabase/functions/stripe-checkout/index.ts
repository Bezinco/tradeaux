import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

// Helper to get service role key from various env var formats
function getServiceRoleKey() {
  // 1. Try legacy direct key
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy && !legacy.startsWith('{')) return legacy;

  // 2. Try new JSON dictionary format
  const secretsJson = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretsJson) {
    try {
      const parsed = JSON.parse(secretsJson);
      if (parsed.service_role) return parsed.service_role;
      // Fallback: first key in the dictionary
      const keys = Object.values(parsed);
      if (keys.length > 0) return keys[0];
    } catch (e) {
      // Not valid JSON, maybe it's already a raw key
      if (secretsJson && !secretsJson.startsWith('{')) return secretsJson;
    }
  }

  // 3. Fallback to anon key (won't work for admin ops but won't crash)
  return Deno.env.get('SUPABASE_ANON_KEY') || '';
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = getServiceRoleKey();
const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  // Debug: log env status (remove in production)
  console.log('Env check:', { 
    url: supabaseUrl ? 'set' : 'missing', 
    key: supabaseServiceKey ? 'set' : 'missing',
    stripe: stripeSecretKey ? 'set' : 'missing'
  });

  // Check env vars
  if (!stripeSecretKey) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ 
      error: 'Supabase credentials not configured',
      details: { url: !!supabaseUrl, key: !!supabaseServiceKey }
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

  try {
    const { amount, successUrl, cancelUrl } = await req.json();

    if (!amount || amount < 100) {
      return new Response(JSON.stringify({ error: 'Minimum deposit is $100' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized - no auth header' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized - invalid token', details: userError?.message }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'TradeAux Wallet Deposit',
            description: `Deposit $${amount} to your TradeAux wallet`,
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      success_url: successUrl || `${req.headers.get('origin')}/dash-buyer.html?deposit=success`,
      cancel_url: cancelUrl || `${req.headers.get('origin')}/dash-buyer.html?deposit=cancelled`,
      metadata: {
        supabase_user_id: user.id,
        amount: amount.toString(),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Stripe checkout error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
});
