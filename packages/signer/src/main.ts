import jsQR from "jsqr";
import QRCode from "qrcode";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { FrameCollector, decodeRequest, encodeResponse, review, typedData, type Reviewed } from "./core";

const app = document.getElementById("app")!;
const KEY = "verbatim-device-key";

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

function keyPanel() {
  const panel = el("div", { class: "panel" });
  if (key) {
    panel.append(el("div", { class: "line" }, "Device owner"), el("div", { class: "mono" }, privateKeyToAccount(key).address));
    return panel;
  }
  const input = el("input", { placeholder: "0x private key of an account owner" });
  panel.append(
    el("div", { class: "line" }, "This device holds no key yet."),
    input,
    el("div", { class: "row" },
      el("button", { onclick: () => setKey(input.value.trim() as Hex) }, "Import"),
      el("button", { onclick: () => setKey(generatePrivateKey()) }, "Generate"),
    ),
  );
  return panel;
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
  const panel = el("div", { class: "panel" },
    el("div", { class: "line" }, "Signing request"),
    area,
    video,
    el("div", { class: "row" },
      el("button", { class: "primary", onclick: () => open(area.value) }, "Review"),
      el("button", { onclick: () => scan(video) }, "Scan QR"),
    ),
  );
  if (error) panel.append(el("div", { class: "err" }, `Refused: ${error}`));
  app.append(panel);
}

async function scan(video: HTMLVideoElement) {
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
  const lines = el("div", { class: "panel" });
  for (const l of r.lines) {
    lines.append(el("div", { class: l.risk ? "risk" : l.guarantee ? "guarantee" : "line", style: `margin-left:${l.indent * 14}px` } as never, l.text));
  }
  const meta = el("div", { class: "panel" },
    el("div", { class: "mono" }, `Account ${r.decoded.account}`),
    el("div", { class: "mono" }, `Chain ${r.decoded.chainId}, ${Number(r.decoded.expiry) - Math.floor(Date.now() / 1000)} seconds left to run`),
    el("div", { class: "mono" }, `Sentence hash ${r.treeHash}`),
  );
  app.replaceChildren(lines, meta, el("div", { class: "row" },
    el("button", { class: "primary", onclick: () => approve(r) }, "Approve and sign"),
    el("button", { onclick: () => home() }, "Reject"),
  ));
}

async function approve(r: Reviewed) {
  const a = privateKeyToAccount(key!);
  const sig = await a.signTypedData(typedData(r.decoded, r, r.treeHash, r.specHash) as never);
  const text = encodeResponse(a.address, sig);
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, text, { errorCorrectionLevel: "L", margin: 2, width: 320 });
  app.replaceChildren(
    el("div", { class: "panel" }, el("div", { class: "line" }, "Signed. Show this to the wallet."), canvas, el("textarea", { readOnly: true, value: text })),
    el("div", { class: "row" }, el("button", { onclick: () => home() }, "Done")),
  );
}

home();
