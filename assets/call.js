/* SECTION: call — PeerJS/WebRTC 亲情对讲（真实语音，需联网；同房号设备互通） */
(function () {
"use strict";
const { state, $, save, pad, DEVICES, DEV_EMOJI } = window.BC;
const NAME = () => state.mode === "parent" ? "父母端" : state.names[state.mode];
/* PeerJS 要求 ID 仅含字母数字、以单个 - _ 或空格分段；用单连字符并清洗房号，避免 invalid-id */
const room = () => { const r = (state.callRoom || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); if (!r) { state.callRoom = "h" + Math.random().toString(36).slice(2, 8); return state.callRoom; } return r; };
const childId = (dev) => room() + "-c-" + dev;
const parentId = () => room() + "-p";

let peer = null, mic = null, myRole = null, myId = null, idRetry = 0;
const calls = new Map();   // id -> {call, type:'parent'|'child'|'sibling'}
const conns = new Map();   // id -> DataConnection (mesh 信令)
const remotes = new Map(); // id -> AudioElement
let callStart = 0, timerInt = null, pendingAnswer = null;

/* SECTION: peer lifecycle */
function ensurePeer(cb) {
  const wantId = state.mode === "parent" ? parentId() : childId(state.mode);
  if (peer && !peer.destroyed && myId === wantId) {
    if (!cb) return;
    if (peer.open) cb();
    else { peer.once("open", cb); peer.once("error", () => {}); } /* 等注册完成再执行回调 */
    return;
  }
  if (peer && !peer.destroyed) { try { peer.destroy(); } catch (e) {} } /* 仅 ID 变化（换房号/切模式）才重建 */
  if (myId !== wantId) idRetry = 0; /* 同一 ID 的重试计数跨实例累计 */
  closeAll(true);
  if (typeof Peer === "undefined") { setStatus("对讲组件未加载：需联网加载 PeerJS（CDN）", true); return; }
  if (!(location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    setStatus("当前打开方式无法使用麦克风，对讲不可用（其余功能正常）。请用服务提供的 http/https 网址（或本机 localhost）打开本页", true);
    return;
  }
  const id = wantId;
  /* 信令走页面同源自建服务器（默认 path "/"，端点 /peerjs），比公共服务器稳定；file:// 下无法使用 */
  const secure = location.protocol === "https:";
  const sigOpts = { debug: 0, host: location.hostname, secure, port: location.port ? Number(location.port) : (secure ? 443 : 80) };
  const self = new Peer(id, sigOpts);
  peer = self; myRole = state.mode; myId = id;
  const stale = () => peer !== self; /* 旧实例的异步事件一律忽略，防止互毁新实例 */
  self.on("open", () => { if (stale()) return; setStatus(state.mode === "parent" ? "对讲已就绪（父母端在线）" : "对讲已就绪，等待爸妈呼叫，收到会自动接通", false); if (state.mode === "parent" && BC.renderHooks.callList) { try { BC.renderHooks.callList(); } catch (e) {} } if (cb) cb(); });
  self.on("error", (e) => {
    if (stale() || self.destroyed) return;
    if (e.type === "peer-unavailable") { window.toast("对方不在线，请确认其设备已打开且房号相同"); return; }
    if (e.type === "invalid-id") { setStatus("房号格式无效，请在设置中改用字母或数字房号", true); return; }
    if (e.type === "unavailable-id") {
      /* ID 被占用：先销毁自己释放服务器侧残留，再限次重建 */
      if (++idRetry > 3) { setStatus("对讲注册失败：房号疑似被占用，请在设置中换一个房号", true); try { self.destroy(); } catch (err) {} if (!stale()) { peer = null; myRole = null; myId = null; } return; }
      setStatus("对讲正在重连（第 " + idRetry + " 次）…", true);
      try { self.destroy(); } catch (err) {}
      if (!stale()) { peer = null; myRole = null; myId = null; }
      setTimeout(() => { try { ensurePeer(); } catch (err) {} }, 1500 + idRetry * 1500);
      return;
    }
    /* 网络/服务器断连类错误：用官方 reconnect，不销毁实例 */
    setStatus("对讲连接异常：" + (e.type || "network") + "，正在自动重连", true);
    try { self.reconnect(); } catch (err) {}
  });
  self.on("disconnected", () => { if (stale()) return; try { self.reconnect(); } catch (e) {} });
  self.on("call", (call) => { if (stale()) return; if (state.mode !== "parent") answerCall(call); });
  self.on("connection", (conn) => {
    conn.on("open", () => {
      conns.set(conn.peer, conn);
      conn.on("data", (msg) => {
        if (msg && msg.type === "mesh" && state.mode !== "parent") startMesh(msg.peers);
        if (msg && msg.type === "bye") hangupOne(conn.peer);
      });
    });
    conn.on("close", () => conns.delete(conn.peer));
  });
}
function setStatus(t, warn) {
  const el = $("#cc-status"); if (el) { el.textContent = "对讲状态：" + t; el.style.borderColor = warn ? "#E05B4B" : "var(--line)"; }
}

/* SECTION: mic */
async function getMic() {
  if (mic) return mic;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { window.toast("无法使用麦克风：" + (e.name === "NotAllowedError" ? "请在浏览器允许麦克风权限" : e.message)); return null; }
  return mic;
}

/* SECTION: calls */
async function answerCall(call) {
  const m = await getMic();
  if (!m) { try { call.close(); } catch (e) {} return; }
  const isParent = !/-c-clock[123]$/.test(call.peer);
  calls.set(call.peer, { call, type: isParent ? "parent" : "sibling" });
  call.answer(m);
  bindCall(call);
  showCallUI(isParent ? "parent" : "sibling");
  /* 应答方主动建立数据通道，供群通话网状互连信令使用 */
  const cn = peer.connect(call.peer, { reliable: true });
  cn.on("open", () => {
    conns.set(call.peer, cn);
    cn.on("data", (msg) => {
      if (msg && msg.type === "mesh" && state.mode !== "parent") startMesh(msg.peers);
      if (msg && msg.type === "bye") hangupOne(call.peer);
    });
  });
  cn.on("error", () => {});
}
async function callPeer(id, type) {
  if (!peer || peer.destroyed) { ensurePeer(() => callPeer(id, type)); return; }
  const m = await getMic();
  if (!m) return;
  const call = peer.call(id, m, { metadata: { from: NAME(), room: room() } });
  if (!call) return;
  calls.set(id, { call, type });
  bindCall(call);
  showCallUI(type);
}
function bindCall(call) {
  call.on("stream", (stream) => {
    let el = remotes.get(call.peer);
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true; el.playsInline = true;
      document.body.appendChild(el);
      remotes.set(call.peer, el);
    }
    el.srcObject = stream;
    const p = el.play();
    if (p && p.catch) p.catch(() => { pendingAnswer = { el }; $("#cs-answer").classList.remove("hidden"); });
    startTimer();
  });
  call.on("close", () => hangupOne(call.peer));
  call.on("error", () => hangupOne(call.peer));
}
async function startMesh(peers) {
  for (const pid of peers) {
    if (pid === childId(state.mode)) continue;
    if (!calls.has(pid)) await callPeer(pid, "sibling");
  }
}
function hangupOne(id) {
  const c = calls.get(id);
  if (c) { try { c.call.close(); } catch (e) {} calls.delete(id); }
  const el = remotes.get(id);
  if (el) { el.pause(); el.remove(); remotes.delete(id); }
  const cn = conns.get(id);
  if (cn) { try { cn.close(); } catch (e) {} conns.delete(id); }
  if (!calls.size) closeCallUI();
  else renderPeers();
}
function closeAll(silent) {
  Array.from(calls.keys()).forEach((id) => {
    const c = calls.get(id);
    if (!silent && c) { try { const cn = conns.get(id); if (cn && cn.open) cn.send({ type: "bye" }); c.call.close(); } catch (e) {} }
  });
  calls.clear();
  remotes.forEach((el) => el.remove()); remotes.clear();
  conns.forEach((cn) => { try { cn.close(); } catch (e) {} }); conns.clear();
  if (mic) { mic.getTracks().forEach(t => t.stop()); mic = null; }
  stopTimer();
  if (!silent) closeCallUI();
}

/* SECTION: UI */
function showCallUI(kind) {
  $("#call-screen").classList.remove("hidden");
  $("#cs-title").textContent = kind === "parent" ? "📞 爸妈的来电" : (state.mode === "parent" ? "家庭通话" : "家庭通话");
  $("#cs-avatar").classList.add("ringing");
  setTimeout(() => $("#cs-avatar").classList.remove("ringing"), 1200);
  $("#cs-state").textContent = calls.size ? "已接通 · " + Array.from(calls.keys()).map(peerLabel).join("、") : "正在呼叫…";
  $("#cs-mute").classList.remove("muting"); $("#cs-mute").textContent = "🎤";
  renderPeers(); startTimer();
}
function peerLabel(id) {
  for (const d of DEVICES) { const cid = childId(d); if (id === cid) return state.names[d]; }
  if (/-p$/.test(id)) return "父母端";
  return "设备";
}
function renderPeers() {
  const box = $("#cs-peers");
  if (!calls.size) { box.innerHTML = ""; return; }
  box.innerHTML = Array.from(calls.keys()).map(id =>
    '<span class="peer">' + BC.esc(peerLabel(id)) + (state.mode === "parent" ? ' <button class="btn small danger" style="padding:2px 10px;font-size:12px;min-height:28px" data-hang="' + id + '">挂断</button>' : "") + "</span>"
  ).join("");
  box.querySelectorAll("[data-hang]").forEach(b => b.addEventListener("click", () => hangupOne(b.dataset.hang)));
  $("#cs-state").textContent = "已接通 · " + Array.from(calls.keys()).map(peerLabel).join("、");
}
function closeCallUI() {
  $("#call-screen").classList.add("hidden");
  $("#cs-answer").classList.add("hidden");
  pendingAnswer = null; stopTimer();
}
function startTimer() {
  if (timerInt) return;
  callStart = callStart || Date.now();
  $("#cs-timer").classList.remove("hidden");
  timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - callStart) / 1000);
    $("#cs-timer").textContent = pad(Math.floor(s / 60)) + ":" + pad(s % 60);
  }, 500);
}
function stopTimer() { clearInterval(timerInt); timerInt = null; callStart = 0; $("#cs-timer").classList.add("hidden"); }

