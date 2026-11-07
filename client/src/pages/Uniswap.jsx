import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseAbi, parseEther } from "viem";
import { Pill } from "../components/Badge";
import { SuiteRunner } from "../components/SuiteRunner";
import { OpRunner } from "../components/OpRunner";
import { ProofRef } from "../components/ProofRef";
import { Loading } from "../components/States";
import { TxLink } from "../components/TxLink";
import { apiPost, serverConfig } from "../lib/api";
import { useData } from "../lib/data";
import { useNetwork } from "../lib/network-context";
import { sepoliaPublic } from "../lib/networks";
import { accountState, quote, received, swapCall } from "../lib/userop";

const HOOK = parseAbi(["function ATTACKER() view returns (address)"]);
const SLIPPAGE_BPS = 100n;
const fmt = (raw) => formatUnits(raw, 6);

function useSetup(dep, amount) {
  const [s, set] = useState({ loading: true });
  useEffect(() => {
    if (!dep) return;
    let live = true;
    (async () => {
      const pub = sepoliaPublic();
      const amountIn = parseEther(amount || "0");
      const [account, expected, attacker, config] = await Promise.all([accountState(dep.account), amountIn > 0n ? quote(dep, dep.pools.eth.key, amountIn) : 0n, pub.readContract({ address: dep.skimHook, abi: HOOK, functionName: "ATTACKER" }), serverConfig()]);
      return { account, expected, minOut: (expected * (10_000n - SLIPPAGE_BPS)) / 10_000n, attacker, config, amountIn };
    })()
      .then((x) => live && set(x))
      .catch((error) => live && set({ error }));
    return () => {
      live = false;
    };
  }, [dep, amount]);
  return s;
}

/** The left column: the same swap from an ordinary wallet, sent by the server's throwaway EOA. */
function Ordinary({ dep, setup, tamper, route, onTx }) {
  const [r, setR] = useState(null);
  const run = async () => {
    setR({ running: true });
    try {
      const key = tamper || route === "evil" ? dep.pools.ethEvil.key : dep.pools.eth.key;
      const call = swapCall(dep, key, setup.amountIn, tamper ? 0n : setup.minOut);
      const { hash, from } = await apiPost("/demo/eoa-swap", { data: call.data, value: call.value });
      setR({ running: true, hash });
      const rc = await sepoliaPublic().waitForTransactionReceipt({ hash, timeout: 180_000 });
      const got = received(rc.logs, dep.tokens.dUSDC, from);
      const took = received(rc.logs, dep.tokens.dUSDC, setup.attacker);
      setR({ hash, status: rc.status, got, took });
      onTx?.({ label: "Ordinary wallet, tampered frontend", kind: took > got ? "skimmed" : rc.status === "success" ? "landed" : "reverted", txHash: hash, block: rc.blockNumber.toString(), gas: rc.gasUsed.toString() });
    } catch (e) {
      setR({ error: e.message });
    }
  };
  return (
    <div className="panel col">
      <h2>Ordinary wallet</h2>
      <div className="label">It shows the frontend's claim</div>
      <div className="claim">
        Swap {formatUnits(setup.amountIn, 18)} ETH for at least {fmt(setup.minOut)} dUSDC
      </div>
      <p className="muted small">An ordinary wallet signs calldata. It has no way to know the claim and the calldata disagree.</p>
      <button className="primary" onClick={run} disabled={r?.running || !setup.config?.eoaDemo}>
        {r?.running ? "Sending…" : "Run from an ordinary wallet"}
      </button>
      {!setup.config?.eoaDemo ? <div className="muted small">The server has no demo wallet configured; the recorded run is below.</div> : null}
      {r?.error ? <div className="bad">{r.error}</div> : null}
      {r?.hash && r.status ? (
        <div className="result">
          <div className="kv">
            <span>Expected</span>
            <span>at least {fmt(setup.minOut)} dUSDC</span>
            <span>Received</span>
            <span className={r.got < setup.minOut ? "neg" : ""}>{fmt(r.got)} dUSDC</span>
            <span>The hook took</span>
            <span className={r.took > 0n ? "neg" : ""}>{fmt(r.took)} dUSDC</span>
          </div>
          <TxLink hash={r.hash} leg="sepolia" />
        </div>
      ) : r?.hash ? (
        <div className="muted small">
          Sent <TxLink hash={r.hash} leg="sepolia" />, waiting for a block…
        </div>
      ) : null}
      <div className="label">Recorded</div>
      <ProofRef id="B-A2-eoa" />
    </div>
  );
}

