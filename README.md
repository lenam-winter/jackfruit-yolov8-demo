# Jackfruit YOLOv8 Demo (Flask)

A minimal demo website to run jackfruit detection/classification with a YOLOv8 model.

## Features
- Upload an image or capture from webcam (front-end).
- Server runs YOLOv8 inference and returns:
  - Annotated image (PNG).
  - JSON of boxes (xyxy), class names, confidences.
- Simple UI to preview results.
- Ready for local run or deployment on Render/Railway/Heroku (uses `gunicorn`).

## Quick Start

### 1) Put your model
Copy your trained model file to `backend/models/best.pt` (you can rename, update the path in `app.py` if needed).

### 2) Create venv & install deps
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3) Run locally
```bash
# Development (auto-reload)
export FLASK_APP=app.py
export FLASK_ENV=development
flask run --host=0.0.0.0 --port=8000
# or
python app.py
```

Open: http://localhost:8000

### 4) (Optional) Export to ONNX for faster inference
```bash
# inside venv
pip install ultralytics
yolo export model=models/best.pt format=onnx imgsz=640
# Then update MODEL_PATH in app.py to the exported .onnx and set USE_ONNX=True
```

### 5) Deploy (example Render)
- Create a new Web Service, use this repo.
- Set build command: `pip install -r backend/requirements.txt`
- Set start command: `gunicorn -w 2 -k gthread -b 0.0.0.0:$PORT app:app`
- Set working directory to `backend`.
- Add environment variable `PYTHONUNBUFFERED=1`.
- Add a persistent storage (optional) if you want to upload/save files.

## Notes
- `ultralytics` is used for PyTorch inference; for ONNX, we use `onnxruntime` for CPU.
- Adjust `CONF_THRES` and `IOU_THRES` in `app.py` as needed.