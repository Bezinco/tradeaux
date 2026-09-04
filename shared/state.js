// TradeAux Shared State
const APP_STATE = {
  company: {
    name: '', reg: '', country: '', tax: '', address: '', email: '', phone: '', website: '',
    verified: 'pending', logo: null, photos: [], documents: {}, cert_toggles: { incorporation: true }
  },
  products: [],
  orders: [],
  receivables: [],
  briefs: [],
  archivedAuctions: [],
  tar: { conversionFee: 25, dailyLimit: 500, batchSize: 50, todayConversions: 0, todayConversionsDate: '', totalConversions: 0, totalFeesPaid: 0 },
  wallet: { balance: 0 },
  lastUpdated: null
};

function loadState() {
  try {
    var raw = localStorage.getItem('tradeaux_app_state');
    if (raw) Object.assign(APP_STATE, JSON.parse(raw));
  } catch(e) {}
  return APP_STATE;
}

function saveState(updates) {
  Object.assign(APP_STATE, updates);
  APP_STATE.lastUpdated = new Date().toISOString();
  try {
    var slim = JSON.parse(JSON.stringify(APP_STATE));
    slim.company.logo = null;
    slim.company.photos = [];
    slim.company.documents = {};
    slim.products = slim.products.map(function(p) { var c = Object.assign({}, p); c.images = []; return c; });
    localStorage.setItem('tradeaux_app_state', JSON.stringify(slim));
  } catch(e) {}
  var evt = new CustomEvent('tradeaux:state', { detail: APP_STATE });
  window.dispatchEvent(evt);
  if (window.parent && window.parent !== window) window.parent.dispatchEvent(evt);
}

function listenState(cb) {
  window.addEventListener('tradeaux:state', function(e) { cb(e.detail); });
}

function getFee() { return APP_STATE.tar && APP_STATE.tar.conversionFee > 0 ? APP_STATE.tar.conversionFee : 25; }
function getGlobalLimit() { return 10000; }