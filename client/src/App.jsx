import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout, PageBoundary } from "./components/Layout";
import { Loading } from "./components/States";
import { NetworkProvider } from "./lib/network-context";
import Home from "./pages/Home";
import Proofs from "./pages/Proofs";

// Heavier pages load on demand: they bring the renderer, the signer core and WalletConnect.
const Demo = lazy(() => import("./pages/Demo"));
const Uniswap = lazy(() => import("./pages/Uniswap"));
const Ens = lazy(() => import("./pages/Ens"));

function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p className="lede">There is no page here.</p>
    </>
  );
}

/** The old live-demo page is now /demo; its swap cases moved to the Uniswap page. */
function SuitesRedirect() {
  const { hash } = useLocation();
  const uniswap = ["#skim", "#honest-swap"].includes(hash);
  return <Navigate to={`${uniswap ? "/uniswap" : "/demo"}${hash}`} replace />;
}

/** The test history is the second view of the proofs page. */
function HistoryRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/proofs${search ? `${search}&` : "?"}view=history`} replace />;
}

const page = (C) => (
  <Suspense fallback={<Loading />}>
    <C />
  </Suspense>
);

export default function App() {
  return (
    <BrowserRouter>
      <NetworkProvider>
        <Routes>
          {/* The landing page brings its own navigation and footer. */}
          <Route
            index
            element={
              <PageBoundary path="/">
                <Home />
              </PageBoundary>
            }
          />
          <Route element={<Layout />}>
            <Route path="demo" element={page(Demo)} />
            <Route path="uniswap" element={page(Uniswap)} />
            <Route path="suites" element={<SuitesRedirect />} />
            <Route path="ens" element={page(Ens)} />
            <Route path="proofs" element={<Proofs />} />
            <Route path="history" element={<HistoryRedirect />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </NetworkProvider>
    </BrowserRouter>
  );
}
