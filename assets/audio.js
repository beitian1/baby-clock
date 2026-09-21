/* SECTION: audio — IndexedDB 存储 + 播放器 + 续播 */
(function () {
"use strict";
const { state, $, $$, pad } = window.BC;
const audioEl = new Audio();
audioEl.preload = "auto";

/* SECTION: idb store */
let db = null;
function openDB() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open("bc_media", 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
    };
    rq.onsuccess = () => { db = rq.result; res(); };
    rq.onerror = () => rej(rq.error);
  });
}
function idbPut(key, val) { return new Promise((res, rej) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
function idbGet(key) { return new Promise((res) => { try { const tx = db.transaction("files"); const rq = tx.objectStore("files").get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); } catch (e) { res(null); } }); }
function idbDel(key) { return new Promise((res) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").delete(key); tx.oncomplete = res; tx.onerror = res; }); }

const meta = JSON.parse(localStorage.getItem("bc_tracks") || "[]"); // [{id,name,dur}]
function saveMeta() { try { localStorage.setItem("bc_tracks", JSON.stringify(meta)); } catch (e) {} }

async function durationOf(blob) {
  return new Promise((res) => {
    const a = new Audio(); const url = URL.createObjectURL(blob);
    a.preload = "metadata";
    a.onloadedmetadata = () => { res(isFinite(a.duration) ? Math.round(a.duration) : 0); URL.revokeObjectURL(url); };
    a.onerror = () => { res(0); URL.revokeObjectURL(url); };
    setTimeout(() => res(a.duration && isFinite(a.duration) ? Math.round(a.duration) : 0), 4000);
    a.src = url;
  });
}

window.BCAudioStore = {
  ready: openDB().catch(() => {}),
  async addFiles(fileList) {
    const files = Array.from(fileList).filter(f => /\.(mp3|m4a|wav|ogg|aac|opus|webm)$/i.test(f.name) || f.type.startsWith("audio/"));
    let added = 0;
    for (const f of files) {
      const id = "t" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      try { await idbPut(id, f); } catch (e) { window.toast("存储失败，可能空间不足"); break; }
      const dur = await durationOf(f);
      meta.push({ id, name: f.name.replace(/\.[^.]+$/, ""), dur });
      added++;
    }
    saveMeta();
    return added;
  },
  list() { return meta; },
  remove(id) { const i = meta.findIndex(m => m.id === id); if (i >= 0) meta.splice(i, 1); saveMeta(); idbDel(id); },
  async getBlob(id) { await window.BCAudioStore.ready; const blob = await idbGet(id); return { name: (meta.find(m => m.id === id) || {}).name || "音频", blob }; },
  /* 作业图片 */
  async saveHwImage(file) {
    await window.BCAudioStore.ready;
    const id = "img" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    await idbPut(id, file);
    return id;
  },
  async getHwImage(id) { await window.BCAudioStore.ready; const blob = await idbGet(id); return blob ? URL.createObjectURL(blob) : null; },
  delHwImage(id) { idbDel(id); }
};

/* SECTION: player */
const resume = JSON.parse(localStorage.getItem("bc_resume") || "null"); // {idx,pos}
let list = []; // 当前可播放条目（meta 过滤掉丢失的）
let cur = -1, mode = 0, external = false, externalStopTimer = null;
const MODES = ["🔁", "🔀", "🔂"];
const MODE_TXT = ["顺序播放", "随机播放", "单曲循环"];

function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return pad(Math.floor(s / 60)) + ":" + pad(s % 60); }
function renderList() {
  const box = $("#audio-list");
  list = meta.slice();
  if (!list.length) { box.innerHTML = '<div class="empty-tip">还没有音频。点上方按钮导入 MP3 / M4A / WAV 文件，支持整个文件夹批量导入</div>'; return; }
  box.innerHTML = list.map((m, i) =>
    '<div class="track' + (i === cur ? " cur" : "") + '" data-i="' + i + '"><span>' + (i === cur ? "🎵" : "🎞️") + '</span><span class="t-name">' + ((BC.esc || String)(m.name)) + '</span><span class="t-dur">' + fmt(m.dur) + '</span><button class="t-del" data-del="' + m.id + '" title="删除">✕</button></div>'
  ).join("");
}
function saveResume() {
  if (cur >= 0 && !external && audioEl.currentTime > 0.5) {
    try { localStorage.setItem("bc_resume", JSON.stringify({ idx: cur, pos: Math.floor(audioEl.currentTime) })); } catch (e) {}
  }
}
async function playIndex(i, fromPos) {
  if (!list.length) return;
  cur = ((i % list.length) + list.length) % list.length;
  external = false;
  const m = list[cur];
  const { blob } = await BCAudioStore.getBlob(m.id);
  if (!blob) { window.toast("该音频文件已丢失，已跳过"); list.splice(cur, 1); renderList(); return; }
  audioEl.src = URL.createObjectURL(blob);
  $("#pl-name").textContent = m.name;
  $("#pl-play").textContent = "❚❚";
  try { await audioEl.play(); } catch (e) { /* iOS 需用户手势，下方按钮已带手势 */ }
  if (fromPos) { try { audioEl.currentTime = fromPos; } catch (e) {} }
  renderList();
}
window.BCPlayer = {
  el: audioEl,
  init() {
    audioEl.addEventListener("timeupdate", () => {
      if (external || !audioEl.duration) return;
      $("#pl-bar").value = Math.round(audioEl.currentTime / audioEl.duration * 1000);
      $("#pl-cur").textContent = fmt(audioEl.currentTime);
      $("#pl-total").textContent = fmt(audioEl.duration);
    });
    audioEl.addEventListener("pause", saveResume);
    audioEl.addEventListener("ended", () => {
      if (external) return;
      if (mode === 2) { audioEl.currentTime = 0; audioEl.play(); return; }
      playIndex(mode === 1 ? Math.floor(Math.random() * list.length) : cur + 1);
    });
    audioEl.addEventListener("error", () => { $("#pl-name").textContent = "播放失败，换一个文件试试"; });
    $("#pl-play").addEventListener("click", async () => {
      if (!list.length) { window.toast("请先导入音频文件"); return; }
      if (!audioEl.src) { await playIndex(Math.max(0, resume ? resume.idx : 0), resume ? resume.pos : 0); }
      else if (audioEl.paused) { audioEl.play().catch(() => {}); $("#pl-play").textContent = "❚❚"; }
      else { audioEl.pause(); $("#pl-play").textContent = "▶"; }
    });
    $("#pl-prev").addEventListener("click", () => playIndex(mode === 1 ? Math.floor(Math.random() * list.length) : cur - 1));
    $("#pl-next").addEventListener("click", () => playIndex(mode === 1 ? Math.floor(Math.random() * list.length) : cur + 1));
    $("#pl-stop").addEventListener("click", () => { audioEl.pause(); audioEl.currentTime = 0; $("#pl-play").textContent = "▶"; saveResume(); });
    $("#pl-bar").addEventListener("input", (e) => { if (audioEl.duration) { audioEl.currentTime = e.target.value / 1000 * audioEl.duration; } });
    $("#pl-mode-btn").addEventListener("click", () => { mode = (mode + 1) % 3; $("#pl-mode-btn").textContent = MODES[mode]; $("#pl-mode-text").textContent = MODE_TXT[mode]; });
    $("#audio-list").addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del]");
      if (del) { BCAudioStore.remove(del.dataset.del); if (cur >= list.length) cur = list.length - 1; renderList(); return; }
      const row = e.target.closest(".track");
      if (row) await playIndex(+row.dataset.i);
    });
    $("#audio-file").addEventListener("change", async (e) => {
      const n = await BCAudioStore.addFiles(e.target.files);
      e.target.value = ""; renderList();
      window.toast(n ? "已导入 " + n + " 个音频" : "没有识别到音频文件");
    });
    $("#audio-folder").addEventListener("change", async (e) => {
      const n = await BCAudioStore.addFiles(e.target.files);
      e.target.value = ""; renderList();
      window.toast(n ? "文件夹导入 " + n + " 个音频" : "文件夹里没有音频文件");
    });
    BCAudioStore.ready.then(async () => {
      renderList();
      if (resume && meta.length) {
        cur = Math.min(resume.idx, meta.length - 1);
        $("#pl-name").textContent = "上次停在《" + (list[cur] ? list[cur].name : "") + "》，点 ▶ 继续";
      }
    });
    /* 恢复：记住上次位置，点播放即续播 */
    const _origPlayIndex = playIndex;
    this.playIndex = _origPlayIndex;
  },
  playExternalUrl(url, name, stopMs) {
    external = true;
    audioEl.src = url;
    $("#pl-name").textContent = "⏰ 闹钟：" + name;
    audioEl.play().catch(() => {});
    clearTimeout(externalStopTimer);
    externalStopTimer = setTimeout(() => { if (external) this.stopExternal(); }, stopMs || 900000);
  },
  stopExternal() {
    external = false;
    audioEl.pause(); audioEl.removeAttribute("src"); audioEl.load();
    clearTimeout(externalStopTimer);
  }
};
})();
