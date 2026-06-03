import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const results = []
    const now_time = new Date().toISOString()

    // Get active briefs
    const { data: briefs, error: briefsError } = await supabase
      .from('seller_briefs')
      .select('id, commodity, quantity_mt, est_price, end_time')
      .eq('status', 'active')

    if (briefsError) throw briefsError

    if (!briefs || briefs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No active briefs', timestamp: now_time }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get active bots
    const { data: bots, error: botsError } = await supabase
      .from('buyer_bots')
      .select('id, buyer_name, bot_name, commodity, min_qty, max_qty, max_price, strategy')
      .eq('is_active', true)

    if (botsError) throw botsError

    if (!bots || bots.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No active bots', timestamp: now_time }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get wallet balances
    const buyerNames = [...new Set(bots.map(b => b.buyer_name))]
    const { data: wallets } = await supabase
      .from('buyer_wallets')
      .select('buyer_name, available_balance')
      .in('buyer_name', buyerNames)

    const walletMap = new Map()
    wallets?.forEach(w => walletMap.set(w.buyer_name, w.available_balance))

    // Match and bid
    for (const brief of briefs) {
      const timeRemaining = new Date(brief.end_time).getTime() - Date.now()
      const isLastMinute = timeRemaining < 60000
      const isLastTenSeconds = timeRemaining < 10000

      for (const bot of bots) {
        if (bot.commodity !== brief.commodity) continue
        if (bot.min_qty > brief.quantity_mt) continue
        if (bot.max_qty < brief.quantity_mt) continue
        if (bot.max_price < brief.est_price) continue

        const availableBalance = walletMap.get(bot.buyer_name) || 0
        if (availableBalance < 25) {
          results.push({ bot: bot.bot_name, brief: brief.id, success: false, error: 'Insufficient wallet balance' })
          continue
        }

        if (bot.strategy === 'sniper') {
          if (!isLastMinute) continue
          const { count: existingBids } = await supabase
            .from('cai_bids')
            .select('id', { count: 'exact', head: true })
            .eq('brief_id', brief.id)
            .eq('bot_name', bot.bot_name)
            .eq('status', 'pending')
          if (existingBids && existingBids > 0) continue
        }

        let bidPrice = brief.est_price
        switch (bot.strategy) {
          case 'aggressive': bidPrice = brief.est_price * 0.90; break
          case 'balanced': bidPrice = brief.est_price * 0.95; break
          case 'conservative': bidPrice = brief.est_price * 0.98; break
          case 'sniper': bidPrice = isLastTenSeconds ? brief.est_price * 0.88 : brief.est_price * 0.92; break
          default: bidPrice = brief.est_price * 0.95
        }

        if (bidPrice > bot.max_price) bidPrice = bot.max_price
        const floorPrice = brief.est_price * 0.75
        if (bidPrice < floorPrice) bidPrice = floorPrice
        bidPrice = Math.round(bidPrice * 100) / 100

        const { data: bidResult, error: bidError } = await supabase.rpc('place_bid_with_hold', {
          p_bot_id: bot.id,
          p_brief_id: brief.id,
          p_bid_price: bidPrice,
          p_quantity_mt: brief.quantity_mt
        })

        results.push({
          bot: bot.bot_name,
          brief: brief.id,
          price: bidPrice,
          strategy: bot.strategy,
          timeRemaining: Math.floor(timeRemaining / 1000),
          success: bidResult?.success || false,
          error: bidError?.message || bidResult?.error || null
        })
      }
    }

    const successful = results.filter(r => r.success)
    const failed = results.filter(r => !r.success)

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: now_time,
        briefs_processed: briefs.length,
        bots_active: bots.length,
        bids_attempted: results.length,
        bids_successful: successful.length,
        bids_failed: failed.length,
        details: results
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})