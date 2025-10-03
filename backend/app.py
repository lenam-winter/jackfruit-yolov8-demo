import io
import os
import base64
from typing import List, Dict, Any

from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image
import numpy as np

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
        from ultralytics import YOLO
        _model = YOLO(MODEL_PATH)
        _model_classes = _model.names
    return _model

def run_inference(image: Image.Image) -> Dict[str, Any]:
    model = load_model()

    # Ultralytics path (PyTorch)
    if not USE_ONNX:
        from ultralytics.utils.plotting import Annotator, colors
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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)