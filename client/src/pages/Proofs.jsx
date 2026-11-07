// The test history: every run on record. The proof ledger, one row per claim, lives on the live demo page, where its rows can run
// again; an old link to a proof is sent there.
import { lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Loading } from "../components/States";

const History = lazy(() => import("./History"));

export default function Proofs() {
  const [params] = useSearchParams();
  const id = params.get("id");
  if (id) return <Navigate to={`/demo?id=${encodeURIComponent(id)}#proofs`} replace />;
  return (
    <Suspense fallback={<Loading what="Loading the history" />}>
      <History />
    </Suspense>
  );
}
