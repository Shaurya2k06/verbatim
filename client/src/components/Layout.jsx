import { Component, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { DevnetBanner, StatusBar } from "./StatusBar";
import { Footer } from "../landing/Footer";
import { HexField } from "../landing/HexField";
import { LandingNav } from "../landing/LandingNav";
import "../landing/landing.css";
import "../landing/app.css";

export const ROUTES = [
  ["/suites", "Live demo"],
  ["/demo", "Side-by-side"],
  ["/attack", "Attack us"],
  ["/wallet", "Wallet"],
  ["/sentences", "Sentences"],
  ["/xray", "Hook X-ray"],
  ["/ens", "ENS"],
  ["/trust", "Trust"],
  ["/mempool", "Mempool"],
  ["/proofs", "Proofs"],
  ["/history", "History"],
  ["/standards", "Standards"],
];

/** One page failing must not blank the site: show the error, keep the navigation. */
export class PageBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prev) {
    if (prev.path !== this.props.path && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="bad">
        This page failed: {this.state.error.message}. The rest of the site still works; <a href="/proofs">the proof ledger</a> needs no network.
      </div>
    );
  }
}

export const REPO = "https://github.com/shaurya2k06/verbatim";

export function Layout() {
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    // On a phone the page index scrolls sideways; keep the current page in view.
    const on = document.querySelector(".lp-nav-links.is-pages a.active");
    const track = on?.parentElement;
    // Only when the current page's link is out of sight: a bar that fits stays where it is.
    if (on && (on.offsetLeft < track.scrollLeft || on.offsetLeft + on.offsetWidth > track.scrollLeft + track.clientWidth)) track.scrollLeft = on.offsetLeft - (track.clientWidth - on.offsetWidth) / 2;
  }, [loc.pathname]);
  return (
    <div className="lp lp-app">
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <HexField />
      <LandingNav base="/" pages={ROUTES} />
      <div className="lp-app-status">
        <StatusBar />
        <DevnetBanner />
      </div>
      <main id="main" className="lp-page">
        <PageBoundary path={loc.pathname}>
          <Outlet />
        </PageBoundary>
      </main>
      <Footer />
    </div>
  );
}
