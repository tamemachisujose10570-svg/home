(function () {
  'use strict';

  window.PEER_CONFIG = {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  };

  window.codeToPeerId = async function (code) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('homecam:' + code.trim()));
    const hex = Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return 'homecam-' + hex.slice(0, 24);
  };

  window.formatTime = function (ts) {
    const d = new Date(ts);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };
})();
