// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DisplayVM} from "../lib/DisplayVM.sol";
import {VDesc} from "../lib/VDesc.sol";
import {SSTORE2} from "../lib/SSTORE2.sol";

interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// The trust store's storage (§7.6). Shared by the render path and the admin module, which runs by DELEGATECALL
/// from the paymaster, so both must see these slots first and in this order.
abstract contract TrustStoreLayout {
    uint8 internal constant STATUS_ATTESTED_ENS = 1;
    uint8 internal constant STATUS_ATTESTED_NO_ENS = 2;

    struct DescSlot {
        address blob;
        uint64 epoch;
        uint8 status;
        bool revoked;
    }

    struct TokenSlot {
        bytes11 symbol;
        uint8 symLen;
        uint8 decimals;
        uint8 flags;
        bool known;
    }

    struct ProxyTemplate {
        address upgrader;
        bytes32 logicCodehash;
        address impl;
        bytes4 getter;
    }

    struct DescUpdate {
        bytes32 codehash;
        bytes4 selector;
        bytes vdesc;
        bytes32 publisher;
    }

    struct TokenUpdate {
        address token;
        bytes11 symbol;
        uint8 symLen;
        uint8 decimals;
        uint8 flags;
    }

    struct ProxyUpdate {
        bytes32 codehash;
        ProxyTemplate template;
    }

    struct RouterUpdate {
        bytes32 codehash;
        bool legacy;
    }

    struct NameUpdate {
        address addr;
        bytes32 name;
        address resolver;
    }

    struct Revocation {
        bytes32 codehash;
        bytes4 selector;
    }

    struct TrustUpdate {
        uint64 epoch;
        DescUpdate[] descriptors;
        Revocation[] revocations;
        TokenUpdate[] tokens;
        ProxyUpdate[] proxies;
        RouterUpdate[] routers;
        bytes32[] hooks;
        address[] spenders;
        NameUpdate[] names;
    }

    uint64 internal _trustEpoch;
    mapping(bytes32 => mapping(bytes4 => DescSlot)) internal _descOf;
    mapping(bytes32 => mapping(bytes4 => bytes32)) internal _publisherOf;
    mapping(bytes32 => bool) internal _everRevoked;
    mapping(address => TokenSlot) internal _tokens;
    mapping(bytes32 => uint8) internal _codeKind_;
    mapping(bytes32 => ProxyTemplate) internal _proxyTemplates;
    mapping(bytes32 => bool) internal _attestedHooks;
    mapping(address => bool) internal _attestedSpenders;
    mapping(address => bytes32) internal _names;
    mapping(address => address) internal _nameResolvers;

    address[] internal _attestors;
    mapping(address => bool) internal _isAttestor;
    uint8 internal _attestorThreshold;

    // Deposits, fees and policies (§7.2). Declared here so the render path and the admin module share one layout.
    struct Policy {
        uint64 ttl;
        uint64 allowMask;
        bool set;
    }

    struct Deposit {
        uint128 amount;
        uint128 pendingWithdraw;
    }

    /// A fee prepaid for one nonce of one account, so no two pending transactions can draw on the same money.
    struct FeeTicket {
        uint128 amount;
        uint64 reclaimAt;
    }

    mapping(address => Policy) internal _policyOf;
    mapping(address => mapping(address => Deposit)) internal _deposits;
    mapping(address => mapping(address => uint256)) internal _withdrawReadyAt;
    mapping(address => mapping(uint256 => FeeTicket)) internal _feeTickets;
    mapping(address => uint256) internal _feesAccrued;

    uint256 internal constant WITHDRAW_DELAY_ = 1 hours;

    event Deposited(address indexed account, address indexed asset, uint256 amount);
    event WithdrawRequested(address indexed account, address indexed asset, uint256 amount, uint256 readyAt);
    event PolicySet(address indexed account, bytes32 indexed policyHash);
    event TicketsFunded(address indexed account, uint256 indexed firstNonce, uint256 count, uint256 each);

    error WithdrawNotReady(uint256 readyAt);
    error TransferFailed();

    error EpochNotIncreasing();
    error NotEnoughAttestors();
    error AttestorsNotSorted();
    error DescriptorRevoked();
    error BadSymbol();
    error NoNamesOnThisLeg();

    event TrustRefreshed(uint64 indexed epoch, bytes32 indexed updateHash);
}