/* SECTION: parent actions */
function checkOnline(id, el) {
  if (!peer || peer.destroyed) { el.textContent = "连接中…"; setTimeout(() => checkOnline(id, el), 1500); return; }
  if (!peer.open) { el.textContent = "连接中…"; peer.once("open", () => checkOnline(id, el)); return; }
  let done = false;
  const cn = peer.connect(id, { reliable: false, metadata: { ping: true } });
  const to = setTimeout(() => { if (!done) { done = true; el.textContent = "⚪ 离线"; el.className = "st"; try { cn.close(); } catch (e) {} } }, 8000);
  cn.on("open", () => {
    if (done) return; done = true; clearTimeout(to);
    el.textContent = "🟢 在线"; el.className = "st online";
    setTimeout(() => { try { cn.close(); } catch (e) {} }, 800);
  });
  cn.on("error", () => { if (!done) { done = true; clearTimeout(to); el.textContent = "⚪ 离线"; } });
}
function renderCallList() {
  const box = $("#pm-call-list");
  if (!box) return;
  box.innerHTML = DEVICES.map(d =>
    '<div class="call-dev"><span>' + DEV_EMOJI[d] + " " + BC.esc(state.names[d]) + '</span><button class="btn small" data-call="' + childId(d) + '">📞 呼叫</button><span class="st" data-st="' + childId(d) + '">检测中…</span></div>'
  ).join("");
  box.querySelectorAll("[data-call]").forEach(b => b.addEventListener("click", () => ensurePeer(() => callPeer(b.dataset.call, "child"))));
  box.querySelectorAll("[data-st]").forEach(el => checkOnline(el.dataset.st, el));
}

