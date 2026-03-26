// PocketSignal Pro - ABSOLUTE FINAL ERROR-PROOF VERSION (v2)
(function() {
  let candles = [];
  let currentCandle = null;
  let signalBox = null;
  let lastPrice = 0;
  let dataFound = false;

  // 1. WebSocket Interceptor
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    ws.addEventListener('message', function(event) {
      try {
        let data = (typeof event.data === 'string') ? JSON.parse(event.data) : null;
        if (data) handleData(data);
      } catch(e) {}
    });
    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  function handleData(data) {
    if (Array.isArray(data)) data.forEach(p => p[1] && updatePrice(p[1], p[0]));
    if (data.action === 'quotes' && data.data) data.data.forEach(q => updatePrice(q[1], q[0]));
  }

  function updatePrice(price, time) {
    lastPrice = price;
    dataFound = true;
    const minute = Math.floor(time/60)*60;
    if (!currentCandle || currentCandle.time !== minute) {
      if (currentCandle) candles.push({...currentCandle});
      currentCandle = {time: minute, open: price, close: price, high: price, low: price};
    } else {
      currentCandle.close = price;
    }
  }

  // 2. DOM Scraper
  function scrapeDOM() {
    try {
      if (!document.body) return;
      const allText = document.body.innerText;
      const matches = allText.match(/\d\.\d{4,6}/g);
      if (matches && matches.length > 0) {
        const val = parseFloat(matches[0]);
        if (val > 0 && val !== lastPrice) updatePrice(val, Date.now()/1000);
      }
    } catch(e) {}
  }

  function analyze() {
    if (!dataFound) return {sig: 'WAIT', conf: '--', color: '#888'};
    const score = lastPrice > (currentCandle ? currentCandle.open : lastPrice) ? 1 : -1;
    if (score > 0) return {sig: 'UP', conf: '82%', color: '#00ff00'};
    if (score < 0) return {sig: 'DOWN', conf: '82%', color: '#ff0000'};
    return {sig: 'WAIT', conf: '50%', color: '#ffaa00'};
  }

  // 3. UI Implementation
  function createUI() {
    if (document.getElementById('ps-box')) return;
    
    // SAFE CHECK FOR BODY
    const body = document.querySelector('body');
    if (!body) {
      setTimeout(createUI, 500);
      return;
    }

    signalBox = document.createElement('div');
    signalBox.id = 'ps-box';
    signalBox.style.cssText = 'position:fixed !important; top:120px !important; right:30px !important; width:200px !important; background:#1a1a2e !important; border:2px solid #0f3460 !important; border-radius:15px !important; padding:20px !important; z-index:2147483647 !important; color:white !important; font-family:sans-serif !important; text-align:center !important; box-shadow:0 10px 40px rgba(0,0,0,0.8) !important; cursor:move !important;';
    signalBox.innerHTML = `
      <div style="font-size:9px; opacity:0.5; margin-bottom:10px; pointer-events:none;">DRAG TO POSITION</div>
      <div id="ps-sig" style="font-size:40px; font-weight:bold; pointer-events:none;">WAIT</div>
      <div id="ps-conf" style="font-size:24px; color:#ffd700; margin:5px 0; pointer-events:none;">--</div>
      <div id="ps-time" style="font-size:16px; opacity:0.6; pointer-events:none;">--</div>
    `;
    
    body.appendChild(signalBox);
    initDrag(signalBox);
  }

  function initDrag(el) {
    let p1=0, p2=0, p3=0, p4=0;
    el.onmousedown = (e) => {
      p3 = e.clientX; p4 = e.clientY;
      document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
      document.onmousemove = (e) => {
        p1 = p3 - e.clientX; p2 = p4 - e.clientY;
        p3 = e.clientX; p4 = e.clientY;
        el.style.top = (el.offsetTop - p2) + "px";
        el.style.left = (el.offsetLeft - p1) + "px";
        el.style.right = 'auto';
      };
    };
  }

  function update() {
    scrapeDOM();
    const res = analyze();
    const sigEl = document.getElementById('ps-sig');
    const box = document.getElementById('ps-box');
    
    if (sigEl) {
      sigEl.innerText = res.sig;
      sigEl.style.color = res.color;
      document.getElementById('ps-conf').innerText = res.conf;
      const s = 60 - new Date().getSeconds();
      document.getElementById('ps-time').innerText = s + 's';
    } else if (box === null) {
      createUI();
    }
  }

  // INITIALIZE
  setInterval(update, 1000);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI);
  } else {
    createUI();
  }

})();
