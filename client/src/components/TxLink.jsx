import { useNetwork } from "../lib/network-context";
import { txUrl } from "../lib/networks";

export const short = (h, n = 6) => (h && h.length > 2 * n + 4 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

export function TxLink({ hash, leg }) {
  const { deployments } = useNetwork();
  if (!hash) return null;
  return (
    <a className="mono" href={txUrl(leg, hash, deployments)} target="_blank" rel="noreferrer">
      {short(hash)} ↗
    </a>
  );
}
