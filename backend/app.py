import io
import os
import base64
from typing import List, Dict, Any

from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image
import numpy as np
import requests
from PIL import Image
from flask import request, jsonify, stream_with_context, Response
import time


# Configuration
USE_ONNX = False  # set True if you exported to ONNX and want to use onnxruntime
MODEL_PATH = os.environ.get("MODEL_PATH", "models/best.pt")
CONF_THRES = float(os.environ.get("CONF_THRES", 0.25))
IOU_THRES = float(os.environ.get("IOU_THRES", 0.45))
IMG_SIZE = int(os.environ.get("IMG_SIZE", 640))

app = Flask(__name__, static_folder="static", template_folder="templates")

# Lazy model loader to speed cold start
_model = None
_model_classes = None

def load_model():
    global _model, _model_classes
    if _model is not None:
        return _model

    if USE_ONNX:
        # ONNXRuntime inference session
        import onnxruntime as ort
        _model = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        # Classes must be provided manually when using ONNX. Adjust to your labels.
        _model_classes = ["unripe", "ripe", "diseased"]
    else:
        # Ultralytics YOLOv8
        from ultralytics import YOLO # type: ignore
        _model = YOLO(MODEL_PATH)
        _model_classes = _model.names
    return _model

def run_inference(image: Image.Image) -> Dict[str, Any]:
    model = load_model()

    # Ultralytics path (PyTorch)
    if not USE_ONNX:
        from ultralytics.utils.plotting import Annotator, colors # type: ignore
        # Inference
        results = model.predict(image, imgsz=IMG_SIZE, conf=CONF_THRES, iou=IOU_THRES, verbose=False)
        # Take first result
        r = results[0]
        boxes = r.boxes.xyxy.cpu().numpy().astype(float) if r.boxes is not None else np.zeros((0, 4))
        cls = r.boxes.cls.cpu().numpy().astype(int) if r.boxes is not None else np.array([], dtype=int)
        conf = r.boxes.conf.cpu().numpy().astype(float) if r.boxes is not None else np.array([], dtype=float)

        # Annotated image
        im = r.plot()  # BGR numpy
        im_rgb = im[:, :, ::-1]  # to RGB

        # Build JSON
        detections = []
        for i in range(len(cls)):
            detections.append({
                "box_xyxy": boxes[i].tolist(),
                "class_id": int(cls[i]),
                "class_name": str(_model_classes[int(cls[i])]),
                "confidence": float(conf[i])
            })

        return {
            "detections": detections,
            "annotated_image": Image.fromarray(im_rgb)
        }

    # ONNX path (simplified demo; assumes standard YOLOv8 preprocessing)
    import onnxruntime as ort
    sess: ort.InferenceSession = model  # type: ignore
    input_name = sess.get_inputs()[0].name
    # Preprocess
    img_resized = image.resize((IMG_SIZE, IMG_SIZE))
    img_arr = np.array(img_resized).astype(np.float32)
    if img_arr.ndim == 2:
        img_arr = np.stack([img_arr]*3, axis=-1)
    img_arr = img_arr[:, :, :3]  # ensure 3 channels
    img_arr = img_arr.transpose(2, 0, 1) / 255.0  # CHW, 0..1
    img_arr = np.expand_dims(img_arr, axis=0)  # NCHW

    outputs = sess.run(None, {input_name: img_arr})
    # NOTE: Post-processing (NMS) varies by export; for brevity we rely on PyTorch path for full features.
    # Here we just return a placeholder JSON.
    return {
        "detections": [],
        "annotated_image": image  # no drawing in this minimal ONNX stub
    }

def image_to_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()

@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")

@app.route("/health", methods=["GET"])
def health():
    return jsonify(status="ok")

@app.route("/predict", methods=["POST"])
def predict():
    # Returns annotated PNG
    if "image" not in request.files:
        return jsonify(error="missing file field 'image'"), 400
    file = request.files["image"]
    img = Image.open(file.stream).convert("RGB")
    out = run_inference(img)
    png_bytes = image_to_bytes(out["annotated_image"])
    return send_file(io.BytesIO(png_bytes), mimetype="image/png")

@app.route("/predict_json", methods=["POST"])
def predict_json():
    # Returns JSON with detections and a base64 preview (small) of annotated image
    if "image" not in request.files:
        return jsonify(error="missing file field 'image'"), 400
    file = request.files["image"]
    img = Image.open(file.stream).convert("RGB")
    out = run_inference(img)

    # small preview
    preview = out["annotated_image"].copy()
    preview.thumbnail((512, 512))
    b = image_to_bytes(preview)
    b64 = base64.b64encode(b).decode("utf-8")

    return jsonify({
        "detections": out["detections"],
        "preview_png_base64": b64
    })

