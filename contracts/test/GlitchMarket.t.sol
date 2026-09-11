// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { GlitchMarket } from "../src/GlitchMarket.sol";

contract GlitchMarketTest is Test {
    GlitchMarket internal m;

    address internal seller = makeAddr("seller");
    address internal alice = makeAddr("alice"); // buyer A, the disputer
    address internal bob = makeAddr("bob"); // buyer B, juror
    address internal carol = makeAddr("carol"); // buyer C, juror
    address internal dave = makeAddr("dave"); // never buys anything

    uint256 internal constant PRICE = 0.00001 ether;
    uint256 internal constant MIN_PRICE = 0.000001 ether;

    function setUp() public {
        m = new GlitchMarket();
        vm.deal(seller, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(dave, 100 ether);
        // Start at a sane timestamp so `createdAt` arithmetic is not near zero.
        vm.warp(1_700_000_000);
    }

    function _list() internal returns (uint256 id) {
        uint256 stake = m.requiredStake(seller, PRICE);
        vm.prank(seller);
        id = m.list{ value: stake }(
            "Celeste", "Any%", "Frame-perfect corner clip in Chapter 3", keccak256("secret-content"), "ipfs://bafyTest", "aes-key-abc", PRICE, MIN_PRICE
        );
    }

    function _buy(address who, uint256 listingId) internal returns (uint256 pid) {
        uint256 p = m.currentPrice(listingId);
        vm.prank(who);
        pid = m.purchase{ value: p }(listingId);
    }

    // -----------------------------------------------------------------
    // Decay table
    // -----------------------------------------------------------------

    function test_DecayTableStartsAtFullValue() public view {
        assertEq(m.decayFactor(0), 10_000);
    }

    function test_DecayTableIsMonotonicallyDecreasing() public view {
        uint256 prev = type(uint256).max;
        for (uint256 i = 0; i < m.DECAY_TABLE_LEN(); i++) {
            uint256 v = m.decayFactor(i);
            assertLt(v, prev, "decay table must strictly decrease");
            prev = v;
        }
    }

    function test_DecayTableClampsPastEnd() public view {
        uint256 last = m.decayFactor(m.DECAY_TABLE_LEN() - 1);
        assertEq(m.decayFactor(m.DECAY_TABLE_LEN()), last);
        assertEq(m.decayFactor(10_000), last);
    }

    // -----------------------------------------------------------------
    // Pricing
    // -----------------------------------------------------------------

    function test_PriceDecaysOverTime() public {
        uint256 id = _list();
        uint256 p0 = m.currentPrice(id);
        assertEq(p0, PRICE, "price at t=0 is the initial price");

        vm.warp(block.timestamp + 60);
        uint256 p1 = m.currentPrice(id);
        assertLt(p1, p0, "price must fall as the secret ages");
    }

    function test_PriceDropsWithEachCopySold() public {
        uint256 id = _list();
        uint256 before = m.currentPrice(id);
        _buy(alice, id);
        uint256 afterOne = m.currentPrice(id);
        assertLt(afterOne, before, "each copy sold erodes the next buyer's price");

        _buy(bob, id);
        assertLt(m.currentPrice(id), afterOne);
    }

    function test_PriceNeverFallsBelowMinimum() public {
        uint256 id = _list();
        vm.warp(block.timestamp + 10 days);
        assertEq(m.currentPrice(id), MIN_PRICE);
    }

    function test_RequiredStakeShrinksAsReputationGrows() public view {
        uint256 unproven = m.requiredStake(seller, PRICE);
        assertEq(unproven, PRICE * 5, "an unproven seller posts 5x");
    }

    // -----------------------------------------------------------------
    // Listing and purchase
    // -----------------------------------------------------------------

    function test_ListingRequiresSufficientStake() public {
        uint256 need = m.requiredStake(seller, PRICE);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(GlitchMarket.InsufficientStake.selector, need));
        m.list{ value: need - 1 }("Celeste", "Any%", "t", bytes32(0), "ipfs://x", "k", PRICE, MIN_PRICE);
    }

    function test_ContentHashIsCommittedAtListingTime() public {
        uint256 id = _list();
        assertEq(m.getListing(id).contentHash, keccak256("secret-content"));
    }

    function test_BuyerCannotReadKeyBeforePaying() public {
        uint256 id = _list();
        vm.prank(alice);
        vm.expectRevert(GlitchMarket.NotBuyer.selector);
        m.revealKey(id);
    }

    function test_BuyerCanReadKeyAfterPaying() public {
        uint256 id = _list();
        _buy(alice, id);
        vm.prank(alice);
        assertEq(m.revealKey(id), "aes-key-abc");
    }

    function test_OverpaymentIsRefunded() public {
        uint256 id = _list();
        uint256 p = m.currentPrice(id);
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        m.purchase{ value: p + 0.5 ether }(id);
        assertEq(alice.balance, balBefore - p, "excess over the live price is returned");
    }

    function test_CannotBuyTwice() public {
        uint256 id = _list();
        _buy(alice, id);
        vm.prank(alice);
        vm.expectRevert(GlitchMarket.AlreadyPurchased.selector);
        m.purchase{ value: 1 ether }(id);
    }

    function test_SellerCannotBuyOwnListing() public {
        uint256 id = _list();
        vm.prank(seller);
        vm.expectRevert(GlitchMarket.NotBuyer.selector);
        m.purchase{ value: 1 ether }(id);
    }

    // -----------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------

    function test_HappyPath_SellerClaimsAfterChallengeWindow() public {
        uint256 id = _list();
        uint256 pid = _buy(alice, id);
        uint256 paid = m.getPurchase(pid).pricePaid;

        vm.warp(block.timestamp + m.CHALLENGE_WINDOW());
        uint256 balBefore = seller.balance;
        vm.prank(seller);
        m.claim(pid);

        assertEq(seller.balance, balBefore + paid, "seller receives the escrowed payment");
        assertEq(uint256(m.getPurchase(pid).state), uint256(GlitchMarket.PurchaseState.Claimed));
        assertEq(m.reputation(seller), 1, "a clean sale earns reputation");
    }

    function test_SellerCannotClaimDuringChallengeWindow() public {
        uint256 id = _list();
        uint256 pid = _buy(alice, id);
        vm.prank(seller);
        vm.expectRevert(GlitchMarket.WindowOpen.selector);
        m.claim(pid);
    }

    function test_NonSellerCannotClaim() public {
        uint256 id = _list();
        uint256 pid = _buy(alice, id);
        vm.warp(block.timestamp + m.CHALLENGE_WINDOW());
        vm.prank(dave);
        vm.expectRevert(GlitchMarket.NotSeller.selector);
        m.claim(pid);
    }

    // -----------------------------------------------------------------
    // Disputes
    // -----------------------------------------------------------------

    function test_DisputeFreezesFundsAndDoesNotRefund() public {
        uint256 id = _list();
        uint256 pid = _buy(alice, id);
        uint256 bond = m.disputeBondFor(m.getPurchase(pid).pricePaid);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        m.dispute{ value: bond }(pid, keccak256("evidence"));

        assertEq(alice.balance, balBefore - bond, "disputing costs a bond, it does not refund");
        assertEq(uint256(m.getPurchase(pid).state), uint256(GlitchMarket.PurchaseState.Disputed));
    }

    function test_DisputeRequiresBond() public {
        uint256 id = _list();
        uint256 pid = _buy(alice, id);
        uint256 bond = m.disputeBondFor(m.getPurchase(pid).pricePaid);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(GlitchMarket.WrongBond.selector, bond));
        m.dispute{ value: bond - 1 }(pid, keccak256("evidence"));
    }

    function test_CannotDisputeAfterWindowCloses() public {
        uint256 id = _list();
        uint256 pid = _buy(alice, id);
        vm.warp(block.timestamp + m.CHALLENGE_WINDOW());
        vm.prank(alice);
        vm.expectRevert(GlitchMarket.WindowClosed.selector);
        m.dispute{ value: 1 ether }(pid, keccak256("evidence"));
    }

    function test_SellerCannotClaimWhileDisputed() public {
        uint256 id = _list();
        uint256 pid = _buy(alice, id);
        uint256 bond = m.disputeBondFor(m.getPurchase(pid).pricePaid);
        vm.prank(alice);
        m.dispute{ value: bond }(pid, keccak256("e"));

        vm.warp(block.timestamp + m.CHALLENGE_WINDOW());
        vm.prank(seller);
        vm.expectRevert(GlitchMarket.WrongState.selector);
        m.claim(pid);
    }

    // -----------------------------------------------------------------
    // Jury
    // -----------------------------------------------------------------

    function _disputedSetup() internal returns (uint256 id, uint256 pid) {
        id = _list();
        pid = _buy(alice, id);
        _buy(bob, id);
        _buy(carol, id);
        uint256 bond = m.disputeBondFor(m.getPurchase(pid).pricePaid);
        vm.prank(alice);
        m.dispute{ value: bond }(pid, keccak256("evidence"));
    }

    function test_DisputeIsNotJudgeableUntilDecayThreshold() public {
        (, uint256 pid) = _disputedSetup();
        assertFalse(m.juryEligible(pid), "must not be judgeable immediately");

        vm.prank(bob);
        vm.expectRevert(GlitchMarket.NotYetJudgeable.selector);
        m.vote(pid, true);
    }

    function test_DisputeBecomesJudgeableAfterDecay() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        assertTrue(m.juryEligible(pid), "judgeable once secrecy has aged out");
    }

    function test_OnlyPriorBuyersMayVote() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        vm.prank(dave);
        vm.expectRevert(GlitchMarket.NotAJuror.selector);
        m.vote(pid, true);
    }

    function test_DisputerCannotJudgeOwnDispute() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        vm.prank(alice);
        vm.expectRevert(GlitchMarket.NotAJuror.selector);
        m.vote(pid, true);
    }

    function test_SellerCannotVote() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        vm.prank(seller);
        vm.expectRevert(GlitchMarket.NotAJuror.selector);
        m.vote(pid, false);
    }

    function test_JurorCannotVoteTwice() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        vm.prank(bob);
        m.vote(pid, true);
        vm.prank(bob);
        vm.expectRevert(GlitchMarket.AlreadyVoted.selector);
        m.vote(pid, true);
    }

    function test_OneVoteIsNotEnoughToResolve() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        vm.prank(bob);
        m.vote(pid, true);
        assertEq(
            uint256(m.getPurchase(pid).state),
            uint256(GlitchMarket.PurchaseState.Disputed),
            "a single juror must not be able to resolve"
        );
    }

    function test_TwoConvergentVotesRefundBuyerAndSlashSeller() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        uint256 paid = m.getPurchase(pid).pricePaid;
        uint256 bond = m.getPurchase(pid).disputeBond;
        uint256 stake = m.getListing(id).stake;

        vm.warp(m.juryEligibleAt(id));
        uint256 balBefore = alice.balance;

        vm.prank(bob);
        m.vote(pid, true);
        vm.prank(carol);
        m.vote(pid, true);

        assertEq(uint256(m.getPurchase(pid).state), uint256(GlitchMarket.PurchaseState.RefundedToBuyer));
        assertEq(alice.balance, balBefore + paid + bond + stake, "buyer recovers payment, bond, and the slashed stake");
        assertEq(m.getListing(id).stake, 0, "seller stake is slashed");
        assertFalse(m.getListing(id).active, "a listing that lost a dispute is pulled");
        assertEq(m.reputation(seller), -5, "losing a dispute costs reputation sharply");
    }

    function test_TwoVotesForSellerAwardPaymentAndForfeitBuyerBond() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        uint256 paid = m.getPurchase(pid).pricePaid;
        uint256 bond = m.getPurchase(pid).disputeBond;

        vm.warp(m.juryEligibleAt(id));
        uint256 balBefore = seller.balance;

        vm.prank(bob);
        m.vote(pid, false);
        vm.prank(carol);
        m.vote(pid, false);

        assertEq(uint256(m.getPurchase(pid).state), uint256(GlitchMarket.PurchaseState.AwardedToSeller));
        assertEq(seller.balance, balBefore + paid + bond, "seller keeps the sale and takes the griefer's bond");
        assertEq(m.reputation(alice), -5, "a failed dispute costs the buyer reputation");
        assertGt(m.reputation(seller), 0);
    }

    function test_JurorsEarnReputationForParticipating() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        vm.prank(bob);
        m.vote(pid, true);
        assertEq(m.reputation(bob), 1);
    }

    // -----------------------------------------------------------------
    // Staged jury: tiers, the single-buyer case, and the timeout default
    // -----------------------------------------------------------------

    /// A listing bought by exactly one person, who then disputes. Under a prior-buyers-only rule
    /// this could never be judged, because the disputer may not rule on their own claim.
    function _soloDisputedSetup() internal returns (uint256 id, uint256 pid) {
        id = _list();
        pid = _buy(alice, id);
        uint256 bond = m.disputeBondFor(m.getPurchase(pid).pricePaid);
        vm.prank(alice);
        m.dispute{ value: bond }(pid, keccak256("evidence"));
    }

    function test_JuryTiersOpenInOrder() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        assertEq(m.juryTier(pid), 0, "nobody may judge immediately");

        vm.warp(m.juryEligibleAt(id));
        assertEq(m.juryTier(pid), 1, "prior buyers first");

        vm.warp(m.openJuryAt(id));
        assertEq(m.juryTier(pid), 2, "then everyone");
    }

    function test_OutsiderCannotVoteAtTierOne() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        assertFalse(m.canVote(pid, dave));
        vm.prank(dave);
        vm.expectRevert(GlitchMarket.NotAJuror.selector);
        m.vote(pid, true);
    }

    function test_OutsiderCanVoteOnceJuryOpens() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.openJuryAt(id));
        assertTrue(m.canVote(pid, dave), "a stranger may judge worthless content");
        vm.prank(dave);
        m.vote(pid, true);
        assertEq(m.getPurchase(pid).votesForBuyer, 1);
    }

    function test_DisputerAndSellerStillExcludedAtOpenTier() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.openJuryAt(id));
        assertFalse(m.canVote(pid, alice), "disputer never judges their own claim");
        assertFalse(m.canVote(pid, seller), "seller never judges their own sale");
        vm.prank(alice);
        vm.expectRevert(GlitchMarket.NotAJuror.selector);
        m.vote(pid, true);
    }

    /// The bug this tier structure exists to kill: a sole buyer's dispute must still resolve.
    function test_SoleBuyerDisputeCanStillBeJudgedOnceJuryOpens() public {
        (uint256 id, uint256 pid) = _soloDisputedSetup();
        vm.warp(m.juryEligibleAt(id));
        assertFalse(m.canVote(pid, dave), "still closed to outsiders at tier 1");

        vm.warp(m.openJuryAt(id));
        uint256 balBefore = alice.balance;
        vm.prank(dave);
        m.vote(pid, true);
        vm.prank(bob);
        m.vote(pid, true);

        assertEq(uint256(m.getPurchase(pid).state), uint256(GlitchMarket.PurchaseState.RefundedToBuyer));
        assertGt(alice.balance, balBefore, "the sole buyer is made whole");
    }

    function test_TimeoutNotAvailableEarly() public {
        (, uint256 pid) = _soloDisputedSetup();
        assertFalse(m.timeoutReady(pid));
        vm.expectRevert(GlitchMarket.NotYetJudgeable.selector);
        m.forceResolve(pid);
    }

    function test_TimeoutPaysSellerAndReturnsBond() public {
        (uint256 id, uint256 pid) = _soloDisputedSetup();
        uint256 paid = m.getPurchase(pid).pricePaid;
        uint256 bond = m.getPurchase(pid).disputeBond;

        vm.warp(m.timeoutAt(id));
        assertTrue(m.timeoutReady(pid));

        uint256 sellerBefore = seller.balance;
        uint256 aliceBefore = alice.balance;
        // Anyone may trigger it, so neither side can hold the escrow hostage.
        vm.prank(dave);
        m.forceResolve(pid);

        assertEq(uint256(m.getPurchase(pid).state), uint256(GlitchMarket.PurchaseState.AwardedToSeller));
        assertEq(seller.balance, sellerBefore + paid, "seller paid by default");
        assertEq(alice.balance, aliceBefore + bond, "bond returned: nothing was proven either way");
        assertEq(m.reputation(seller), 0, "a timeout moves no reputation");
        assertEq(m.reputation(alice), 0);
    }

    function test_TimeoutCannotOverrideAVerdict() public {
        (uint256 id, uint256 pid) = _disputedSetup();
        vm.warp(m.juryEligibleAt(id));
        vm.prank(bob);
        m.vote(pid, true);
        vm.prank(carol);
        m.vote(pid, true);

        vm.warp(m.timeoutAt(id));
        vm.expectRevert(GlitchMarket.WrongState.selector);
        m.forceResolve(pid);
    }

    function test_SellerStakeUnfreezesAfterTimeout() public {
        (uint256 id, uint256 pid) = _soloDisputedSetup();
        vm.warp(m.timeoutAt(id));
        m.forceResolve(pid);
        vm.prank(seller);
        m.closeListing(id);
        uint256 before = seller.balance;
        vm.prank(seller);
        m.withdrawStake(id);
        assertGt(seller.balance, before, "capital is no longer trapped");
    }

    // -----------------------------------------------------------------
    // Stake lifecycle
    // -----------------------------------------------------------------

    function test_StakeCannotBeWithdrawnWhilePurchasesAreOpen() public {
        uint256 id = _list();
        _buy(alice, id);
        vm.prank(seller);
        m.closeListing(id);
        vm.prank(seller);
        vm.expectRevert(GlitchMarket.OpenObligations.selector);
        m.withdrawStake(id);
    }

    function test_StakeIsReturnedOnceEverythingSettles() public {
        uint256 id = _list();
        uint256 pid = _buy(alice, id);
        uint256 stake = m.getListing(id).stake;

        vm.warp(block.timestamp + m.CHALLENGE_WINDOW());
        vm.prank(seller);
        m.claim(pid);
        vm.prank(seller);
        m.closeListing(id);

        uint256 balBefore = seller.balance;
        vm.prank(seller);
        m.withdrawStake(id);
        assertEq(seller.balance, balBefore + stake);
    }

    // -----------------------------------------------------------------
    // Solvency
    // -----------------------------------------------------------------

    function test_ContractHoldsExactlyItsObligations() public {
        uint256 id = _list();
        uint256 stake = m.getListing(id).stake;
        uint256 pid = _buy(alice, id);
        uint256 paid = m.getPurchase(pid).pricePaid;
        assertEq(address(m).balance, stake + paid, "escrow plus stake, nothing stranded");
    }
}
