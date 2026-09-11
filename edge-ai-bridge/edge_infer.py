#!/usr/bin/env python3
"""
edge_infer.py — the "edge" half of the edge-AI claim.

Runs a real onboard object-detection pass (default: OpenCV's built-in HOG +
linear-SVM person detector — ships with opencv-python, no model download,
no internet dependency at demo time) against a folder of frames or a
webcam, times every inference on the wall clock, and POSTs the real
{latencyMs, detections} numbers to the EdgeFleet dashboard so judges see
actual on-device inference latency, not a claimed one.

Run this on the same laptop as the dashboard for a quick check, or on a
Raspberry Pi / Jetson Nano on the same network for the real "this runs on
constrained edge hardware" proof — nothing here changes either way, only
the latency numbers will look different (which is the point).

Usage:
    python edge_infer.py
    python edge_infer.py --robot-id r3 --interval 1.0
    python edge_infer.py --source webcam
    python edge_infer.py --model model/yourmodel.onnx   # bring your own ONNX model

By default this loops forever, one inference every --interval seconds,
until you Ctrl+C it — leave it running in a terminal during the demo.
"""
import argparse
import glob
import os
import time

import cv2
import numpy as np
import requests

DEFAULT_SERVER = os.environ.get("EDGEFLEET_SERVER", "http://localhost:3000")
DEFAULT_TOKEN = os.environ.get("EDGE_BRIDGE_TOKEN", "devtoken123")


class HogDetector:
    """OpenCV's built-in HOG + SVM person detector. Real, local, no download."""

    name = "hog-person-cpu"

    def __init__(self):
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    def infer(self, frame_bgr: np.ndarray) -> int:
        small = cv2.resize(frame_bgr, (320, 240))
        rects, _weights = self.hog.detectMultiScale(small, winStride=(8, 8), padding=(8, 8), scale=1.05)
        return len(rects)


class OnnxDetector:
    """Optional bring-your-own-model path. Requires `pip install onnxruntime`."""

    def __init__(self, model_path: str):
        import onnxruntime as ort  # deferred import — optional dependency

        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        input_shape = self.session.get_inputs()[0].shape
        # best-effort guess at HxW from the model's declared input shape
        dims = [d for d in input_shape if isinstance(d, int) and d > 1]
        self.size = (dims[-1], dims[-2]) if len(dims) >= 2 else (320, 320)
        self.name = f"onnx:{os.path.basename(model_path)}"

    def infer(self, frame_bgr: np.ndarray) -> int:
        resized = cv2.resize(frame_bgr, self.size)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        chw = np.transpose(rgb, (2, 0, 1))[None, ...]
        outputs = self.session.run(None, {self.input_name: chw})
        # generic fallback: count output rows above a naive objectness threshold
        # if the model's output layout doesn't match this, at minimum you still
        # get a REAL, honest latency number — swap this scoring for your model's
        # actual postprocessing before trusting the detection count.
        try:
            out = outputs[0]
            flat = out.reshape(-1, out.shape[-1]) if out.ndim >= 2 else out.reshape(1, -1)
            conf_col = min(4, flat.shape[-1] - 1)
            return int((flat[:, conf_col] > 0.5).sum())
        except Exception:
            return 0


def load_frames(source: str):
    if source == "webcam":
        return None  # handled specially in main loop
    paths = sorted(glob.glob(os.path.join(source, "*.jpg")) + glob.glob(os.path.join(source, "*.png")))
    if not paths:
        raise SystemExit(
            f"No frames found in {source}. Run `python make_sample_frames.py` first, "
            f"or pass --source webcam."
        )
    return paths


def post_reading(server: str, token: str, robot_id: str, latency_ms: float, detections: int, model_name: str):
    try:
        resp = requests.post(
            f"{server}/api/edge-inference",
            json={
                "robotId": robot_id,
                "latencyMs": latency_ms,
                "detections": detections,
                "model": model_name,
                "token": token,
            },
            timeout=3,
        )
        ok = resp.ok
    except requests.RequestException as e:
        ok = False
        print(f"  ! could not reach dashboard: {e}")
    return ok


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--server", default=DEFAULT_SERVER, help="EdgeFleet dashboard base URL")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="must match EDGE_BRIDGE_TOKEN in .env")
    parser.add_argument("--robot-id", default="r1", help="which robot this reading is attributed to")
    parser.add_argument("--interval", type=float, default=1.5, help="seconds between inference passes")
    parser.add_argument("--count", type=int, default=0, help="stop after N passes (0 = run forever)")
    parser.add_argument(
        "--source", default=os.path.join(os.path.dirname(__file__), "sample_frames"), help="frame folder, or 'webcam'"
    )
    parser.add_argument("--model", default=None, help="path to an ONNX model to use instead of the built-in HOG detector")
    args = parser.parse_args()

    detector = OnnxDetector(args.model) if args.model else HogDetector()
    print(f"Model: {detector.name}")
    print(f"Posting to: {args.server}/api/edge-inference (robot {args.robot_id})")

    cap = None
    frame_paths = None
    if args.source == "webcam":
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            raise SystemExit("Could not open webcam. Drop --source to use the bundled sample frames instead.")
    else:
        frame_paths = load_frames(args.source)

    i = 0
    try:
        while True:
            if cap is not None:
                ok, frame = cap.read()
                if not ok:
                    print("  ! webcam read failed, skipping")
                    time.sleep(args.interval)
                    continue
            else:
                frame = cv2.imread(frame_paths[i % len(frame_paths)])

            t0 = time.perf_counter()
            detections = detector.infer(frame)
            latency_ms = (time.perf_counter() - t0) * 1000.0

            ok = post_reading(args.server, args.token, args.robot_id, latency_ms, detections, detector.name)
            status = "sent" if ok else "FAILED TO SEND"
            print(f"[{i:04d}] {latency_ms:6.1f}ms  {detections} detection(s)  -> {status}")

            i += 1
            if args.count and i >= args.count:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        if cap is not None:
            cap.release()


if __name__ == "__main__":
    main()
