import {useEffect} from 'react';
import {
  DENOMINATOR,JITO_TIP,POOL_SUPPLY,SOLD,SUPPLY,VESTED,
  formatSol,grossFunding,migrationFdv,openingFdv,type Config,
} from './lib/launchlab';

const sections=[
  {id:'getting-started',label:'Getting started'},
  {id:'tokenomics',label:'Token supply and dev allocation'},
  {id:'market-cap',label:'Market cap'},
  {id:'migration',label:'Migration'},
  {id:'wallets',label:'Wallets and Privy'},
  {id:'costs',label:'Budgets and fees'},
  {id:'activity',label:'Activity and recovery'},
];
const tokens=(amount:bigint)=>(Number(amount)/1_000_000).toLocaleString('en-US');
const share=(amount:bigint)=>new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:2}).format(Number(amount)/Number(SUPPLY));
const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',minimumFractionDigits:0,maximumFractionDigits:1});

export default function Docs({config,loading}:{config:Config|null;loading:boolean}){
  const target=config?`${formatSol(config.minimum)} SOL`:'the target shown on Launch';
  const configStatus=loading?'Reading the Raydium configuration…':'Live Raydium configuration is unavailable.';
  const tradeFee=config?new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:3}).format(Number(config.feeRate)/Number(DENOMINATOR)):'—';
  useEffect(()=>{
    const section=window.location.hash.slice(1);
    if(!sections.some(item=>item.id===section))return;
    const frame=window.requestAnimationFrame(()=>document.getElementById(section)?.scrollIntoView({block:'start'}));
    return()=>window.cancelAnimationFrame(frame);
  },[]);
  return <div className="docs-layout">
    <article className="docs-content">
      <section id="getting-started">
        <h2>Getting started</h2>
        <p>rayxento creates Solana mainnet tokens on Raydium LaunchLab. Creation, the developer allocation and optional purchases are submitted together through Jito.</p>
        <ol className="docs-steps">
          <li><strong>Add wallets.</strong> Sign in with email in Wallets. Import each Solana wallet with its private key and give it a name.</li>
          <li><strong>Enter token details.</strong> Add a name and ticker, then optional artwork, description, website and X link. Pinata publishes the image and public token metadata to IPFS.</li>
          <li><strong>Choose buyers.</strong> Select the developer wallet and up to six additional wallets. Each address has one role. Leave the dev budget blank or enter zero to create without a dev purchase. Every selected additional buyer needs a positive budget.</li>
          <li><strong>Review and sign.</strong> Review launch checks balances, pricing, fees and the current Raydium configuration. Its simulation covers creation, the vesting allocation and purchases included in the first transaction. Sign and send bundle requests the wallet signatures through Privy and sends the bundle to Jito.</li>
          <li><strong>Follow Activity.</strong> Track confirmation and migration using the saved token address and transaction links.</li>
        </ol>
        <p>When included, the bundle executes in order within one slot. First-block placement and protection from competing traders depend on execution conditions. <a href="https://docs.jito.wtf/lowlatencytxnsend/" target="_blank" rel="noreferrer">Jito bundle mechanics</a></p>
      </section>

      <section id="tokenomics">
        <h2>Token supply and dev allocation</h2>
        <p>Each token launches with <strong>{tokens(SUPPLY)} tokens</strong> and six decimals.</p>
        <div className="docs-table-scroll">
          <table>
            <caption>Allocation at creation</caption>
            <thead><tr><th scope="col">Allocation</th><th scope="col">Tokens</th><th scope="col">Share</th></tr></thead>
            <tbody>
              <tr><th scope="row">Bonding curve purchases</th><td>{tokens(SOLD)}</td><td>{share(SOLD)}</td></tr>
              <tr><th scope="row">Raydium pool at migration</th><td>{tokens(POOL_SUPPLY)}</td><td>{share(POOL_SUPPLY)}</td></tr>
              <tr><th scope="row">Developer vesting reserve</th><td>{tokens(VESTED)}</td><td>{share(VESTED)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="docs-callout">
          <h3>How the dev reserve works</h3>
          <p>The reserve is assigned to the selected developer wallet at creation, including launches with a zero dev buy. After migration, the full reserve becomes claimable through a separate LaunchLab claim transaction. Claiming transfers the reserved tokens to the dev wallet.</p>
          <p>The developer can then transfer or sell the allocation. Selling into the pool consumes SOL liquidity and lowers the token price. Buyers keep the tokens they purchased in their own wallets.</p>
        </div>
        <p>The current schedule unlocks the full reserve after migration. The beneficiary and schedule are set when the token is created. <a href="https://docs.raydium.io/products/launchlab/vesting" target="_blank" rel="noreferrer">LaunchLab vesting details</a></p>
      </section>

      <section id="market-cap">
        <h2>Market cap</h2>
        <p>The displayed market cap uses the current token price multiplied by the full minted supply, including the developer reserve. This valuation is also called FDV.</p>
        <p>The curve controls how price rises as purchases collect SOL. At an illustrative <strong>$80 per SOL</strong>, the current configuration gives these opening and completion values.</p>
        <dl className="docs-figures">
          <div><dt>Starting market cap</dt><dd>{config?dollars.format(Number(openingFdv(config))/1e9*80):'—'}</dd></div>
          <div><dt>Market cap at curve completion</dt><dd>{config?dollars.format(Number(migrationFdv(config))/1e9*80):'—'}</dd></div>
        </dl>
        {!config&&<p className="docs-status" role="status">{configStatus}</p>}
        <p>Launch converts the estimates using a SOL/USD quote refreshed every minute. Dollar values move with SOL. Initial buys change the price state visible after creation.</p>
      </section>

      <section id="migration">
        <h2>Migration</h2>
        <p>The curve completes when it has collected <strong>{target} after trading fees</strong>. This can be funded over time by buyers. The launcher reads the minimum from Raydium before preparing a launch.</p>
        <dl className="docs-states">
          <div><dt>Curve open</dt><dd>Purchases and sales take place on LaunchLab.</dd></div>
          <div><dt>Migration pending</dt><dd>The fundraising target has been reached. Raydium migration is awaiting completion.</dd></div>
          <div><dt>Migrated</dt><dd>rayxento has verified the completed LaunchLab state and a destination Raydium CPMM pool with the correct token pair.</dd></div>
        </dl>
        <p>Raydium completes the pool migration after fundraising. Axiom and GMGN maintain their own indexing and labels, which can update at different times.</p>
      </section>

      <section id="wallets">
        <h2>Wallets and Privy</h2>
        <p>Privy handles email sign-in, wallet import, export and transaction signing. During import, your private key passes through the browser into the Privy SDK. The import field clears when the operation starts.</p>
        <p>Wallet names are saved in this browser alongside public addresses. Export key opens the Privy export flow. Earlier encrypted rayxento backups can be restored with their original password and imported into Privy.</p>
        <p>Remove archives the wallet in Privy and clears its launch role. Archiving blocks subsequent signing while preserving the on-chain address and its assets. Keep an exported key if you need continued access. <a href="https://docs.privy.io/wallets/wallets/archive-a-wallet" target="_blank" rel="noreferrer">Privy archiving</a></p>
      </section>

      <section id="costs">
        <h2>Budgets and fees</h2>
        <p>Native creator fees are 0.5% before and after migration. The selected developer wallet receives 0.5% net on LaunchLab. After migration, Raydium retains 5% of the 0.5% CPMM creator fee, leaving 0.475% net for the developer. The platform trading fee is zero. Fees accrue on-chain and must be claimed by the developer.</p>
        <dl className="docs-states">
          <div><dt>Curve trading fee</dt><dd>{tradeFee} in the current Raydium and platform configuration.</dd></div>
          <div><dt>CPMM trading fee</dt><dd>{config?.postMigrationFeeRate?new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:3}).format(Number(config.postMigrationFeeRate)/Number(DENOMINATOR)):'—'} total, including the 0.5% creator fee.</dd></div>
          <div><dt>Jito tip</dt><dd>{formatSol(JITO_TIP)} SOL for the whole launch bundle.</dd></div>
          <div><dt>Developer setup allowance</dt><dd>0.05 SOL, plus the dev purchase budget, Jito tip and estimated network fees.</dd></div>
          <div><dt>Additional buyer allowance</dt><dd>Each buyer needs its purchase budget plus 0.0041 SOL for temporary token accounts.</dd></div>
        </dl>
        {config&&<p>Filling the current curve requires approximately <strong>{formatSol(grossFunding(config.minimum,config.feeRate))} SOL in purchases</strong> to collect {target} net. Network fees, rent and the Jito tip are additional. Splitting purchases introduces small rounding differences.</p>}
        <p>Setup and account allowances are available-balance checks. Actual account rent and transaction fees are charged on-chain.</p>
        <p>The first launch from a developer wallet also creates its fee configuration and pays its account rent. Later launches reuse it. For a wallet with the earlier 0.95% platform-fee configuration, use Update creator fees on Launch before preparing another launch. This is a separate developer-signed transaction that creates no token. It changes that wallet’s existing LaunchLab curves and the CPMM tier used for their future migrations. Already-migrated pools keep their existing tier.</p>
        <p>The LP split stays 90% burned and 10% locked in a Fee Key owned by the developer. Extra LP-fee income is separate from creator fees.</p>
        <p>Purchase budgets are maximum amounts. The final purchase is capped at the tokens remaining on the curve. Unused budget can remain as wrapped SOL when an existing wrapped-SOL account is used.</p>
      </section>

      <section id="activity">
        <h2>Activity and recovery</h2>
        <p>Activity keeps up to 100 launches in this browser, including public mint addresses, transaction signatures and the last known status. Reloading preserves the history. Clearing site data removes the local records.</p>
        <p>If confirmation is pending, open Activity and refresh the status before launching again. A submitted bundle stays pending until the app verifies its on-chain result or expiry. Transaction links open the public record on Solscan.</p>
        <p>Keep the mint address and transaction signatures when you need to continue tracking a launch from another browser.</p>
      </section>
    </article>
    <nav className="docs-toc" aria-label="Documentation sections">
      <p>On this page</p>
      {sections.map(section=><a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
    </nav>
  </div>;
}
