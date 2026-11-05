// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FrameIntrospection, DevnetFrames} from "../lib/FrameIntrospection.sol";
import {AssertionKit} from "../lib/AssertionKit.sol";
import {Buf, VSpec, PolicyRules} from "../lib/VTree.sol";
import {SnapshotVerifier} from "../lib/SnapshotVerifier.sol";

interface IStatelessRenderer {
    struct In {
        uint64 chainId;
        address account;
        uint64 expiry;
        bytes32 snapshotRoot;
        uint32 policyVersion;
        uint8 path;
        address feeAsset;
        uint256 maxFee;
        bytes body;
        address[] hints;
    }

    function render(bytes32 root, bytes calldata proofs, In memory i) external view returns (bytes32 treeHash, bytes32 specHash, uint256 risk);
}

interface IRevocationRegistry {
    function isRevoked(bytes32 leafHash) external view returns (bool);
}

interface IRendererPaymaster {
    function chargeTicket(uint256 nonce, uint256 amount) external;
}

/// §7.4. Every verifier builds this digest from its own view of the transaction (D2).
library OwnerDigest {
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant TX_TYPEHASH = keccak256("Tx(bytes32 treeHash,bytes32 specHash,uint64 expiry,bytes32 snapshotRoot,uint8 path,bytes32 txCommit)");
    bytes32 internal constant NAME_HASH = keccak256("Verbatim");
    bytes32 internal constant VERSION_HASH = keccak256("11");

    function compute(address account, bytes32 treeHash, bytes32 specHash, uint64 expiry, bytes32 root, uint8 path, bytes32 txCommit) internal view returns (bytes32 digest) {
        // Same as hashing abi.encode twice, without allocating: validation runs this on every transaction.
        bytes32 domainType = DOMAIN_TYPEHASH;
        bytes32 nameHash = NAME_HASH;
        bytes32 versionHash = VERSION_HASH;
        bytes32 txType = TX_TYPEHASH;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore(m, domainType)
            mstore(add(m, 0x20), nameHash)
            mstore(add(m, 0x40), versionHash)
            mstore(add(m, 0x60), chainid())
            mstore(add(m, 0x80), and(account, 0xffffffffffffffffffffffffffffffffffffffff))
            let domain := keccak256(m, 0xa0)
            mstore(m, txType)
            mstore(add(m, 0x20), treeHash)
            mstore(add(m, 0x40), specHash)
            mstore(add(m, 0x60), and(expiry, 0xffffffffffffffff))
            mstore(add(m, 0x80), root)
            mstore(add(m, 0xa0), and(path, 0xff))
            mstore(add(m, 0xc0), txCommit)
            let structHash := keccak256(m, 0xe0)
            mstore(m, 0x1901000000000000000000000000000000000000000000000000000000000000)
            mstore(add(m, 0x02), domain)
            mstore(add(m, 0x22), structHash)
            digest := keccak256(m, 0x42)
        }
    }
}

