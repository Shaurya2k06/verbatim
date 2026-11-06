// The signing hand-off, shared by every page that sends: a QR for the offline signer, a paste box for its answer, and an optional
// DEMO KEY held in this tab's memory only. Every signature is checked against the account's owners before it is accepted.
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeResponse, encodeRequest, review, toFrames, typedData } from "@verbatim/signer";
import { Pill } from "./Badge";

function Qr({ frames }) {
  const ref = useRef(null);
  useEffect(() => {
    let i = 0;
    const draw = () => ref.current && QRCode.toCanvas(ref.current, frames[i++ % frames.length], { errorCorrectionLevel: "L", margin: 2, width: 260 });
    draw();
    if (frames.length < 2) return;
    const t = setInterval(draw, 650);
    return () => clearInterval(t);
  }, [frames]);
  return <canvas ref={ref} className="qr" aria-label="Signing request as a QR code" />;
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

  return (
    <div className="signing">
      <div className="signing-qr">
        <Qr frames={frames} />
        <div className="row">
          <button type="button" onClick={() => navigator.clipboard?.writeText(text)}>
            Copy request
          </button>
          <span className="muted small">{frames.length > 1 ? `${frames.length} animated frames` : "one frame"}</span>
        </div>
      </div>
      <div className="signing-in">
        {reviewed.error ? <div className="bad">A device would refuse this: {reviewed.error}</div> : null}
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