/* SECTION: init */
window.BCCall = {
  init() {
    /* 不在此处抢跑注册：boot 末尾 applyMode 会统一触发，避免重复注册自我冲突 */
    $("#cs-mute").addEventListener("click", () => {
      if (!mic) return;
      const on = !mic.getAudioTracks()[0].enabled;
      mic.getAudioTracks().forEach(t => t.enabled = on);
      $("#cs-mute").textContent = on ? "🎤" : "🔇";
      $("#cs-mute").classList.toggle("muting", !on);
    });
    $("#cs-hangup").addEventListener("click", () => closeAll(false));
    $("#cs-answer").addEventListener("click", () => {
      if (pendingAnswer) { pendingAnswer.el.play().catch(() => {}); $("#cs-answer").classList.add("hidden"); pendingAnswer = null; }
    });
    $("#ca-group").addEventListener("click", () => {
      ensurePeer(async () => {
        for (const d of DEVICES) await callPeer(childId(d), "child");
        $("#ca-hangall").classList.remove("hidden");
        /* 稍候数据通道建立，通知每个孩子互连，形成三方都能听说的网状通话 */
        setTimeout(() => {
          conns.forEach((cn) => { try { if (cn.open) cn.send({ type: "mesh", peers: DEVICES.map(childId) }); } catch (e) {} });
        }, 2500);
      });
    });
    $("#ca-hangall").addEventListener("click", () => { closeAll(false); $("#ca-hangall").classList.add("hidden"); });
    BC.renderHooks.callList = () => { if (state.mode === "parent") renderCallList(); };
  },
  restart() { closeAll(true); if (peer) { try { peer.destroy(); } catch (e) {} } peer = null; myRole = null; myId = null; setTimeout(() => ensurePeer(), 400); },
  refreshList: renderCallList
};
})();
