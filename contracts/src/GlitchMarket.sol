// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  GlitchMarket
/// @notice A pay-before-inspect marketplace for speedrun glitches.
///
///         Sellers commit to encrypted content (video/instructions for a skip or sequence break)
///         by publishing only its hash and an IPFS pointer. Buyers pay a price that decays with
///         elapsed time and with each copy sold, because the value of a secret erodes as it ages
///         and spreads. Payment sits in escrow behind a short challenge window; if nobody disputes,
///         the seller claims it. A dispute freezes the escrow rather than refunding it, and is
///         judged only once the listing's price has decayed far enough that showing the content to
///         a jury costs the ecosystem little. The juror pool widens as that value drains: first
///         prior buyers of the same listing, who already know the secret and can actually test the
///         trick; then, once the content is all but worthless, anyone at all. If no jury ever
///         converges, the escrow defaults to the seller rather than freezing forever.
///
/// @dev    Timing constants are set for a live video demo, not for production. See NOTES.md.
contract GlitchMarket {
    // ---------------------------------------------------------------------
    // Tunables
    // ---------------------------------------------------------------------

    uint256 public constant BPS = 10_000;

    /// @notice Seconds represented by one entry of the decay lookup table.
    uint256 public constant DECAY_STEP = 30;

    /// @notice Number of entries in the packed decay table.
    uint256 public constant DECAY_TABLE_LEN = 80;

    /// @notice How long a buyer has to dispute before the seller may claim escrow.
    uint256 public constant CHALLENGE_WINDOW = 3 minutes;

    /// @notice Tier 1. Prior buyers of this listing may judge once decay passes here.
    uint256 public constant JURY_THRESHOLD_BPS = 6_000;

    /// @notice Tier 2. Anyone may judge once decay passes here.
    ///
    /// @dev Restricting jurors to prior buyers protects the secret, but it has two costs. It can
    ///      leave a listing with a single buyer permanently unjudgeable — the disputer may not rule
    ///      on their own claim, so the escrow would freeze forever. And prior buyers are not
    ///      disinterested: a lost dispute delists the listing, which preserves the edge of everyone
    ///      who already bought, biasing them toward slashing the seller. Opening the pool once the
    ///      content is all but worthless fixes both, and by then disclosure costs near nothing.
    uint256 public constant OPEN_JURY_THRESHOLD_BPS = 1_000;

    /// @notice Tier 3. With the value gone and still no verdict, anyone may trigger the default.
    uint256 public constant TIMEOUT_THRESHOLD_BPS = 200;

    /// @notice Independent jurors that must converge before a dispute resolves.
    uint256 public constant MIN_JURY_VOTES = 2;

    /// @notice `alpha` from the PRD: each copy sold adds 0.5 to the denominator of the price.
    uint256 public constant ALPHA_BPS = 5_000;

    /// @notice Dispute bond, as a fraction of the price the disputing buyer paid.
    uint256 public constant DISPUTE_BOND_BPS = 5_000;

    /// @dev Packed `e^(-0.0851 * i)` scaled by 1e4, two bytes per entry, i in [0, 80).
    ///      Solidity has no constant arrays, so the table is a constant `bytes` blob that
    ///      `decayFactor` indexes into. Precomputed off-chain: no on-chain fixed-point math.
    bytes private constant DECAY_TABLE =
        hex"271023e020f31e431bcb19861771158813c6122910ae0f520e120cec0bde0ae6"
        hex"0a030931087107c1071f068a06020584051104a7044603ed039b0350030a02cb"
        hex"0291025b022a01fd01d301ad018a016a014c01310118010200ec00d900c700b7"
        hex"00a8009b008e00820078006e0065005d0055004e00480042003d00380033002f"
        hex"002b002800240021001f001c001a001800160014001200110010000e000d000c";

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum PurchaseState {
        None,
        Escrowed, // paid, challenge window may still be open
        Claimed, // seller took the money, no dispute
        Disputed, // frozen, awaiting decay threshold + jury
        RefundedToBuyer, // jury sided with the buyer
        AwardedToSeller // jury sided with the seller
    }

    struct Listing {
        address seller;
        string game;
        string category;
        string teaser;
        bytes32 contentHash; // commitment to the encrypted file, fixed at listing time
        string storagePointer; // IPFS CID of the encrypted file
        string encryptedKey; // see NOTES.md: gated, but not cryptographically private
        uint256 initialPrice;
        uint256 minPrice;
        uint256 createdAt;
        uint256 copiesSold;
        uint256 stake;
        bool active;
    }

    struct Purchase {
        uint256 listingId;
        address buyer;
        uint256 pricePaid;
        uint256 purchasedAt;
        PurchaseState state;
        uint256 disputeBond;
        bytes32 evidenceHash;
        bytes32 nonce; // must appear in buyer evidence, so old footage cannot be reused
        uint256 votesForBuyer;
        uint256 votesForSeller;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    Listing[] private _listings;
    Purchase[] private _purchases;

    /// @notice Reputation may go negative; a lost dispute costs far more than a clean sale earns.
    mapping(address => int256) public reputation;

    mapping(uint256 => mapping(address => bool)) public hasPurchased;
    mapping(uint256 => uint256[]) private _purchasesOfListing;
    mapping(address => uint256[]) private _purchasesOfBuyer;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        string game,
        string category,
        bytes32 contentHash,
        uint256 initialPrice,
        uint256 stake
    );
    event Purchased(
        uint256 indexed purchaseId,
        uint256 indexed listingId,
        address indexed buyer,
        uint256 pricePaid,
        uint256 copiesSoldAfter,
        bytes32 nonce
    );
    event Claimed(uint256 indexed purchaseId, address indexed seller, uint256 amount);
    event Disputed(uint256 indexed purchaseId, address indexed buyer, uint256 bond, bytes32 evidenceHash);
    event Voted(uint256 indexed purchaseId, address indexed juror, bool forBuyer);
    event Resolved(uint256 indexed purchaseId, bool buyerWon, uint256 payout, uint256 slashedStake);
    event TimedOut(uint256 indexed purchaseId, uint256 paidToSeller, uint256 bondReturned);
    event ListingClosed(uint256 indexed listingId);
    event StakeWithdrawn(uint256 indexed listingId, address indexed seller, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error BadPrice();
    error NotSeller();
    error NotBuyer();
    error InactiveListing();
    error InsufficientStake(uint256 required);
    error InsufficientPayment(uint256 required);
    error AlreadyPurchased();
    error WrongState();
    error WindowOpen();
    error WindowClosed();
    error WrongBond(uint256 required);
    error NotYetJudgeable();
    error NotAJuror();
    error AlreadyVoted();
    error OpenObligations();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ---------------------------------------------------------------------
    // Pricing
    // ---------------------------------------------------------------------

    /// @notice Time-decay multiplier in basis points, read from the precomputed table.
    /// @dev    Clamps past the end of the table, so an ancient listing sits at the floor.
    function decayFactor(uint256 stepIndex) public pure returns (uint256) {
        if (stepIndex >= DECAY_TABLE_LEN) stepIndex = DECAY_TABLE_LEN - 1;
        uint256 o = stepIndex * 2;
        return (uint256(uint8(DECAY_TABLE[o])) << 8) | uint256(uint8(DECAY_TABLE[o + 1]));
    }

    /// @notice Live price: `initial * decay(t) / (1 + alpha*n)`, floored at the listing's minimum.
    function currentPrice(uint256 listingId) public view returns (uint256) {
        Listing storage l = _listings[listingId];
        uint256 factor = decayFactor((block.timestamp - l.createdAt) / DECAY_STEP);
        uint256 p = (l.initialPrice * factor) / BPS;
        p = (p * BPS) / (BPS + (ALPHA_BPS * l.copiesSold));
        return p < l.minPrice ? l.minPrice : p;
    }

    /// @notice Stake a seller must post: 5x the listing price when unproven, easing to 2x.
    function requiredStake(address seller, uint256 initialPrice) public view returns (uint256) {
        int256 rep = reputation[seller];
        uint256 mult;
        if (rep <= 0) mult = 500;
        else if (rep < 5) mult = 400;
        else if (rep < 10) mult = 300;
        else mult = 200;
        return (initialPrice * mult) / 100;
    }

    function disputeBondFor(uint256 pricePaid) public pure returns (uint256) {
        return (pricePaid * DISPUTE_BOND_BPS) / BPS;
    }

    // ---------------------------------------------------------------------
    // Selling
    // ---------------------------------------------------------------------

    function list(
        string calldata game,
        string calldata category,
        string calldata teaser,
        bytes32 contentHash,
        string calldata storagePointer,
        string calldata encryptedKey,
        uint256 initialPrice,
        uint256 minPrice
    ) external payable returns (uint256 id) {
        if (initialPrice == 0 || minPrice > initialPrice) revert BadPrice();
        uint256 need = requiredStake(msg.sender, initialPrice);
        if (msg.value < need) revert InsufficientStake(need);

        _listings.push(
            Listing({
                seller: msg.sender,
                game: game,
                category: category,
                teaser: teaser,
                contentHash: contentHash,
                storagePointer: storagePointer,
                encryptedKey: encryptedKey,
                initialPrice: initialPrice,
                minPrice: minPrice,
                createdAt: block.timestamp,
                copiesSold: 0,
                stake: msg.value,
                active: true
            })
        );
        id = _listings.length - 1;
        emit Listed(id, msg.sender, game, category, contentHash, initialPrice, msg.value);
    }

    function closeListing(uint256 listingId) external {
        Listing storage l = _listings[listingId];
        if (msg.sender != l.seller) revert NotSeller();
        if (!l.active) revert InactiveListing();
        l.active = false;
        emit ListingClosed(listingId);
    }

    /// @notice Reclaim stake once a listing is closed and every purchase against it has settled.
    function withdrawStake(uint256 listingId) external nonReentrant {
        Listing storage l = _listings[listingId];
        if (msg.sender != l.seller) revert NotSeller();
        if (l.active) revert OpenObligations();

        uint256[] storage ids = _purchasesOfListing[listingId];
        for (uint256 i = 0; i < ids.length; i++) {
            PurchaseState s = _purchases[ids[i]].state;
            if (s == PurchaseState.Escrowed || s == PurchaseState.Disputed) revert OpenObligations();
        }

        uint256 amount = l.stake;
        if (amount == 0) revert WrongState();
        l.stake = 0;
        _send(msg.sender, amount);
        emit StakeWithdrawn(listingId, msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Buying
    // ---------------------------------------------------------------------

    function purchase(uint256 listingId) external payable nonReentrant returns (uint256 purchaseId) {
        Listing storage l = _listings[listingId];
        if (!l.active) revert InactiveListing();
        if (msg.sender == l.seller) revert NotBuyer();
        if (hasPurchased[listingId][msg.sender]) revert AlreadyPurchased();

        uint256 price = currentPrice(listingId);
        if (msg.value < price) revert InsufficientPayment(price);

        l.copiesSold += 1;
        hasPurchased[listingId][msg.sender] = true;

        bytes32 nonce = keccak256(
            abi.encodePacked(listingId, msg.sender, block.timestamp, _purchases.length, blockhash(block.number - 1))
        );

        _purchases.push(
            Purchase({
                listingId: listingId,
                buyer: msg.sender,
                pricePaid: price,
                purchasedAt: block.timestamp,
                state: PurchaseState.Escrowed,
                disputeBond: 0,
                evidenceHash: bytes32(0),
                nonce: nonce,
                votesForBuyer: 0,
                votesForSeller: 0
            })
        );
        purchaseId = _purchases.length - 1;
        _purchasesOfListing[listingId].push(purchaseId);
        _purchasesOfBuyer[msg.sender].push(purchaseId);

        // Price is read live, so an honest overpay is refunded rather than pocketed.
        if (msg.value > price) _send(msg.sender, msg.value - price);

        emit Purchased(purchaseId, listingId, msg.sender, price, l.copiesSold, nonce);
    }

    /// @notice The encrypted content key, gated on proof of purchase.
    /// @dev    Application-layer gating only — contract storage is world-readable. See NOTES.md.
    function revealKey(uint256 listingId) external view returns (string memory) {
        Listing storage l = _listings[listingId];
        if (!hasPurchased[listingId][msg.sender] && msg.sender != l.seller) revert NotBuyer();
        return l.encryptedKey;
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    function claim(uint256 purchaseId) external nonReentrant {
        Purchase storage p = _purchases[purchaseId];
        Listing storage l = _listings[p.listingId];
        if (msg.sender != l.seller) revert NotSeller();
        if (p.state != PurchaseState.Escrowed) revert WrongState();
        if (block.timestamp < p.purchasedAt + CHALLENGE_WINDOW) revert WindowOpen();

        p.state = PurchaseState.Claimed;
        reputation[l.seller] += 1;
        _send(l.seller, p.pricePaid);
        emit Claimed(purchaseId, l.seller, p.pricePaid);
    }

    /// @notice Dispute freezes escrow. It does not refund — an instant refund would be exploitable.
    function dispute(uint256 purchaseId, bytes32 evidenceHash) external payable nonReentrant {
        Purchase storage p = _purchases[purchaseId];
        if (msg.sender != p.buyer) revert NotBuyer();
        if (p.state != PurchaseState.Escrowed) revert WrongState();
        if (block.timestamp >= p.purchasedAt + CHALLENGE_WINDOW) revert WindowClosed();

        uint256 bond = disputeBondFor(p.pricePaid);
        if (msg.value < bond) revert WrongBond(bond);

        p.state = PurchaseState.Disputed;
        p.disputeBond = bond;
        p.evidenceHash = evidenceHash;

        if (msg.value > bond) _send(msg.sender, msg.value - bond);
        emit Disputed(purchaseId, msg.sender, bond, evidenceHash);
    }

    /// @notice The listing's current time-decay factor, in basis points.
    /// @dev    Keyed to *time* only, not to `currentPrice`. Copies sold also erode secrecy, but
    ///         folding them in would let a seller pull a dispute forward into judgment by
    ///         manufacturing self-dealt purchases. Elapsed time is the one input to these gates
    ///         that no participant can accelerate.
    function listingDecay(uint256 listingId) public view returns (uint256) {
        Listing storage l = _listings[listingId];
        return decayFactor((block.timestamp - l.createdAt) / DECAY_STEP);
    }

    /// @notice Who may judge this dispute right now.
    ///         0 = nobody yet, 1 = prior buyers of this listing, 2 = anyone.
    function juryTier(uint256 purchaseId) public view returns (uint8) {
        Purchase storage p = _purchases[purchaseId];
        if (p.state != PurchaseState.Disputed) return 0;
        uint256 d = listingDecay(p.listingId);
        if (d <= OPEN_JURY_THRESHOLD_BPS) return 2;
        if (d <= JURY_THRESHOLD_BPS) return 1;
        return 0;
    }

    /// @notice True once anyone at all may vote on this dispute.
    function juryEligible(uint256 purchaseId) public view returns (bool) {
        return juryTier(purchaseId) > 0;
    }

    /// @notice True once the default resolution may be triggered because no jury ever converged.
    function timeoutReady(uint256 purchaseId) public view returns (bool) {
        Purchase storage p = _purchases[purchaseId];
        if (p.state != PurchaseState.Disputed) return false;
        return listingDecay(p.listingId) <= TIMEOUT_THRESHOLD_BPS;
    }

    /// @notice Whether `juror` may vote on this dispute right now, for the UI.
    function canVote(uint256 purchaseId, address juror) public view returns (bool) {
        uint8 tier = juryTier(purchaseId);
        if (tier == 0) return false;
        Purchase storage p = _purchases[purchaseId];
        if (juror == p.buyer || juror == _listings[p.listingId].seller) return false;
        if (hasVoted[purchaseId][juror]) return false;
        if (tier == 1 && !hasPurchased[p.listingId][juror]) return false;
        return true;
    }

    function _thresholdAt(uint256 listingId, uint256 bps) private view returns (uint256) {
        Listing storage l = _listings[listingId];
        for (uint256 i = 0; i < DECAY_TABLE_LEN; i++) {
            if (decayFactor(i) <= bps) return l.createdAt + (i * DECAY_STEP);
        }
        return l.createdAt + (DECAY_TABLE_LEN * DECAY_STEP);
    }

    /// @notice Timestamp at which prior buyers may start judging, for UI countdowns.
    function juryEligibleAt(uint256 listingId) public view returns (uint256) {
        return _thresholdAt(listingId, JURY_THRESHOLD_BPS);
    }

    /// @notice Timestamp at which the jury opens to everyone.
    function openJuryAt(uint256 listingId) public view returns (uint256) {
        return _thresholdAt(listingId, OPEN_JURY_THRESHOLD_BPS);
    }

    /// @notice Timestamp at which an unjudged dispute can be defaulted to the seller.
    function timeoutAt(uint256 listingId) public view returns (uint256) {
        return _thresholdAt(listingId, TIMEOUT_THRESHOLD_BPS);
    }

    /// @notice Vote on a frozen dispute. Only prior buyers of this same listing may vote, and the
    ///         disputing buyer may not vote on their own claim.
    function vote(uint256 purchaseId, bool forBuyer) external nonReentrant {
        Purchase storage p = _purchases[purchaseId];
        Listing storage l = _listings[p.listingId];

        if (p.state != PurchaseState.Disputed) revert WrongState();
        uint8 tier = juryTier(purchaseId);
        if (tier == 0) revert NotYetJudgeable();
        // Tier 1 is prior buyers only; tier 2 is open to anyone. Neither side of the dispute votes.
        if (tier == 1 && !hasPurchased[p.listingId][msg.sender]) revert NotAJuror();
        if (msg.sender == p.buyer || msg.sender == l.seller) revert NotAJuror();
        if (hasVoted[purchaseId][msg.sender]) revert AlreadyVoted();

        hasVoted[purchaseId][msg.sender] = true;
        if (forBuyer) p.votesForBuyer += 1;
        else p.votesForSeller += 1;
        reputation[msg.sender] += 1;
        emit Voted(purchaseId, msg.sender, forBuyer);

        if (p.votesForBuyer >= MIN_JURY_VOTES) _resolve(purchaseId, true);
        else if (p.votesForSeller >= MIN_JURY_VOTES) _resolve(purchaseId, false);
    }

    /// @notice Default resolution when no jury ever converged and the content is worthless.
    ///
    /// @dev    The optimistic model applied consistently: absent affirmative evidence against the
    ///         seller, the seller is paid. The buyer's bond is returned rather than forfeited,
    ///         because nothing was proven against them either — they simply never got a verdict.
    ///         Callable by anyone, so neither party can hold the escrow hostage by refusing to act.
    function forceResolve(uint256 purchaseId) external nonReentrant {
        Purchase storage p = _purchases[purchaseId];
        Listing storage l = _listings[p.listingId];
        if (p.state != PurchaseState.Disputed) revert WrongState();
        if (!timeoutReady(purchaseId)) revert NotYetJudgeable();

        p.state = PurchaseState.AwardedToSeller;
        uint256 bond = p.disputeBond;
        uint256 payout = p.pricePaid;
        p.disputeBond = 0;
        // No reputation moves: a timeout is an absence of judgment, not a finding either way.
        if (bond > 0) _send(p.buyer, bond);
        _send(l.seller, payout);
        emit TimedOut(purchaseId, payout, bond);
        emit Resolved(purchaseId, false, payout, 0);
    }

    function _resolve(uint256 purchaseId, bool buyerWon) private {
        Purchase storage p = _purchases[purchaseId];
        Listing storage l = _listings[p.listingId];

        uint256 payout;
        uint256 slashed;

        if (buyerWon) {
            // Buyer is made whole, gets their bond back, and takes the seller's slashed stake.
            slashed = l.stake;
            l.stake = 0;
            l.active = false;
            p.state = PurchaseState.RefundedToBuyer;
            reputation[l.seller] -= 5;
            payout = p.pricePaid + p.disputeBond + slashed;
            _send(p.buyer, payout);
        } else {
            // Seller keeps the sale and takes the griefing buyer's forfeited bond.
            p.state = PurchaseState.AwardedToSeller;
            reputation[l.seller] += 1;
            reputation[p.buyer] -= 5;
            payout = p.pricePaid + p.disputeBond;
            _send(l.seller, payout);
        }
        emit Resolved(purchaseId, buyerWon, payout, slashed);
    }

    // ---------------------------------------------------------------------
    // Views for the frontend
    // ---------------------------------------------------------------------

    function listingCount() external view returns (uint256) {
        return _listings.length;
    }

    function purchaseCount() external view returns (uint256) {
        return _purchases.length;
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _listings[listingId];
    }

    function getPurchase(uint256 purchaseId) external view returns (Purchase memory) {
        return _purchases[purchaseId];
    }

    function purchasesOfBuyer(address buyer) external view returns (uint256[] memory) {
        return _purchasesOfBuyer[buyer];
    }

    function purchasesOfListing(uint256 listingId) external view returns (uint256[] memory) {
        return _purchasesOfListing[listingId];
    }

    /// @notice Everything the UI needs for one listing card, in a single call.
    function listingView(uint256 listingId)
        external
        view
        returns (Listing memory listing, uint256 price, int256 sellerReputation)
    {
        listing = _listings[listingId];
        price = currentPrice(listingId);
        sellerReputation = reputation[listing.seller];
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{ value: amount }("");
        if (!ok) revert TransferFailed();
    }
}
