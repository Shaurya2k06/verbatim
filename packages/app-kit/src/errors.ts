// Our contracts' revert reasons, decoded and explained in plain words. No network, no deployment: safe to import anywhere.
import { decodeErrorResult, parseAbi, type Hex } from "viem";

export const ERRORS = parseAbi([
  "error TreeMismatch(bytes32 expected, bytes32 actual)",
  "error SpecHashMismatch(bytes32 expected, bytes32 actual)",
  "error PolicyRefused(uint256 risk)",
  "error DigestMismatch(bytes32 expected, bytes32 signed)",
  "error Replayed(bytes32 digest)",
  "error SnapshotMissing()",
  "error SnapshotExpiresTooSoon(uint64 expiry, uint64 snapshotExpiry)",
  "error SnapshotTtlTooLong(uint256 ttl, uint256 max)",
  "error NoTicket(uint256 nonce, uint256 needed)",
  "error TtlTooLong(uint256 remaining, uint256 maxTtl)",
  "error NotCanonicalSender(bytes32 codehash)",
  "error BadLayout(uint256 check)",
  "error BadSignatureEntry()",
  "error SignersNotSortedOrUnknown()",
  "error FrameReadFailed()",
  "error AssertionFailed(uint256 index, uint256 expected, uint256 actual)",
  "error Expired(uint256 timestamp, uint256 expiry)",
  "error CallFailed(uint256 index, bytes reason)",
  "error CodeChanged(address target)",
  "error CodeAppeared(address target)",
  "error AttestorNotListed(address attestor)",
  "error LeafRevokedInEns(bytes32 leafHash)",
  "error WrongResolverCode(bytes32 found)",
  "error RootRolesHeld(uint256 roleCount)",
  "error RecordSetterNotExclusive(string key, uint256 roleCount)",
]);

export const EXPLAIN: Record<string, string> = {
  TreeMismatch: "The calldata does not render to the sentence you signed.",
  SpecHashMismatch: "The assertions do not match the sentence you signed.",
  PolicyRefused: "The sentence is true, and your policy refuses it.",
  DigestMismatch: "The signatures cover something other than what this transaction renders to.",
  Replayed: "This exact signed content has already run.",
  SnapshotExpiresTooSoon: "The signature outlives the attested snapshot. Trust needs refreshing.",
  NoTicket: "No fee is prepaid for this transaction's nonce.",
  TtlTooLong: "The signature stays valid for longer than your policy allows.",
  BadLayout: "The transaction is not the required four-frame shape.",
  BadSignatureEntry: "The signatures do not cover this transaction.",
  SignersNotSortedOrUnknown: "The owners' signatures are not over what this operation carries.",
  SpecMismatch: "The assertions sent do not match the sentence you signed.",
  FrameReadFailed: "Frame data could not be read.",
  AssertionFailed: "The contract did something the sentence did not say. Everything was undone.",
  Expired: "The signature is past its validity window.",
  CallFailed: "A call in the batch reverted. Everything was undone.",
  CodeAppeared: "An address claimed to hold no code does.",
  CodeChanged: "A contract's code changed after signing.",
  AttestorNotListed: "An attestor who signed the snapshot is no longer listed in ENS.",
  LeafRevokedInEns: "Something this transaction relies on has been revoked in ENS.",
  WrongResolverCode: "The name's resolver is not the pinned code, so nobody can vouch that its records are locked.",
  RootRolesHeld: "Someone can still rewrite this name's records, so it cannot be trusted.",
  RecordSetterNotExclusive: "More than the governance key can write this record.",
};

export function explainRevert(text: string): { name?: string; human: string; raw: string } {
  const m = text.match(/0x[0-9a-fA-F]{8,}/);
  if (m) {
    try {
      const e = decodeErrorResult({ abi: ERRORS, data: m[0] as Hex });
      const args = (e.args ?? []).map((a: unknown) => (typeof a === "bigint" ? `0x${a.toString(16)}` : String(a))).join(", ");
      return { name: e.errorName, human: EXPLAIN[e.errorName] ?? e.errorName, raw: `${e.errorName}(${args})` };
    } catch {
      /* not one of ours */
    }
  }
  return { human: text, raw: text };
}