/// Attested descriptors, tokens, hooks and names, read during render. Lives in the paymaster's own storage, so
/// validation reads only the entity's own state. One slot per lookup, read at most once per node.
abstract contract TrustStore is DisplayVM, TrustStoreLayout {
    function _setAttestors(address[] memory list, uint8 threshold) internal {
        _attestors = list;
        _attestorThreshold = threshold;
        for (uint256 i = 0; i < list.length; i++) _isAttestor[list[i]] = true;
    }

    // ------------------------------------------------------------- DisplayVM lookups -------------

    function _descriptor(bytes32 codehash, bytes4 selector) internal view virtual override returns (Desc memory d) {
        DescSlot memory s = _descOf[codehash][selector];
        if (s.blob == address(0) || s.revoked) return d;
        d.blob = SSTORE2.read(s.blob);
        d.publisher = _publisherOf[codehash][selector];
        d.epoch = s.epoch;
        d.status = s.status;
    }

    function _tokenInfo(address token) internal view virtual override returns (bytes32 symbol, uint8 decimals, uint8 flags, bool known) {
        // One raw SLOAD; reading the struct field by field would pay for the slot once per field.
        uint256 w;
        assembly ("memory-safe") {
            mstore(0, token)
            mstore(0x20, _tokens.slot)
            w := sload(keccak256(0, 0x40))
        }
        uint256 symLen = (w >> 88) & 0xff;
        symbol = bytes32(((w & ((1 << 88) - 1)) << 168) | symLen);
        decimals = uint8(w >> 96);
        flags = uint8(w >> 104);
        known = (w >> 112) & 1 == 1;
    }

    function _nameOf(address) internal view virtual override returns (bytes32) {
        return bytes32(0);
    }

    function _nameResolver(address a) internal view virtual override returns (address) {
        return _nameResolvers[a];
    }

    function _spenderIsAttested(address spender) internal view virtual override returns (bool) {
        return _attestedSpenders[spender];
    }

    function _hookIsAttested(bytes32 codehash) internal view virtual override returns (bool) {
        return _attestedHooks[codehash];
    }

    function _codeKind(bytes32 codehash) internal view virtual override returns (uint8) {
        return _codeKind_[codehash];
    }

    function _proxyTemplate(bytes32 codehash) internal view virtual override returns (address, bytes32, address, bytes4) {
        ProxyTemplate memory p = _proxyTemplates[codehash];
        return (p.upgrader, p.logicCodehash, p.impl, p.getter);
    }
}

