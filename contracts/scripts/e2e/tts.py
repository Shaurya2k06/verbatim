# Text to speech for site-tour.ts, with Kokoro (kokoro-onnx). It runs as a small server: one JSON request per line on stdin,
# {"say": "...", "out": "/path/file.wav"}, and one JSON answer per line on stdout, {"out": ..., "dur": seconds}.
#
#   python -I tts.py <dir with kokoro-v1.0.onnx and voices-v1.0.bin> [voice] [speed]
#
# The model files come from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0). Output is 24 kHz mono 16-bit.
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

model_dir = sys.argv[1]
voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
k = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))
print(json.dumps({"ready": True}), flush=True)
for raw in sys.stdin:
    if not raw.strip():
        continue
    req = json.loads(raw)
    samples, sr = k.create(req["say"], voice=voice, speed=speed, lang="en-us")
    samples = np.asarray(samples, dtype=np.float32)
    sf.write(req["out"], samples, sr, subtype="PCM_16")
    print(json.dumps({"out": req["out"], "dur": len(samples) / sr}), flush=True)
