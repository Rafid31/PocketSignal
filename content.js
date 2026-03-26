// PocketSignal Pro - Fix: WebSocket Interceptor & Draggable UI
(function() {
  let candles = [];
  let currentCandle = null;
  let signalBox = null;
  let supportLevels = [];
  let resistanceLevels = [];

  // ==========================================
  // 1. IMPROVED WebSocket Interceptor
  // ==========================================
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    console.log('PocketSignal: Intercepting WS:', url);
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    
    ws.addEventListener('message', function(event) {
      try {
        let rawData = event.data;
        let data = null;
        
        // Handle binary or string data
        if (typeof rawData === 'string') {
          try { data = JSON.parse(rawData); } catch(e) {}
        }
        
        if (data) parseWSData(data);
      } catch(e) {}
    });
    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  function parseWSData(data) {
    try {
      // Pocket Option specific data patterns
      if (Array.isArray(data)) data.forEach(processCandleItem);
      if (data.candles) data.candles.forEach(processCandleItem);
      if (data.history) data.history.forEach(processCandleItem);
      if (data.action === 'quotes' && data.data) {
        if (Array.isArray(data.data)) data.data.forEach(q => updateCurrentCandle(q[1], q[0]));
      }
      if (data.quotes) data.quotes.forEach(q => { if (q[1]) updateCurrentCandle(q[1], q[0]); });
    } catch(e) {}
  }

  function processCandleItem(item) {
    if (!item) return;
    let candle = null;
    if (Array.isArray(item) && item.length >= 5) {
      candle = {time: item[0], open: parseFloat(item[1]), close: parseFloat(item[2]), high: parseFloat(item[3]), low: parseFloat(item[4])};
    } else if (item.open !== undefined) {
      candle = {
        time: item.time || item.t || Date.now()/1000,
        open: parseFloat(item.open || item.o),
        close: parseFloat(item.close || item.c),
        high: parseFloat(item.high || item.h),
        low: parseFloat(item.low || item.l)
      };
    }
    if (candle && !isNaN(candle.open) && !candles.find(c => c.time === candle.time)) {
      candles.push(candle);
      if (candles.length > 200) candles.shift();
      computeSRLevels();
    }
  }

  function updateCurrentCandle(price, time) {
    price = parseFloat(price);
    if (isNaN(price)) return;
    const minute = Math.floor(time/60)*60;
    if (!currentCandle || currentCandle.time !== minute) {
      if (currentCandle) {
        candles.push({...currentCandle});
        if (candles.length > 200) candles.shift();
        computeSRLevels();
      }
      currentCandle = {time: minute, open: price, close: price, high: price, low: price};
    } else {
      currentCandle.close = price;
      currentCandle.high = Math.max(currentCandle.high, price);
      currentCandle.low = Math.min(currentCandle.low, price);
    }
  }

  function computeSRLevels() {
    if (candles.length < 10) return;
    const last50 = candles.slice(-50);
    const highs = last50.map(c => c.high);
    const lows = last50.map(c => c.low);
    const pivotHighs = [], pivotLows = [];
    for (let i=2; i<last50.length-2; i++) {
      if (highs[i]>highs[i-1] && highs[i]>highs[i-2] && highs[i]>highs[i+1] && highs[i]>highs[i+2]) pivotHighs.push(highs[i]);
      if (lows[i]<lows[i-1] && lows[i]<lows[i-2] && lows[i]<lows[i+1] && lows[i]<lows[i+2]) pivotLows.push(lows[i]);
    }
    resistanceLevels = [...new Set(pivotHighs)].sort((a,b)=>b-a).slice(0,3);
    supportLevels = [...new Set(pivotLows)].sort((a,b)=>a-b).slice(0,3);
  }

  function calcEMA(data, period) {
    if (data.length < period) return null;
    const k = 2/(period+1);
    let ema = data.slice(0,period).reduce((a,b)=>a+b,0)/period;
    for (let i=period; i<data.length; i++) ema = data[i]*k + ema*(1-k);
    return ema;
  }

  function calcRSI(closes, period=14) {
    if (closes.length < period+1) return null;
    let gains=0, losses=0;
    for (let i=closes.length-period; i<closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff>0) gains+=diff;
      else losses+=Math.abs(diff);
    }
    const avgGain=gains/period, avgLoss=losses/period;
    if (avgLoss===0) return 100;
    return 100-(100/(1+(avgGain/avgLoss)));
  }

  function detectPattern(candles) {
    if (candles.length<3) return null;
    const [c1,c2,c3] = candles.slice(-3);
    const body2 = Math.abs(c2.close-c2.open);
    if (body2<(c2.high-c2.low)*0.1) return {pattern:'DOJI', bias:'REVERSAL'};
    if (c1.close<c1.open && c2.close>c2.open && c2.open<c1.close && c2.close>c1.open) return {pattern:'BULLISH ENGULFING', bias:'UP'};
    if (c1.close>c1.open && c2.close<c2.open && c2.open>c1.close && c2.close<c1.open) return {pattern:'BEARISH ENGULFING', bias:'DOWN'};
    return null;
  }

  function nearSR(price) {
    const threshold = 0.0010;
    for (let r of resistanceLevels) if (Math.abs(price-r)<threshold) return {type:'RESISTANCE', level:r};
    for (let s of supportLevels) if (Math.abs(price-s)<threshold) return {type:'SUPPORT', level:s};
    return null;
  }

  function generateSignal() {
    const allCandles = [...candles];
    if (currentCandle) allCandles.push(currentCandle);
    if (allCandles.length < 5) return {signal:'WAIT', reason:'Collecting data...', confidence:0, color:'#888'};
    
    const closes = allCandles.map(c=>c.close);
    const currentPrice = closes[closes.length-1];
    const ema5=calcEMA(closes,5), ema10=calcEMA(closes,10);
    const rsi=calcRSI(closes,14);
    const pattern=detectPattern(allCandles);
    const srZone=nearSR(currentPrice);
    
    let bull=0, bear=0, reasons=[];
    if (ema5 && ema10) { if (ema5>ema10) bull+=2; else bear+=2; }
    if (rsi) { if (rsi>70) bear+=3; else if (rsi<30) bull+=3; }
    if (pattern) { if (pattern.bias==='UP') bull+=3; else if (pattern.bias==='DOWN') bear+=3; }
    if (srZone) { if (srZone.type==='SUPPORT') bull+=2; else bear+=2; }

    const total = bull+bear;
    const confidence = total>0 ? Math.round((Math.max(bull,bear)/total)*100) : 0;
    if (bull>bear) return {signal:'UP', reason:'Momentum Strong ↑', confidence, color:'#00ff00'};
    if (bear>bull) return {signal:'DOWN', reason:'Momentum Strong ↓', confidence, color:'#ff0000'};
    return {signal:'WAIT', reason:'Neutral', confidence:0, color:'#ffaa00'};
  }

  // ==========================================
  // 2. DRAGGABLE UI Implementation
  // ==========================================
  function makeDraggable(el) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    el.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      el.style.top = (el.offsetTop - pos2) + "px";
      el.style.left = (el.offsetLeft - pos1) + "px";
      el.style.right = 'auto'; // Reset right position when dragging
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  function createUI() {
    if (document.getElementById('pocketsignal-box')) return;
    signalBox = document.createElement('div');
    signalBox.id = 'pocketsignal-box';
    signalBox.style.cursor = 'move';
    signalBox.innerHTML = `
      <div style="font-size:10px; color:#aaa; margin-bottom:5px; text-align:center;">DRAG TO MOVE</div>
      <div id="ps-signal">WAIT</div>
      <div id="ps-confidence">0%</div>
      <div id="ps-reason">Initializing...</div>
      <div id="ps-time">--</div>
    `;
    document.body.appendChild(signalBox);
    makeDraggable(signalBox);
  }

  function updateUI() {
    if (!signalBox) createUI();
    const signal = generateSignal();
    const sigEl = document.getElementById('ps-signal');
    const confEl = document.getElementById('ps-confidence');
    const resEl = document.getElementById('ps-reason');
    const timeEl = document.getElementById('ps-time');
    
    if (sigEl) { sigEl.textContent = signal.signal; sigEl.style.color = signal.color; }
    if (confEl) confEl.textContent = signal.confidence+'%';
    if (resEl) resEl.textContent = signal.reason;
    
    const secs = 60 - (new Date().getSeconds());
    if (timeEl) timeEl.textContent = secs+'s';
    
    if (secs <= 10 && signal.signal !== 'WAIT') {
      signalBox.classList.add('ps-alert');
      setTimeout(() => signalBox.classList.remove('ps-alert'), 500);
    }
  }

  // Start after a short delay
  setTimeout(() => {
    createUI();
    setInterval(updateUI, 1000);
    console.log('PocketSignal Pro: Fixed & Draggable UI Active');
  }, 2000);
})();