/// `refreshTrust` and friends: everything outside validation. Split out to keep the paymaster under EIP-170.
contract TrustAdmin is TrustStoreLayout {
    function trustUpdateHash(TrustUpdate calldata u) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), u));
    }

    /// Outside validation, so it may read anything. Monotonic epoch, k-of-n attestors, no un-revoking (I10).
    function refreshTrust(TrustUpdate calldata u, bytes[] calldata sigs) external {
        if (u.epoch <= _trustEpoch) revert EpochNotIncreasing();
        bytes32 h = trustUpdateHash(u);
        if (sigs.length < _attestorThreshold) revert NotEnoughAttestors();
        address last;
        for (uint256 i = 0; i < sigs.length; i++) {
            address s = _recover(h, sigs[i]);
            if (s <= last || !_isAttestor[s]) revert AttestorsNotSorted();
            last = s;
        }
        _trustEpoch = u.epoch;

        for (uint256 i = 0; i < u.revocations.length; i++) {
            Revocation calldata r = u.revocations[i];
            DescSlot storage slot = _descOf[r.codehash][r.selector];
            if (slot.blob != address(0)) _everRevoked[keccak256(SSTORE2.read(slot.blob))] = true;
            slot.revoked = true;
        }
        for (uint256 i = 0; i < u.descriptors.length; i++) {
            DescUpdate calldata d = u.descriptors[i];
            bytes32 descHash = keccak256(d.vdesc);
            if (_everRevoked[descHash]) revert DescriptorRevoked();
            VDesc.validate(d.vdesc);
            uint8 status = _checkPublisher(d.publisher, descHash);
            _descOf[d.codehash][d.selector] = DescSlot(SSTORE2.write(d.vdesc), u.epoch, status, false);
            _publisherOf[d.codehash][d.selector] = d.publisher;
        }
        for (uint256 i = 0; i < u.tokens.length; i++) {
            TokenUpdate calldata t = u.tokens[i];
            if (t.symLen > 11) revert BadSymbol();
            _tokens[t.token] = TokenSlot(t.symbol, t.symLen, t.decimals, t.flags, true);
        }
        for (uint256 i = 0; i < u.proxies.length; i++) {
            _codeKind_[u.proxies[i].codehash] = 2;
            _proxyTemplates[u.proxies[i].codehash] = u.proxies[i].template;
        }
        for (uint256 i = 0; i < u.routers.length; i++) _codeKind_[u.routers[i].codehash] = u.routers[i].legacy ? 3 : 1;
        for (uint256 i = 0; i < u.hooks.length; i++) _attestedHooks[u.hooks[i]] = true;
        for (uint256 i = 0; i < u.spenders.length; i++) _attestedSpenders[u.spenders[i]] = true;
        for (uint256 i = 0; i < u.names.length; i++) {
            NameUpdate calldata n = u.names[i];
            _checkName(n.addr, n.name, n.resolver);
            _names[n.addr] = n.name;
            _nameResolvers[n.addr] = n.resolver;
        }
        emit TrustRefreshed(u.epoch, h);
    }

    // ------------------------------------------------------------------------------ getters -----

    function trustEpoch() external view returns (uint64) {
        return _trustEpoch;
    }

    function descOf(bytes32 c, bytes4 s) external view returns (address blob, uint64 epoch, uint8 status, bool revoked) {
        DescSlot memory d = _descOf[c][s];
        return (d.blob, d.epoch, d.status, d.revoked);
    }

    function publisherOf(bytes32 c, bytes4 s) external view returns (bytes32) {
        return _publisherOf[c][s];
    }

    function tokens(address t) external view returns (bytes11 symbol, uint8 symLen, uint8 decimals, uint8 flags, bool known) {
        TokenSlot memory x = _tokens[t];
        return (x.symbol, x.symLen, x.decimals, x.flags, x.known);
    }

    function codeKind(bytes32 c) external view returns (uint8) {
        return _codeKind_[c];
    }

    function proxyTemplates(bytes32 c) external view returns (address upgrader, bytes32 logicCodehash, address impl, bytes4 getter) {
        ProxyTemplate memory p = _proxyTemplates[c];
        return (p.upgrader, p.logicCodehash, p.impl, p.getter);
    }

    function attestedHooks(bytes32 c) external view returns (bool) {
        return _attestedHooks[c];
    }

    function names(address a) external view returns (bytes32) {
        return _names[a];
    }

    function nameResolver(address a) external view returns (address) {
        return _nameResolvers[a];
    }

    function everRevoked(bytes32 h) external view returns (bool) {
        return _everRevoked[h];
    }

    function policyOf(address a) external view returns (uint64 ttl, uint64 allowMask, bool set) {
        Policy memory p = _policyOf[a];
        return (p.ttl, p.allowMask, p.set);
    }

    function deposits(address a, address asset) external view returns (uint128 amount, uint128 pendingWithdraw) {
        Deposit memory d = _deposits[a][asset];
        return (d.amount, d.pendingWithdraw);
    }

    function feeTicket(address account, uint256 nonce) external view returns (uint128 amount, uint64 reclaimAt) {
        FeeTicket memory f = _feeTickets[account][nonce];
        return (f.amount, f.reclaimAt);
    }

    function attestedSpenders(address a) external view returns (bool) {
        return _attestedSpenders[a];
    }

    function feesAccrued(address asset) external view returns (uint256) {
        return _feesAccrued[asset];
    }

    function WITHDRAW_DELAY() external pure returns (uint256) {
        return WITHDRAW_DELAY_;
    }

    // ----------------------------------------------------------------------------- deposits -----

    /// Anyone may fund an account's deposit; only the account can spend it.
    function deposit(address account, address asset, uint256 amount) external payable {
        if (asset == address(0)) {
            amount = msg.value;
        } else if (!IERC20Min(asset).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        _deposits[account][asset].amount += uint128(amount);
        emit Deposited(account, asset, amount);
    }

    /// Lowers what validation counts as available at once, but the money stays until the delay passes, so a pending
    /// transaction's fee cannot be raced away (WITHDRAW_DELAY > the TTL).
    function requestWithdraw(address asset, uint256 amount) external {
        _deposits[msg.sender][asset].pendingWithdraw = uint128(amount);
        uint256 readyAt = block.timestamp + WITHDRAW_DELAY_;
        _withdrawReadyAt[msg.sender][asset] = readyAt;
        emit WithdrawRequested(msg.sender, asset, amount, readyAt);
    }

    function withdraw(address asset) external {
        uint256 readyAt = _withdrawReadyAt[msg.sender][asset];
        if (readyAt == 0 || block.timestamp < readyAt) revert WithdrawNotReady(readyAt);
        Deposit storage d = _deposits[msg.sender][asset];
        uint256 amount = d.pendingWithdraw < d.amount ? d.pendingWithdraw : d.amount;
        d.amount -= uint128(amount);
        d.pendingWithdraw = 0;
        _withdrawReadyAt[msg.sender][asset] = 0;
        if (asset == address(0)) {
            (bool ok, ) = msg.sender.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else if (!IERC20Min(asset).transfer(msg.sender, amount)) {
            revert TransferFailed();
        }
    }

    function setPolicy(uint64 maxTtl, uint64 allowMask) external {
        _policyOf[msg.sender] = Policy(maxTtl, allowMask, true);
        emit PolicySet(msg.sender, keccak256(abi.encode(maxTtl, allowMask)));
    }

    /// Anyone may prepay an account's next fees. The value is split evenly over `count` nonces.
    function fundTickets(address account, uint256 firstNonce, uint256 count) external payable {
        uint256 each = msg.value / count;
        for (uint256 i = 0; i < count; i++) _feeTickets[account][firstNonce + i].amount += uint128(each);
        emit TicketsFunded(account, firstNonce, count, each);
    }

    /// A ticket stops validating as soon as this is called, and pays out only after a delay longer than any signature
    /// can live, so its reclaim cannot race a transaction that is already pending.
    function requestReclaim(uint256 nonce) external {
        _feeTickets[msg.sender][nonce].reclaimAt = uint64(block.timestamp + WITHDRAW_DELAY_);
    }

    function reclaim(uint256 nonce) external {
        FeeTicket memory f = _feeTickets[msg.sender][nonce];
        if (f.reclaimAt == 0 || block.timestamp < f.reclaimAt) revert WithdrawNotReady(f.reclaimAt);
        delete _feeTickets[msg.sender][nonce];
        (bool ok, ) = msg.sender.call{value: f.amount}("");
        if (!ok) revert TransferFailed();
    }

    /// Leg A has no ENS and caches no names.
    function _checkName(address, bytes32, address) internal view virtual {
        revert NoNamesOnThisLeg();
    }

    /// Leg A has no ENS: attestors only, marked as such.
    function _checkPublisher(bytes32, bytes32) internal view virtual returns (uint8) {
        return STATUS_ATTESTED_NO_ENS;
    }

    function _recover(bytes32 h, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return address(0);
        return ecrecover(h, v, r, s);
    }
}
