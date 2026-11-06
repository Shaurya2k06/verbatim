// One user operation, end to end on Sepolia: build, show the sentence(s), collect owner signatures, submit, wait, report.
import { useEffect, useState } from "react";
import { review } from "@verbatim/signer";
import { prepare, requestOf, send, wait } from "../lib/userop";
import { Outcome } from "./Outcome";
import { SentenceDiff } from "./SentenceDiff";
import { SigningPanel } from "./SigningPanel";
import { Loading } from "./States";
import { Timeline } from "./Timeline";

/**
 * `spec` describes what to build: { calls, lie?: { calls }, weakenSpec?, validity?, holdUntilExpired? }. With `lie`, the signer is shown the
 * sentence of `lie.calls` while `calls` are what is sent: a tampered frontend.
 */
export function OpRunner({ spec, account, onEvent, disabled, claimedTitle, actualTitle }) {
  const [state, setState] = useState({ stage: "building" });
  const emit = (stage, extra = {}) => onEvent?.({ stage, ...extra });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const truth = await prepare({ calls: spec.calls, validity: spec.validity });
        let p = truth;
        let shown = null;
        if (spec.weakenSpec) {
          // The honest sentence, with its assertions swapped for an empty set (VSPEC v2, no items).
          p = await prepare({ calls: spec.calls, validity: spec.validity, override: { tree: truth.tree, spec: "0x565300020000" } });
        } else if (spec.lie) {
          shown = await prepare({ calls: spec.lie.calls, validity: spec.validity });
          p = await prepare({ calls: spec.calls, validity: spec.validity, override: { tree: shown.tree, spec: shown.spec } });
        }
        if (live) {
          setState({ stage: "built", p, trueTree: truth.tree });
          emit("built");
          try {
            review(requestOf(p));
          } catch (e) {
            emit("device-refused", { error: e.message });
          }
        }
      } catch (e) {
        if (live) setState({ stage: "built", buildError: e.shortMessage ?? e.message });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  const submit = async (sigs) => {
    const p = state.p;
    setState((s) => ({ ...s, stage: "signed" }));
    emit("signed");
    if (spec.holdUntilExpired) {
      setState((s) => ({ ...s, holding: true }));
      while (Math.floor(Date.now() / 1000) <= Number(p.expiry) + 15) await new Promise((r) => setTimeout(r, 2000));
      setState((s) => ({ ...s, holding: false }));
    }
    setState((s) => ({ ...s, stage: "submitted" }));
    const r = await send(p, sigs).catch((e) => ({ error: e.message }));
    if (r.error || r.rejected) {
      setState((s) => ({ ...s, stage: "done", outcome: r }));
      emit("done", { outcome: r.rejected ? "rejected-at-validation" : "error", error: r.reason?.raw ?? r.error });
      return;
    }
    setState((s) => ({ ...s, outcome: { pending: true, userOpHash: r.userOpHash } }));
    emit("submitted", { userOpHash: r.userOpHash });
    try {
      const w = await wait(r.userOpHash, p.account);
      setState((s) => ({ ...s, stage: "done", outcome: w }));
      emit("done", { outcome: w.result?.ok ? "landed" : "reverted-in-batch", error: w.result?.error?.raw, txHash: w.txHash, receipt: w });
    } catch (e) {
      setState((s) => ({ ...s, stage: "done", outcome: { error: e.message } }));
      emit("done", { outcome: "error", error: e.message });
    }
  };

  if (state.stage === "building") return <Loading what="Rendering the sentence from the calldata" />;
  if (state.buildError) return <div className="bad">Could not build: {state.buildError}</div>;
  const failed = state.outcome && (state.outcome.rejected || state.outcome.error || state.outcome.result?.ok === false);
  return (
    <div className="runner">
      <Timeline stage={state.stage} failed={failed} />
      <SentenceDiff claimed={state.p.tree} actual={state.trueTree} claimedTitle={claimedTitle} actualTitle={actualTitle} />
      {state.stage === "built" ? <SigningPanel request={requestOf(state.p)} owners={account.owners} needed={account.threshold} onReady={submit} disabled={disabled} /> : null}
      {state.holding ? <div className="muted">Holding the signature until it has expired, as a host replaying it later would…</div> : null}
      {state.stage === "signed" || state.stage === "submitted" ? <Loading what="Submitting through the bundler" /> : null}
      <Outcome o={state.outcome} />
    </div>
  );
}
