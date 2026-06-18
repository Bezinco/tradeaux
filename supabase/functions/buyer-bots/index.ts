// supabase/functions/buyer-bots/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } }
  );

  console.log('Buyer Bot Edge Function started');

  try {
    const { data: auctions, error: auctionsError } = await supabaseClient
      .from('auctions')
      .select(`
        *,
        sellers!inner (
          id,
          coop_name,
          origin_country,
          fob_port,
          certificates,
          rating
        )
      `)
      .eq('status', 'active')
      .gt('remaining_quantity_kg', 0);

    if (auctionsError) throw auctionsError;

    if (!auctions || auctions.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active auctions found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: buyerBots, error: botsError } = await supabaseClient
      .from('buyer_bots')
      .select('*')
      .eq('is_active', true)
      .gte('wallet_balance', 25);

    if (botsError) throw botsError;

    if (!buyerBots || buyerBots.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active buyer bots found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let bidsPlaced = 0;

    for (const auction of auctions) {
      for (const bot of buyerBots) {
        if (auction.product_category !== bot.product_category) continue;
        if (auction.remaining_quantity_kg < bot.min_quantity_kg) continue;
        if (bot.preferred_origins.length > 0 && !bot.preferred_origins.includes(auction.origin_country)) continue;
        
        const sellerCerts = auction.sellers?.certificates || {};
        let hasCerts = true;
        for (const requiredCert of bot.requires_certificates) {
          if (!sellerCerts[requiredCert]) hasCerts = false;
        }
        if (!hasCerts) continue;

        const bidPrice = bot.max_price_per_kg;
        const bidQuantity = Math.min(bot.max_quantity_kg, auction.remaining_quantity_kg, 5000);

        const { error: bidError } = await supabaseClient
          .from('bids')
          .insert({
            auction_id: auction.id,
            buyer_bot_id: bot.id,
            buyer_name: bot.bot_name,
            price_per_kg: bidPrice,
            quantity_kg: bidQuantity,
            payment_days: 30,
            status: 'pending',
            fee_locked: 25
          });

        if (!bidError) {
          const newWalletBalance = bot.wallet_balance - 25;
          await supabaseClient
            .from('buyer_bots')
            .update({ wallet_balance: newWalletBalance })
            .eq('id', bot.id);
          bidsPlaced++;
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, bids_placed: bidsPlaced }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
