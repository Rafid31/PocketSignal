// PocketSignal Pro - FINAL HYBRID VERSION (WS + DOM + DRAG)
(function() {
  let candles = [];
  let currentCandle = null;
  let signalBox = null;
  let lastPrice = 0;
  let supportLevels = [];
  let resistanceLevels = [];
  let dataFound = false;

  // ==========================================
  // 1. WebSocket Interceptor
  // ==========================================
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
    if (data.candles) data.candles.forEach(c => processCandle(c));
    if (data.quotes) data.quotes.forEach(q => q[1] && updatePrice(q[1], q[0]));
  }

  // ==========================================
  // 2. DOM Scraper (Robust Pattern Matching)
  // ==========================================
  function scrapeDOM() {
    try {
      const allText = document.body.innerText;
      // Look for price patterns like 1.15594 or 0.88213
      const matches = allText.match(/\d\.\d{4,6}/g);
      if (matches && matches.length > 0) {
        // Use the first match that looks like a real-time price
        const val = parseFloat(matches[0]);
        if (val > 0 && val !== lastPrice) {
          updatePrice(val, Date.now()/1000);
          dataFound = true;
          return;
        }
      }
      
      // Target specific known price elements
      const target = document.querySelector('[class*="price-value"]') || 
                     document.querySelector('[class*="quote-item__price"]') ||
                     document.querySelector('.current-price');
      if (target && target.innerText) {
        const val = parseFloat(target.innerText.replace(/[^0-9.]/g, ''));
        if (!isNaN(val) && val > 0) {
          updatePrice(val, Date.now()/1000);
          dataFound = true;
        }
      }
    } catch(e) {}
  }

  function updatePrice(price, time) {
    lastPrice = price;
    const minute = Math.floor(time/60)*60;
    if (!currentCandle || currentCandle.time !== minute) {
      if (currentCandle) {
        candles.push({...currentCandle});
        if (candles.length > 50) candles.shift();
      }
      currentCandle = {time: minute, open: price, close: price, high: price, low: price};
    } else {
      currentCandle.close = price;
      currentCandle.high = Math.max(currentCandle.high, price);
      currentCandle.low = Math.min(currentCandle.low, price);
    }
  }

  function processCandle(c) {
    const candle = {
      time: c[0] || c.time,
      open: parseFloat(c[1] || c.open),
      close: parseFloat(c[2] || c.close),
      high: parseFloat(c[3] || c.high),
      low: parseFloat(c[4] || c.low)
    };
    if (!candles.find(prev => prev.time === candle.time)) {
      candles.push(candle);
      if (candles.length > 50) candles.shift();
    }
  }

  // ==========================================
  // 3. Signal Engine
  // ==========================================
  function analyze() {
    if (!dataFound && candles.length < 3) {
      return {sig: 'WAIT', conf: '--', reason: 'Scanning Chart...', color: '#888'};
    }
    
    const last = lastPrice;
    const open = currentCandle ? currentCandle.open : lastPrice;
    
    let score = 0;
    if (last > open) score += 2; else score -= 2;
    
    // Trend from candles
    if (candles.length > 2) {
      const lastC = candles[candles.length-1];
      if (lastC.close > lastC.open) score += 1; else score -= 1;
    }

    if (score > 0) return {sig: 'UP', conf: 70 + (score*5) + '%', reason: 'Strong Buying Flow ↑', color: '#00ff00'};
    if (score < 0) return {sig: 'DOWN', conf: 70 + (Math.abs(score)*5) + '%', reason: 'Strong Selling Flow ↓', color: '#ff0000'};
    return {sig: 'WAIT', conf: '50%', reason: 'Market Neutral', color: '#ffaa00'};
  }

  // ==========================================
  // 4. UI & Drag
  // ==========================================
  function createUI() {
    if (document.getElementById('ps-box')) return;
    signalBox = document.createElement('div');
    signalBox.id = 'ps-box';
    signalBox.style = 'position:fixed; top:120px; right:30px; width:220px; background:rgba(26,26,46,0.95); border:2px solid #0f3460; border-radius:15px; padding:20px; z-index:1000000; color:white; font-family:sans-serif; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.8); cursor:move; backdrop-filter:blur(10px);';
    signalBox.innerHTML = `
      <div style="font-size:9px; opacity:0.5; margin-bottom:10px;">DRAG TO POSITION</div>
      <div id="ps-sig" style="font-size:40px; font-weight:bold; letter-spacing:2px;">WAIT</div>
      <div id="ps-conf" style="font-size:24px; color:#ffd700; font-weight:bold; margin:5px 0;">--</div>
      <div id="ps-reason" style="font-size:12px; opacity:0.8; min-height:30px;">Initializing...</div>
      <div id="ps-time" style="font-size:16px; margin-top:10px; opacity:0.6; font-weight:bold;">--</div>
    `;
    document.body.appendChild(signalBox);
    
    // Smooth Draggable
    let p1=0, p2=0, p3=0, p4=0;
    signalBox.onmousedown = (e) => {
      p3 = e.clientX; p4 = e.clientY;
      document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
      document.onmousemove = (e) => {
        p1 = p3 - e.clientX; p2 = p4 - e.clientY;
        p3 = e.clientX; p4 = e.clientY;
        signalBox.style.top = (signalBox.offsetTop - p2) + "px";
        signalBox.style.left = (signalBox.offsetLeft - p1) + "px";
        signalBox.style.right = 'auto';
      };
    };
  }

  function update() {
    scrapeDOM(); // Constant fallback
    const res = analyze();
    const sigEl = document.getElementById('ps-sig');
    if (sigEl) {
      sigEl.innerText = res.sig;
      sigEl.style.color = res.color;
      document.getElementById('ps-conf').innerText = res.conf;
      document.getElementById('ps-reason').innerText = res.reason;
      const secs = 60 - new Date().getSeconds();
      document.getElementById('ps-time').innerText = secs + 's';
      
      if (secs <= 10 && res.sig !== 'WAIT') {
        signalBox.style.borderColor = '#ff6b6b';
      } else {
        signalBox.style.borderColor = '#0f3460';
      }
    }
  }

  setTimeout(() => {
    createUI();
    setInterval(update, 800);
    console.log('PocketSignal FINAL Version Active');
  }, 1000);
})();
