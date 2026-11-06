import { REPO } from "../components/Layout";
import { useData } from "../lib/data";
import { Mark } from "./LandingNav";

export function Footer() {
  const { data: manifest } = useData("manifest.json");
  return (
    <footer className="lp-footer">
      <div className="lp-footer-brand">
        <Mark size={18} />
        <span>Verbatim. The chain is your wallet’s screen.</span>
      </div>
      <div className="lp-footer-links">
        <a href={REPO}>Repository</a>
        <a href={`${REPO}/tree/main/contracts/docs/erc`}>ERC drafts</a>
        <a href={`${REPO}/blob/main/contracts/docs/FINDINGS.md`}>Findings</a>
        <a href={`${REPO}/blob/main/LICENSE`}>MIT license</a>
        <a href={`${REPO}/graphs/contributors`}>Team</a>
        {manifest ? (
          <span>
            evidence as of {manifest.commit}
            {manifest.dirty ? "+modified" : ""}
          </span>
        ) : null}
      </div>
    </footer>
  );
}
