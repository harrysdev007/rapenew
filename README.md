# rayxento — Raydium launcher

An independent React + TypeScript app with an English interface, large bold typography and a local Node server. Default address: **http://127.0.0.1:5188/**. The existing Meteora project is separate.

## Start

Requires Node 22.x (22.18 or newer).

```powershell
npm ci
Copy-Item .env.example .env # only if .env does not already exist
npm run dev
```

Set `SOLANA_RPC_URL` to a mainnet RPC in `.env`. Set `PINATA_JWT` for token image uploads and automatic metadata publishing. Optional `JITO_AUTH_UUID` authenticates requests to Jito. Set `VITE_PRIVY_APP_ID` to the public Privy App ID and enable email login and Solana wallets in the Privy dashboard. Allow the local origin `http://127.0.0.1:5188` if the app restricts origins. The browser integration uses the public App ID. Server credentials stay on the local server, which binds to `127.0.0.1`.

```powershell
npm run build
npm start
```

## Vercel

Import this repository using the included `vercel.json`. It installs with `npm ci`, builds the Vite client and serves `/api/*` through a Node function. Direct navigation to Launch, Wallets, Activity and Documentation is supported. Keep the project on Node 22.x.

Set these environment variables in Vercel before deploying:

- `VITE_PRIVY_APP_ID`: optional override for the public Privy app ID. The project's public ID is included in `shared/app-config.mjs`, so login remains available when this build variable is missing. The server also accepts `PRIVY_APP_ID` as an override.
- `PRIVY_APP_SECRET`: server-only Privy secret for session verification and wallet archiving.
- `SOLANA_RPC_URL`: mainnet RPC URL.
- `PINATA_JWT`: server-only Pinata credential for artwork and metadata.
- `APP_ORIGIN`: the public HTTPS origin, for example `https://rapelaunch.xyz`.
- `JITO_AUTH_UUID`: optional server-only Jito authentication.

Add the public origin to Privy's allowed origins. Vercel's deployment and production URLs are also accepted by the API; add a preview origin to Privy if testing login there. Never prefix server credentials with `VITE_` or commit `.env`. Changing the public Privy ID requires a rebuild. Production uploads require a verified Privy session. Artwork is limited to 3 MiB so its JSON/base64 request fits Vercel's function request limit.

The API explicitly accepts the project's HTTPS hosts `rayxento.xyz`, `www.rayxento.xyz`, `rapelaunch.xyz`, `www.rapelaunch.xyz` and `rapenew.vercel.app` even if Vercel system variables are disabled. Origin checks still require requests to come from the same host. Add each address used for login to Privy's allowed origins separately; allowing `www.rapelaunch.xyz` alone does not allow the other two.

`rpc-websockets` is pinned to 9.3.8 because 9.3.9 requires the ESM-only `uuid` 14 from CommonJS. Vercel disables experimental `require(ESM)` by default. The API cold-start test runs with that feature disabled, and the pinned release supports this runtime without extra `NODE_OPTIONS` settings.

## Launch flow

1. Open **Wallets** and sign in with email through Privy. Under **Add wallet**, enter a name and a Solana base58 private key or JSON keypair. The client sends the key directly to Privy through its SDK. rapelaunch persists only the display name and public address for this Privy account in the browser. Names are local to that browser profile.
2. Use **Export key** to open Privy's export dialog. To recover an earlier encrypted backup, open **Import from an old backup**, unlock it with its original password and choose the wallets to import into Privy.
3. Enter the token name and ticker. Optionally add artwork, a website and an **X / Twitter** profile, post or community URL. The launcher uploads artwork and publishes the metadata through Pinata. Published JSON includes `external_url` for the website and `twitter` (also `extensions.twitter`) for X.
4. Select the developer wallet and optionally assign up to six distinct buyers. Enter the initial purchase budgets manually. Leave the developer amount blank to skip that purchase. The migration target is 73 SOL net, checked against Raydium’s live minimum.
5. Fund each address independently. The dev needs its purchase budget plus a 0.05 SOL temporary setup reserve, a 0.001 SOL Jito tip per bundle and estimated transaction fees. Each other buyer needs its budget plus 0.0041 SOL for temporary token accounts. These reserves are balance checks, not fixed service charges. Actual rent is paid on-chain; closing newly created WSOL accounts returns their remaining funds and rent.
6. **Review launch** reads the live configuration, checks balances, calculates exact-output purchases, packs transactions, estimates fees and simulates creation and any dev purchase that fits in the first transaction. Remaining buys are packed in order into the same bundle. **Sign and send bundle** signs only the reviewed messages and submits one Jito bundle.
7. **Activity** saves the public mint and transaction signatures before submission and tracks the actual chain state. An unknown outcome blocks another launch until confirmation or verified expiry. Reloading the page retains recovery information. A cross-tab lock prevents concurrent signing.

**Remove** in **My wallets** archives the wallet in Privy and clears its launch role. To enable the action, set a write-enabled `PRIVY_APP_SECRET` in the local `.env` and restart the server. The server verifies the Privy session and looks up the wallet under that user before archiving it. Privy handles recovery of archived wallets through support.

