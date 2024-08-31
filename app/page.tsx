// @ts-nocheck
"use client";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { clusterApiUrl, Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { SystemProgram } from "@solana/web3.js";
import {
  ConnectionProvider
} from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { SendHorizontal, Loader2, Menu, Moon, Sun, DollarSign } from "lucide-react";
import dynamic from 'next/dynamic';
import ClientSideWalletProvider from "../components/ClientSideWalletProvider";

require("@solana/wallet-adapter-react-ui/styles.css");

type PriceData = {
  symbol: string;
  price: number;
  priceChange24h: number;
  sparklineData: number[];
  lastUpdated: string;
};

type Message = {
  sender: "user" | "bot";
  content: string;
  priceData?: PriceData;
};

type TransactionDetails = {
  transaction: string;
  network: string;
  connection: string;
};

const ClientSideWalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);



const formatMessageContent = (content: string) => {
  const lines = content.split('\n');

  return lines.map((line, index) => {
    if (/^\d+\./.test(line.trim())) {
      return (
        <div key={index} className="ml-4 mb-2">
          <strong>{line.trim().split('.')[0]}.</strong> {line.trim().split('.').slice(1).join('.')}
        </div>
      );
    }
    else if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
      return <li key={index} className="ml-6 mb-1">{line.trim().slice(1)}</li>;
    }
    else {
      return <p key={index} className="mb-2">{line}</p>;
    }
  });
};