/// Owner-set, EIP-712, assertion and execution logic shared by the frame account and the 4337 account.
/// Holds no DELEGATECALL, no SELFDESTRUCT and no upgrade path (D10); see the bytecode scan in test/Invariants.t.sol.
abstract contract VerbatimCore {
    using Buf for bytes;

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    uint256 public constant MAX_LEDGER = 16;
    /// What the frame reader returns in one read.
    uint256 internal constant MAX_SIGNERS = 6;
    uint256 public constant MAX_WATCH = 32;
    uint256 public constant ASSERT_RESERVE = 200_000;
    uint256 internal constant OUTER_RESERVE = 30_000;
    uint256 internal constant MAX_RETURN = 256;
    uint256 internal constant SECP256K1N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    uint8 internal constant PHASE_IDLE = 0;
    uint8 internal constant PHASE_LOCKED = 1;
    uint8 internal constant PHASE_PROTECTED = 2;

    uint32 internal constant DEFAULT_MAX_TTL = 300;
    uint32 internal constant DEFAULT_MAX_SNAPSHOT_TTL = 6 hours;

    address public immutable RENDERER_PAYMASTER;
    address public immutable PERMIT2;

    address[] internal _owners;
    mapping(address => bool) public isOwner;

    // One slot, read with one SLOAD by validation (see `policyWord`). Policy inputs come only from sender storage (§7.4).
    uint8 public threshold;
    uint8 internal _phase;
    uint8 public attestorThreshold;
    uint32 public maxTtl;
    uint32 public maxSnapshotTtl;
    uint32 public allowMask;
    uint32 public policyVersion;
    /// keccak256 of the owner list, first 13 bytes. A false match would take a 2^104 second-preimage search, and this slot
    /// is read anyway: validation takes the list from frame data instead of paying two more SLOADs.
    bytes13 public ownersTag;

    /// Who may attest snapshots on the stateless path: the hash of the sorted list, which travels in frame data.
    bytes32 public attestorsHash;

    /// Permit2 base allowances only: nothing else may outlive a batch (D9).
    address[] internal _ledger;
    address[] internal _watchlist;
    /// Replay guard (D23): checked in VERIFY, set in execution, whatever the batch then does.
    mapping(bytes32 => bool) public consumed;

    error BadThreshold();
    error BadOwner();
    error BadSignatureLength();
    error SignatureMalleable();
    error SignersNotSortedOrUnknown();
    error NotSelf();
    error Reentrant();
    error NotLocked();
    error Expired(uint256 timestamp, uint256 validUntil);
    error TtlTooLong(uint256 remaining, uint256 maxTtl);
    error SpecMismatch();
    error CodeChanged(address target);
    error CodeAppeared(address target);
    error ImplChanged(address target);
    error CallFailed(uint256 index, bytes reason);
    error NoGasReserve();
    error LedgerFull();
    error WatchFull();
    error Replayed(bytes32 digest);
    error NameChanged(address target);

    event VerbatimResult(bool indexed ok, bytes err);

    constructor(address renderer, address permit2, address[] memory owners_, uint8 threshold_) {
        RENDERER_PAYMASTER = renderer;
        PERMIT2 = permit2;
        maxTtl = DEFAULT_MAX_TTL;
        maxSnapshotTtl = DEFAULT_MAX_SNAPSHOT_TTL;
        policyVersion = 1;
        if (threshold_ == 0 || threshold_ > owners_.length || threshold_ > MAX_SIGNERS) revert BadThreshold();
        for (uint256 i = 0; i < owners_.length; i++) {
            address o = owners_[i];
            if (o == address(0) || isOwner[o]) revert BadOwner();
            isOwner[o] = true;
            _owners.push(o);
        }
        threshold = threshold_;
        _setOwnersTag();
    }

    function _setAttestors(address[] memory list, uint8 k) internal {
        if (k == 0 || k > list.length) revert BadThreshold();
        attestorsHash = keccak256(abi.encodePacked(list));
        attestorThreshold = k;
    }

    function _setOwnersTag() private {
        ownersTag = bytes13(keccak256(abi.encodePacked(_owners)));
    }

    receive() external payable {}

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    /// Only reachable from inside a protected batch, so owners change only through a rendered TRUST_CHANGE (I7).
    modifier onlyBatch() {
        if (msg.sender != address(this) || _phase != PHASE_PROTECTED) revert NotSelf();
        _;
    }

    // ----------------------------------------------------------------------- signatures ---------

    /// The slot holding threshold and the policy. Bytes from the low end: threshold, phase, attestor threshold, maxTtl(4),
    /// maxSnapshotTtl(4), allowMask(4), policyVersion(4), ownersTag(13).
    function policyWord() external view returns (uint256 w) {
        assembly ("memory-safe") {
            w := sload(threshold.slot)
        }
    }

    function digestOf(bytes32 treeHash, bytes32 specHash, uint64 expiry, bytes32 root, uint8 path, bytes32 txCommit) public view returns (bytes32) {
        return OwnerDigest.compute(address(this), treeHash, specHash, expiry, root, path, txCommit);
    }

    /// Exactly `threshold` r||s||v signatures, signers strictly ascending, all owners, low s. No trailing bytes.
    function _checkSignatures(bytes32 digest, bytes memory sigs) internal view {
        uint256 k = threshold;
        if (sigs.length != k * 65) revert BadSignatureLength();
        address last;
        for (uint256 i = 0; i < k; i++) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly ("memory-safe") {
                let p := add(add(sigs, 0x20), mul(i, 65))
                r := mload(p)
                s := mload(add(p, 0x20))
                v := byte(0, mload(add(p, 0x40)))
            }
            if (uint256(s) > SECP256K1N_HALF) revert SignatureMalleable();
            address signer = ecrecover(digest, v, r, s);
            if (signer <= last || !isOwner[signer]) revert SignersNotSortedOrUnknown();
            last = signer;
        }
    }

    // ------------------------------------------------------------------------ execution ---------

    /// §10. Fee first; its failure reverts the frame and nothing protected runs. An assertion failure reverts the inner
    /// call only, so the fee stays paid and the digest stays consumed (I4, I5, I13).
    function _execute(Call[] calldata calls, bytes calldata spec, bytes32 specHash, uint64 expiry, bytes32 digest) internal {
        if (_phase != PHASE_IDLE) revert Reentrant();
        _phase = PHASE_LOCKED;
        _chargeFee();
        if (consumed[digest]) revert Replayed(digest);
        consumed[digest] = true;
        uint256 left = gasleft();
        if (left <= OUTER_RESERVE) revert NoGasReserve();
        (bool ok, bytes memory err) = _callBounded(address(this), 0, left - OUTER_RESERVE, abi.encodeCall(this.protectedBatch, (calls, spec, specHash, expiry)));
        emit VerbatimResult(ok, err);
        _phase = PHASE_IDLE;
    }

    function _chargeFee() internal virtual;

    /// §10 step 3: on the stateless path, the leaves used must not be revoked since the snapshot was signed.
    function _liveLeafChecks() internal view virtual;

    /// A call that keeps at most MAX_RETURN bytes of what comes back. Copying a target's whole revert data would let it
    /// spend our reserves, and with them the fee (A18). Solidity's `.call` always copies it all.
    function _callBounded(address target, uint256 value, uint256 gasLimit, bytes memory data) private returns (bool ok, bytes memory ret) {
        assembly ("memory-safe") {
            ok := call(gasLimit, target, value, add(data, 0x20), mload(data), 0, 0)
            let n := returndatasize()
            if gt(n, MAX_RETURN) { n := MAX_RETURN }
            ret := mload(0x40)
            mstore(ret, n)
            returndatacopy(add(ret, 0x20), 0, n)
            mstore(0x40, add(add(ret, 0x20), and(add(n, 31), not(31))))
        }
    }

    /// The inner self-call: expiry, live re-checks, snapshot, calls, assertions, ledger.
    function protectedBatch(Call[] calldata calls, bytes calldata spec, bytes32 specHash, uint64 expiry) external onlySelf {
        if (_phase != PHASE_LOCKED) revert NotLocked();
        _phase = PHASE_PROTECTED;
        if (keccak256(spec) != specHash) revert SpecMismatch();

        // The expiry frame already checked this. A second check costs little and depends on nothing else.
        if (block.timestamp > expiry) revert Expired(block.timestamp, expiry);
        if (expiry - block.timestamp > maxTtl) revert TtlTooLong(expiry - block.timestamp, maxTtl);

        _liveLeafChecks();
        bytes memory s = spec;
        _liveChecks(s);
        Snapshot memory pre = _snapshot(s);

        for (uint256 i = 0; i < calls.length; i++) {
            uint256 left = gasleft();
            if (left <= ASSERT_RESERVE) revert NoGasReserve();
            (bool ok, bytes memory ret) = _callBounded(calls[i].target, calls[i].value, left - ASSERT_RESERVE, calls[i].data);
            if (!ok) revert CallFailed(i, ret);
        }

        _liveChecks(s);
        _assert(s, pre);
        _updateLedger(s);
        _phase = PHASE_LOCKED;
    }

    function _liveChecks(bytes memory s) private view {
        uint256 n = AssertionKit.header(s);
        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.CODEHASH_EQ) {
                address t = AssertionKit.addrAt(s, p);
                if (t.codehash != bytes32(s.rdBe(p + 20, 32))) revert CodeChanged(t);
            } else if (op == VSpec.NO_CODE) {
                address t = AssertionKit.addrAt(s, p);
                if (t.code.length != 0) revert CodeAppeared(t);
            } else if (op == VSpec.NAME_EQ) {
                address a = AssertionKit.addrAt(s, p);
                if (AssertionKit.resolveAddr(AssertionKit.addrAt(s, p + 20), bytes32(s.rdWord(p + 40))) != a) revert NameChanged(a);
            } else if (op == VSpec.IMPL_EQ) {
                address t = AssertionKit.addrAt(s, p);
                (bool ok, bytes memory out) = t.staticcall{gas: AssertionKit.READ_GAS}(abi.encodeWithSelector(bytes4(bytes32(s.rdBe(p + 20, 4) << 224))));
                if (!ok || out.length < 32 || address(uint160(uint256(abi.decode(out, (bytes32))))) != AssertionKit.addrAt(s, p + 24)) revert ImplChanged(t);
            }
            p += AssertionKit.itemSize(op);
        }
    }

    struct Snapshot {
        address[] tracked;
        uint256[] trackedPre;
        uint256 nTracked;
        uint256[] deltaPre; // per item index
        uint256[] ledgerPre;
        uint256[] p2Pre; // per item index
        bytes32 ownersHash;
        uint256 policy;
        bytes32 selfCode;
    }

    function _track(Snapshot memory x, address asset) private view {
        for (uint256 i = 0; i < x.nTracked; i++) if (x.tracked[i] == asset) return;
        x.tracked[x.nTracked] = asset;
        x.trackedPre[x.nTracked] = AssertionKit.balance(address(this), asset);
        x.nTracked++;
    }

    function _snapshot(bytes memory s) private view returns (Snapshot memory x) {
        uint256 n = AssertionKit.header(s);
        uint256 lN = _ledger.length;
        uint256 wN = _watchlist.length;
        uint256 cap = 1 + lN + wN + n;
        x.tracked = new address[](cap);
        x.trackedPre = new uint256[](cap);
        x.deltaPre = new uint256[](n);
        x.ledgerPre = new uint256[](lN);

        _track(x, address(0));
        for (uint256 i = 0; i < lN; i++) {
            x.ledgerPre[i] = AssertionKit.erc20Allowance(_ledger[i], address(this), PERMIT2);
            _track(x, _ledger[i]);
        }
        for (uint256 i = 0; i < wN; i++) _track(x, _watchlist[i]);

        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.DELTA_EQ || op == VSpec.DELTA_GE) {
                x.deltaPre[i] = AssertionKit.balance(AssertionKit.addrAt(s, p), AssertionKit.addrAt(s, p + 20));
            } else if (op == VSpec.ALLOW_LE) {
                _track(x, AssertionKit.addrAt(s, p));
            } else if (op == VSpec.P2ALLOW_LE) {
                _track(x, AssertionKit.addrAt(s, p + 20));
            }
            p += AssertionKit.itemSize(op);
        }
        x.ownersHash = keccak256(abi.encodePacked(_owners));
        x.policy = _policySlot();
        x.selfCode = address(this).codehash;
    }

    /// Threshold and policy, without the phase byte.
    function _policySlot() private view returns (uint256 w) {
        assembly ("memory-safe") {
            w := and(sload(threshold.slot), not(0xff00))
        }
    }

    function _fail(uint256 i, uint256 expected, uint256 actual) private pure {
        revert AssertionKit.AssertionFailed(i, expected, actual);
    }

    function _assert(bytes memory s, Snapshot memory x) private view {
        uint256 n = AssertionKit.header(s);
        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.DELTA_EQ) {
                uint256 post = AssertionKit.balance(AssertionKit.addrAt(s, p), AssertionKit.addrAt(s, p + 20));
                int256 want = int256(s.rdWord(p + 40));
                int256 got = int256(post) - int256(x.deltaPre[i]);
                if (got != want) _fail(i, uint256(want), uint256(got));
            } else if (op == VSpec.DELTA_GE) {
                uint256 post = AssertionKit.balance(AssertionKit.addrAt(s, p), AssertionKit.addrAt(s, p + 20));
                uint256 want = s.rdWord(p + 40);
                if (post < x.deltaPre[i] + want) _fail(i, x.deltaPre[i] + want, post);
            } else if (op == VSpec.ALLOW_LE) {
                uint256 post = AssertionKit.erc20Allowance(AssertionKit.addrAt(s, p), address(this), AssertionKit.addrAt(s, p + 20));
                uint256 max = s.rdWord(p + 40);
                if (post > max) _fail(i, max, post);
            } else if (op == VSpec.P2ALLOW_LE) {
                uint256 post = AssertionKit.p2Allowance(AssertionKit.addrAt(s, p), address(this), AssertionKit.addrAt(s, p + 20), AssertionKit.addrAt(s, p + 40));
                uint256 max = s.rdBe(p + 60, 20);
                if (post > max) _fail(i, max, post);
            } else if (op == VSpec.OPERATOR_EQ) {
                bool got = AssertionKit.isOperator(AssertionKit.addrAt(s, p), address(this), AssertionKit.addrAt(s, p + 20));
                if (got != (s.rdU8(p + 40) == 1)) _fail(i, s.rdU8(p + 40), got ? 1 : 0);
            } else if (op == VSpec.OWNER_EQ) {
                address o = AssertionKit.ownerOf(AssertionKit.addrAt(s, p), s.rdWord(p + 20));
                address want = AssertionKit.addrAt(s, p + 52);
                if (o != want) _fail(i, uint160(want), uint160(o));
            } else if (op == VSpec.TRACKED_NO_DECREASE) {
                _assertTracked(s, x, i);
            } else if (op == VSpec.TRACKED_NO_ALLOW_INC) {
                _assertAllowances(s, x, i);
            } else if (op == VSpec.ACCOUNT_INVARIANT) {
                if (s.rdU8(p) == 0) _assertAccount(x, i);
            } else if (op == VSpec.APPROVALS_CLEARED) {
                _assertCleared(s, i);
            }
            p += AssertionKit.itemSize(op);
        }
    }

    /// True if a delta item names (this account, asset): those are checked exactly and exempt from no-decrease.
    function _named(bytes memory s, address asset) private view returns (bool) {
        uint256 n = AssertionKit.header(s);
        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if ((op == VSpec.DELTA_EQ || op == VSpec.DELTA_GE) && AssertionKit.addrAt(s, p) == address(this) && AssertionKit.addrAt(s, p + 20) == asset) return true;
            p += AssertionKit.itemSize(op);
        }
        return false;
    }

    function _assertTracked(bytes memory s, Snapshot memory x, uint256 index) private view {
        for (uint256 i = 0; i < x.nTracked; i++) {
            address asset = x.tracked[i];
            if (_named(s, asset)) continue;
            uint256 post = AssertionKit.balance(address(this), asset);
            if (post < x.trackedPre[i]) _fail(index, uint256(uint160(asset)), post);
        }
    }

    /// Does the spec declare this token's base allowance to Permit2?
    function _declaresBase(bytes memory s, address token) private view returns (bool) {
        uint256 n = AssertionKit.header(s);
        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.ALLOW_LE && AssertionKit.addrAt(s, p) == token && AssertionKit.addrAt(s, p + 20) == PERMIT2) return true;
            p += AssertionKit.itemSize(op);
        }
        return false;
    }

    function _assertAllowances(bytes memory s, Snapshot memory x, uint256 index) private view {
        for (uint256 i = 0; i < x.ledgerPre.length; i++) {
            address t = _ledger[i];
            if (_declaresBase(s, t)) continue;
            uint256 post = AssertionKit.erc20Allowance(t, address(this), PERMIT2);
            if (post > x.ledgerPre[i]) _fail(index, x.ledgerPre[i], post);
        }
    }

    /// D9: every approval the batch names is back to zero, except an ERC-20 base allowance to Permit2.
    function _assertCleared(bytes memory s, uint256 index) private view {
        uint256 n = AssertionKit.header(s);
        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.ALLOW_LE) {
                address spender = AssertionKit.addrAt(s, p + 20);
                if (spender != PERMIT2) {
                    uint256 post = AssertionKit.erc20Allowance(AssertionKit.addrAt(s, p), address(this), spender);
                    if (post != 0) _fail(index, 0, post);
                }
            } else if (op == VSpec.P2ALLOW_LE) {
                uint256 post = AssertionKit.p2Allowance(AssertionKit.addrAt(s, p), address(this), AssertionKit.addrAt(s, p + 20), AssertionKit.addrAt(s, p + 40));
                if (post != 0) _fail(index, 0, post);
            } else if (op == VSpec.OPERATOR_EQ) {
                if (AssertionKit.isOperator(AssertionKit.addrAt(s, p), address(this), AssertionKit.addrAt(s, p + 20))) _fail(index, 0, 1);
            }
            p += AssertionKit.itemSize(op);
        }
    }

    /// §10 step 5: record Permit2 base allowances, drop those at zero, keep to the cap.
    function _updateLedger(bytes memory s) private {
        uint256 n = AssertionKit.header(s);
        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.ALLOW_LE && AssertionKit.addrAt(s, p + 20) == PERMIT2) {
                address t = AssertionKit.addrAt(s, p);
                bool found;
                for (uint256 k = 0; k < _ledger.length; k++) if (_ledger[k] == t) found = true;
                if (!found) _ledger.push(t);
            }
            p += AssertionKit.itemSize(op);
        }
        for (uint256 k = _ledger.length; k > 0; k--) {
            if (AssertionKit.erc20Allowance(_ledger[k - 1], address(this), PERMIT2) == 0) {
                _ledger[k - 1] = _ledger[_ledger.length - 1];
                _ledger.pop();
            }
        }
        if (_ledger.length > MAX_LEDGER) revert LedgerFull();
    }

    function _assertAccount(Snapshot memory x, uint256 index) private view {
        if (keccak256(abi.encodePacked(_owners)) != x.ownersHash) _fail(index, 0, 1);
        if (address(this).codehash != x.selfCode) _fail(index, 0, 2);
        if (_policySlot() != x.policy) _fail(index, 0, 3);
    }

    // --------------------------------------------------------------- self-administration --------

    function addOwner(address o) external onlyBatch {
        if (o == address(0) || isOwner[o]) revert BadOwner();
        isOwner[o] = true;
        _owners.push(o);
        _setOwnersTag();
    }

    function removeOwner(address o) external onlyBatch {
        if (!isOwner[o] || _owners.length - 1 < threshold) revert BadOwner();
        isOwner[o] = false;
        for (uint256 i = 0; i < _owners.length; i++) {
            if (_owners[i] == o) {
                _owners[i] = _owners[_owners.length - 1];
                _owners.pop();
                _setOwnersTag();
                return;
            }
        }
    }

    function setThreshold(uint8 t) external onlyBatch {
        if (t == 0 || t > _owners.length || t > MAX_SIGNERS) revert BadThreshold();
        threshold = t;
    }

    function addWatch(address token) external onlyBatch {
        if (_watchlist.length >= MAX_WATCH) revert WatchFull();
        for (uint256 i = 0; i < _watchlist.length; i++) if (_watchlist[i] == token) return;
        _watchlist.push(token);
    }

    function removeWatch(address token) external onlyBatch {
        for (uint256 i = 0; i < _watchlist.length; i++) {
            if (_watchlist[i] == token) {
                _watchlist[i] = _watchlist[_watchlist.length - 1];
                _watchlist.pop();
                return;
            }
        }
    }

    /// Changes who may attest snapshots. A TRUST_CHANGE like any other.
    function setAttestors(address[] calldata list, uint8 k) external onlyBatch {
        _setAttestors(list, k);
    }

    /// A new policy is a new version, which every later tree states.
    function setPolicy(uint32 maxTtl_, uint32 maxSnapshotTtl_, uint32 allowMask_) external onlyBatch {
        maxTtl = maxTtl_;
        maxSnapshotTtl = maxSnapshotTtl_;
        allowMask = allowMask_;
        policyVersion++;
    }

    // ---------------------------------------------------------------------------- views ---------

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function watchlist() external view returns (address[] memory) {
        return _watchlist;
    }

    function ledger() external view returns (address[] memory) {
        return _ledger;
    }

    /// ERC-1271 is off (D9): off-chain signatures cannot be post-checked.
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xffffffff;
    }
}

