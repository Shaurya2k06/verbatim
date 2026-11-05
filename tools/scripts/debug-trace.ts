import { rpc, DEVNET } from "@verbatim/frames-sdk";
const h = process.argv[2];
const walk = (c: any, d = 0) => { const pad = " ".repeat(d*2); console.log(`${pad}${c.type} to=${c.to} gas=${c.gas} used=${c.gasUsed} in=${(c.input||'').slice(0,10)} err=${c.error||''} rev=${c.revertReason||''} out=${(c.output||'').slice(0,74)}`); for (const x of c.calls||[]) walk(x,d+1); };
for (const tracer of ["callTracer"]) {
  const t = await rpc<any>(DEVNET.node, "debug_traceTransaction", [h, { tracer }]).catch((e) => ({ err: e.message }));
  if (Array.isArray(t)) t.forEach((f, i) => { console.log("frame", i); walk(f.result ?? f); }); else if (t.err) console.log(t.err); else walk(t);
}
