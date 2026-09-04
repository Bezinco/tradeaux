// TradeAux Shared Utilities
function $(id) { return document.getElementById(id); }

function money(n) {
  return (n == null || isNaN(n)) ? '$0.00' :
    '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripHtml(s) {
  if (s == null) return '';
  return String(s).replace(/<[^>]*>/g, '');
}

function uuid() {
  return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function safeDate(d, opts) {
  if (!d) return 'N/A';
  var date = new Date(d);
  return isNaN(date.getTime()) ? 'N/A' :
    (opts ? date.toLocaleString(undefined, opts) : date.toLocaleDateString());
}

function showToast(msg, type) {
  type = type || 'info';
  if (window.parent !== window && window.parent.__showToast) {
    window.parent.__showToast(msg, type);
    return;
  }
  var container = $('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg.length > 120 ? msg.substring(0, 117) + '...' : msg;
  container.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('show'); });
  setTimeout(function() {
    t.classList.remove('show');
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
  }, 4000);
}

function openImageDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('TradeAuxImages', 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function() { reject(req.error); };
  });
}

async function saveImagesToIDB(data) {
  try {
    var db = await openImageDB();
    var tx = db.transaction('images', 'readwrite');
    var store = tx.objectStore('images');
    (data.products || []).forEach(function(p) {
      if (p.images && p.images.length) store.put({ id: 'product_' + p.id, images: p.images });
    });
    if (data.company) {
      if (data.company.logo) store.put({ id: 'company_logo', image: data.company.logo });
      if (data.company.photos && data.company.photos.length) store.put({ id: 'company_photos', photos: data.company.photos });
      if (data.company.documents && Object.keys(data.company.documents).length) store.put({ id: 'company_documents', documents: data.company.documents });
    }
    await new Promise(function(res, rej) { tx.oncomplete = res; tx.onerror = rej; });
  } catch(e) { console.warn('IDB save failed:', e); }
}

async function loadImagesFromIDB(products, company) {
  try {
    var db = await openImageDB();
    var tx = db.transaction('images', 'readonly');
    var store = tx.objectStore('images');
    var out = { products: products || [], company: company || {} };
    await Promise.all((out.products).map(function(p) {
      return new Promise(function(res) {
        var r = store.get('product_' + p.id);
        r.onsuccess = function() { if (r.result) p.images = r.result.images || []; res(); };
        r.onerror = res;
      });
    }));
    var logo = store.get('company_logo');
    await new Promise(function(res) { logo.onsuccess = function() { if (logo.result) out.company.logo = logo.result.image; res(); }; logo.onerror = res; });
    var photos = store.get('company_photos');
    await new Promise(function(res) { photos.onsuccess = function() { if (photos.result) out.company.photos = photos.result.photos || []; res(); }; photos.onerror = res; });
    var docs = store.get('company_documents');
    await new Promise(function(res) { docs.onsuccess = function() { if (docs.result) out.company.documents = docs.result.documents || {}; res(); }; docs.onerror = res; });
    return out;
  } catch(e) { return { products: products || [], company: company || {} }; }
}