import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
})

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  try {
    const { session_id } = await req.json()

    if (!session_id) {
      return new Response(JSON.stringify({ error: 'No session ID provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id)

    if (session.payment_status !== 'paid') {
      return new Response(JSON.stringify({ 
        paid: false, 
        status: session.payment_status 
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const userId = session.metadata?.supabase_user_id
    const amount = parseFloat(session.metadata?.amount || '0')

    if (!userId || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid metadata' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Use fetch directly instead of supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    // Get current balance
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?select=wallet_balance&id=eq.${userId}`, {
      headers: {
        'apikey': supabaseKey!,
        'Authorization': `Bearer ${supabaseKey!}`,
        'Content-Type': 'application/json',
      },
    })
    const profile = await profileRes.json()
    const currentBalance = profile[0]?.wallet_balance || 0
    const newBalance = currentBalance + amount

    // Update wallet
    await fetch(`${supabaseUrl}/rest/v1/profiles?wallet_balance=eq.${currentBalance}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey!,
        'Authorization': `Bearer ${supabaseKey!}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ wallet_balance: newBalance }),
    })

    // Record transaction (optional - log to console for now)
    console.log(`Deposit: User ${userId} +$${amount} → New balance: $${newBalance}`)

    return new Response(JSON.stringify({ 
      paid: true, 
      amount: amount,
      new_balance: newBalance 
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })

  } catch (error) {
    console.error('Verify error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})