import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { DevnetBanner, StatusBar } from "./StatusBar";
import { useData } from "../lib/data";

export const ROUTES = [
  ["/demo", "Side-by-side"],
  ["/attack", "Attack us"],
  ["/wallet", "Wallet"],
  ["/sentences", "Sentences"],
  ["/xray", "Hook X-ray"],
  ["/ens", "ENS"],
  ["/trust", "Trust"],
  ["/mempool", "Mempool"],
  ["/proofs", "Proofs"],
  ["/standards", "Standards"],
];

export const REPO = "https://github.com/shaurya2k06/verbatim";

export function Layout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const manifest = useData("manifest.json");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <>
      <StatusBar />
      <header className="top">
        <nav className="nav">
          <NavLink to="/" className="brand" end>
            Verbatim
          </NavLink>
          <button className="menu" aria-expanded={open} aria-controls="nav-links" onClick={() => setOpen(!open)}>
            {open ? "Close" : "Menu"}
          </button>
          <div id="nav-links" className={`links${open ? " open" : ""}`}>
            {ROUTES.map(([to, label]) => (
              <NavLink key={to} to={to} onClick={() => setOpen(false)}>
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
        <DevnetBanner />
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="foot">
        <a href={REPO}>Repository</a>
        <a href={`${REPO}/tree/main/docs/erc`}>ERC drafts</a>
        <a href={`${REPO}/blob/main/docs/FINDINGS.md`}>Findings</a>
        <a href={`${REPO}/blob/main/LICENSE`}>MIT license</a>
        <a href={`${REPO}/graphs/contributors`}>Team</a>
        {manifest.data ? (
          <span className="mono">
            evidence as of {manifest.data.commit}
            {manifest.data.dirty ? "+modified" : ""}
          </span>
        ) : null}
      </footer>
    </>
  );
}