@app.route("/predict_url", methods=["POST"])
def predict_url():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify(error="Missing 'url'"), 400
    try:
        max_bytes = 5 * 1024 * 1024  # 5MB
        r = requests.get(url, stream=True, timeout=10)
        r.raise_for_status()
        content = r.raw.read(max_bytes + 1, decode_content=True)
        if len(content) == 0:
            return jsonify(error="Empty image content"), 400
        if len(content) > max_bytes:
            return jsonify(error="Image too large (max 5MB)"), 400
        img = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception as e:
        return jsonify(error=f"Failed to fetch image: {e}"), 400

    try:
        out = run_inference(img)
        # prepare preview like predict_json
        preview = out["annotated_image"].copy()
        preview.thumbnail((512, 512))
        b = image_to_bytes(preview)
        b64 = base64.b64encode(b).decode("utf-8")
        return jsonify({
            "detections": out["detections"],
            "preview_png_base64": b64
        })
    except Exception as e:
        return jsonify(error=f"Inference error: {e}"), 500






# ===== Gemini Chat (REST) =====
import os, requests
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# KHÔNG tạo lại app nếu file đã có app = Flask(...)
# app = Flask(__name__, static_folder="static", template_folder="templates")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

@app.route("/chat", methods=["POST"])
def chat():
    if not GEMINI_API_KEY:
        return jsonify(error="Server missing GEMINI_API_KEY (.env)"), 500

    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    if not isinstance(messages, list) or not messages:
        return jsonify(error="Missing messages[]"), 400

    # === NEW: nhận context & lang (tuỳ chọn) ===
    context = (data.get("context") or "").strip()
    lang = (data.get("lang") or "vi").lower()

    # === NEW: sys_prompt + khởi tạo contents (đặt TRƯỚC lịch sử chat) ===
    sys_prompt = (
        "Bạn là trợ lý Jackfruit Vision cho đồ án tốt nghiệp. "
        "Nhiệm vụ: giải thích kết quả nhận diện (mít non/chín/sâu bệnh), "
        "gợi ý cách chụp ảnh, cách cải thiện mô hình; trả lời ngắn gọn, lịch sự. "
        f"Ngôn ngữ: {'Tiếng Việt' if lang.startswith('vi') else 'English'}."
    )
    contents = [{"role": "user", "parts": [{"text": sys_prompt}]}]

    # === NEW: nhúng ngữ cảnh nhận diện nếu có ===
    if context:
        contents.append({"role": "user", "parts": [{"text": f"[Context]\n{context}"}]})

    # === giữ nguyên: đổ lịch sử hội thoại vào contents ===
    for m in messages:
        role = "model" if m.get("role") == "model" else "user"
        text = (m.get("content") or "").strip()
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})

    try:
        headers = {"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY}
        payload = {"contents": contents}

        timeout = float(os.environ.get("CHAT_TIMEOUT", 40))
        r = requests.post(GEMINI_URL, headers=headers, json=payload, timeout=timeout)
        r.raise_for_status()
        j = r.json()

        # Lấy text phản hồi an toàn
        reply = ""
        try:
            parts = j.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            reply = "".join(p.get("text", "") for p in parts if "text" in p).strip()
        except Exception:
            reply = ""

        if not reply:
            # Nếu bị chặn/không có nội dung
            pf = j.get("promptFeedback", {}) or {}
            block = pf.get("blockReason") or pf.get("blockReasonMessage")
            reply = f"(không có phản hồi{' – ' + block if block else ''})"

        return jsonify({"reply": reply})
    except requests.Timeout:
        return jsonify(error="Gemini timeout. Vui lòng thử lại."), 504
    except requests.HTTPError as e:
        return jsonify(error=f"Gemini HTTP {e.response.status_code}: {e.response.text[:300]}"), 502
    except Exception as e:
        return jsonify(error=f"Chat error: {e}"), 500

@app.route("/chat_stream", methods=["POST"])
def chat_stream():
    data = request.get_json(silent=True) or {}
    data.setdefault("lang", "vi")
    try:
        headers = {"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY}
        context  = (data.get("context") or "").strip()
        messages = data.get("messages") or []
        sys_prompt = (
            "Bạn là trợ lý Jackfruit Vision. Trả lời ngắn gọn, lịch sự. "
            f"Ngôn ngữ: {'Tiếng Việt' if data['lang']=='vi' else 'English'}."
        )
        contents = [{"role":"user","parts":[{"text":sys_prompt}]}]
        if context:
            contents.append({"role":"user","parts":[{"text":f'[Context]\n{context}'}]})
        for m in messages:
            contents.append({
                "role": "model" if m.get("role")=="model" else "user",
                "parts":[{"text": (m.get("content") or '').strip()}]
            })
        payload = {"contents": contents}
        r = requests.post(GEMINI_URL, headers=headers, json=payload, timeout=40)
        r.raise_for_status()
        j = r.json()
        parts = j.get("candidates",[{}])[0].get("content",{}).get("parts",[])
        full = "".join(p.get("text","") for p in parts if "text" in p).strip() or "(không có phản hồi)"
    except Exception as e:
        full = f"(lỗi khi gọi mô hình: {e})"

    @stream_with_context
    def gen():
        chunk = 40
        for i in range(0, len(full), chunk):
            yield full[i:i+chunk]
            time.sleep(0.03)
    return Response(gen(), mimetype="text/plain; charset=utf-8")




if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)


