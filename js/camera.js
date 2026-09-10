(function () {
  'use strict';

  var codeInput = document.getElementById('codeInput');
  var genBtn = document.getElementById('genBtn');
  var startBtn = document.getElementById('startBtn');
  var setupCard = document.getElementById('setupCard');
  var runCard = document.getElementById('runCard');
  var codeDisplay = document.getElementById('codeDisplay');
  var copyBtn = document.getElementById('copyBtn');
  var switchBtn = document.getElementById('switchBtn');
  var stopBtn = document.getElementById('stopBtn');
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var preview = document.getElementById('preview');
  var galleryCard = document.getElementById('galleryCard');
  var gallery = document.getElementById('gallery');
  var clearBtn = document.getElementById('clearBtn');
  var overlay = document.getElementById('overlay');
  var overlayImg = document.getElementById('overlayImg');
  var overlayClose = document.getElementById('overlayClose');

  var peer = null;
  var localStream = null;
  var facing = 'environment';
  var running = false;
  var reconnectTimer = null;
  var motionTimer = null;
  var mediaConns = [];
  var dataConns = [];
  var motionCanvas = null;
  var motionCtx = null;
  var prevFrame = null;
  var lastMotionAt = 0;
  var db = null;

  var MOTION_INTERVAL = 600;
  var MOTION_COOLDOWN = 5000;
  var MOTION_THRESHOLD = 0.02;

  genBtn.addEventListener('click', function () {
    codeInput.value = Math.random().toString(36).slice(2, 10);
  });
  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  switchBtn.addEventListener('click', switchCamera);
  copyBtn.addEventListener('click', copyCode);
  clearBtn.addEventListener('click', clearSnaps);
  overlayClose.addEventListener('click', function () { overlay.hidden = true; });
  overlay.addEventListener('click', function () { overlay.hidden = true; });

  function setStatus(state, text) {
    statusDot.className = 'dot ' + state;
    statusText.textContent = text;
  }

  function getMedia() {
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  }

  async function start() {
    if (typeof Peer === 'undefined') { alert('信令库加载失败，请检查网络后刷新重试'); return; }
    var code = codeInput.value.trim();
    if (code.length < 6) { alert('设备码至少 6 位'); return; }
    startBtn.disabled = true;
    try {
      localStream = await getMedia();
    } catch (e) {
      startBtn.disabled = false;
      alert('无法打开摄像头/麦克风：' + e.message + '\n请确认已授权相机和麦克风，且页面为 HTTPS 访问。');
      return;
    }
    preview.srcObject = localStream;
    try { await preview.play(); } catch (e) {}
    var peerId = await codeToPeerId(code);
    setupCard.hidden = true;
    runCard.hidden = false;
    galleryCard.hidden = false;
    codeDisplay.textContent = code;
    running = true;
    facing = 'environment';
    connectPeer(peerId);
    startMotion();
    refreshGallery();
  }

  function stop() {
    running = false;
    clearTimeout(reconnectTimer);
    if (motionTimer) { clearInterval(motionTimer); motionTimer = null; }
    mediaConns.forEach(function (c) { try { c.close(); } catch (e) {} });
    dataConns.forEach(function (c) { try { c.close(); } catch (e) {} });
    mediaConns = [];
    dataConns = [];
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
    preview.srcObject = null;
    prevFrame = null;
    runCard.hidden = true;
    galleryCard.hidden = true;
    setupCard.hidden = false;
    startBtn.disabled = false;
  }

  function connectPeer(peerId) {
    if (!running) return;
    clearTimeout(reconnectTimer);
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    peer = new Peer(peerId, PEER_CONFIG);
    peer.on('open', function () {
      setStatus('on', '信令已连接，等待观看端接入');
    });
    peer.on('disconnected', function () {
      if (!running) return;
      setStatus('wait', '连接断开，正在重连…');
      if (!peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
    });
    peer.on('close', function () {
      if (!running) return;
      setStatus('wait', '连接关闭，3 秒后重连…');
      reconnectTimer = setTimeout(function () { connectPeer(peerId); }, 3000);
    });
    peer.on('error', function (err) {
      if (!running) return;
      if (err.type === 'unavailable-id' || err.type === 'peer-unavailable' || err.type === 'network') {
        setStatus('wait', '网络异常，5 秒后重连…');
        reconnectTimer = setTimeout(function () { connectPeer(peerId); }, 5000);
      } else {
        setStatus('off', '信令错误：' + err.type);
      }
    });
    peer.on('connection', onConnection);
  }

  function callViewer(viewerId) {
    if (!running || !peer || !localStream) return;
    var existing = mediaConns.some(function (c) { return c.peer === viewerId && c.open; });
    if (existing) return;
    var call;
    try {
      call = peer.call(viewerId, localStream);
    } catch (e) { return; }
    mediaConns.push(call);
    call.on('close', function () {
      mediaConns = mediaConns.filter(function (c) { return c !== call; });
      updateWatchCount();
    });
    call.on('error', function () {
      mediaConns = mediaConns.filter(function (c) { return c !== call; });
      updateWatchCount();
    });
    updateWatchCount();
  }

  function onConnection(conn) {
    conn.on('open', function () {
      dataConns.push(conn);
      conn.on('data', function (data) { onCommand(data, conn); });
      conn.on('close', function () {
        dataConns = dataConns.filter(function (c) { return c !== conn; });
        var viewerId = conn.peer;
        mediaConns.filter(function (c) { return c.peer === viewerId; }).forEach(function (c) {
          try { c.close(); } catch (e) {}
        });
      });
    });
    conn.on('error', function () {});
  }

  async function onCommand(data, conn) {
    if (typeof data !== 'string') return;
    if (data === 'callme') {
      callViewer(conn.peer);
      return;
    }
    if (data !== 'snap') return;
    var buf;
    try { buf = await captureJpeg(1280, 0.7); } catch (e) { return; }
    var header = JSON.stringify({ t: 'snap', ts: Date.now(), size: buf.byteLength });
    dataConns.forEach(function (c) {
      try { c.send(header); c.send(buf); } catch (e) {}
    });
  }

  function updateWatchCount() {
    if (!running) return;
    if (mediaConns.length > 0) {
      setStatus('on', '正在被观看（' + mediaConns.length + ' 个观看端）');
    } else {
      setStatus('on', '信令已连接，等待观看端接入');
    }
  }

  function captureJpeg(maxWidth, quality) {
    return new Promise(function (resolve, reject) {
      if (!preview.videoWidth) { reject(new Error('no video')); return; }
      var vw = preview.videoWidth;
      var vh = preview.videoHeight;
      var scale = Math.min(1, maxWidth / vw);
      var c = document.createElement('canvas');
      c.width = Math.round(vw * scale);
      c.height = Math.round(vh * scale);
      c.getContext('2d').drawImage(preview, 0, 0, c.width, c.height);
      c.toBlob(function (blob) {
        if (!blob) { reject(new Error('capture failed')); return; }
        blob.arrayBuffer().then(resolve, reject);
      }, 'image/jpeg', quality);
    });
  }

  function startMotion() {
    motionCanvas = document.createElement('canvas');
    motionCanvas.width = 64;
    motionCanvas.height = 48;
    motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
    prevFrame = null;
    lastMotionAt = 0;
    if (motionTimer) clearInterval(motionTimer);
    motionTimer = setInterval(detectMotion, MOTION_INTERVAL);
  }

  function detectMotion() {
    if (!running || !localStream || !preview.videoWidth) return;
    try {
      motionCtx.drawImage(preview, 0, 0, 64, 48);
    } catch (e) { return; }
    var data = motionCtx.getImageData(0, 0, 64, 48).data;
    if (!prevFrame) { prevFrame = data; return; }
    var diff = 0;
    for (var i = 0; i < data.length; i += 4) {
      diff += Math.abs(data[i] - prevFrame[i]) + Math.abs(data[i + 1] - prevFrame[i + 1]) + Math.abs(data[i + 2] - prevFrame[i + 2]);
    }
    var ratio = diff / ((data.length / 4) * 3 * 255);
    prevFrame = data;
    if (ratio <= MOTION_THRESHOLD) return;
    var now = Date.now();
    if (now - lastMotionAt < MOTION_COOLDOWN) return;
    lastMotionAt = now;
    onMotion(now);
  }

  async function onMotion(ts) {
    var buf;
    try { buf = await captureJpeg(960, 0.6); } catch (e) { return; }
    try { await storeSnap(ts, buf); } catch (e) {}
    var header = JSON.stringify({ t: 'motion', ts: ts, size: buf.byteLength });
    dataConns.forEach(function (c) {
      try { c.send(header); c.send(buf); } catch (e) {}
    });
    refreshGallery();
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('homecam-snaps', 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('snaps')) {
          req.result.createObjectStore('snaps', { keyPath: 'ts' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function storeSnap(ts, buf) {
    if (!db) db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('snaps', 'readwrite');
      tx.objectStore('snaps').put({ ts: ts, buf: buf });
      tx.oncomplete = function () {
        var keysReq = db.transaction('snaps', 'readonly').objectStore('snaps').getAllKeys();
        keysReq.onsuccess = function () {
          var keys = keysReq.result.sort(function (a, b) { return a - b; });
          if (keys.length > 100) {
            var del = db.transaction('snaps', 'readwrite');
            keys.slice(0, keys.length - 100).forEach(function (k) {
              del.objectStore('snaps').delete(k);
            });
          }
          resolve();
        };
        keysReq.onerror = function () { resolve(); };
      };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function loadSnaps() {
    return new Promise(function (resolve, reject) {
      openDb().then(function (database) {
        var req = database.transaction('snaps', 'readonly').objectStore('snaps').getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      }, reject);
    });
  }

  function clearSnaps() {
    openDb().then(function (database) {
      var tx = database.transaction('snaps', 'readwrite');
      tx.objectStore('snaps').clear();
      tx.oncomplete = function () { refreshGallery(); };
    }).catch(function () {});
  }

  function refreshGallery() {
    loadSnaps().then(function (items) {
      gallery.innerHTML = '';
      items.sort(function (a, b) { return b.ts - a.ts; }).forEach(function (item) {
        var blob = new Blob([item.buf], { type: 'image/jpeg' });
        var url = URL.createObjectURL(blob);
        var el = document.createElement('div');
        el.className = 'snap';
        var img = document.createElement('img');
        img.src = url;
        img.alt = formatTime(item.ts);
        img.addEventListener('click', function () {
          overlayImg.src = url;
          overlay.hidden = false;
        });
        var t = document.createElement('div');
        t.className = 'snap-time';
        t.textContent = formatTime(item.ts);
        el.appendChild(img);
        el.appendChild(t);
        gallery.appendChild(el);
      });
    }).catch(function () {});
  }

  async function switchCamera() {
    if (!running || !localStream) return;
    switchBtn.disabled = true;
    facing = facing === 'environment' ? 'user' : 'environment';
    var next;
    try {
      next = await getMedia();
    } catch (e) {
      switchBtn.disabled = false;
      alert('切换失败：' + e.message);
      return;
    }
    var old = localStream;
    localStream = next;
    preview.srcObject = next;
    mediaConns.forEach(function (conn) {
      var pc = conn.peerConnection;
      if (!pc) return;
      pc.getSenders().forEach(function (sender) {
        if (!sender.track) return;
        var track = next.getTracks().find(function (t) { return t.kind === sender.track.kind; });
        if (track) sender.replaceTrack(track).catch(function () {});
      });
    });
    old.getTracks().forEach(function (t) { t.stop(); });
    switchBtn.disabled = false;
  }

  function copyCode() {
    var code = codeDisplay.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        alert('已复制');
      }, function () {
        prompt('请手动复制：', code);
      });
    } else {
      prompt('请手动复制：', code);
    }
  }
})();
