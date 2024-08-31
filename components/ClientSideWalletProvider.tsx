import React from 'react';
import { WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

const ClientSideWalletProvider: React.FC<{
  children: React.ReactNode;
  wallets: any[];
}> = ({ children, wallets }) => {
  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>{children}</WalletModalProvider>
    </WalletProvider>
  );
};

export default ClientSideWalletProvider;