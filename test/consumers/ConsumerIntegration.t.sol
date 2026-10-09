// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/consumers/GuardedSwapRouter.sol";
import "../../src/consumers/GuardedLender.sol";
import "../../src/consumers/GuardedSettlementRouter.sol";
import "../../src/AnchorClock.sol";

// ---------------------------------------------------------------- mocks

contract MockERC20T {
    uint8 public dec = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function decimals() external view returns (uint8) {
        return dec;
    }

    function setDec(uint8 d) external {
        dec = d;
    }

    function approve(address sp, uint256 amount) external returns (bool) {
        allowance[msg.sender][sp] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "allow");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockFeed {
    int256 public ans = 100 * 1e8;
    bool public shouldRevert;

    function setPrice(int256 a) external {
        ans = a;
    }

    function setRevert(bool v) external {
        shouldRevert = v;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!shouldRevert, "feed halted");
        return (1, ans, block.timestamp, block.timestamp, 1);
    }
}

/// @notice Adapter-shaped mock: read() -> (priceWad, observedAt, ok).
contract MockAdapterRead {
    uint256 public price = 100 * 1e18;
    bool public ok = true;

    function set(uint256 p, bool o) external {
        price = p;
        ok = o;
    }

    function read() external view returns (uint256, uint256, bool) {
        return (price, block.timestamp, ok);
    }
}

contract MockPolicy {
    mapping(address => bool) public auth;

    function setAuth(address a, bool v) external {
        auth[a] = v;
    }

    function isAuthorized(address a) external view returns (bool) {
        return auth[a];
    }
}

// ---------------------------------------------------------------- suite

