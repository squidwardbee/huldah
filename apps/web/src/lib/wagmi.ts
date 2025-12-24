import { http, createConfig } from 'wagmi';
import { polygon } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

// WalletConnect project ID (get from cloud.walletconnect.com)
const projectId = 'YOUR_PROJECT_ID';

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

