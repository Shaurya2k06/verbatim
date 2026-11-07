import jsQR from "jsqr";
import QRCode from "qrcode";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { FrameCollector, decodeRequest, encodeResponse, matchCode, review, typedData, type Reviewed } from "./core";
import "./style.css";

const app = document.getElementById("app")!;
const KEY = "verbatim-device-key";

// The Android build (packages/signer/android) has no INTERNET permission, so the OS gives it no network at all.
if (navigator.userAgent.includes("VerbatimSignerAndroid/")) {
  const eyebrow = document.querySelector(".eyebrow");
  const sub = document.querySelector(".sub");
  if (eyebrow) eyebrow.textContent = "// android · no internet permission";
  if (sub) sub.textContent = "The phone gives this app no network at all. It shows every line of what you sign, guarantees first.";
}

const store = {
  get: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* private window: the key lasts as long as the page */
    }
  },
};

let key = store.get() as Hex | null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  Object.assign(e, rest);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
};

/** A framed panel with a title bar, like the device on the landing page. */
const panel = (title: string, right: string, ...kids: (Node | string)[]) =>
  el("div", { class: "panel" },
    el("div", { class: "bar" }, el("span", {}, title), right ? el("span", {}, right) : el("span", { class: "dots" }, el("i"), el("i"), el("i"))),
    el("div", { class: "body" }, ...kids),
  );

function keyPanel() {
  if (key) return panel("device owner", "key on this phone", el("div", { class: "mono" }, el("b", {}, privateKeyToAccount(key).address)));
  const input = el("input", { placeholder: "0x private key of an account owner", type: "password", autocomplete: "off" } as never);
  return panel("device owner", "",
    el("div", { class: "line" }, "This device holds no key yet."),
    input,
    el("div", { class: "row" },
      el("button", { class: "primary", onclick: () => setKey(input.value.trim() as Hex) }, "Import"),
      el("button", { onclick: () => setKey(generatePrivateKey()) }, "Generate"),
    ),
  );
}

function setKey(k: Hex) {
  try {
    privateKeyToAccount(k);
  } catch {
    alert("That is not a private key.");
    return;
  }
  key = k;
  store.set(k);
  home();
}

function home(error?: string) {
  app.replaceChildren(keyPanel());
  if (!key) return;
  const area = el("textarea", { placeholder: "Scan the request, or paste it here" });
  const video = el("video", { hidden: true, playsInline: true, muted: true });
  const progress = el("div", { class: "progress", hidden: true });
  const box = panel("signing request", "",
    el("div", { class: "line caret" }, "Scan the laptop's QR"),
    area,
    video,
    progress,
    el("div", { class: "row" },
      el("button", { class: "primary", onclick: () => open(area.value) }, "Review"),
      el("button", { onclick: () => scan(video, progress) }, "Scan QR"),
    ),
  );
  if (error) box.lastElementChild!.append(el("div", { class: "err" }, `Refused: ${error}`));
  app.append(box);
}

/** The rotating QR, frame by frame: which frames have arrived, so the person knows to keep the camera on the screen. */
function showProgress(box: HTMLElement, frames: FrameCollector) {
  box.hidden = false;
  if (!frames.total) {
    box.replaceChildren(el("div", { class: "line" }, "Point the camera at the laptop's QR."));
    return;
  }
  const cells = Array.from({ length: frames.total }, (_, i) => el("i", { class: frames.parts.has(i + 1) ? "on" : "" }));
  box.replaceChildren(el("div", { class: "line" }, `Rotating QR: ${frames.seen} of ${frames.total} frames`), el("div", { class: "cells" }, ...cells));
}

async function scan(video: HTMLVideoElement, progress: HTMLElement) {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    home("no camera here. Paste the request instead.");
    return;
  }
  video.hidden = false;
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const frames = new FrameCollector();
  let shown = -1;
  showProgress(progress, frames);
  const tick = () => {
    if (!video.isConnected) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      const whole = code ? frames.add(code.data) : null;
      if (frames.seen !== shown) {
        shown = frames.seen;
        showProgress(progress, frames);
      }
      if (whole) {
        stream.getTracks().forEach((t) => t.stop());
        open(whole);
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function open(text: string) {
  let r: Reviewed;
  try {
    r = review(decodeRequest(text));
  } catch (e) {
    home((e as Error).message);
    return;
  }
  const risks = r.lines.filter((l) => l.risk).length;
  const lines = panel("the sentence", risks ? `${risks} risk line${risks > 1 ? "s" : ""}` : "no risk lines",
    ...r.lines.map((l, i) => el("div", { class: l.risk ? "risk" : l.guarantee ? "guarantee" : "line", style: `margin-left:${l.indent * 14}px;animation-delay:${Math.min(i, 20) * 40}ms` } as never, l.text)),
  );
  const left = Number(r.decoded.expiry) - Math.floor(Date.now() / 1000);
  const meta = panel("what you sign", `${left} s left`,
    el("div", { class: "mono" }, "Account ", el("b", {}, r.decoded.account)),
    el("div", { class: "mono" }, "Chain ", el("b", {}, String(r.decoded.chainId))),
    el("div", { class: "mono" }, "Sentence hash ", el("b", {}, r.treeHash)),
    el("div", { class: "match" }, el("span", {}, "Match code"), el("b", {}, matchCode(r.digest))),
    el("div", { class: "line" }, "The laptop shows the same code next to its QR. A different code means a different request: reject it."),
  );
  app.replaceChildren(lines, meta, el("div", { class: "row" },
    el("button", { class: "primary", onclick: () => approve(r) }, "Approve and sign"),
    el("button", { class: "danger", onclick: () => home() }, "Reject"),
  ));
}

async function approve(r: Reviewed) {
  const a = privateKeyToAccount(key!);
  const sig = await a.signTypedData(typedData(r.decoded, r, r.treeHash, r.specHash) as never);
  const text = encodeResponse(a.address, sig);
  const canvas = document.createElement("canvas");
  canvas.className = "qr";
  // As large and as simple as the screen allows: the laptop's webcam is low resolution and fixed focus. Low error correction keeps the
  // modules big (a phone screen is clean, unlike a printed code), and the standard four-module quiet zone lets the finder patterns stand out.
  const size = Math.max(280, Math.min(window.innerWidth - 48, 520));
  await QRCode.toCanvas(canvas, text, { errorCorrectionLevel: "L", margin: 4, width: size });
  app.replaceChildren(
    panel("signed", "show this to the laptop", el("div", { class: "line ok" }, "Signed. Hold this QR up to the laptop's camera."), canvas, el("div", { class: "match" }, el("span", {}, "Match code"), el("b", {}, matchCode(r.digest))), el("textarea", { readOnly: true, value: text })),
    el("div", { class: "row" }, el("button", { class: "primary", onclick: () => home() }, "Done")),
  );
}

home();