/// @notice Day-4 consumer integration: guarded vs unguarded twins on all
/// three flows, plus INV-5 (exits never blocked) across session states.
contract ConsumerIntegration is Test {
    // Mon Oct 5 2026 14:00 UTC = 10:00 EDT (NYSE OPEN); Sat Oct 10 = CLOSED.
    uint256 constant T_OPEN = 1791208800;
    uint256 constant T_CLOSED = 1791633600;

    MockERC20T tokenIn;
    MockERC20T tokenOut;
    MockERC20T coll;
    MockERC20T debtT;
    MockERC20T usdc;
    MockFeed feed;
    MockAdapterRead venue;
    MockAdapterRead refFeed;
    MockAdapterRead peg;
    MockPolicy policy;
    AnchorClock clock;

    address keeper = address(0xBEEF);
    address user = address(0xCAFE);
    address payee = address(0xFACE);

    function setUp() public {
        tokenIn = new MockERC20T();
        tokenOut = new MockERC20T();
        coll = new MockERC20T();
        debtT = new MockERC20T();
        usdc = new MockERC20T();
        feed = new MockFeed();
        venue = new MockAdapterRead();
        refFeed = new MockAdapterRead();
        peg = new MockAdapterRead();
        policy = new MockPolicy();
        clock = new AnchorClock();
        vm.warp(T_OPEN);

        tokenIn.mint(user, 1_000_000 * 1e18);
        tokenOut.mint(keeper, 1_000_000 * 1e18);
        coll.mint(user, 1_000 * 1e18);
        debtT.mint(address(this), 1_000_000 * 1e18);
        usdc.mint(user, 1_000_000 * 1e18);
        usdc.mint(address(this), 1_000_000 * 1e18);
        policy.setAuth(user, true);
        policy.setAuth(payee, true);
    }

    // ---- swap ----

    function _swapRouter() internal returns (GuardedSwapRouter r) {
        r = new GuardedSwapRouter(address(feed), address(tokenIn), address(tokenOut), 500, keeper, 100 * 1e8);
        vm.prank(keeper);
        tokenOut.approve(address(r), type(uint256).max);
        vm.prank(keeper);
        r.fund(1_000_000 * 1e18);
    }

    function testSwap_guardedExecutesInsideCollar() public {
        GuardedSwapRouter r = _swapRouter();
        feed.setPrice(103 * 1e8); // +3%, inside ±5%
        vm.startPrank(user);
        tokenIn.approve(address(r), type(uint256).max);
        (uint256 id, uint256 out) = r.swap(1_000 * 1e18);
        vm.stopPrank();
        assertEq(id, 0);
        // out = 1000 * 103e8 * 1e18 / (1e8 * 1e18) = 103000e18
        assertEq(out, 103_000 * 1e18);
        assertEq(tokenOut.balanceOf(user), 103_000 * 1e18);
    }

    function testSwap_guardedDefersOutsideCollar() public {
        GuardedSwapRouter r = _swapRouter();
        feed.setPrice(120 * 1e8); // +20%, outside ±5%
        vm.startPrank(user);
        tokenIn.approve(address(r), type(uint256).max);
        (uint256 id, uint256 out) = r.swap(1_000 * 1e18);
        vm.stopPrank();
        assertTrue(id != 0);
        assertEq(out, 0);
        assertEq(tokenIn.balanceOf(user), 1_000_000 * 1e18 - 1_000 * 1e18); // escrowed
    }

    function testSwap_claimRefundAlways() public {
        GuardedSwapRouter r = _swapRouter();
        feed.setPrice(120 * 1e8);
        vm.startPrank(user);
        tokenIn.approve(address(r), type(uint256).max);
        (uint256 id,) = r.swap(1_000 * 1e18);
        uint256 before = tokenIn.balanceOf(user);
        r.claimRefund(id);
        vm.stopPrank();
        assertEq(tokenIn.balanceOf(user), before + 1_000 * 1e18);
    }

    function testSwap_executeDeferredAtReopen() public {
        GuardedSwapRouter r = _swapRouter();
        feed.setPrice(120 * 1e8);
        vm.startPrank(user);
        tokenIn.approve(address(r), type(uint256).max);
        (uint256 id,) = r.swap(1_000 * 1e18);
        vm.stopPrank();
        // Reopen: keeper updates the refFeed, price back inside the band.
        feed.setPrice(121 * 1e8);
        vm.prank(keeper);
        r.setReferencePrice(120 * 1e8);
        vm.prank(user);
        r.executeDeferred(id);
        assertEq(tokenOut.balanceOf(user), 121_000 * 1e18);
    }

    function testSwap_feedHaltInstantRefund() public {
        GuardedSwapRouter r = _swapRouter();
        feed.setRevert(true);
        vm.startPrank(user);
        tokenIn.approve(address(r), type(uint256).max);
        (uint256 id, uint256 out) = r.swap(1_000 * 1e18);
        vm.stopPrank();
        assertEq(id, 0);
        assertEq(out, 0);
        assertEq(tokenIn.balanceOf(user), 1_000_000 * 1e18); // full refund, nothing escrowed
    }

    function testSwap_unguardedExecutesAtBadPrice() public {
        UnguardedSwapRouter r = new UnguardedSwapRouter(address(feed), address(tokenIn), address(tokenOut));
        vm.startPrank(keeper);
        tokenOut.approve(address(r), type(uint256).max);
        r.fund(1_000_000 * 1e18);
        vm.stopPrank();
        feed.setPrice(120 * 1e8); // dislocated print
        vm.startPrank(user);
        tokenIn.approve(address(r), type(uint256).max);
        uint256 out = r.swap(1_000 * 1e18, 0);
        vm.stopPrank();
        assertEq(out, 120_000 * 1e18); // no protection: fills at the bad print
    }

    // ---- lender ----

    function _lender() internal returns (GuardedLender l) {
        l = new GuardedLender(
            address(coll),
            address(debtT),
            address(clock),
            0, // EQUITY_US
            address(venue),
            address(refFeed),
            15 minutes,
            0
        );
        debtT.transfer(address(l), 100_000 * 1e18); // lender inventory
    }

    function _depositBorrow(GuardedLender l, uint256 collAmt, uint256 borrowAmt) internal {
        vm.startPrank(user);
        coll.approve(address(l), type(uint256).max);
        l.depositCollateral(collAmt);
        l.borrow(borrowAmt);
        vm.stopPrank();
    }

    function testLender_borrowAtOpenLTV() public {
        GuardedLender l = _lender();
        _depositBorrow(l, 10 * 1e18, 500 * 1e18); // 50% of 1000 value: ok
        vm.prank(user);
        vm.expectRevert("exceeds LTV");
        l.borrow(1);
    }

    function testLender_borrowCappedWhenClosed() public {
        vm.warp(T_CLOSED);
        GuardedLender l = _lender();
        vm.startPrank(user);
        coll.approve(address(l), type(uint256).max);
        l.depositCollateral(10 * 1e18);
        vm.expectRevert("exceeds LTV");
        l.borrow(500 * 1e18); // 50% > 35% closed cap
        l.borrow(350 * 1e18); // 35%: ok
        vm.stopPrank();
        assertEq(debtT.balanceOf(user), 350 * 1e18);
    }

    function testLender_sixDecimalDebtScalesCorrectly() public {
        // Regression: 6-decimal debt token (like rUSDG) must not get an
        // 18-decimal borrow cap. 10 coll @ 100 = 1000 value; 50% = 500 units.
        MockERC20T debt6 = new MockERC20T();
        debt6.setDec(6);
        debt6.mint(address(this), 1_000_000 * 1e6);
        GuardedLender l = new GuardedLender(
            address(coll), address(debt6), address(clock), 0, address(venue), address(refFeed), 15 minutes, 0
        );
        debt6.transfer(address(l), 100_000 * 1e6);
        vm.startPrank(user);
        coll.approve(address(l), type(uint256).max);
        l.depositCollateral(10 * 1e18);
        l.borrow(500 * 1e6); // exactly 50%: ok
        vm.expectRevert("exceeds LTV");
        l.borrow(1); // one unit more: revert
        vm.stopPrank();
        assertEq(debt6.balanceOf(user), 500 * 1e6);
    }

    function testLender_repayNeverBlocked() public {
        GuardedLender l = _lender();
        _depositBorrow(l, 10 * 1e18, 500 * 1e18);
        vm.warp(T_CLOSED); // even while closed...
        venue.set(1 * 1e18, true); // ...and the venue price collapsed
        vm.startPrank(user);
        debtT.approve(address(l), type(uint256).max);
        l.repay(500 * 1e18);
        vm.stopPrank();
        assertEq(l.debt(user), 0);
    }

    function testLender_withdrawZeroDebtNeverBlocked() public {
        GuardedLender l = _lender();
        vm.startPrank(user);
        coll.approve(address(l), type(uint256).max);
        l.depositCollateral(10 * 1e18);
        vm.stopPrank();
        vm.warp(T_CLOSED);
        vm.prank(user);
        l.withdrawCollateral(10 * 1e18);
        assertEq(coll.balanceOf(user), 1_000 * 1e18);
    }

    function testLender_INV7_venueManipulationCannotLiquidate() public {
        GuardedLender l = _lender();
        _depositBorrow(l, 10 * 1e18, 400 * 1e18); // 40% LTV, healthy
        // Attacker crushes the VENUE price 10x; refFeed still healthy.
        venue.set(10 * 1e18, true);
        vm.prank(address(0xA11CE));
        vm.expectRevert("healthy on refFeed");
        l.liquidate(user);
        // Reference confirms the distress: liquidation now works.
        refFeed.set(30 * 1e18, true); // value 300 < 400 debt
        debtT.mint(address(0xA11CE), 400 * 1e18);
        vm.startPrank(address(0xA11CE));
        debtT.approve(address(l), type(uint256).max);
        l.liquidate(user);
        vm.stopPrank();
        assertEq(l.debt(user), 0);
    }

    function testLender_graceBlocksLiquidation() public {
        vm.warp(T_CLOSED);
        GuardedLender l = _lender();
        vm.startPrank(user);
        coll.approve(address(l), type(uint256).max);
        l.depositCollateral(10 * 1e18);
        l.borrow(300 * 1e18);
        vm.stopPrank();
        l.pokeSession(); // records the close
        // Reopen Monday; refFeed shows distress.
        vm.warp(T_OPEN);
        l.pokeSession();
        refFeed.set(20 * 1e18, true); // value 200 < 300 debt
        debtT.mint(address(0xA11CE), 300 * 1e18);
        vm.prank(address(0xA11CE));
        debtT.approve(address(l), type(uint256).max);
        vm.expectRevert("in grace");
        l.liquidate(user);
        vm.warp(T_OPEN + 16 minutes);
        vm.prank(address(0xA11CE));
        l.liquidate(user);
        assertEq(l.debt(user), 0);
    }

    function testLender_unguardedLiquidatesOnSqueeze() public {
        UnguardedLender l = new UnguardedLender(address(coll), address(debtT), address(venue));
        debtT.transfer(address(l), 100_000 * 1e18);
        vm.startPrank(user);
        coll.approve(address(l), type(uint256).max);
        l.depositCollateral(10 * 1e18);
        l.borrow(400 * 1e18); // 40% < 60%: healthy
        vm.stopPrank();
        // Squeezed venue print: unguarded twin liquidates immediately.
        venue.set(10 * 1e18, true);
        debtT.mint(address(0xA11CE), 400 * 1e18);
        vm.startPrank(address(0xA11CE));
        debtT.approve(address(l), type(uint256).max);
        l.liquidate(user);
        vm.stopPrank();
        assertEq(l.debt(user), 0); // liquidated on the manipulated print
    }

    // ---- settlement ----

    function _settleRouter() internal returns (GuardedSettlementRouter r) {
        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(tokenOut);
        // peg adapter reads `peg` mock; tolerance 30 bps is enforced inside the mock setup
        r = new GuardedSettlementRouter(tokens, address(peg), address(clock), 1, address(policy), 30, keeper);
    }

    function testSettle_happyPath() public {
        GuardedSettlementRouter r = _settleRouter();
        vm.startPrank(user);
        usdc.approve(address(r), type(uint256).max);
        r.settle(address(usdc), payee, 1_000 * 1e18, bytes32("inv-1"));
        vm.stopPrank();
        assertEq(usdc.balanceOf(payee), 1_000 * 1e18);
    }

    function testSettle_complianceHoldAndRefund() public {
        GuardedSettlementRouter r = _settleRouter();
        policy.setAuth(payee, false); // blocked payee
        vm.startPrank(user);
        usdc.approve(address(r), type(uint256).max);
        r.settle(address(usdc), payee, 1_000 * 1e18, bytes32("inv-2"));
        vm.stopPrank();
        assertEq(usdc.balanceOf(payee), 0); // held, not paid
        (bool released, bool refunded) = _holdClosed(r, 1);
        assertFalse(released || refunded);
        vm.prank(user);
        r.claimRefund(1);
        assertEq(usdc.balanceOf(user), 1_000_000 * 1e18);
    }

    function testSettle_pegBreakWhileFedClosed() public {
        // Saturday: Fed BANK_US anchor is CLOSED (banking days only).
        vm.warp(T_CLOSED);
        assertFalse(clock.isOpen(AnchorClock.Anchor.BANK_US, block.timestamp));
        GuardedSettlementRouter r = _settleRouter();
        peg.set(0, false); // peg adapter fails: break detected
        vm.startPrank(user);
        usdc.approve(address(r), type(uint256).max);
        r.settle(address(usdc), payee, 1_000 * 1e18, bytes32("inv-3"));
        vm.stopPrank();
        assertEq(usdc.balanceOf(payee), 0); // at-par acceptance halted
        assertEq(_holdReason(r, 1), bytes32("PEG_BREAK_CLOSED"));
    }

    function testSettle_unguardedPaysRegardless() public {
        UnguardedSettlementRouter r = new UnguardedSettlementRouter();
        vm.startPrank(user);
        usdc.approve(address(r), type(uint256).max);
        r.settle(address(usdc), payee, 1_000 * 1e18, bytes32("inv-9"));
        vm.stopPrank();
        assertEq(usdc.balanceOf(payee), 1_000 * 1e18); // no checks at all
    }

    function _holdReason(GuardedSettlementRouter r, uint256 id) internal view returns (bytes32 reason) {
        (,,,, reason,,) = r.holds(id);
    }

    function _holdClosed(GuardedSettlementRouter r, uint256 id) internal view returns (bool released, bool refunded) {
        (,,,,, released, refunded) = r.holds(id);
    }

    // ---- billing ----

    function testBilling_payFee() public {
        ProtectionBilling b = new ProtectionBilling(address(usdc), keeper, address(this));
        vm.startPrank(user);
        usdc.approve(address(b), type(uint256).max);
        b.payFee(bytes32("invoice-42"), 25 * 1e18, bytes("tempo-protection"));
        vm.stopPrank();
        assertEq(usdc.balanceOf(keeper), 25 * 1e18);
    }

    // ---- INV-5 sweep: exits never blocked, any state ----

    function testINV5_exitsNeverBlocked() public {
        // Borrow while healthy, then break everything: CLOSED session, dead feeds.
        GuardedLender l = _lender();
        vm.warp(T_OPEN);
        _depositBorrow(l, 10 * 1e18, 100 * 1e18);
        vm.warp(T_CLOSED);
        venue.set(0, false);
        refFeed.set(0, false);
        feed.setRevert(true);

        // repay works
        vm.warp(T_OPEN);
        vm.startPrank(user);
        debtT.approve(address(l), type(uint256).max);
        l.repay(100 * 1e18);
        // withdraw with zero debt works
        coll.approve(address(l), type(uint256).max);
        l.depositCollateral(1 * 1e18);
        l.withdrawCollateral(11 * 1e18);
        vm.stopPrank();

        // swap refund works (feed halted -> instant refund path)
        GuardedSwapRouter r = _swapRouter();
        vm.startPrank(user);
        tokenIn.approve(address(r), type(uint256).max);
        (uint256 id, uint256 out) = r.swap(100 * 1e18);
        vm.stopPrank();
        assertEq(id, 0);
        assertEq(out, 0);

        // settlement hold refund works
        GuardedSettlementRouter s = _settleRouter();
        policy.setAuth(payee, false);
        vm.startPrank(user);
        usdc.approve(address(s), type(uint256).max);
        s.settle(address(usdc), payee, 100 * 1e18, bytes32("inv-x"));
        s.claimRefund(1);
        vm.stopPrank();
    }
}
