// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FrameIntrospection, DevnetFrames} from "../lib/FrameIntrospection.sol";
import {AssertionKit} from "../lib/AssertionKit.sol";
import {Buf, VSpec} from "../lib/VTree.sol";

interface IRendererPaymaster {
    function charge(address asset, uint256 amount) external;
    function policyHashOf(address account) external view returns (bytes32);
    function maxTtlOf(address account) external view returns (uint64);
    function chargeTicket(uint256 nonce, uint256 amount) external;
}

/// Owner-set, EIP-712, assertion and execution logic shared by the frame account (Leg A) and the 4337 account (Leg B).
/// Holds no DELEGATECALL, no SELFDESTRUCT and no upgrade path (D10); see the bytecode scan in test/Invariants.t.sol.
abstract contract VerbatimCore {
    using Buf for bytes;

    struct Fee {
        address asset;
        uint256 amount;
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    uint256 public constant MAX_LEDGER = 64;
    uint256 public constant MAX_WATCH = 32;
    uint256 public constant ASSERT_RESERVE = 200_000;
    uint256 internal constant OUTER_RESERVE = 30_000;
    uint256 internal constant SECP256K1N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant TX_TYPEHASH = keccak256("VerbatimTx(bytes32 txCommit,bytes32 treeHash,bytes32 specHash,uint64 validUntil)");
    bytes32 internal constant NAME_HASH = keccak256("Verbatim");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    uint8 internal constant PHASE_IDLE = 0;
    uint8 internal constant PHASE_LOCKED = 1;
    uint8 internal constant PHASE_PROTECTED = 2;

    address public immutable RENDERER_PAYMASTER;

    address[] internal _owners;
    mapping(address => bool) public isOwner;
    uint8 public threshold;
    uint8 internal _phase;

    AssertionKit.LedgerEntry[] internal _ledger;
    mapping(bytes32 => bool) internal _inLedger;
    address[] internal _watchlist;

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
    error LedgerEntryLive();
    error NameChanged(address target);

    event VerbatimResult(bool indexed ok, bytes err);

    constructor(address renderer, address[] memory owners_, uint8 threshold_) {
        RENDERER_PAYMASTER = renderer;
        if (threshold_ == 0 || threshold_ > owners_.length) revert BadThreshold();
        for (uint256 i = 0; i < owners_.length; i++) {
            address o = owners_[i];
            if (o == address(0) || isOwner[o]) revert BadOwner();
            isOwner[o] = true;
            _owners.push(o);
        }
        threshold = threshold_;
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

    function digestOf(bytes32 txCommit, bytes32 treeHash, bytes32 specHash, uint64 validUntil) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
        bytes32 structHash = keccak256(abi.encode(TX_TYPEHASH, txCommit, treeHash, specHash, validUntil));
        return keccak256(abi.encodePacked(hex"1901", domain, structHash));
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

    /// Fee first; its failure reverts the frame and nothing protected runs. An assertion failure reverts the inner
    /// call only, so the fee stays paid (I4, I5).
    function _execute(Fee calldata fee, Call[] calldata calls, bytes calldata spec, bytes32 specHash, uint64 validUntil) internal {
        if (_phase != PHASE_IDLE) revert Reentrant();
        _phase = PHASE_LOCKED;
        _chargeFee(fee);
        uint256 left = gasleft();
        if (left <= OUTER_RESERVE) revert NoGasReserve();
        (bool ok, bytes memory err) = address(this).call{gas: left - OUTER_RESERVE}(abi.encodeCall(this.protectedBatch, (calls, spec, specHash, validUntil)));
        emit VerbatimResult(ok, err);
        _phase = PHASE_IDLE;
    }

    function _chargeFee(Fee calldata fee) internal virtual;

    /// The inner self-call: expiry, live re-checks, snapshot, calls, assertions.
    function protectedBatch(Call[] calldata calls, bytes calldata spec, bytes32 specHash, uint64 validUntil) external onlySelf {
        if (_phase != PHASE_LOCKED) revert NotLocked();
        _phase = PHASE_PROTECTED;
        if (keccak256(spec) != specHash) revert SpecMismatch();

        if (block.timestamp > validUntil) revert Expired(block.timestamp, validUntil);
        uint256 maxTtl = IRendererPaymaster(RENDERER_PAYMASTER).maxTtlOf(address(this));
        if (validUntil - block.timestamp > maxTtl) revert TtlTooLong(validUntil - block.timestamp, maxTtl);

        bytes memory s = spec;
        _liveChecks(s);
        _recordLedger(s);
        Snapshot memory pre = _snapshot(s);

        for (uint256 i = 0; i < calls.length; i++) {
            uint256 left = gasleft();
            if (left <= ASSERT_RESERVE) revert NoGasReserve();
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value, gas: left - ASSERT_RESERVE}(calls[i].data);
            if (!ok) revert CallFailed(i, ret);
        }

        _liveChecks(s);
        _assert(s, pre);
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

    function _addLedger(AssertionKit.LedgerEntry memory l) private {
        bytes32 key = keccak256(abi.encode(l.kind, l.token, l.spender, l.permit2));
        if (_inLedger[key]) return;
        if (_ledger.length >= MAX_LEDGER) revert LedgerFull();
        _inLedger[key] = true;
        _ledger.push(l);
    }

    /// Approvals the batch declares become permanent ledger entries before the snapshot.
    function _recordLedger(bytes memory s) private {
        uint256 n = AssertionKit.header(s);
        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.ALLOW_LE) {
                _addLedger(AssertionKit.LedgerEntry(AssertionKit.LEDGER_ERC20, AssertionKit.addrAt(s, p), AssertionKit.addrAt(s, p + 20), address(0)));
            } else if (op == VSpec.P2ALLOW_LE) {
                _addLedger(AssertionKit.LedgerEntry(AssertionKit.LEDGER_PERMIT2, AssertionKit.addrAt(s, p + 20), AssertionKit.addrAt(s, p + 40), AssertionKit.addrAt(s, p)));
            } else if (op == VSpec.OPERATOR_EQ) {
                _addLedger(AssertionKit.LedgerEntry(AssertionKit.LEDGER_OPERATOR, AssertionKit.addrAt(s, p), AssertionKit.addrAt(s, p + 20), address(0)));
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
        uint8 threshold;
        bytes32 selfCode;
        bytes32 policy;
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
        uint256 cap = 1 + lN + wN;
        x.tracked = new address[](cap);
        x.trackedPre = new uint256[](cap);
        x.deltaPre = new uint256[](n);
        x.p2Pre = new uint256[](n);
        x.ledgerPre = new uint256[](lN);

        _track(x, address(0));
        for (uint256 i = 0; i < lN; i++) {
            AssertionKit.LedgerEntry memory l = _ledger[i];
            x.ledgerPre[i] = AssertionKit.ledgerRead(l, address(this));
            if (l.kind != AssertionKit.LEDGER_OPERATOR) _track(x, l.token);
        }
        for (uint256 i = 0; i < wN; i++) _track(x, _watchlist[i]);

        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.DELTA_EQ || op == VSpec.DELTA_GE) {
                x.deltaPre[i] = AssertionKit.balance(AssertionKit.addrAt(s, p), AssertionKit.addrAt(s, p + 20));
            } else if (op == VSpec.P2ALLOW_LE) {
                x.p2Pre[i] = AssertionKit.p2Allowance(AssertionKit.addrAt(s, p), address(this), AssertionKit.addrAt(s, p + 20), AssertionKit.addrAt(s, p + 40));
            }
            p += AssertionKit.itemSize(op);
        }
        x.ownersHash = keccak256(abi.encodePacked(_owners));
        x.threshold = threshold;
        x.selfCode = address(this).codehash;
        x.policy = IRendererPaymaster(RENDERER_PAYMASTER).policyHashOf(address(this));
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
                uint256 v = s.rdBe(p + 61, 20);
                uint256 max = s.rdU8(p + 60) == VSpec.P2_RELATIVE ? (x.p2Pre[i] >= v ? x.p2Pre[i] - v : 0) : v;
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

    function _declaredAllowance(bytes memory s, AssertionKit.LedgerEntry memory l) private pure returns (bool) {
        uint256 n = AssertionKit.header(s);
        uint256 p = 6;
        for (uint256 i = 0; i < n; i++) {
            uint8 op = uint8(s.rdU8(p++));
            if (op == VSpec.ALLOW_LE && l.kind == AssertionKit.LEDGER_ERC20 && AssertionKit.addrAt(s, p) == l.token && AssertionKit.addrAt(s, p + 20) == l.spender) return true;
            if (op == VSpec.P2ALLOW_LE && l.kind == AssertionKit.LEDGER_PERMIT2 && AssertionKit.addrAt(s, p + 20) == l.token && AssertionKit.addrAt(s, p + 40) == l.spender) return true;
            if (op == VSpec.OPERATOR_EQ && l.kind == AssertionKit.LEDGER_OPERATOR && AssertionKit.addrAt(s, p) == l.token && AssertionKit.addrAt(s, p + 20) == l.spender) return true;
            p += AssertionKit.itemSize(op);
        }
        return false;
    }

    function _assertAllowances(bytes memory s, Snapshot memory x, uint256 index) private view {
        for (uint256 i = 0; i < x.ledgerPre.length; i++) {
            AssertionKit.LedgerEntry memory l = _ledger[i];
            if (_declaredAllowance(s, l)) continue;
            uint256 post = AssertionKit.ledgerRead(l, address(this));
            if (post > x.ledgerPre[i]) _fail(index, x.ledgerPre[i], post);
        }
    }

    function _assertAccount(Snapshot memory x, uint256 index) private view {
        if (keccak256(abi.encodePacked(_owners)) != x.ownersHash || threshold != x.threshold) _fail(index, 0, 1);
        if (address(this).codehash != x.selfCode) _fail(index, 0, 2);
        if (IRendererPaymaster(RENDERER_PAYMASTER).policyHashOf(address(this)) != x.policy) _fail(index, 0, 3);
    }

    // --------------------------------------------------------------- self-administration --------

    function addOwner(address o) external onlyBatch {
        if (o == address(0) || isOwner[o]) revert BadOwner();
        isOwner[o] = true;
        _owners.push(o);
    }

    function removeOwner(address o) external onlyBatch {
        if (!isOwner[o] || _owners.length - 1 < threshold) revert BadOwner();
        isOwner[o] = false;
        for (uint256 i = 0; i < _owners.length; i++) {
            if (_owners[i] == o) {
                _owners[i] = _owners[_owners.length - 1];
                _owners.pop();
                return;
            }
        }
    }

    function setThreshold(uint8 t) external onlyBatch {
        if (t == 0 || t > _owners.length) revert BadThreshold();
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

    /// Drops a ledger entry whose allowance is already zero.
    function pruneLedger(uint256 index) external onlyBatch {
        AssertionKit.LedgerEntry memory l = _ledger[index];
        if (AssertionKit.ledgerRead(l, address(this)) != 0) revert LedgerEntryLive();
        _inLedger[keccak256(abi.encode(l.kind, l.token, l.spender, l.permit2))] = false;
        _ledger[index] = _ledger[_ledger.length - 1];
        _ledger.pop();
    }

    // ---------------------------------------------------------------------------- views ---------

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function watchlist() external view returns (address[] memory) {
        return _watchlist;
    }

    function ledgerHash() external view returns (bytes32) {
        return keccak256(abi.encode(_ledger));
    }

    function ledger() external view returns (AssertionKit.LedgerEntry[] memory) {
        return _ledger;
    }

    /// ERC-1271 is off (D9): off-chain signatures cannot be post-checked.
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xffffffff;
    }
}

/// Leg A: the EIP-8141 sender. Frame 0 locks the layout and checks signatures; frame 2 executes.
abstract contract VerbatimAccountBase is VerbatimCore, FrameIntrospection {
    address internal constant ENTRY_POINT = address(0xaa);

    error NotEntryPoint();
    error BadLayout(uint256 check);
    error BadSignatureEntry();

    constructor(address renderer, address[] memory owners_, uint8 threshold_) VerbatimCore(renderer, owners_, threshold_) {}

    /// Frame 0. Data: treeHash, specHash, validUntil. Owners sign in protocol-validated SECP256K1 entries with an
    /// explicit `msg`: the deployed sidecar refuses calls to the ecrecover precompile, so the protocol recovers them.
    /// An explicit `msg` cannot contain `sig_hash`, so `_txCommit` covers what it would have: see docs/DECISIONS.md.
    function verifyFrame(bytes32 treeHash, bytes32 specHash, uint64 validUntil) external {
        if (msg.sender != ENTRY_POINT) revert NotEntryPoint();
        Layout memory l = _layoutLock();
        uint256 digest = uint256(digestOf(_txCommit(l), treeHash, specHash, validUntil));
        uint256 k = threshold;
        // Zero only in a 7702 delegator's empty storage: such a sender must not approve without signatures.
        if (k == 0 || l.sigCount != k) revert BadSignatureEntry();
        address last;
        for (uint256 i = 0; i < k; i++) {
            (uint256 scheme, uint256 signed, uint256 who) = _sigEntry(i);
            if (scheme != SCHEME_SECP256K1 || signed != digest) revert BadSignatureEntry();
            address signer = address(uint160(who));
            if (signer <= last || !isOwner[signer]) revert SignersNotSortedOrUnknown();
            last = signer;
        }
        _approve(SCOPE_EXECUTION);
    }

    /// Everything `sig_hash` covers beyond the frame 0 data the digest already holds. Keyed nonces and blobs are refused
    /// rather than committed to.
    function _txCommit(Layout memory l) private view returns (bytes32) {
        TxFields memory f = _txFields();
        if (f.blobCount != 0 || f.nonceKeyCount != 1 || f.nonceKey0 != 0) revert BadLayout(7);
        bytes32 h1 = keccak256(_framedatacopy(0, l.l1, 1));
        bytes32 h2 = keccak256(_framedatacopy(0, l.l2, 2));
        return keccak256(abi.encode(f.nonce, f.maxPriorityFee, f.maxFee, l.g0, l.s0, l.g1, l.s1, l.g2, l.s2, h1, h2));
    }

    /// I3: exactly [VERIFY self, VERIFY canonical renderer, SENDER self.executeVerified], no flags beyond the scopes.
    /// A transaction without exactly 3 frames fails inside `_layout`.
    function _layoutLock() private view returns (Layout memory l) {
        l = _layout();
        uint256 self = uint160(address(this));
        if (l.frameCount != 3) revert BadLayout(0);
        if (l.current != 0) revert BadLayout(1);
        if (l.sender != self) revert BadLayout(2);
        if (l.m0 != MODE_VERIFY || l.t0 != self || l.f0 != SCOPE_EXECUTION) revert BadLayout(3);
        if (l.m1 != MODE_VERIFY || l.t1 != uint160(RENDERER_PAYMASTER) || l.f1 != SCOPE_PAYMENT) revert BadLayout(4);
        if (l.m2 != MODE_SENDER || l.t2 != self || l.f2 != 0 || l.v2 != 0) revert BadLayout(5);
        if (bytes4(bytes32(_framedataload(0, 2))) != this.executeVerified.selector) revert BadLayout(6);
    }

    function _chargeFee(Fee calldata fee) internal override {
        (uint256 nonce, ) = _nonceAndMaxCost();
        IRendererPaymaster(RENDERER_PAYMASTER).chargeTicket(nonce, fee.amount);
    }

    /// Frame 2. `specHash` and `validUntil` are re-read from frame 0, which the signatures bind.
    function executeVerified(Fee calldata fee, Call[] calldata calls, bytes calldata spec) external onlySelf {
        _execute(fee, calls, spec, bytes32(_framedataload(36, 0)), uint64(_framedataload(68, 0)));
    }
}

contract VerbatimAccount is VerbatimAccountBase, DevnetFrames {
    constructor(address renderer, address[] memory owners_, uint8 threshold_, address frameReader) VerbatimAccountBase(renderer, owners_, threshold_) DevnetFrames(frameReader) {}
}