The token supply is 1 billion with 6 decimals. Approximately 633.975 million tokens (63.3975%) are sold on the curve and 366.025 million (36.6025%) seed the Raydium pool. No tokens are allocated to the developer and no vesting account is created. The developer obtains tokens only through purchases. New launches target 73 SOL net raised. At 75.16 USD/SOL and zero migration fee, FDV is approximately $4,997 before any buys and $14,990 at migration. Dollar estimates follow SOL/USD; these are not fixed USD prices. Existing tokens retain their original on-chain settings. Each launch purchase uses its own budget. If the final buyer can afford the remaining curve supply, the purchase is capped at that supply. Each buyer pays their purchase and token-account costs. The developer pays transaction fees for the bundle.

## Threshold and migration

On-chain configuration checked on 2026-11-13:

- SOL quote configuration: `6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX`.
- Platform: developer-owned PDA derived from `platform_config` and the selected developer wallet. Created atomically with its first token; later launches reuse it.
- Protocol minimum net funding: **24 SOL** at the last check; new rayxento launches use **73 SOL net**.
- Combined curve trading fee: **0.75%**.
- Gross funding estimate: **73.551637280 SOL**, before account rent, network fees and Jito tip. Splitting among wallets introduces tiny integer rounding differences.

Native creator fees are 0.5% on both stages, with no platform trading fee. The developer receives 0.5% net before migration. After migration, CPMM tier `52MZUkNsRYzP4gn2mCaLTVtJQy2tpoF79hp5K1HhAxxX` charges a 0.5% creator fee; the protocol retains 5% of that fee, leaving 0.475% net. Total CPMM trading fees are 1.25% (0.75% trade + 0.5% creator). The default protocol share and any developer override are checked before review/signing. Fees accrue on-chain and require a separate claim; the app does not currently include a claim button. LP remains 90% burned and 10% locked, with the Fee Key owned by the developer.

For a developer wallet with the earlier 0.95% platform-fee profile, select it on Launch and use **Update creator fees** before preparing another launch. This separate Privy-signed transaction updates that wallet's existing LaunchLab curves and their future migration tier, without creating a token. Already-migrated CPMM pools keep their tier. The transaction is simulated, checked against the fixed fee settings and submitted through a dedicated endpoint that accepts only the signed canonical update and fixed network-fee instructions. A public transaction signature is shown for confirmation recovery. No update is sent automatically.

The 73 SOL migration target is validated against the live configuration. The initial buys can fund any portion of the curve, including zero. The gross funding estimate applies to filling the entire curve.

LaunchLab status **1** means the curve is complete and migration is pending. The app shows **Migrated** only after status **2** and a destination CPMM account owned by Raydium with the matching token pair are both verified. Raydium's keeper performs migration; it need not occur in the launch bundle. Axiom and GMGN independently index migrations and control their own badges. The launcher cannot guarantee their classification or timing.

## First-block execution

The first transaction creates the developer fee configuration if needed, creates the token without a developer reserve. It also includes the developer purchase when that fits; otherwise the purchase runs in the next transaction of the same atomic bundle. Other purchases run in order, with multiple buyers packed into common transactions. Every transaction is at most 1,232 bytes, and the whole launch is at most five transactions. A tip may require the fifth transaction. Oversized launches are rejected; there is no sequential public-transaction fallback or split-bundle fallback.

Jito bundles execute sequentially and atomically within a slot when included. Submission does not guarantee inclusion, an exclusive first block or protection from every competing bot. An unsuccessful/expired bundle is not automatically replaced with a new mint. Existing WSOL accounts remain open; unused purchase budget in them stays as WSOL. Newly created WSOL accounts are closed to the same owner.

## Verification

```powershell
npm test
npm run build
npm run check:mainnet
```

Tests cover lamport precision, fee gross-up, partial and complete curve funding, duplicate buyers, early completion, packet and signature checks for dev + six buyers, WSOL account preservation, encrypted vault round trips, relay validation and migration verification. A captured mainnet simulation account provides a regression fixture for the real pool layout.

`check:mainnet` performs **unsigned, read-only simulations of the first transaction** for creation without a buy, a 1 SOL dev buy, a full dev buy, and a seven-wallet bundle. It verifies the simulated fee config and allocation. When fee setup means the dev buy runs in the next transaction, that buy is not covered by this RPC simulation. The report is written to `outputs/mainnet-simulation.json`. Standard Solana RPC cannot simulate dependent transactions as a bundle. The app shows the result of simulating the first transaction before signing.

## Primary references

- [Raydium: creating a LaunchLab token](https://docs.raydium.io/user-flows/creating-a-launchlab-token)
- [Raydium official instruction definitions](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/launchpad/instrument.ts)
- [Raydium official account layouts](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/launchpad/layout.ts)
- [Raydium exact-output curve math](https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/launchpad/curve/constantProductCurve.ts)
- [Jito bundles, limits and landing behavior](https://docs.jito.wtf/lowlatencytxnsend/)
