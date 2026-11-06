import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout, PageBoundary } from "./components/Layout";
import { Loading } from "./components/States";
import { NetworkProvider } from "./lib/network-context";
import Home from "./pages/Home";
import Proofs from "./pages/Proofs";
import Suites from "./pages/Suites";

// Heavier pages load on demand: they bring the renderer, the signer core and WalletConnect.
const Demo = lazy(() => import("./pages/Demo"));
const Attack = lazy(() => import("./pages/Attack"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Sentences = lazy(() => import("./pages/Sentences"));
const Xray = lazy(() => import("./pages/Xray"));
const Ens = lazy(() => import("./pages/Ens"));
const Trust = lazy(() => import("./pages/Trust"));
const Mempool = lazy(() => import("./pages/Mempool"));
const Standards = lazy(() => import("./pages/Standards"));

function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p className="lede">There is no page here.</p>
    </>
  );
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
          {/* The landing page and the live demo bring their own navigation and footer. */}
          <Route
            index
            element={
              <PageBoundary path="/">
                <Home />
              </PageBoundary>
            }
          />
          <Route
            path="suites"
            element={
              <PageBoundary path="/suites">
                <Suites />
              </PageBoundary>
            }
          />
          <Route element={<Layout />}>
            <Route path="demo" element={page(Demo)} />
            <Route path="attack" element={page(Attack)} />
            <Route path="wallet" element={page(Wallet)} />
            <Route path="sentences" element={page(Sentences)} />
            <Route path="xray" element={page(Xray)} />
            <Route path="ens" element={page(Ens)} />
            <Route path="trust" element={page(Trust)} />
            <Route path="mempool" element={page(Mempool)} />
            <Route path="proofs" element={<Proofs />} />
            <Route path="standards" element={page(Standards)} />
            {/* /bounty appears only once an L2 deployment with a funded bounty wallet is published. Until then /standards says so. */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </NetworkProvider>
    </BrowserRouter>
  );
}
