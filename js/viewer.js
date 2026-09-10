(function () {
  'use strict';

  var codeInput = document.getElementById('codeInput');
  var connectBtn = document.getElementById('connectBtn');
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var videoCard = document.getElementById('videoCard');
  var remoteVideo = document.getElementById('remoteVideo');
  var snapBtn = document.getElementById('snapBtn');
  var fullscreenBtn = document.getElementById('fullscreenBtn');
  var muteBtn = document.getElementById('muteBtn');
  var eventsCard = document.getElementById('eventsCard');
  var eventList = document.getElementById('eventList');
  var overlay = document.getElementById('overlay');
  var overlayImg = document.getElementById('overlayImg');
  var overlayClose = document.getElementById('overlayClose');

  var peer = null;
  var incoming = null;
  var conn = null;
  var camPeerId = null;
  var retryTimer = null;
  var retryCount = 0;
  var pendingHeader = null;
  var connected = false;
  var muted = false;
  var epoch = 0;
  var waitTimer = null;

  var MAX_RETRY = 60;
  var WAIT_MS = 15000;

  codeInput.value = localStorage.getItem('lastCode') || '';
  connectBtn.addEventListener('click', connect);
  snapBtn.addEventListener('click', requestSnap);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  muteBtn.addEventListener('click', toggleMute);
  overlayClose.addEventListener('click', function () { overlay.hidden = true; });
  overlay.addEventListener('click', function () { overlay.hidden = true; });

  function setStatus(state, text) {
    statusDot.className = 'dot ' + state;
    statusText.textContent = text;
  }

  async function connect() {
    if (typeof Peer === 'undefined') { alert('信令库加载失败，请检查网络后刷新重试'); return; }
    var code = codeInput.value.trim();
    if (code.length < 6) { alert('请输入正确的设备码'); return; }
    localStorage.setItem('lastCode', code);
    camPeerId = await codeToPeerId(code);
    epoch++;
    var myEpoch = epoch;
    cleanup();
    retryCount = 0;
    pendingHeader = null;
    connectBtn.disabled = true;
    setStatus('wait', '正在连接信令服务器…');
    createPeer(myEpoch);
  }

  function createPeer(myEpoch) {
    if (myEpoch !== epoch) return;
    peer = new Peer(PEER_CONFIG);
    peer.on('open', function () {
      if (myEpoch !== epoch) return;
      setStatus('wait', '正在联系相机端…');
      openChannel(myEpoch);
    });
    peer.on('disconnected', function () {
      if (myEpoch !== epoch) return;
      if (!peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
    });
    peer.on('close', function () {
      if (myEpoch !== epoch) return;
      if (!connected) scheduleRetry(myEpoch);
    });
    peer.on('error', function (err) {
      if (myEpoch !== epoch) return;
      if (err.type === 'peer-unavailable') scheduleRetry(myEpoch);
    });
    peer.on('call', function (call) {
      if (myEpoch !== epoch) return;
      handleIncomingCall(call, myEpoch);
    });
  }

  function openChannel(myEpoch) {
    try {
      conn = peer.connect(camPeerId, { serialization: 'binary', reliable: true });
    } catch (e) {
      scheduleRetry(myEpoch);
      return;
    }
    clearTimeout(waitTimer);
    waitTimer = setTimeout(function () {
      if (myEpoch !== epoch) return;
      if (connected) return;
      setStatus('wait', '相机端无响应，正在重试…');
      if (conn) { try { conn.close(); } catch (e) {} }
      scheduleRetry(myEpoch);
    }, WAIT_MS);
    conn.on('open', function () {
      if (myEpoch !== epoch) return;
      setStatus('wait', '已联系到相机端，等待视频建立…');
      try { conn.send('callme'); } catch (e) {}
    });
    conn.on('data', onData);
    conn.on('close', function () {
      if (myEpoch !== epoch) return;
      conn = null;
      if (!connected) scheduleRetry(myEpoch);
    });
    conn.on('error', function (err) {
      if (myEpoch !== epoch) return;
      if (err.type === 'peer-unavailable') scheduleRetry(myEpoch);
    });
  }

  function handleIncomingCall(call, myEpoch) {
    var ok = false;
    try {
      call.answer(new MediaStream());
      ok = true;
    } catch (e) {}
    if (!ok) { scheduleRetry(myEpoch); return; }
    incoming = call;
    call.on('stream', function (stream) {
      if (myEpoch !== epoch) return;
      clearTimeout(waitTimer);
      remoteVideo.srcObject = stream;
      remoteVideo.play().catch(function () {});
      connected = true;
      retryCount = 0;
      videoCard.hidden = false;
      eventsCard.hidden = false;
      connectBtn.disabled = false;
      setStatus('on', '已连接，正在实时观看');
    });
    call.on('close', function () {
      if (myEpoch !== epoch) return;
      incoming = null;
      connected = false;
      remoteVideo.srcObject = null;
      videoCard.hidden = true;
      setStatus('wait', '连接中断，正在重试…');
      scheduleRetry(myEpoch);
    });
    call.on('error', function () {});
  }

  function scheduleRetry(myEpoch) {
    clearTimeout(retryTimer);
    retryCount++;
    if (retryCount > MAX_RETRY) {
      setStatus('off', '相机端离线或设备码错误，请确认相机端已开启');
      connectBtn.disabled = false;
      return;
    }
    setStatus('wait', '相机端暂不可达，5 秒后自动重试（第 ' + retryCount + ' 次）');
    retryTimer = setTimeout(function () {
      if (myEpoch !== epoch) return;
      if (connected) return;
      cleanup();
      setStatus('wait', '正在重新连接…');
      createPeer(myEpoch);
    }, 5000);
  }

  function cleanup() {
    clearTimeout(retryTimer);
    clearTimeout(waitTimer);
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (incoming) { try { incoming.close(); } catch (e) {} incoming = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    remoteVideo.srcObject = null;
    videoCard.hidden = true;
    connected = false;
  }

  function onData(data) {
    if (typeof data === 'string') {
      var m;
      try { m = JSON.parse(data); } catch (e) { pendingHeader = null; return; }
      if (m.t === 'motion' || m.t === 'snap') pendingHeader = m;
      return;
    }
    if (data instanceof ArrayBuffer && pendingHeader && data.byteLength === pendingHeader.size) {
      var h = pendingHeader;
      pendingHeader = null;
      var blob = new Blob([data], { type: 'image/jpeg' });
      addEvent(h.t, h.ts, blob);
    } else {
      pendingHeader = null;
    }
  }

  function addEvent(type, ts, blob) {
    var url = URL.createObjectURL(blob);
    var el = document.createElement('div');
    el.className = 'event';
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.addEventListener('click', function () {
      overlayImg.src = url;
      overlay.hidden = false;
    });
    var info = document.createElement('div');
    info.className = 'event-info';
    var title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = (type === 'motion' ? '检测到移动' : '手动截图') + ' · ' + formatTime(ts);
    info.appendChild(title);
    el.appendChild(img);
    el.appendChild(info);
    eventList.insertBefore(el, eventList.firstChild);
    while (eventList.children.length > 30) {
      eventList.removeChild(eventList.lastChild);
    }
  }

  function requestSnap() {
    if (!conn || !conn.open) { alert('数据通道未连接，请稍后再试'); return; }
    try { conn.send('snap'); } catch (e) { alert('发送失败：' + e.message); }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    } else if (remoteVideo.requestFullscreen) {
      remoteVideo.requestFullscreen().catch(function () {});
    } else if (remoteVideo.webkitEnterFullscreen) {
      remoteVideo.webkitEnterFullscreen();
    }
  }

  function toggleMute() {
    muted = !muted;
    remoteVideo.muted = muted;
    muteBtn.textContent = muted ? '取消静音' : '静音';
  }
})();
