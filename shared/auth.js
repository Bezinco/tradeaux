// TradeAux Shared Auth — Microfrontend Version
const SUPABASE_URL = 'https://knceschbzidmqvosdwud.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuY2VzY2hiemlkbXF2b3Nkd3VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NTY2MTgsImV4cCI6MjA4NjUzMjYxOH0.2lZXDSMAQwo4mD5y66-2d6kd6FXMvIFBmNbBgoSx56o';

var supabaseClient = null;
var currentUserId = null;
var currentCompanyId = null;
var _authReady = false;
var _authCallbacks = [];

async function initAuth() {
  if (typeof supabase === 'undefined') {
    console.error('Supabase SDK missing');
    return null;
  }
  var { createClient } = supabase;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  // Check for session
  var { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    currentUserId = session.user.id;
    await loadCompanyId();
  }
  
  // Listen for auth changes
  supabaseClient.auth.onAuthStateChange(function(event, session) {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      currentUserId = session ? session.user.id : null;
      if (session) {
        loadCompanyId().then(function() { _notifyAuth(); });
      }
    } else if (event === 'SIGNED_OUT') {
      currentUserId = null;
      currentCompanyId = null;
      localStorage.removeItem('tradeaux_company_id');
      _notifyAuth();
    }
  });
  
  _authReady = true;
  _notifyAuth();
  return supabaseClient;
}

async function loadCompanyId() {
  if (!supabaseClient || !currentUserId) return null;
  
  // Check localStorage first
  var stored = localStorage.getItem('tradeaux_company_id');
  if (stored) {
    var { data: v } = await supabaseClient
      .from('companies')
      .select('id')
      .eq('id', stored)
      .eq('user_id', currentUserId)
      .maybeSingle();
    if (v) {
      currentCompanyId = stored;
      return stored;
    }
    localStorage.removeItem('tradeaux_company_id');
  }
  
  // Fetch from Supabase
  var { data, error } = await supabaseClient
    .from('companies')
    .select('*')
    .eq('user_id', currentUserId)
    .limit(1);
  
  if (error || !data || !data.length) {
    // Create company
    var slug = 'seller-' + currentUserId;
    var { data: created, error: cErr } = await supabaseClient
      .from('companies')
      .insert({
        user_id: currentUserId,
        name: 'YOUR COMPANY',
        slug: slug,
        verified: 'pending',
        cert_toggles: { incorporation: true }
      })
      .select();
    if (cErr) {
      console.error('Company creation failed:', cErr);
      return null;
    }
    data = created;
  }
  
  if (data && data.length) {
    currentCompanyId = data[0].id;
    localStorage.setItem('tradeaux_company_id', currentCompanyId);
  }
  return currentCompanyId;
}

function getSupabase() { return supabaseClient; }
function getUserId() { return currentUserId; }
function getCompanyId() { return currentCompanyId || localStorage.getItem('tradeaux_company_id'); }

function onAuthReady(cb) {
  if (_authReady) cb();
  else _authCallbacks.push(cb);
}

function _notifyAuth() {
  _authCallbacks.forEach(function(cb) { try { cb(); } catch(e) {} });
  _authCallbacks = [];
  var evt = new CustomEvent('tradeaux:auth', {
    detail: { userId: currentUserId, companyId: currentCompanyId }
  });
  window.dispatchEvent(evt);
  if (window.parent && window.parent !== window) {
    window.parent.dispatchEvent(evt);
  }
}

function signOut() {
  if (supabaseClient) {
    supabaseClient.auth.signOut();
  }
  currentUserId = null;
  currentCompanyId = null;
  localStorage.removeItem('tradeaux_company_id');
  _notifyAuth();
}