function ChatInterface({ onNetworkChange }: { onNetworkChange: (network: WalletAdapterNetwork) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [submitting, setSubmitting] = useState(false);
  const [livePrice, setLivePrice] = useState<PriceData | null>(null);
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isTransactionPending, setIsTransactionPending] = useState(false);
  const [selectableMessages, setSelectableMessages] = useState<string[]>([]);
  const [showAirdropAnimation, setShowAirdropAnimation] = useState(false);

const AirdropAnimation = () => (
  <div className="fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50">
    <div className="bg-white rounded-lg p-6 flex flex-col items-center">
      <DollarSign className="w-16 h-16 text-green-500 animate-bounce mb-4" />
      <p className="text-lg font-semibold">Airdrop Initiated!</p>
    </div>
  </div>
);



useEffect(() => {
  const savedMessages = localStorage.getItem("chatMessages");
  if (savedMessages) {
    const parsedMessages = JSON.parse(savedMessages);
    if (parsedMessages.length > 0) {
      setMessages(parsedMessages);
    } else {
      getWelcomeMessageContent();
    }
  } else {
    getWelcomeMessageContent();
  }
}, []);


const getWelcomeMessageContent = () => {
  return `I'm here to assist you with a wide range of Solana blockchain operations and cryptocurrency information. Here's what I can help you with:

1. Check Solana balance on any network (mainnet, devnet, testnet) for your wallet or any specified wallet
2. View recent transactions for your wallet or any specified wallet
3. Generate transaction summaries for your wallet or any specified wallet
4. Send SOL to another address on any network
5. Request an airdrop on devnet or testnet
6. Get current cryptocurrency prices
7. Swap tokens (when available)
8. Show all token balances in a wallet
9. Get detailed information about any specific transaction using its hash

Feel free to ask about any of these operations, and I'll guide you through the process!

Note: I'm currently in beta mode, so you might encounter some bugs. We're continuously working to improve and add new features.

Important: Ensure your Phantom wallet is connected to the same network (mainnet, devnet, or testnet) as the operation you're attempting to perform to avoid transaction failures or conflicts.`;
};

  useEffect(() => {
    localStorage.setItem("chatMessages", JSON.stringify(messages));
  }, [messages]);

  const DefaultMessages = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
      {[ "What's my Solana balance on devnet?",
        "Tell me the current Bitcoin price",
        "Send 0.2 SOL to C1Q85yjUtPQookfxbAFzJo9whF7nnN5RqduDFviZ9FVZ on devnet",
        "Last 5 transactions of my wallet",
        "Airdrop me 2 SOL on devnet",
        "Airdrop me 0.5 SOL on testnet"].map((msg, index) => (
        <div
          key={index}
          className={`p-2 rounded-lg cursor-pointer text-center text-xs sm:text-sm md:text-base ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} transition-colors duration-200`}
          onClick={() => handleSelectableMessageClick(msg)}
        >
          {msg}
        </div>
      ))}
    </div>
  );

  const ChatBubble = ({ message, onSelect }: { message: string; onSelect: (message: string) => void }) => (
    <div
      className={`p-2 rounded-full cursor-pointer text-xs sm:text-sm ${isDarkMode
          ? 'bg-pink-600 hover:bg-purple-700 text-white'
          : 'bg-pink-100 hover:bg-purple-200 text-purple-800'
        } transition-colors duration-200`}
      onClick={() => onSelect(message)}
    >
      {message}
    </div>
  );

  const handleSelectableMessageClick = (message: string) => {
    setInput(message);
    setSelectableMessages([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !publicKey) return;

    setSubmitting(true);
    setIsTyping(true);
    setSelectableMessages([]); 
    const userMessage: Message = { sender: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const response = await fetch("/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          walletAddress: publicKey.toBase58(),
        }),
      });

      if (!response.ok) throw new Error("API response was not ok");

      const data = await response.json();

      if (data.network) {
        onNetworkChange(data.network as WalletAdapterNetwork);
      }

      const botMessage: Message = {
        sender: "bot",
        content: data.response,
        priceData: data.priceData,
      };
      setMessages((prev) => [...prev, botMessage]);
      setIsTyping(false);

      if (data.priceData) {
        setLivePrice(data.priceData);
        setIsLiveUpdating(true);
      }

      if (data.transactionDetails) {
        handleTransaction(data.transactionDetails);
      }

      const followUpResponse = await fetch("/api/generatefollowups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastBotMessage: data.response,
        }),
      });

      const followUpData = await followUpResponse.json();

      if (followUpData.followUpMessages) {
        setSelectableMessages(followUpData.followUpMessages);
      }

    } catch (error) {
      console.error("Error:", error);
      const errorMessage: Message = { sender: "bot", content: `Error: ${(error as Error).message}` };
      setMessages((prev) => [...prev, errorMessage]);
      setIsTyping(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransaction = useCallback(
    async (transactionDetails: TransactionDetails) => {
      if (!connected || !publicKey || !sendTransaction) {
        console.error("Wallet not connected or sendTransaction not available");
        return;
      }
  
      setIsTransactionPending(true);
      const pendingMessage: Message = {
        sender: "bot",
        content: "Transaction pending. Please sign the transaction in your wallet.",
      };
      setMessages((prev) => [...prev, pendingMessage]);
  
      let transaction;
      try {
        const transactionBuffer = Buffer.from(transactionDetails.transaction, "base64");
        transaction = VersionedTransaction.deserialize(transactionBuffer);
      } catch (error) {
        console.error("Error deserializing transaction:", error);
        const errorMessage: Message = {
          sender: "bot",
          content: `Error preparing transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsTransactionPending(false);
        return;
      }
  
      const networkConnection = new Connection(transactionDetails.connection);
  
      try {
        // Sign and send the transaction
        const signature = await sendTransaction(transaction, networkConnection);
  
        const processingMessage: Message = {
          sender: "bot",
          content: "Transaction sent. Processing...",
        };
        setMessages((prev) => [...prev, processingMessage]);
  
        // Check if the transaction was an airdrop
        if (transaction.message.instructions.some(instruction => 
          instruction.programId && 
          'equals' in instruction.programId &&
          instruction.programId.equals(SystemProgram.programId) &&
          'data' in instruction &&
          instruction.data instanceof Buffer &&
          instruction.data.length >= 4 &&
          instruction.data.readUInt32LE(0) === 2 // 2 is the index for SystemInstruction::Transfer
        )) {
          setShowAirdropAnimation(true);
          setTimeout(() => setShowAirdropAnimation(false), 3000); // Hide after 3 seconds
        }
  
        // Wait for confirmation
        const latestBlockHash = await networkConnection.getLatestBlockhash();
        await networkConnection.confirmTransaction({
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: signature
        });
  
        setIsTransactionPending(false);
  
        const confirmationMessage: Message = {
          sender: "bot",
          content: `Transaction confirmed! Signature: ${signature}`,
        };
        setMessages((prev) => [...prev, confirmationMessage]);
  
        const explorerLink: Message = {
          sender: "bot",
          content: `<a href="https://explorer.solana.com/tx/${signature}?cluster=${transactionDetails.network.toLowerCase()}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 underline">View transaction on Solana Explorer</a>`,
        };
        setMessages((prev) => [...prev, explorerLink]);
      } catch (error) {
        console.error("Transaction error:", error);
        const errorMessage: Message = {
          sender: "bot",
          content: `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsTransactionPending(false);
      }
    },
    [connected, publicKey, sendTransaction]
  );

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  const renderPriceChart = (priceData: PriceData) => {
    const chartData = priceData.sparklineData.map((price, index) => ({
      time: index,
      price: price,
    }));

    return (
      <div className={`${isDarkMode ? "bg-gray-800" : "bg-white"} p-4 rounded-lg shadow-md mb-4`}>
        <h2 className={`text-base sm:text-lg font-semibold mb-2 ${isDarkMode ? "text-gray-200" : "text-gray-800"}`}>{priceData.symbol} Price Chart</h2>
        <p className={`text-lg sm:text-xl md:text-2xl font-bold ${isDarkMode ? "text-gray-100" : "text-gray-900"}`}>${priceData.price.toFixed(2)}</p>
        <p className={`text-xs sm:text-sm ${priceData.priceChange24h >= 0 ? "text-green-400" : "text-red-400"} mb-4`}>
          {priceData.priceChange24h >= 0 ? "▲" : "▼"} {Math.abs(priceData.priceChange24h).toFixed(2)}% (24h)
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <XAxis dataKey="time" tick={{ fill: isDarkMode ? "#9CA3AF" : "#6B7280", fontSize: 10 }} tickFormatter={(value) => `${value}h`} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: isDarkMode ? "#9CA3AF" : "#6B7280", fontSize: 10 }} tickFormatter={(value) => `$${value.toFixed(0)}`} />
            <Tooltip
              contentStyle={{ backgroundColor: isDarkMode ? "#374151" : "white", border: `1px solid ${isDarkMode ? "#4B5563" : "#E5E7EB"}`, borderRadius: "6px" }}
              labelStyle={{ color: isDarkMode ? "#D1D5DB" : "#374151" }}
              labelFormatter={(value) => `Time: ${value}h`}
              formatter={(value) => [`$${Number(value).toFixed(2)}`, "Price"]}
            />
            <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? "#4B5563" : "#E5E7EB"} />
            <Line type="monotone" dataKey="price" stroke="#3B82F6" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
        <p className={`text-xs ${isDarkMode ? "text-gray-400" : "text-gray-500"} mt-2`}>Last updated: {new Date(priceData.lastUpdated).toLocaleString()}</p>
      </div>
    );
  };

  return (
    <div className={`flex flex-col lg:flex-row h-screen ${isDarkMode ? "bg-gray-900" : "bg-gray-50"}`}>
      <div className={`w-full lg:w-64 ${isDarkMode ? "bg-gray-800" : "bg-white"} border-b lg:border-r border-gray-700 p-4`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Menu className={`w-5 h-5 sm:w-6 sm:h-6 ${isDarkMode ? "text-gray-300" : "text-gray-600"} mr-2`} />
            <h1 className={`text-base sm:text-lg md:text-xl font-semibold ${isDarkMode ? "text-gray-100" : "text-gray-800"}`}>Solana AI Chat</h1>
          </div>
          <button onClick={toggleDarkMode} className="p-2 rounded-full hover:bg-gray-700 transition-colors">
            {isDarkMode ? <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-gray-300" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />}
          </button>
        </div>
        <ClientSideWalletMultiButton className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md w-full transition duration-150 ease-in-out text-xs sm:text-sm md:text-base" />
      </div>

      <div className="flex-1 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
  {messages.length === 0 ? (
    <>
      <DefaultMessages />
      <div className={`mt-8 max-w-full lg:max-w-[70%] p-3 rounded-lg ${isDarkMode ? "bg-gray-700 text-gray-100" : "bg-white text-gray-800"} break-words`}>
        <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? "text-gray-200" : "text-gray-800"}`}>
          Welcome to Solana AI Chatbot!
        </h2>
        <div className="text-xs sm:text-sm md:text-base">
          {formatMessageContent(getWelcomeMessageContent())}
        </div>
      </div>
    </>
  ) : (
    <>
      {messages.map((msg, index) => (
        <div key={index} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-full lg:max-w-[70%] p-3 rounded-lg ${
              msg.sender === "user"
                ? "bg-blue-600 text-white"
                : isDarkMode
                ? "bg-gray-700 text-gray-100"
                : "bg-white text-gray-800"
            } break-words`}
          >
            {msg.content.startsWith("<a") ? (
              <p className="text-xs sm:text-sm md:text-base" dangerouslySetInnerHTML={{ __html: msg.content }}></p>
            ) : (
              <div className="text-xs sm:text-sm md:text-base">{formatMessageContent(msg.content)}</div>
            )}
            {msg.priceData && renderPriceChart(msg.priceData)}
          </div>
        </div>
      ))}
      {isTyping && (
        <div className="flex justify-start">
          <div className={`${isDarkMode ? "bg-gray-700" : "bg-white"} rounded-lg p-3 flex items-center`}>
            <div className="flex space-x-2">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce delay-150"></div>
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce delay-300"></div>
            </div>
          </div>
        </div>
      )}
      {showAirdropAnimation && <AirdropAnimation />}
      {isTransactionPending && (
        <div className="flex justify-center items-center">
          <div className={`${isDarkMode ? "bg-gray-700" : "bg-white"} rounded-lg p-4 flex items-center space-x-2`}>
            <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-green-500 animate-bounce" />
            <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 animate-spin text-blue-600" />
            <span className={`${isDarkMode ? "text-gray-200" : "text-gray-800"} text-xs sm:text-sm md:text-base`}>
              Processing transaction...
            </span>
          </div>
        </div>
      )}
    </>
  )}
  {selectableMessages.length > 0 && (
    <div className="flex flex-wrap justify-start mt-4 space-x-2 space-y-2">
      {selectableMessages.map((msg, index) => (
        <ChatBubble key={index} message={msg} onSelect={handleSelectableMessageClick} />
      ))}
    </div>
  )}
</div>

        <form onSubmit={handleSubmit} className={`p-4 ${isDarkMode ? "bg-gray-800" : "bg-white"} border-t border-gray-700`}>
          <div className="flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className={`flex-1 p-2 text-xs sm:text-sm md:text-base ${isDarkMode ? "bg-gray-700 text-gray-100" : "bg-white text-gray-800"} border border-gray-600 rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
              placeholder={connected ? "Type your message..." : "Please connect your wallet"}
              disabled={!connected || submitting}
            />
            <button
              type="submit"
              className="bg-blue-600 text-white p-2 rounded-r-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition duration-150 ease-in-out"
              disabled={!connected || submitting}
            >
              {submitting ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <SendHorizontal className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Home() {
  const [network, setNetwork] = useState<WalletAdapterNetwork>(WalletAdapterNetwork.Mainnet);
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <ClientSideWalletProvider wallets={wallets}>
        <ChatInterface onNetworkChange={setNetwork} />
      </ClientSideWalletProvider>
    </ConnectionProvider>
  );
}

export default Home;