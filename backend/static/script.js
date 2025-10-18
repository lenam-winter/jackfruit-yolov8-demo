// ===== Helpers =====
const $ = (s) => document.querySelector(s);
// Đang xử lý: bật overlay
const setBusy = () => {
  const dot = $("#status .dot");
  const text = $("#statusText");
  const progress = $("#progress");
  dot.className = "dot busy";
  text.textContent = "Đang phân tích hình ảnh...";
  progress.hidden = false;            // dùng thuộc tính hidden
  progress.style.display = "flex";    // ép hiển thị (phòng cache style)
};

// Trạng thái idle: ẩn overlay hoàn toàn
const setIdle = () => {
  const dot = $("#status .dot");
  const text = $("#statusText");
  const progress = $("#progress");
  dot.className = "dot idle";
  text.textContent = "Sẵn sàng";
  progress.hidden = true;             // ẩn theo hidden
  progress.style.display = "none";    // ẩn tuyệt đối
};


const toast = (msg) => {
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 2200);
};

const imgResult = $("#imgResult");
const jsonResult = $("#jsonResult");
const tbl = $("#tblDetections");
const tbody = $("#tblDetections tbody");
const empty = $("#emptyState");

function renderDetections(dets) {
  if (!dets || !dets.length) {
    tbl.hidden = true;
    empty.style.display = "block";
    tbody.innerHTML = "";
    jsonResult.textContent = "[]";
    return;
  }
  empty.style.display = "none";
  tbl.hidden = false;

  tbody.innerHTML = dets
    .map((d, i) => {
      const box = d.box_xyxy.map(v => Math.round(v)).join(", ");
      const conf = (d.confidence * 100).toFixed(1) + "%";
      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${d.class_name}</strong></td>
        <td>${conf}</td>
        <td>${box}</td>
      </tr>`;
    })
    .join("");
  jsonResult.textContent = JSON.stringify(dets, null, 2);
}
// === TÓM TẮT KẾT QUẢ NHẬN DIỆN (để đưa vào context chat) ===
function summarizeDetections(res) {
  try {
    const dets = res?.detections || res?.results || [];
    if (!Array.isArray(dets) || dets.length === 0) return "Không phát hiện đối tượng nào.";
    const byLabel = {};
    for (const d of dets) {
      const lab = d.class_name || d.label || d.class || "unknown";
      const conf = Number(d.confidence ?? d.conf ?? d.score ?? 0);
      (byLabel[lab] ||= []).push(conf);
    }
    const parts = Object.entries(byLabel).map(([lab, arr]) => {
      const avg = arr.reduce((a,b)=>a+b,0) / arr.length;
      return `${lab}: ${arr.length} (độ tin cậy TB ~ ${(avg*100).toFixed(1)}%)`;
    });
    const time = (res?.runtime_ms != null) ? ` | Thời gian: ${res.runtime_ms}ms` : "";
    return `Tổng quan nhận diện: ${parts.join(" • ")}${time}`;
  } catch { return ""; }
}

// Gửi ảnh và nhận kết quả
async function uploadAndPredict(file) {
  const form = new FormData();
  form.append("image", file);

  setBusy();

  try {
    const res = await fetch("/predict_json", { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text() || "Server error");

    const data = await res.json();

    // Hiển thị ảnh kết quả
    imgResult.src = "data:image/png;base64," + data.preview_png_base64;

    // Render bảng phát hiện
    renderDetections(data.detections);
    window.jv_context = summarizeDetections(data);   


  } catch (e) {
    alert("Lỗi: " + e.message);
  } finally {
    // ✅ Tắt overlay hoàn toàn — chỉ còn ảnh kết quả + bảng
    const dot = $("#status .dot");
    const text = $("#statusText");
    const progress = $("#progress");
    dot.className = "dot ok";
    text.textContent = "Hoàn tất 🎉";
    progress.hidden = true;
    progress.style.display = "none";
  }
}


async function predictFromURL(imageUrl){
  if(!imageUrl || !/^https?:\/\//i.test(imageUrl)){ alert("Nhập URL http/https hợp lệ"); return; }
  setBusy();
  try{
    const res = await fetch("/predict_url", {  // <-- đúng đường dẫn
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ url: imageUrl })
    });
    if(!res.ok) throw new Error(await res.text() || "Server error");
    const data = await res.json();
    imgResult.src = "data:image/png;base64," + data.preview_png_base64;
    renderDetections(data.detections);
    window.jv_context = summarizeDetections(data);
  } catch(e){ alert("Lỗi: " + e.message); }
  finally{
    $("#status .dot").className = "dot ok";
    $("#statusText").textContent = "Hoàn tất 🎉";
    const progress = $("#progress"); progress.hidden = true; progress.style.display = "none";
  }
}




// ===== Upload / Drag-drop =====
const dropZone = $("#dropZone");
const fileInput = $("#fileInput");
const btnChoose = $("#btnChoose");
const btnPredict = $("#btnPredict");
const chkAutoRun = $("#chkAutoRun");
const preview = $("#preview");

btnChoose.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  preview.src = url;
  preview.style.display = "block";
  dropZone.classList.add("has-img");  
  if (chkAutoRun.checked) uploadAndPredict(f);
});

["dragenter", "dragover"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.remove("drag");
  })
);
dropZone.addEventListener("drop", (e) => {
  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;
  const f = files[0];
  const url = URL.createObjectURL(f);
  preview.src = url;
  preview.style.display = "block";
  dropZone.classList.add("has-img");
  if (chkAutoRun.checked) uploadAndPredict(f);
});

btnPredict.addEventListener("click", () => {
  const f = fileInput.files?.[0];
  if (!f) return toast("Vui lòng chọn ảnh trước!");
  uploadAndPredict(f);
});

// THÊM MỚI: sự kiện cho URL
const urlInput = $("#urlInput");
const btnPredictURL = $("#btnPredictURL");
btnPredictURL?.addEventListener("click", ()=>{
  const url = urlInput?.value?.trim();
  predictFromURL(url);
});



// ===== Webcam (bản chắc chắn) =====
const video = $("#video");
const canvas = $("#canvas");
const ctx = canvas.getContext("2d");
const btnStartCam = $("#btnStartCam");
const btnStopCam = $("#btnStopCam");
const btnSnap = $("#btnSnap");
const btnPredictSnap = $("#btnPredictSnap");

let currentStream = null;      // lưu stream hiện tại
let currentSnapBlob = null;    // ảnh chụp tạm

function getActiveStream() {
  // ưu tiên đọc từ video.srcObject (nguồn sự thật),
  // nếu không có thì dùng currentStream
  return (video && video.srcObject) ? video.srcObject : currentStream;
}

async function startCamera() {
  // nếu đang có stream cũ, tắt trước cho sạch
  await stopCamera();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    currentStream = stream;
    video.srcObject = stream;
    await video.play();
    toast("Đã bật camera");
    btnStartCam.disabled = true;
    btnStopCam.disabled = false;
  } catch (e) {
    toast("Không thể bật camera: " + e.message);
  }
}

async function stopCamera() {
  try {
    const stream = getActiveStream();
    if (stream) {
      stream.getTracks().forEach(t => t.stop()); // dừng mọi track (video/audio)
    }
  } catch (e) {
    console.warn("Stop camera error:", e);
  }
  // dọn dẹp
  if (video) {
    try { video.pause(); } catch {}
    video.srcObject = null;
  }
  currentStream = null;
  toast("Đã tắt camera");
  btnStartCam.disabled = false;
  btnStopCam.disabled = true;
}

btnStartCam.addEventListener("click", startCamera);
btnStopCam.addEventListener("click", stopCamera);

btnSnap.addEventListener("click", () => {
  const stream = getActiveStream();
  if (!stream) { toast("Camera chưa bật"); return; }
  const w = video.videoWidth || 640, h = video.videoHeight || 480;
  canvas.width = w; canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  canvas.toBlob((blob) => { currentSnapBlob = blob; toast("Đã chụp ảnh"); }, "image/png");
});

btnPredictSnap.addEventListener("click", async () => {
  if (!currentSnapBlob) { toast("Hãy chụp ảnh trước!"); return; }
  const f = new File([currentSnapBlob], "capture.png", { type: "image/png" });
  await uploadAndPredict(f);
});

// Khởi tạo trạng thái nút khi load trang
(function initCamUI(){
  const stream = getActiveStream();
  btnStartCam.disabled = !!stream;
  btnStopCam.disabled = !stream;
})();

// ===== Theme: light / dark toggle =====
const btnTheme = document.getElementById("btnTheme");
const themeIcon = document.getElementById("themeIcon");
const THEME_KEY = "jf_theme"; // localStorage key

function applyTheme(theme){
  // theme: "dark" | "light"
  document.documentElement.setAttribute("data-theme", theme);
  if(btnTheme){
    btnTheme.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    themeIcon.textContent = theme === "dark" ? "☀️" : "🌙"; // sun when dark (to switch), moon when light
  }
  try { localStorage.setItem(THEME_KEY, theme); } catch(e){}
}

function initTheme(){
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch(e){ saved = null; }
  if(saved === "dark" || saved === "light"){
    applyTheme(saved);
    return;
  }
  // fallback to system preference
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

// Toggle handler
btnTheme?.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(cur === "dark" ? "light" : "dark");
});

// init on load
initTheme();

// Misc
$("#year").textContent = new Date().getFullYear();
setIdle();




window.jv_context = window.jv_context || "";
// ===== Gemini Chatbot (đọc body 1 lần) =====
const chatThread = document.getElementById("chatThread");
const chatForm   = document.getElementById("chatForm");
const chatInput  = document.getElementById("chatInput");
const chatSend   = document.getElementById("chatSend");
const chatStatus = document.getElementById("chatStatus");

// Nếu bạn mở file bằng Live Server (5500) => gọi tới backend 8000
const BASE = location.origin.includes(":8000") ? "" : "http://127.0.0.1:8000";

let chatHistory = [];

// Trạng thái chat
function showTypingStatus() {
  if (!chatStatus) return;
  chatStatus.classList.add("typing");
  chatStatus.innerHTML = `📝 Đang nhập <span class="dots"><span>.</span><span>.</span><span>.</span></span>`;
}

function showThinkingStatus() {
  // 
  return; // tạm ẩn
}

function clearStatus() {
  if (!chatStatus) return;
  chatStatus.classList.remove("typing");
  chatStatus.textContent = "";
}

function renderMsg(role, text){
  if(!chatThread) return null;
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "model" ? "bot" : "user");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text || "";

  wrap.appendChild(bubble);
  chatThread.appendChild(wrap);
  chatThread.scrollTop = chatThread.scrollHeight;

  return bubble;
}

// Hiển thị "đang nhập..." khi user đang gõ
chatInput?.addEventListener("input", () => {
  const hasText = (chatInput.value || "").trim().length > 0;
  if (hasText) showTypingStatus(); else clearStatus();
});
chatInput?.addEventListener("focus", () => {
  if ((chatInput.value || "").trim()) showTypingStatus();
});
chatInput?.addEventListener("blur", () => {
  clearStatus();
});

chatForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const q = (chatInput?.value || "").trim();
  if(!q) return;
  chatInput.value = "";
  clearStatus();
  renderMsg("user", q);
  chatHistory.push({ role:"user", content:q });
  {
  const s = getActiveSession();
  if (s){
    s.messages = chatHistory.slice();
    if (!s.title || s.title === "Cuộc trò chuyện mới"){
      s.title = autoTitleFrom(q);
    }
    s.updatedAt = ts();
    s.contextSnapshot = window.jv_context || "";
    saveSessions(); renderHistoryList();
  }
}
  chatSend && (chatSend.disabled = true);
  // Hiện trạng thái "đang suy nghĩ..." + tạo bong bóng bot placeholder
  showThinkingStatus();
  const placeholder = renderMsg("model", "");
  if (placeholder) {
    placeholder.classList.add("typing");
    placeholder.innerHTML = `🤖 Đang suy nghĩ, vui lòng đợi <span class="dots"><span>.</span><span>.</span><span>.</span></span>`;
  }
  try{
        const res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        messages: chatHistory,
        context: window.jv_context || "",
        lang: "vi"
      })
    });

    // Đọc body 1 lần
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { error: raw }; }

    if(!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    const reply = (data.reply || "(không có phản hồi)").trim();
    
    if (placeholder){
      placeholder.classList.remove("typing");
      placeholder.textContent = reply;
    } else {
      renderMsg("model", reply);
    }

    chatHistory.push({ role:"model", content: reply });
    {
  
  const s = getActiveSession();
  if (s){
    s.messages = chatHistory.slice();
    s.updatedAt = ts();
    s.contextSnapshot = window.jv_context || "";
    saveSessions(); renderHistoryList();
  }
}


  }catch(err){
    renderMsg("model", "⚠️ Lỗi: " + (err.message || err));
  }finally{
    chatSend.disabled = false;
  }
});

// ===== Chat History (LocalStorage) =====
const HISTORY_KEY = "jf_chat_sessions_v1";

let sessions = [];   // [{id, title, messages, createdAt, updatedAt, contextSnapshot}]
let activeId = null;

function uid(){
  return "s_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
function ts(){
  return new Date().toISOString();
}
function autoTitleFrom(text){
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "Cuộc trò chuyện mới";
  return t.length > 40 ? t.slice(0, 40) + "…" : t;
}
function loadSessions(){
  try{
    const raw = localStorage.getItem(HISTORY_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    sessions = Array.isArray(obj?.sessions) ? obj.sessions : [];
    activeId = obj?.activeId || sessions?.[0]?.id || null;
  }catch{ sessions = []; activeId = null; }
}
function saveSessions(){
  try{
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ sessions, activeId }));
  }catch{}
}
function ensureDefaultSession(){
  if (!sessions.length){
    const id = uid();
    sessions = [{
      id, title:"Cuộc trò chuyện mới", messages:[], createdAt: ts(), updatedAt: ts(), contextSnapshot:""
    }];
    activeId = id; saveSessions();
  }
}
function getActiveSession(){
  return sessions.find(s => s.id === activeId) || null;
}
function setActiveSession(id){
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  activeId = id;
  chatHistory = [...(s.messages || [])];   // đồng bộ history ra UI
  renderThread();                          // vẽ lại bong bóng
  window.jv_context = s.contextSnapshot || "";
  updateCtxHint();
  renderHistoryList();
  saveSessions();
}
function renderThread(){
  if (!chatThread) return;
  chatThread.innerHTML = "";
  for (const m of (chatHistory || [])){
    renderMsg(m.role === "model" ? "model" : "user", m.content || "");
  }
}


function exportSessionToTxt(s){
  if (!s) return;

  // Ghép nội dung — có tiêu đề + thời gian + các lượt chat
  const lines = [];
  lines.push(`# ${s.title || "Cuộc trò chuyện"}`);
  lines.push(`Created: ${new Date(s.createdAt || Date.now()).toLocaleString()}`);
  lines.push(`Updated: ${new Date(s.updatedAt || Date.now()).toLocaleString()}`);
  lines.push(""); // dòng trống

  for (const m of (s.messages || [])) {
    const role = (m.role || "user").toUpperCase();
    lines.push(`${role}: ${m.content || ""}`);
    lines.push(""); // dòng trống giữa các message
  }

  // BOM để Notepad nhận đúng UTF-8 (dấu tiếng Việt)
  const txt = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });

  // Tên file an toàn
  const safeTitle = (s.title || "chat")
    .replace(/[\\/:*?"<>|]+/g, "_")   // ký tự cấm trên Windows
    .slice(0, 60) || "chat";
  const fname = `${safeTitle}_${new Date().toISOString().replace(/[:.]/g,"-")}.txt`;

  // Tạo link ẩn và tải
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function renderHistoryList(){
  const ul = document.getElementById("historyList");
  if (!ul) return;
  ul.innerHTML = "";
  sessions
    .slice() // copy
    .sort((a,b)=> (b.updatedAt || "").localeCompare(a.updatedAt || "")) // mới nhất trên cùng
    .forEach(s => {
      const li = document.createElement("li");
      li.dataset.id = s.id;
      li.className = s.id === activeId ? "active" : "";
      const title = document.createElement("div");
      title.className = "history-item-title";
      title.textContent = s.title || "Không tiêu đề";
      const meta = document.createElement("div");
      meta.className = "history-item-meta";
      const dt = new Date(s.updatedAt || s.createdAt || Date.now());
      meta.textContent = dt.toLocaleString();
      const actions = document.createElement("div");
      actions.className = "history-item-actions";
      const btnDel = document.createElement("button");
      btnDel.type = "button"; btnDel.textContent = "Xóa";
      const btnRen = document.createElement("button");
      btnRen.type = "button"; btnRen.textContent = "Đổi tên";
      const btnExp = document.createElement("button");
      btnExp.type = "button"; btnExp.textContent = "Xuất";
      actions.append(btnRen, btnExp, btnDel);

      const left = document.createElement("div");
      left.style.display="flex"; left.style.alignItems="center"; left.style.gap="8px"; left.style.flex="1";
      left.append(title, meta);

      li.append(left, actions);
      ul.appendChild(li);

      // click để chọn session
      li.addEventListener("click", (e)=>{
        // tránh xung đột khi bấm nút con
        if (e.target.tagName === "BUTTON") return;
        setActiveSession(s.id);
      });
      // đổi tên
      btnRen.addEventListener("click", ()=>{
        const newTitle = prompt("Tên đoạn chat:", s.title || "");
        if (newTitle != null){
          s.title = newTitle.trim() || s.title;
          s.updatedAt = ts();
          saveSessions(); renderHistoryList();
        }
      });
      // xuất txt
      btnExp.addEventListener("click", (ev)=>{
  ev.preventDefault();
  ev.stopPropagation();   // tránh kích hoạt click của <li>
  exportSessionToTxt(s);  // xuất đúng phiên đang bấm
});
      // xóa
      btnDel.addEventListener("click", ()=>{
        if (!confirm("Xóa đoạn chat này?")) return;
        sessions = sessions.filter(x => x.id !== s.id);
        if (activeId === s.id){
          activeId = sessions?.[0]?.id || null;
          chatHistory = getActiveSession()?.messages || [];
          renderThread();
        }
        saveSessions(); renderHistoryList();
      });
    });
}
function newChatSession(){
  const id = uid();
  const s = { id, title:"Cuộc trò chuyện mới", messages:[], createdAt: ts(), updatedAt: ts(), contextSnapshot:"" };
  sessions.unshift(s);
  activeId = id; chatHistory = []; renderThread();
  saveSessions(); renderHistoryList();
}

// Nút điều khiển
document.getElementById("exportActive")?.addEventListener("click", ()=>{
  const s = getActiveSession();
  if (!s) return;
  exportSessionToTxt(s);
});

document.getElementById("newChat")?.addEventListener("click", newChatSession);
document.getElementById("clearChat")?.addEventListener("click", ()=>{
  if (!confirm("Xóa toàn bộ bong bóng của đoạn chat hiện tại?")) return;
  chatHistory = [];
  const s = getActiveSession(); if (s){ s.messages = []; s.updatedAt = ts(); }
  renderThread(); saveSessions(); renderHistoryList();
});

// Khởi tạo lịch sử khi load trang
loadSessions(); ensureDefaultSession(); renderHistoryList(); setActiveSession(activeId);