const VARIANTS = {
  tampered: { label: "Sign what the frontend shows", expect: "TreeMismatch: the chain re-renders the calldata, and it is not the sentence that was signed." },
  truth: { label: "Sign the true sentence anyway", expect: "PolicyRefused: the device shows the risk lines, and the account's policy refuses them." },
  honest: { label: "Honest swap", expect: "Admitted and landed, with the minimum output enforced at execution." },
};

function Verbatim({ dep, setup, tamper, route, live, onTx }) {
  const [variant, setVariant] = useState(null);
  useEffect(() => {
    setVariant(null);
  }, [tamper, route, setup]);
  const spec = useMemo(() => {
    if (!variant) return null;
    const honest = swapCall(dep, dep.pools.eth.key, setup.amountIn, setup.minOut);
    const evil = swapCall(dep, dep.pools.ethEvil.key, setup.amountIn, 0n);
    if (variant === "tampered") return { calls: [evil], lie: { calls: [route === "evil" ? swapCall(dep, dep.pools.ethEvil.key, setup.amountIn, setup.minOut) : honest] } };
    if (variant === "truth") return { calls: [evil] };
    return { calls: [honest] };
  }, [variant, dep, setup, route]);
  return (
    <div className="panel col">
      <h2>Verbatim</h2>
      <p className="small">The offline signer shows the sentence the chain will render. Two owners of {setup.account.threshold}-of-{setup.account.owners.length} sign it; the account re-renders it in validation.</p>
      <div className="variants">
        {(tamper ? ["tampered", "truth", "honest"] : ["honest", "truth"]).map((v) => (
          <button key={v} className={variant === v ? "primary" : ""} onClick={() => setVariant(v)} disabled={!live}>
            {VARIANTS[v].label}
          </button>
        ))}
      </div>
      {!live ? <div className="muted small">Sepolia is unreachable, so live runs are off. Recorded runs are below.</div> : null}
      {variant ? (
        <>
          <div className="callout small">Expected: {VARIANTS[variant].expect}</div>
          <OpRunner key={variant} spec={spec} account={setup.account} onEvent={(e) => e.stage === "done" && onTx?.({ label: `Verbatim: ${VARIANTS[variant].label}`, kind: e.outcome === "rejected-at-validation" ? "rejected" : e.outcome, txHash: e.txHash, userOpHash: e.userOpHash, block: e.receipt?.receipt?.blockNumber ? String(BigInt(e.receipt.receipt.blockNumber)) : undefined, gas: e.receipt?.actualGasUsed ? String(BigInt(e.receipt.actualGasUsed)) : undefined, error: e.outcome === "rejected-at-validation" ? e.error?.slice(0, 40) : undefined })} claimedTitle={variant === "tampered" ? "The device shows (the frontend's sentence)" : "The device shows"} actualTitle="What the calldata really does" />
        </>
      ) : null}
      <div className="label">Recorded</div>
      <ProofRef id="B-A1" />
      <ProofRef id="B-A2b" />
      <ProofRef id="B-swap" />
    </div>
  );
}

