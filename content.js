// PocketSignal Pro - ULTRA FIXED VERSION (WS + DOM Scraping + Draggable)
(function() {
  let candles = [];
  let currentCandle = null;
  let signalBox = null;
  let lastPrice = 0;
  let supportLevels = [];
  let resistanceLevels = [];

  // ==========================================
  // 1. WebSocket Interceptor (Real-time data)
  // ==========================================
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    ws.addEventListener('message', function(event) {
      try {
        let data = (typeof event.data === 'string') ? JSON.parse(event.data) : null;
        if (data) handleBrokerData(data);
      } catch(e) {}
    });
    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  function handleBrokerData(data) {
    // Pocket Option specific data patterns
    if (Array.isArray(data)) data.forEach(p => p[1] && updatePrice(p[1], p[0]));
    if (data.action === 'quotes' && data.data) data.data.forEach(q => updatePrice(q[1], q[0]));
    if (data.candles) data.candles.forEach(c => processCandle(c));
  }

  // ==========================================
  // 2. DOM Scraper Fallback (If WS fails)
  // ==========================================
  function scrapeDOM() {
    try {
      // Find the price in the broker's UI elements
      const priceSelectors = ['.chart-candle__price', '.price-value', '.quote-item__price', '[class*="price"]'];
      for (let selector of priceSelectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText) {
          const val = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
          if (!isNaN(val) && val > 0 && val !== lastPrice) {
            updatePrice(val, Date.now()/1000);
            return;
          }
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
        if (candles.length > 100) candles.shift();
        computeSR();
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
      if (candles.length > 100) candles.shift();
    }
  }

  // ==========================================
  // 3. Technical Analysis
  // ==========================================
  function computeSR() {
    if (candles.length < 10) return;
    const highs = candles.slice(-30).map(c => c.high);
    const lows = candles.slice(-30).map(c => c.low);
    resistanceLevels = [Math.max(...highs)];
    supportLevels = [Math.min(...lows)];
  }

  function analyze() {
    if (candles.length < 5 && !currentCandle) return {sig: 'WAIT', conf: 0, reason: 'Reading Chart...', color: '#888'};
    
    const closes = candles.map(c => c.close);
    if (currentCandle) closes.push(currentCandle.close);
    
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    
    let bull = 0, bear = 0;
    if (last > prev) bull += 2; else bear += 2;
    if (last > lastPrice) bull += 1; else bear += 1;
    
    // Simple logic for real-time responsiveness
    const diff = bull - bear;
    if (diff > 0) return {sig: 'UP', conf: 75 + diff, reason: 'Strong Bullish Flow ↑', color: '#00ff00'};
    if (diff < 0) return {sig: 'DOWN', conf: 75 + Math.abs(diff), reason: 'Strong Bearish Flow ↓', color: '#ff0000'};
    return {sig: 'WAIT', conf: 50, reason: 'Market Neutral', color: '#ffaa00'};
  }

  // ==========================================
  // 4. Draggable UI
  // ==========================================
  function makeDraggable(el) {
    let p1=0, p2=0, p3=0, p4=0;
    el.onmousedown = function(e) {
      e.preventDefault();
      p3 = e.clientX; p4 = e.clientY;
      document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
      document.onmousemove = function(e) {
        e.preventDefault();
        p1 = p3 - e.clientX; p2 = p4 - e.clientY;
        p3 = e.clientX; p4 = e.clientY;
        el.style.top = (el.offsetTop - p2) + "px";
        el.style.left = (el.offsetLeft - p1) + "px";
        el.style.right = 'auto';
      };
    };
  }

  function createUI() {
    if (document.getElementById('ps-box')) return;
    signalBox = document.createElement('div');
    signalBox.id = 'ps-box';
    signalBox.style = 'position:fixed; top:150px; right:30px; width:220px; background:#1a1a2e; border:2px solid #0f3460; border-radius:15px; padding:20px; z-index:999999; color:white; font-family:sans-serif; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,0.6); cursor:move;';
    signalBox.innerHTML = '<div style="font-size:10px; opacity:0.6;">DRAG TO MOVE</div><div id="ps-sig" style="font-size:36px; font-weight:bold;">WAIT</div><div id="ps-conf" style="font-size:24px; color:#ffd700;">--</div><div id="ps-reason" style="font-size:12px; margin:10px 0;">Starting...</div><div id="ps-time" style="font-size:18px; opacity:0.7;">--</div>';
    document.body.appendChild(signalBox);
    makeDraggable(signalBox);
  }

  function refresh() {
    scrapeDOM(); // Constant fallback
    const data = analyze();
    const sigEl = document.getElementById('ps-sig');
    if (sigEl) {
      sigEl.innerText = data.sig;
      sigEl.style.color = data.color;
      document.getElementById('ps-conf').innerText = data.conf + '%';
      document.getElementById('ps-reason').innerText = data.reason;
      const s = 60 - new Date().getSeconds();
      document.getElementById('ps-time').innerText = s + 's';
    }
  }

  setTimeout(() => {
    createUI();
    setInterval(refresh, 1000);
    console.log('PocketSignal Pro: Fixed & Running!');
  }, 2000);
})();
