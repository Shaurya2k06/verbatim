// The signing hand-off, shared by every page that sends: a QR for the offline signer, a paste box for its answer, and an optional
// DEMO KEY held in this tab's memory only. Every signature is checked against the account's owners before it is accepted.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeResponse, encodeRequest, matchCode, review, toFrames, typedData } from "@verbatim/signer";
import { Pill } from "./Badge";

const FRAME_MS = 350;

/** The request as a rotating QR: it loops, so the device catches any frame it missed on the next pass. */
function Qr({ frames }) {
  const ref = useRef(null);
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => setAt(0), [frames]);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, frames[at % frames.length], { errorCorrectionLevel: "L", margin: 3, width: 320 });
  }, [frames, at]);
  useEffect(() => {
    if (frames.length < 2 || paused) return;
    const t = setInterval(() => setAt((i) => (i + 1) % frames.length), FRAME_MS);
    return () => clearInterval(t);
  }, [frames, paused]);
  return (
    <>
      <canvas ref={ref} className="qr" aria-label={`Signing request as a rotating QR code, frame ${(at % frames.length) + 1} of ${frames.length}`} />
      {frames.length > 1 ? (
        <div className="qr-frames" aria-hidden="true">
          {frames.map((_, i) => (
            <i key={i} className={i === at % frames.length ? "on" : ""} />
          ))}
        </div>
      ) : null}
      <div className="row small">
        <span className="muted">{frames.length > 1 ? `Rotating QR · frame ${(at % frames.length) + 1} of ${frames.length}` : "One frame"}</span>
        {frames.length > 1 ? (
          <button type="button" className="chip" onClick={() => setPaused(!paused)}>
            {paused ? "play" : "pause"}
          </button>
        ) : null}
        {paused && frames.length > 1 ? (
          <button type="button" className="chip" onClick={() => setAt((i) => (i + 1) % frames.length)}>
            next frame
          </button>
        ) : null}
      </div>
    </>
  );
}

/** The laptop's camera, reading the signature QR the device shows. Stops itself once it has one. */
function Scanner({ onCode, onClose }) {
  const video = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let stream;
    let frame;
    let live = true;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = () => {
      if (!live) return;
      const v = video.current;
      if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
        if (code?.data.startsWith("VSG1:")) {
          onCode(code.data);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" } })
      .then(async (s) => {
        stream = s;
        if (!live) return s.getTracks().forEach((t) => t.stop());
        video.current.srcObject = s;
        await video.current.play();
        tick();
      })
      .catch((e) => setErr(e.name === "NotAllowedError" ? "the camera was not allowed" : e.message || "no camera here"));
    if (!navigator.mediaDevices) setErr("this browser gives the page no camera");
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="scanner">
      {err ? <div className="bad">Cannot scan: {err}. Paste the signature instead.</div> : <video ref={video} playsInline muted />}
      <div className="row small">
        <span className="muted">Hold the device's signature QR up to this camera.</span>
        <button type="button" className="chip" onClick={onClose}>
          close camera
        </button>
      </div>
    </div>
  );
}

/** `request` is { tree, txCommit }. Calls onReady(sigs) once `needed` distinct owners have signed. */
export function SigningPanel({ request, owners, needed, onReady, disabled }) {
  const text = useMemo(() => encodeRequest(request), [request]);
  const frames = useMemo(() => toFrames(text), [text]);
  const reviewed = useMemo(() => {
    try {
      return { r: review(request) };
    } catch (e) {
      return { error: e.message };
    }
  }, [request]);
  const [sigs, setSigs] = useState([]);
  const [paste, setPaste] = useState("");
  const [demoKey, setDemoKey] = useState("");
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);

  const isOwner = (a) => owners?.some((o) => o.toLowerCase() === a.toLowerCase());
  const accept = async (s) => {
    if (!reviewed.r) throw new Error(reviewed.error);
    const td = typedData(reviewed.r.decoded, request, reviewed.r.treeHash, reviewed.r.specHash);
    const who = await recoverTypedDataAddress({ ...td, signature: s.sig });
    if (who.toLowerCase() !== s.signer.toLowerCase()) throw new Error("that signature is not over this sentence");
    if (!isOwner(who)) throw new Error(`${who} is not an owner of this account`);
    const next = [...sigs.filter((x) => x.signer.toLowerCase() !== who.toLowerCase()), { signer: who, sig: s.sig }];
    setSigs(next);
    if (next.length >= needed && !done) {
      setDone(true);
      onReady(next.slice(0, needed));
    }
  };
  const run = (f) => async () => {
    try {
      setErr(null);
      await f();
    } catch (e) {
      setErr(e.message);
    }
  };

  const onScan = useCallback(
    (code) => {
      setScanning(false);
      run(() => accept(decodeResponse(code)))();
    },
    // accept reads the latest signatures through state; rebinding the camera on every change would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sigs, done, reviewed],
  );

  return (
    <div className="signing">
      <div className="signing-qr">
        <Qr frames={frames} />
        {reviewed.r ? (
          <div className="match-code" title="The device shows the same code after it reviews this request">
            <span>Match code</span>
            <b>{matchCode(reviewed.r.digest)}</b>
          </div>
        ) : null}
        <div className="row">
          <button type="button" onClick={() => navigator.clipboard?.writeText(text)}>
            Copy request
          </button>
        </div>
      </div>
      <div className="signing-in">
        {reviewed.error ? <div className="bad">A device would refuse this: {reviewed.error}</div> : null}
        <p className="small muted">Scan the rotating QR with the offline signer. It reviews the sentence, shows the same match code as here, and answers with a signature QR.</p>
        {scanning ? (
          <Scanner onCode={onScan} onClose={() => setScanning(false)} />
        ) : (
          <button type="button" className="primary" disabled={disabled || done} onClick={() => setScanning(true)}>
            Scan the device's signature
          </button>
        )}
        <label className="field">
          <span>Signature from the offline signer</span>
          <textarea rows={2} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="VSG1:0x…:0x…" disabled={disabled || done} />
        </label>
        <button
          type="button"
          disabled={disabled || done || !paste.trim()}
          onClick={run(async () => {
            await accept(decodeResponse(paste));
            setPaste("");
          })}
        >
          Add signature
        </button>
        <label className="field">
          <span>
            Demo laptop owner <Pill tone="warn">DEMO KEY</Pill> <span className="muted">kept in this tab's memory, never sent or stored</span>
          </span>
          <input type="password" autoComplete="off" value={demoKey} onChange={(e) => setDemoKey(e.target.value)} placeholder="0x… owner key" disabled={disabled || done} />
        </label>
        <button
          type="button"
          disabled={disabled || done || !demoKey.trim()}
          onClick={run(async () => {
            if (!reviewed.r) throw new Error(reviewed.error);
            const a = privateKeyToAccount(demoKey.trim());
            const sig = await a.signTypedData(typedData(reviewed.r.decoded, request, reviewed.r.treeHash, reviewed.r.specHash));
            await accept({ signer: a.address, sig });
          })}
        >
          Sign with the demo key
        </button>
        <div className="sigs">
          {sigs.length} of {needed} owner signatures
          {sigs.map((s) => (
            <div key={s.signer} className="mono">
              ✓ {s.signer}
            </div>
          ))}
        </div>
        {err ? <div className="bad">{err}</div> : null}
      </div>
    </div>
  );
}