export default function Uniswap() {
  const { deployments, stateOf } = useNetwork();
  const dep = deployments?.sepolia;
  // One fixed scenario: 0.001 ETH on Sepolia, through a tampered frontend that claims the honest pool.
  const leg = "sepolia";
  const amount = "0.001";
  const route = "honest";
  const tamper = true;
  const amountOk = /^\d*\.?\d+$/.test(amount) && parseEther(amount) > 0n && parseEther(amount) <= parseEther("0.001");
  const setup = useSetup(amountOk ? dep : null, amount);
  const live = stateOf("sepolia") === "live";
  const manifest = useData("manifest.json");
  void manifest;

  return (
    <>
      <h1>Uniswap</h1>
      <p className="lede">The same malicious swap, twice: an ordinary wallet on the left, Verbatim on the right. Live on Sepolia, against Uniswap's official v4 contracts.</p>
      {leg === "devnet" ? (
        <div className="panel">
          <div className="callout">The frames devnet leg runs the same swap through the alternative mempool. It is not producing blocks right now, so here are its recorded runs.</div>
          <div className="grid2">
            {["A2-eoa", "A2", "A2b", "SWAP"].map((id) => (
              <ProofRef key={id} id={id} />
            ))}
          </div>
        </div>
      ) : !amountOk ? (
        <div className="bad">Enter an amount above 0 and at most 0.001 ETH.</div>
      ) : setup.loading ? (
        <Loading what="Quoting the honest pool and reading the account" />
      ) : setup.error ? (
        <div className="panel">
          <div className="bad">Sepolia is unreachable: {setup.error.shortMessage ?? setup.error.message}. Recorded runs:</div>
          <div className="grid2">
            {["B-A2-eoa", "B-A1", "B-A2b", "B-swap"].map((id) => (
              <ProofRef key={id} id={id} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className="small muted">
            The honest pool quotes {fmt(setup.expected)} dUSDC for {amount} ETH right now (Uniswap v4 Quoter). The frontend claims at least {fmt(setup.minOut)}, after 1% slippage.
          </p>
          <div className="sidebyside">
            <Ordinary dep={dep} setup={setup} tamper={tamper} route={route} />
            <Verbatim dep={dep} setup={setup} tamper={tamper} route={route} live={live} />
          </div>
        </>
      )}

      <section className="panel">
        <h2>
          The real Uniswap app <Pill tone="ok">RECORDED · Sepolia</Pill>
        </h2>
        <p>
          The same attack as a malicious build step on Uniswap's own interface: a Vite plugin rewrites <code>eth_sendTransaction</code> into a minimum-output-0 swap through SkimHook, while the page keeps showing the honest quote. The page said 26.19 USDC. The ordinary wallet signed, and almost all of the output went to the hook. Verbatim refused the same bytes.
        </p>
        <figure className="uni-video">
          <video controls preload="metadata" playsInline poster="/media/uniswap-interface-attack.jpg" aria-label="Recording of Uniswap's real interface, built with a malicious step, signing a swap">
            <source src="/media/uniswap-interface-attack.mp4" type="video/mp4" />
            Your browser can't play this recording. <a href="/media/uniswap-interface-attack.mp4">Download it</a>.
          </video>
          <figcaption className="muted small">
            The recording, about a minute and a quarter: the compromised page quotes 0.001 ETH for 26.19 USDC and an ordinary wallet signs it; the numbers the chain recorded for that swap; then the same bytes handed to Verbatim, where the offline device shows the risk lines and the account refuses with PolicyRefused(56). The browser session is a recording; the numbers and the refusal are read from Sepolia for that same transaction. <a href="/media/uniswap-interface-attack.mp4">Download the video</a>.
          </figcaption>
        </figure>
        <div className="row">
          <ProofRef id="B-UI-eoa" />
          <ProofRef id="B-UI-verbatim" />
        </div>
      </section>

            <section className="panel" id="uniswap-cases">
        <h2>Run the Uniswap cases on Sepolia</h2>
        <p className="muted small">
          Every case that is about a swap or the router, run by the server against Uniswap's official v4 contracts. No wallet or keys needed: the demo server signs as two of the account's owners, on a testnet account.
        </p>
        <SuiteRunner topic="uniswap" facts />
      </section>

    </>
  );
}
