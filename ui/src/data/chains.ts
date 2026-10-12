// Chain table: indexer/poller.ts and offchain/signal-api.py.
// Addresses come only from deployments.generated.json (scripts/sync-deployments.mjs),
// always keyed by chain id: the same address means different contracts on
// different chains (one deployer, repeating nonces).

import deployments from "./deployments.generated.json";

export interface ChainInfo {
  id: string;
  name: string;
  /** Name used in the deployments disclosure (DEPLOYED.md). */
  networkName: string;
  rpc: string;
  rpcBackup: string;
}

export const CHAINS: readonly ChainInfo[] = [
  {
    id: "46630",
    name: "Robinhood Chain",
    networkName: "Robinhood Chain testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    rpcBackup: "https://robinhood-testnet.gateway.tatum.io",
  },
  {
    id: "998",
    name: "HyperEVM",
    networkName: "HyperEVM testnet",
    rpc: "https://rpc.hyperliquid-testnet.xyz/evm",
    rpcBackup: "https://hyperliquid-testnet.gateway.tatum.io",
  },
  {
    id: "42431",
    name: "Tempo",
    networkName: "Tempo Moderato testnet",
    rpc: "https://rpc.testnet.tempo.xyz",
    rpcBackup: "https://tempo-testnet.gateway.tatum.io",
  },
];

export const CHAIN_IDS = CHAINS.map((c) => c.id);

export const chainInfo = (id: string): ChainInfo | undefined => CHAINS.find((c) => c.id === id);
export const chainName = (id: string): string => chainInfo(id)?.name ?? `chain ${id}`;

// Robinhood Chain mainnet: price feeds only (Chainlink, 8 decimals).
export const MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const MAINNET_FEEDS = {
  AAPL: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
  TSLA: "0x4A1166a659A55625345e9515b32adECea5547C38",
  NVDA: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
} as const;

// ---------------------------------------------------------------- deployments

type DeploymentFile = Record<string, string>;
const DEPLOYMENTS = deployments as Record<string, DeploymentFile>;

export const CORE_CONTRACTS = ["AnchorClock", "Rulebook", "PriceIntegrity", "LivenessAdapter"] as const;
export type CoreContract = (typeof CORE_CONTRACTS)[number];

/** Core contract address on one chain, or undefined. Never look up by address alone. */
export function coreAddress(chainId: string, contract: CoreContract): string | undefined {
  return DEPLOYMENTS[chainId]?.[contract];
}

/** Robinhood Chain 46630 consumers, mocks and adapters (46630-full.json). */
export function consumerAddress(name: string): string | undefined {
  return DEPLOYMENTS["46630-full"]?.[name];
}

export const CONSUMER_ENTRIES: [string, string][] = Object.entries(DEPLOYMENTS["46630-full"] ?? {});

/** Name for (chainId, address). Keyed by chain: addresses repeat across chains. */
export function contractNameAt(chainId: string, address: string): string | undefined {
  const files = chainId === "46630" ? [DEPLOYMENTS["46630"], DEPLOYMENTS["46630-full"]] : [DEPLOYMENTS[chainId]];
  for (const f of files) {
    for (const [name, a] of Object.entries(f ?? {})) if (a.toLowerCase() === address.toLowerCase()) return name;
  }
  return undefined;
}

// ---------------------------------------------------------------- source files (keep in sync with sync-deployments.mjs)

const SOURCE_FILES: Record<string, string> = {
  AnchorClock: "src/AnchorClock.sol",
  Rulebook: "src/Rulebook.sol",
  PriceIntegrity: "src/PriceIntegrity.sol",
  GuardedFeed: "src/GuardedFeed.sol",
  LivenessAdapter: "src/adapters/LivenessAdapter.sol",
  GuardedSwapRouter: "src/consumers/GuardedSwapRouter.sol",
  UnguardedSwapRouter: "src/consumers/GuardedSwapRouter.sol",
  GuardedLender: "src/consumers/GuardedLender.sol",
  UnguardedLender: "src/consumers/GuardedLender.sol",
  GuardedSettlementRouter: "src/consumers/GuardedSettlementRouter.sol",
  UnguardedSettlementRouter: "src/consumers/GuardedSettlementRouter.sol",
  ProtectionBilling: "src/consumers/GuardedSettlementRouter.sol",
  refAdapterSwap: "src/adapters/ReferenceFeedAdapter.sol",
  refAdapterLend: "src/adapters/ReferenceFeedAdapter.sol",
  refAdapterPeg: "src/adapters/ReferenceFeedAdapter.sol",
  mockFeedTslaPerRusdg: "src/testnet/MockAggregator.sol",
  mockFeedRusdgPerTsla: "src/testnet/MockAggregator.sol",
  mockFeedPeg: "src/testnet/MockAggregator.sol",
  mockUSD: "src/testnet/MockStable.sol",
  policy: "src/testnet/AllowAllPolicy.sol",
};

export const sourceFileFor = (name: string): string | undefined => SOURCE_FILES[name];

/** What each 46630-full entry is, for the deployments disclosure. */
export const CONSUMER_NOTES: Record<string, string> = {
  GuardedFeed: "session-aware AggregatorV3 drop-in",
  GuardedSwapRouter: "guarded swaps (collar, escrow, refund)",
  UnguardedSwapRouter: "unguarded twin for A/B demos",
  GuardedLender: "isolated lending market, 50% / 35% LTV",
  UnguardedLender: "unguarded twin for A/B demos",
  GuardedSettlementRouter: "stablecoin settlement, Fed anchor",
  UnguardedSettlementRouter: "unguarded twin for A/B demos",
  ProtectionBilling: "protection fee with invoice memo",
  refAdapterSwap: "ReferenceFeedAdapter for swaps",
  refAdapterLend: "ReferenceFeedAdapter for the lender",
  refAdapterPeg: "ReferenceFeedAdapter for the peg",
  mockFeedTslaPerRusdg: "mock feed, TSLA per rUSDG",
  mockFeedRusdgPerTsla: "mock feed, rUSDG per TSLA",
  mockFeedPeg: "mock feed, rUSDG per USD",
  mockUSD: "mock stablecoin",
  policy: "allow-all TIP-403 policy mock",
};
