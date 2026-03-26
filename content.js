// PocketSignal Pro - OTC Signal Analyzer
(function() {
  let candles = [];
  let currentCandle = null;
  let signalBox = null;
  let supportLevels = [];
  let resistanceLevels = [];

  // WebSocket Interceptor
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    ws.addEventListener('message', function(event) {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : null;
        if (data) parseWSData(data);
      } catch(e) {}
    });
    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  function parseWSData(data) {
    try {
      if (Array.isArray(data)) data.forEach(processCandleItem);
      if (data.candles) data.candles.forEach(processCandleItem);
      if (data.history) data.history.forEach(processCandleItem);
      if (data.asset && data.price) updateCurrentCandle(data.price, data.time || Date.now()/1000);
      if (data.quotes) data.quotes.forEach(q => { if (q[1]) updateCurrentCandle(q[1], q[0]); });
      if (data.action === 'quotes' && data.data && Array.isArray(data.data)) {
        data.data.forEach(q => updateCurrentCandle(q[1], q[0]));
      }
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
    const lowerWick=Math.min(c2.open,c2.close)-c2.low;
    if (lowerWick>body2*2 && c2.close>c2.open) return {pattern:'HAMMER', bias:'UP'};
    const upperWick=c2.high-Math.max(c2.open,c2.close);
    if (upperWick>body2*2 && c2.close<c2.open) return {pattern:'SHOOTING STAR', bias:'DOWN'};
    if (c1.close<c1.open && c2.close<c2.open && c3 && c3.close<c3.open) return {pattern:'3 RED', bias:'DOWN'};
    if (c1.close>c1.open && c2.close>c2.open && c3 && c3.close>c3.open) return {pattern:'3 GREEN', bias:'UP'};
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
    if (allCandles.length<5) return {signal:'WAIT', reason:'Collecting data...', confidence:0, color:'#888'};
    const closes = allCandles.map(c=>c.close);
    const currentPrice = closes[closes.length-1];
    const ema5=calcEMA(closes,5), ema10=calcEMA(closes,10), ema20=calcEMA(closes,20);
    const rsi=calcRSI(closes,14);
    const pattern=detectPattern(allCandles);
    const srZone=nearSR(currentPrice);
    let bullPoints=0, bearPoints=0, reasons=[];
    if (ema5 && ema10) {
      if (ema5>ema10) {bullPoints+=2; reasons.push('EMA5>EMA10 ↑');}
      else {bearPoints+=2; reasons.push('EMA5<EMA10 ↓');}
    }
    if (ema10 && ema20) {
      if (ema10>ema20) bullPoints+=1;
      else bearPoints+=1;
    }
    if (ema5 && currentPrice>ema5) bullPoints+=1;
    else if (ema5) bearPoints+=1;
    if (rsi!==null) {
      if (rsi>70) {bearPoints+=3; reasons.push('RSI '+rsi.toFixed(0)+' OB ↓');}
      else if (rsi<30) {bullPoints+=3; reasons.push('RSI '+rsi.toFixed(0)+' OS ↑');}
      else if (rsi>50) bullPoints+=1;
      else bearPoints+=1;
    }
    if (pattern) {
      if (pattern.bias==='UP') {bullPoints+=3; reasons.push(pattern.pattern+' ↑');}
      else if (pattern.bias==='DOWN') {bearPoints+=3; reasons.push(pattern.pattern+' ↓');}
      else reasons.push(pattern.pattern);
    }
    if (srZone) {
      if (srZone.type==='SUPPORT') {bullPoints+=2; reasons.push('Near SUPPORT ↑');}
      else {bearPoints+=2; reasons.push('Near RESISTANCE ↓');}
    }
    const totalPoints = bullPoints+bearPoints;
    const confidence = totalPoints>0 ? Math.round((Math.max(bullPoints,bearPoints)/totalPoints)*100) : 0;
    if (bullPoints>bearPoints) return {signal:'UP', reason:reasons.slice(0,3).join(', '), confidence, color:'#00ff00'};
    else if (bearPoints>bullPoints) return {signal:'DOWN', reason:reasons.slice(0,3).join(', '), confidence, color:'#ff0000'};
    return {signal:'WAIT', reason:'Neutral', confidence:0, color:'#ffaa00'};
  }

  function createUI() {
    signalBox = document.createElement('div');
    signalBox.id = 'pocketsignal-box';
    signalBox.innerHTML = `
      <div id="ps-signal">Loading...</div>
      <div id="ps-confidence">0%</div>
      <div id="ps-reason">Initializing...</div>
      <div id="ps-time">--</div>
    `;
    document.body.appendChild(signalBox);
  }

  function updateUI() {
    if (!signalBox) return;
    const signal = generateSignal();
    document.getElementById('ps-signal').textContent = signal.signal;
    document.getElementById('ps-signal').style.color = signal.color;
    document.getElementById('ps-confidence').textContent = signal.confidence+'%';
    document.getElementById('ps-reason').textContent = signal.reason;
    const now = new Date();
    const secs = 60 - now.getSeconds();
    document.getElementById('ps-time').textContent = secs+'s';
    if (secs <= 10 && signal.signal !== 'WAIT') {
      signalBox.classList.add('ps-alert');
      setTimeout(() => signalBox.classList.remove('ps-alert'), 500);
    }
  }

  setTimeout(() => {
    createUI();
    setInterval(updateUI, 1000);
  }, 2000);
})();
