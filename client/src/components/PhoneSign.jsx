// Phone and laptop: the two-owner signing hand-off, run for real on Sepolia. The laptop builds one transfer and shows it as a rotating
// QR. The phone's offline signer (the Android app, no internet permission) decodes the sentence itself, shows the same match code,
// and answers with a signature QR that the laptop's camera reads. The laptop's own owner key adds the second signature, and the
// operation goes to the bundler. Choose "tampered" and the phone is shown the honest sentence while the calldata pays someone else.
import { useEffect, useMemo, useState } from "react";
import { parseAbi } from "viem";
import { OpRunner } from "./OpRunner";
import { Loading } from "./States";
import { accountState, context, transferCall } from "../lib/userop";
import { sepoliaPublic } from "../lib/networks";

const HOOK = parseAbi(["function ATTACKER() view returns (address)"]);
const ONE_DUSDC = 1_000_000n;
/** The account's policy caps a signature's life at 300 seconds, checked again at execution. This leaves a little margin. */
const VALIDITY_S = 290;

const MODES = {
  honest: {
    label: "An honest payment",
    blurb: "1 dUSDC to verbatim-demo.eth. The phone shows exactly what is sent. Approve it, and it lands.",
    expect: "Lands on Sepolia, with every guarantee checked after the transfer.",
  },
  tampered: {
    label: "A tampered frontend",
    blurb: "The phone is shown the honest payment to verbatim-demo.eth, but the calldata pays the attacker. Approve it anyway.",
    expect: "Refused during validation with TreeMismatch: the chain renders the real calldata, and it is not the sentence the phone signed. Nothing is sent and nothing is paid.",
  },
};

const STEPS = [
  ["Open Verbatim Signer on the phone", "The Android app has no internet permission. Its key is one of the account's three owners."],
  ["Tap Scan QR and point the phone at the laptop", "The QR below rotates through a few frames. The phone keeps reading until it has all of them."],
  ["Read the sentence on the phone, and compare the match code", "The phone decodes the sentence itself, guarantees first. Its match code must equal the one beside the QR here."],
  ["Tap Approve and sign", "The phone signs the sentence's hash, not the calldata, and shows a signature QR."],
  ["On the laptop, press Scan the device's signature", "Hold the phone's QR up to the laptop camera. The page checks that the signer is an owner."],
  ["Add the laptop's signature", "The account needs two of three owners. Paste the laptop's owner key in Demo laptop owner, then Sign with the demo key. It stays in this tab's memory."],
];

export function PhoneSign({ onTx }) {
  const [base, setBase] = useState(null);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { dep } = await context();
        const [account, attacker] = await Promise.all([accountState(dep.account), sepoliaPublic().readContract({ address: dep.skimHook, abi: HOOK, functionName: "ATTACKER" })]);
        if (live) setBase({ dep, account, attacker });
      } catch (e) {
        if (live) setErr(e.shortMessage ?? e.message);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // A new spec object starts a fresh operation, with a fresh expiry, each time a mode is picked or restarted.
  const spec = useMemo(() => {
    if (!base || !mode) return null;
    const { dep, attacker } = base;
    const honest = [transferCall(dep.tokens.dUSDC, dep.ens.recipient, ONE_DUSDC)];
    return mode === "honest" ? { calls: honest, validity: VALIDITY_S } : { calls: [transferCall(dep.tokens.dUSDC, attacker, ONE_DUSDC)], lie: { calls: honest }, validity: VALIDITY_S };
    // round restarts the same mode with a new operation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, mode, round]);

  const pick = (m) => {
    setMode(m);
    setRound((r) => r + 1);
  };

  return (
    <section className="panel phone-sign" id="phone">
      <h2>Sign it on your phone</h2>
      <p className="muted small">
        The real hand-off between an owner’s phone and the laptop, with nothing in between but QR codes. The laptop builds a transaction on Sepolia and never holds the phone’s key; the phone never touches the internet. You read the sentence on the phone and approve it there.
      </p>
      <ol className="phone-steps">
        {STEPS.map(([t, d], i) => (
          <li key={t}>
            <b>
              {i + 1}. {t}
            </b>
            <span className="muted small">{d}</span>
          </li>
        ))}
      </ol>
      {err ? <div className="bad">Could not reach Sepolia: {err}</div> : null}
      {!base && !err ? <Loading what="Reading the account on Sepolia" /> : null}
      {base ? (
        <div className="phone-modes" role="group" aria-label="What the laptop sends">
          {Object.entries(MODES).map(([k, m]) => (
            <button key={k} type="button" className={`phone-mode${mode === k ? " on" : ""}`} aria-pressed={mode === k} onClick={() => pick(k)}>
              <b>{m.label}</b>
              <span>{m.blurb}</span>
            </button>
          ))}
        </div>
      ) : null}
      {spec ? (
        <>
          <p className="small">
            <b>Expected:</b> {MODES[mode].expect} The signature is valid for under five minutes, as the account’s policy requires; if it runs out, start over.{" "}
            <button type="button" className="chip" onClick={() => setRound((r) => r + 1)}>
              start over
            </button>
          </p>
          <OpRunner
            key={round}
            spec={spec}
            account={base.account}
            claimedTitle={mode === "tampered" ? "What the phone is shown (the frontend’s sentence)" : "What the phone is shown"}
            actualTitle="What the calldata really does"
            onEvent={(e) =>
              e.stage === "done" &&
              onTx?.({
                label: `Phone and laptop: ${MODES[mode].label.toLowerCase()}`,
                kind: e.outcome === "rejected-at-validation" ? "rejected" : e.outcome,
                txHash: e.txHash,
                userOpHash: e.userOpHash,
                error: e.outcome === "rejected-at-validation" ? e.error?.slice(0, 40) : undefined,
              })
            }
          />
        </>
      ) : null}
    </section>
  );
}
