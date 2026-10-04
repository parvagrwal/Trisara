// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AnchorClock
/// @notice Session-aware clock for Trisara's market anchors.
/// @dev Evaluated purely from block.timestamp — no keeper transaction is ever
/// needed for a session transition. A timestamp outside the known 2026–2027
/// calendar fails closed (INV-4: missing input never yields OPEN).
///
/// Holiday table was generated from the NYSE and Federal Reserve 2026–2027
/// schedules (script-generated bitmaps, not hand-computed). Cross-check the
/// table against federalreserve.gov and the NYSE calendar before mainnet deploy.
contract AnchorClock {
    enum Anchor {
        EQUITY_US, // NYSE/Nasdaq: weekdays, non-holiday, 09:30–16:00 ET (DST-aware)
        BANK_US // Federal Reserve: banking *days* — weekday, non-holiday, no intraday hours
    }

    uint256 internal constant EPOCH = 1767225600; // 2026-01-01 00:00:00 UTC (a Thursday)
    uint256 internal constant NDAYS = 730; // 2026-01-01 .. 2027-12-31 inclusive
    uint256 internal constant DAY = 86400;

    // Bit i set => day (EPOCH/DAY + i) is a full holiday. Word w covers days [w*256, w*256+255].
    // NYSE holidays 2026: Jan 1, Jan 19, Feb 16, Apr 3, May 25, Jun 19, Jul 3(obs),
    //   Sep 7, Nov 26, Dec 25. 2027: Jan 1, Jan 18, Feb 15, Mar 26, May 31,
    //   Jun 18(obs), Jul 5(obs), Sep 6, Nov 25, Dec 24(obs).
    uint256 internal constant NYSE_HOL_0 =
        904625697166532776758909032996162005138031182332247026639532591706599063553;
    uint256 internal constant NYSE_HOL_1 =
        12554203470796197490839945450350209750792850601006279426048;
    uint256 internal constant NYSE_HOL_2 =
        1645504560386197123886746899274047094584554689329861376002228232;
    // NYSE early closes (session ends 13:00 ET): 2026-11-27, 2026-12-24, 2027-11-26.
    uint256 internal constant NYSE_EARLY_0 = 0;
    uint256 internal constant NYSE_EARLY_1 = 2535301219345924734471987265536;
    uint256 internal constant NYSE_EARLY_2 = 6129982163463555433433388108601236734474956488734408704;
    // Fed holidays 2026: Jan 1, Jan 19, Feb 16, May 25, Jun 19, Jul 3(obs), Sep 7,
    //   Oct 12, Nov 11, Nov 26, Dec 25. 2027: Jan 1, Jan 18, Feb 15, May 31,
    //   Jun 18(obs), Jul 5(obs), Sep 6, Oct 11, Nov 11, Nov 25, Dec 24(obs).
    uint256 internal constant FED_HOL_0 =
        904625697166532776758909032996162005138031182327295266482391070607002566657;
    uint256 internal constant FED_HOL_1 = 22835963168366603934876918588427942454630547456;
    uint256 internal constant FED_HOL_2 =
        1645504560386384196096412367133508926489788997455879868029861896;

    /// @notice True iff the anchor is in a live session at `timestamp`.
    function isOpen(Anchor anchor, uint256 timestamp) public pure returns (bool) {
        if (timestamp < EPOCH || timestamp >= EPOCH + NDAYS * DAY) return false; // INV-4
        uint256 dayIdx = (timestamp - EPOCH) / DAY;
        uint256 weekday = (dayIdx + 4) % 7; // EPOCH was a Thursday; 0 = Sunday
        if (weekday == 0 || weekday == 6) return false;
        if (_isHoliday(anchor, dayIdx)) return false;
        if (anchor == Anchor.BANK_US) return true; // banking days: no intraday hours
        uint256 tod = timestamp % DAY; // seconds since UTC midnight
        (uint256 openUtc, uint256 closeUtc) = _sessionBounds(dayIdx);
        return tod >= openUtc && tod < closeUtc;
    }

    /// @notice Chainlink marketStatus input. Tighten-only: it can flip an
    /// open market to closed, never a closed market to open.
    function isOpen(Anchor anchor, uint256 timestamp, bool marketStatusOpen)
        external
        pure
        returns (bool)
    {
        return marketStatusOpen && isOpen(anchor, timestamp);
    }

    // --- internals ---

    function _sessionBounds(uint256 dayIdx) internal pure returns (uint256 openUtc, uint256 closeUtc) {
        // 09:30–16:00 ET. EDT (UTC-4): 13:30–20:00 UTC. EST (UTC-5): 14:30–21:00 UTC.
        if (_isDST(dayIdx)) {
            openUtc = 13 hours + 30 minutes;
            closeUtc = 20 hours;
        } else {
            openUtc = 14 hours + 30 minutes;
            closeUtc = 21 hours;
        }
        if (_isEarlyClose(dayIdx)) {
            closeUtc = _isDST(dayIdx) ? 17 hours : 18 hours; // 13:00 ET
        }
    }

    /// @notice US daylight saving: second Sunday of March .. first Sunday of November.
    function _isDST(uint256 dayIdx) internal pure returns (bool) {
        // Neither 2026 nor 2027 is a leap year.
        uint256 jan1Weekday = dayIdx < 365 ? 4 : 5; // Thu / Fri, Sunday = 0
        uint256 doy = dayIdx < 365 ? dayIdx : dayIdx - 365; // 0-indexed day of year
        uint256 mar1Weekday = (59 + jan1Weekday) % 7; // Mar 1 = doy 59
        uint256 secondSunMar = 59 + ((7 - mar1Weekday) % 7) + 7;
        uint256 nov1Weekday = (304 + jan1Weekday) % 7; // Nov 1 = doy 304
        uint256 firstSunNov = 304 + ((7 - nov1Weekday) % 7);
        return doy >= secondSunMar && doy < firstSunNov;
    }

    function _isHoliday(Anchor anchor, uint256 dayIdx) internal pure returns (bool) {
        uint256 word = dayIdx / 256;
        uint256 bit = dayIdx % 256;
        uint256 w;
        if (anchor == Anchor.EQUITY_US) {
            w = word == 0 ? NYSE_HOL_0 : word == 1 ? NYSE_HOL_1 : NYSE_HOL_2;
        } else {
            w = word == 0 ? FED_HOL_0 : word == 1 ? FED_HOL_1 : FED_HOL_2;
        }
        return ((w >> bit) & 1) == 1;
    }

    function _isEarlyClose(uint256 dayIdx) internal pure returns (bool) {
        uint256 word = dayIdx / 256;
        uint256 bit = dayIdx % 256;
        uint256 w = word == 0 ? NYSE_EARLY_0 : word == 1 ? NYSE_EARLY_1 : NYSE_EARLY_2;
        return ((w >> bit) & 1) == 1;
    }
}
