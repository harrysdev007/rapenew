import {PrivyProvider, usePrivy} from '@privy-io/react-auth';
import {defaultSolanaRpcsPlugin, useExportWallet, useImportWallet, useSignTransaction, useWallets} from '@privy-io/react-auth/solana';
import {useEffect, useMemo, useState} from 'react';
import App from './App';
import {privyAppId} from '../shared/app-config.mjs';
import {api} from './lib/api';
import type {WalletSigner} from './lib/wallet-signatures';

type NamedWallet = {id: string; address: string; name: string};

export type PrivyWallets = {
  ready: boolean;
  authenticated: boolean;
  wallets: NamedWallet[];
  archiveEnabled: boolean;
  archiveWallet: (address: string) => Promise<void>;
  getAccessToken: () => Promise<string|null>;
  signers: ReadonlyMap<string, WalletSigner>;
  login: () => void;
  logout: () => Promise<void>;
  importKey: (privateKey: string) => Promise<string>;
  saveName: (address: string, name: string) => boolean;
  exportKey: (address: string) => Promise<void>;
};

const appId = privyAppId(import.meta.env.VITE_PRIVY_APP_ID);
const plugins = [defaultSolanaRpcsPlugin()];

function loadWalletNames(storageKey: string): Record<string, string> {
  if (!storageKey) return {};
  try {
    const names = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return Object.fromEntries(Object.entries(names).filter(([address, name]) =>
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && typeof name === 'string' && name.length <= 40,
    )) as Record<string, string>;
  } catch {
    return {};
  }
}

function PrivyLauncher() {
  const {ready, authenticated, login, logout, user, getAccessToken} = usePrivy();
  const {ready: walletsReady, wallets} = useWallets();
  const {importWallet} = useImportWallet();
  const {exportWallet} = useExportWallet();
  const {signTransaction} = useSignTransaction();
  const embedded = useMemo(() => authenticated
    ? wallets.filter(wallet => wallet.standardWallet.name === 'Privy')
    : [], [authenticated, wallets]);
  const storageKey = authenticated && user ? `rapelaunch.wallet-names:${appId}:${user.id}` : '';
  const [archiveEnabled, setArchiveEnabled] = useState(false);
  const [archiveState, setArchiveState] = useState<{key: string; addresses: string[]} | null>(null);
  const archivedAddresses = useMemo(() => new Set(archiveState?.key === storageKey
    ? archiveState.addresses : []), [archiveState, storageKey]);
  useEffect(() => {
    api<{walletArchiveConfigured: boolean}>('health').then(result => setArchiveEnabled(result.walletArchiveConfigured)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!storageKey || !archiveEnabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const {addresses} = await api<{addresses: string[]}>('wallet-archive', undefined, token);
        if (!cancelled) setArchiveState(current => ({
          key: storageKey,
          addresses: [...new Set([...addresses, ...(current?.key === storageKey ? current.addresses : [])])],
        }));
      } catch { /* Wallet archiving can be retried from the wallet list. */ }
    })();
    return () => { cancelled = true; };
  }, [storageKey, archiveEnabled, getAccessToken]);
  const [sessionNames, setSessionNames] = useState<{key: string; names: Record<string, string>} | null>(null);
  const names = useMemo(() => sessionNames?.key === storageKey
    ? sessionNames.names : loadWalletNames(storageKey), [sessionNames, storageKey]);
  const namedWallets = useMemo(() => embedded.map((wallet, i) => ({
    id: `privy:${wallet.address}`,
    address: wallet.address,
    name: names[wallet.address] || `Privy wallet ${i + 1}`,
  })), [embedded, names]);
  const visibleWallets = useMemo(() => namedWallets.filter(wallet => !archivedAddresses.has(wallet.address)), [namedWallets, archivedAddresses]);

  function saveName(address: string, name: string) {
    if (!storageKey) return false;
    const next = {...loadWalletNames(storageKey), ...names, [address]: name};
    setSessionNames({key: storageKey, names: next});
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  }

  const privyWallets: PrivyWallets = {
    ready: ready && (!authenticated || (walletsReady && !!user)),
    authenticated,
    wallets: visibleWallets,
    archiveEnabled,
    getAccessToken,
    archiveWallet: async address => {
      if (!visibleWallets.some(wallet => wallet.address === address)) throw Error('This wallet is unavailable.');
      const token = await getAccessToken();
      if (!token) throw Error('Sign in to Privy first.');
      const result = await api<{address: string; archived: boolean}>('wallet-archive', {address}, token);
      if (result.address !== address || !result.archived) throw Error('Privy did not confirm the archive.');
      setArchiveState(current => ({key: storageKey, addresses: [...new Set([...(current?.key === storageKey ? current.addresses : []), address])]}));
    },
    signers: new Map(embedded.filter(wallet => !archivedAddresses.has(wallet.address)).map(wallet => [wallet.address, async transaction => {
      const result = await signTransaction({transaction, wallet, chain: 'solana:mainnet'});
      return result.signedTransaction;
    }])),
    login,
    logout,
    importKey: async privateKey => (await importWallet({privateKey})).address,
    saveName,
    exportKey: address => exportWallet({address}),
  };
  return <App privy={privyWallets}/>;
}

export default function Root() {
  return <PrivyProvider appId={appId} config={{
    plugins,
    appearance: {theme: 'light', accentColor: '#355cfa', walletChainType: 'solana-only'},
    loginMethods: ['email'],
    embeddedWallets: {
      solana: {createOnLogin: 'off'},
      showWalletUIs: false,
    },
  }}>
    <PrivyLauncher/>
  </PrivyProvider>;
}
