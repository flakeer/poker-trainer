
/* Single-tab guard: the bank lives in localStorage, so two tabs at once could duplicate coins.
   The first tab keeps a heartbeat; any later tab is locked out until the first one closes. */
(function () {
  var K = 'poker.alive', id = Math.random().toString(36).slice(2), o = null;
  try { o = JSON.parse(localStorage.getItem(K) || 'null'); } catch (e) {}
  window.__pokerLocked = !!(o && o.id !== id && Date.now() - o.t < 90000);
  if (!window.__pokerLocked) {
    var beat = function () { try { localStorage.setItem(K, JSON.stringify({ id: id, t: Date.now() })); } catch (e) {} };
    beat(); setInterval(beat, 5000);
    addEventListener('pageshow', beat);
    addEventListener('pagehide', function () { try { var c = JSON.parse(localStorage.getItem(K) || 'null'); if (c && c.id === id) localStorage.removeItem(K); } catch (e) {} });
    return;
  }
  var ov = document.createElement('div');
  ov.id = 'tablock';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#07080dfa;color:#e8ecff;font:16px/1.5 system-ui,sans-serif';
  ov.innerHTML = '<div style="max-width:420px"><div style="font:800 2rem sans-serif;color:#19e3ff;margin-bottom:10px">POKER.</div><b>Poker is already open in another tab or window.</b><p style="color:#8a92b8">Your coins are shared between tabs, so only one can play at a time. Close the other one, then reload this page. If you just closed it, wait a minute and reload.</p></div>';
  Array.prototype.forEach.call(document.body.children, function (el) { if (el.tagName !== 'SCRIPT') el.inert = true; });
  document.body.appendChild(ov);
})();