/// Leg A: the EIP-8141 sender. Frame 1 locks the layout and checks signatures; the last frame executes.
abstract contract VerbatimAccountBase is VerbatimCore, FrameIntrospection {
    address internal constant ENTRY_POINT = address(0xaa);
    /// 3,000 of entry charge, about 50 for the verifier's code.
    uint256 internal constant MIN_EXPIRY_GAS = 3_100;
    address public immutable EXPIRY_VERIFIER;

    error NotEntryPoint();
    error BadLayout(uint256 check);
    error BadSignatureEntry();
    error BadPath(uint256 path);
    error SnapshotExpiresTooSoon(uint64 expiry, uint64 snapshotExpiry);
    error SnapshotTtlTooLong(uint256 ttl, uint256 max);
    error TreeMismatch(bytes32 expected, bytes32 actual);
    error SpecHashMismatch(bytes32 expected, bytes32 actual);
    error PolicyRefused(uint256 risk);
    error LeafRevoked(bytes32 leafHash);

    address public immutable STATELESS_RENDERER;
    address public immutable REVOCATIONS;

    constructor(address renderer, address permit2, address expiryVerifier, address statelessRenderer, address revocations, address[] memory owners_, uint8 threshold_, address[] memory attestors_, uint8 attestorThreshold_) VerbatimCore(renderer, permit2, owners_, threshold_) {
        EXPIRY_VERIFIER = expiryVerifier;
        STATELESS_RENDERER = statelessRenderer;
        REVOCATIONS = revocations;
        _setAttestors(attestors_, attestorThreshold_);
    }

    /// The stateless path's part of frame 1: signatures, the snapshot, the render and the policy (§9.1). Reads only this
    /// account's storage and the code hashes of existing contracts.
    function _verifyStateless(Layout memory l, bytes32 treeHash, bytes32 specHash, bytes32 root, uint256 stored, address[] calldata owners_, bytes calldata extra) private view {
        _statelessLock(l);
        (address[] memory attestors_, uint64 issuedAt, uint64 snapExpiry, address[] memory hints, bytes memory proofs) = abi.decode(extra, (address[], uint64, uint64, address[], bytes));
        if (keccak256(abi.encodePacked(attestors_)) != attestorsHash) revert BadLayout(10);

        uint64 expiry = uint64(l.expiryWord >> 192);
        if (expiry > snapExpiry) revert SnapshotExpiresTooSoon(expiry, snapExpiry);
        uint256 maxSnapshotTtl = uint32(stored >> 56);
        if (snapExpiry - issuedAt > maxSnapshotTtl) revert SnapshotTtlTooLong(snapExpiry - issuedAt, maxSnapshotTtl);

        bytes32 digest = OwnerDigest.compute(address(this), treeHash, specHash, expiry, root, uint8(PATH_STATELESS), l.txCommit);
        if (consumed[digest]) revert Replayed(digest);
        uint256 kO = uint8(stored);
        uint256 kA = uint8(stored >> 16);
        // Exactly the owners' and attestors' entries: padding the list changes nothing a signer saw, so it is refused (B6).
        if (kO == 0 || kA == 0 || l.sigCount != kO + kA || kO + kA > MAX_SIGNATURES) revert BadSignatureEntry();
        _checkOwners(l, uint256(digest), kO, owners_);
        _checkAttestors(l, kO, kA, uint256(SnapshotVerifier.digest(root, issuedAt, snapExpiry, 1)), attestors_);

        IStatelessRenderer.In memory i;
        i.chainId = uint64(block.chainid);
        i.account = address(this);
        i.expiry = expiry;
        i.snapshotRoot = root;
        i.policyVersion = uint32(stored >> 120);
        i.path = uint8(PATH_STATELESS);
        i.maxFee = l.maxFee * (l.g0 + l.s0 + l.g1 + l.s1 + l.g2 + l.s2);
        i.body = _framedatacopy(4, l.l2 - 4, 2);
        i.hints = hints;
        (bytes32 tree, bytes32 spec, uint256 risk) = IStatelessRenderer(STATELESS_RENDERER).render(root, proofs, i);
        if (tree != treeHash) revert TreeMismatch(treeHash, tree);
        if (spec != specHash) revert SpecHashMismatch(specHash, spec);
        if (PolicyRules.refuses(risk, uint32(stored >> 88))) revert PolicyRefused(risk);
    }

    function _checkOwners(Layout memory l, uint256 expected, uint256 n, address[] calldata list) private pure {
        address last;
        for (uint256 i = 0; i < n; i++) {
            (uint256 scheme, uint256 signed, uint256 who) = _sigAt(l, i);
            if (scheme != SCHEME_SECP256K1 || signed != expected) revert BadSignatureEntry();
            address signer = address(uint160(who));
            if (signer <= last) revert SignersNotSortedOrUnknown();
            bool known;
            for (uint256 j = 0; j < list.length; j++) {
                if (list[j] == signer) {
                    known = true;
                    break;
                }
            }
            if (!known) revert SignersNotSortedOrUnknown();
            last = signer;
        }
    }

    function _checkAttestors(Layout memory l, uint256 from, uint256 n, uint256 expected, address[] memory list) private pure {
        address last;
        for (uint256 i = from; i < from + n; i++) {
            (uint256 scheme, uint256 signed, uint256 who) = _sigAt(l, i);
            if (scheme != SCHEME_SECP256K1 || signed != expected) revert BadSignatureEntry();
            address signer = address(uint160(who));
            if (signer <= last) revert SignersNotSortedOrUnknown();
            bool known;
            for (uint256 j = 0; j < list.length; j++) {
                if (list[j] == signer) {
                    known = true;
                    break;
                }
            }
            if (!known) revert SignersNotSortedOrUnknown();
            last = signer;
        }
    }

    /// I3: [expiry, VERIFY self, SENDER self.executeVerified]. Same rules as the paymaster layout, one frame shorter.
    function _statelessLock(Layout memory l) private view {
        uint256 self = uint160(address(this));
        if (l.frameCount != 3) revert BadLayout(0);
        if (l.current != 1) revert BadLayout(1);
        if (l.sender != self) revert BadLayout(2);
        if (l.blobCount != 0) revert BadLayout(7);
        if (l.m0 != MODE_VERIFY || l.t0 != uint160(EXPIRY_VERIFIER) || l.f0 != 0 || l.v0 != 0 || l.s0 != 0 || l.l0 != 8 || l.g0 < MIN_EXPIRY_GAS) revert BadLayout(8);
        if (l.m1 != MODE_VERIFY || l.t1 != self || l.f1 != SCOPE_BOTH || l.v1 != 0) revert BadLayout(3);
        if (l.m2 != MODE_SENDER || l.t2 != self || l.f2 != 0 || l.v2 != 0) revert BadLayout(5);
        if (bytes4(bytes32(_framedataload(0, 2))) != this.executeVerified.selector) revert BadLayout(6);
    }

    /// A revoked leaf never executes (I11). Only the stateless path needs this: the paymaster's cache already dropped it. Parses the
    /// proofs out of frame 1, which the protocol still holds, so a host cannot leave one out now that validation is over.
    function _liveLeafChecks() internal view override {
        if (uint8(_framedataload(100, 1)) != PATH_STATELESS) return;
        Layout memory l = _layout();
        bytes memory f = _framedatacopy(4, l.l1 - 4, 1);
        (, , , , , , bytes memory extra) = abi.decode(f, (bytes32, bytes32, bytes32, uint8, uint256, address[], bytes));
        (, , , , bytes memory proofs) = abi.decode(extra, (address[], uint64, uint64, address[], bytes));
        if (proofs.length == 0) return;
        uint256 depth = uint8(proofs[0]);
        uint256 p = 1;
        while (p < proofs.length) {
            (bytes32 h, uint256 next) = _leafAt(proofs, p, depth);
            if (IRevocationRegistry(REVOCATIONS).isRevoked(h)) revert LeafRevoked(h);
            p = next;
        }
    }

    function _leafAt(bytes memory proofs, uint256 p, uint256 depth) private pure returns (bytes32 h, uint256 next) {
        uint256 w;
        assembly ("memory-safe") {
            w := mload(add(add(proofs, 0x20), p))
        }
        uint256 kind = w >> 248;
        uint256 words = ((w >> 224) & 0xff) + ((w >> 216) & 0xff);
        uint256 vdescLen = (w >> 200) & 0xffff;
        uint256 keyAt = p + 7;
        assembly ("memory-safe") {
            let m := mload(0x40)
            mstore8(m, 0)
            mstore8(add(m, 1), kind)
            let n := mul(words, 0x20)
            mcopy(add(m, 2), add(add(proofs, 0x20), keyAt), n)
            h := keccak256(m, add(n, 2))
        }
        next = keyAt + words * 32 + depth * 32 + vdescLen;
    }

    /// Frame 1. The tree and spec hashes, root and path are bound by the digest; the expiry comes from frame 0. Owners
    /// sign in protocol-validated SECP256K1 entries with an explicit `msg`, since the deployed sidecar refuses calls to
    /// the ecrecover precompile.
    function verifyFrame(bytes32 treeHash, bytes32 specHash, bytes32 root, uint8 path, uint256 policy, address[] calldata owners_, bytes calldata extra) external {
        if (msg.sender != ENTRY_POINT) revert NotEntryPoint();
        Layout memory l = _layout();
        // Frame 2 reads the policy from this frame's data, so it must be the one in storage. Costs this frame nothing extra.
        uint256 stored;
        assembly ("memory-safe") {
            stored := sload(threshold.slot)
        }
        if (policy != stored) revert BadLayout(9);
        bytes32 listHash;
        assembly ("memory-safe") {
            let m := mload(0x40)
            calldatacopy(m, owners_.offset, mul(owners_.length, 0x20))
            listHash := keccak256(m, mul(owners_.length, 0x20))
        }
        if (uint104(stored >> 152) != uint104(bytes13(listHash))) revert BadLayout(10);
        uint256 scope;
        if (path == PATH_STATELESS) {
            _verifyStateless(l, treeHash, specHash, root, stored, owners_, extra);
            scope = SCOPE_BOTH;
        } else {
            _layoutLock(l, path);
            bytes32 digest = OwnerDigest.compute(address(this), treeHash, specHash, uint64(l.expiryWord >> 192), root, path, l.txCommit);
            if (consumed[digest]) revert Replayed(digest);
            uint256 k = uint8(stored);
            // Zero only in a 7702 delegator's empty storage: such a sender must not approve without signatures.
            if (k == 0 || l.sigCount != k) revert BadSignatureEntry();
            _checkOwners(l, uint256(digest), k, owners_);
            scope = SCOPE_EXECUTION;
        }
        _approve(scope);
    }

    /// I3: [expiry, VERIFY self, VERIFY canonical renderer, SENDER self.executeVerified]. No value, no flags beyond the scopes.
    /// On the deployed node a frame starved of gas has status 0 and the transaction is still mined, which would strip the
    /// expiry. So its limit must cover the frame's entry charge and the verifier. A verifier that reverts is refused by the
    /// mempool, and execution checks the time again. FRAMEPARAM STATUS is no use here: ethrex's revert-data pass runs frames in
    /// isolation, where reading it fails, and that masked every real revert reason.
    function _layoutLock(Layout memory l, uint256 path) private view {
        uint256 self = uint160(address(this));
        if (path != PATH_PAYMASTER) revert BadPath(path);
        if (l.frameCount != 4) revert BadLayout(0);
        if (l.current != 1) revert BadLayout(1);
        if (l.sender != self) revert BadLayout(2);
        if (l.blobCount != 0) revert BadLayout(7);
        if (l.m0 != MODE_VERIFY || l.t0 != uint160(EXPIRY_VERIFIER) || l.f0 != 0 || l.v0 != 0 || l.s0 != 0 || l.l0 != 8 || l.g0 < MIN_EXPIRY_GAS) revert BadLayout(8);
        if (l.m1 != MODE_VERIFY || l.t1 != self || l.f1 != SCOPE_EXECUTION || l.v1 != 0) revert BadLayout(3);
        if (l.m2 != MODE_VERIFY || l.t2 != uint160(RENDERER_PAYMASTER) || l.f2 != SCOPE_PAYMENT || l.v2 != 0) revert BadLayout(4);
        if (l.m3 != MODE_SENDER || l.t3 != self || l.f3 != 0 || l.v3 != 0) revert BadLayout(5);
        if (bytes4(bytes32(_framedataload(0, 3))) != this.executeVerified.selector) revert BadLayout(6);
    }

    function _chargeFee() internal override {
        if (uint8(_framedataload(100, 1)) != PATH_PAYMASTER) return;
        Layout memory l = _layout();
        IRendererPaymaster(RENDERER_PAYMASTER).chargeTicket(l.nonce, l.maxCost);
    }

    /// The last frame. The spec hash is re-read from frame 1 and the expiry from frame 0, which the signatures bind.
    /// The digest is what the first owner entry signed, which frame 1 checked.
    function executeVerified(Call[] calldata calls, bytes calldata spec) external onlySelf {
        Layout memory l = _layout();
        _execute(calls, spec, bytes32(_framedataload(36, 1)), uint64(l.expiryWord >> 192), bytes32(l.sig0Msg));
    }
}

contract VerbatimAccount is VerbatimAccountBase, DevnetFrames {
    constructor(address renderer, address permit2, address expiryVerifier, address statelessRenderer, address revocations, address[] memory owners_, uint8 threshold_, address[] memory attestors_, uint8 attestorThreshold_, address frameReader) VerbatimAccountBase(renderer, permit2, expiryVerifier, statelessRenderer, revocations, owners_, threshold_, attestors_, attestorThreshold_) DevnetFrames(frameReader) {}
}
