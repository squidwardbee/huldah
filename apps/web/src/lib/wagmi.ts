import { http, createConfig } from 'wagmi';
import { polygon } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

// WalletConnect project ID (get from cloud.walletconnect.com)
const projectId = '00f660400827984d140e8deed2c19557';

export const wagmiConfig = createConfig({
  chains: [polygon],
  connectors: [
    injected(),
    walletConnect({ projectId }),
  ],
  transports: {
    [polygon.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}


