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


// ===== Gemini Chatbot (đọc body 1 lần) =====
const chatThread = document.getElementById("chatThread");
const chatForm   = document.getElementById("chatForm");
const chatInput  = document.getElementById("chatInput");
const chatSend   = document.getElementById("chatSend");

// Nếu bạn mở file bằng Live Server (5500) => gọi tới backend 8000
const BASE = location.origin.includes(":8000") ? "" : "http://127.0.0.1:8000";

let chatHistory = [];

function renderMsg(role, text){
  if(!chatThread) return;
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "model" ? "bot" : "user");
  wrap.innerHTML = `<div class="bubble">${(text || "").replace(/</g,"&lt;")}</div>`;
  chatThread.appendChild(wrap);
  chatThread.scrollTop = chatThread.scrollHeight;
}

chatForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const q = (chatInput?.value || "").trim();
  if(!q) return;
  chatInput.value = "";
  renderMsg("user", q);
  chatHistory.push({ role:"user", content:q });

  chatSend.disabled = true;
  try{
    const res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ messages: chatHistory })
    });

    // Đọc body 1 lần
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { error: raw }; }

    if(!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    const reply = (data.reply || "(không có phản hồi)").trim();
    renderMsg("model", reply);
    chatHistory.push({ role:"model", content: reply });
  }catch(err){
    renderMsg("model", "⚠️ Lỗi: " + (err.message || err));
  }finally{
    chatSend.disabled = false;
  }
});



