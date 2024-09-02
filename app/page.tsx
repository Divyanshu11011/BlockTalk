//@ts-nocheck
'use client';

import React, { useState, useMemo, useEffect, useCallback,useRef } from 'react';
import {
  useWallet,
  useConnection,
  ConnectionProvider,
} from '@solana/wallet-adapter-react';
import {
  clusterApiUrl,
  Connection,
  PublicKey,
  VersionedTransaction,
  ParsedInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  SendHorizontal,
  Loader2,
  Menu,
  DollarSign,
  Network,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import ClientSideWalletProvider from '../components/ClientSideWalletProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';

require('@solana/wallet-adapter-react-ui/styles.css');



const ClientSideWalletMultiButton = dynamic(
  () =>
    import('@solana/wallet-adapter-react-ui').then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);



const formatMessageContent = (content: string) => {
  const lines = content.split('\n');
  const formattedContent = [];
  let inTransactionList = false;
  let currentTransaction: string[] = [];

  const formatSpecialTerms = (text: string) => {
    return (
      text
        // Format SOL amounts
        .replace(/(\d+(.\d+)?)\s*SOL/g, '$1 SOL')
        // Format transaction hashes
        .replace(/\b([A-Fa-f0-9]{64})\b/g, '$1')
        // Format Solana addresses and wallet addresses
        .replace(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g, '$1')
        .replace(/\b([A-Fa-f0-9]{64,})\b/g, '<span class="break-all">$1</span>')
        // Format slot numbers
        .replace(/\b(slot \d+)\b/g, '**$1**')
        // Format dates
        .replace(
          /\b(\w+ \d+, \d{4}, at \d{2}:\d{2}:\d{2} UTC)\b/g,
          '_$1_'
        )
        // Format transaction status
        .replace(/\b(successful|Failed)\b/gi, (match) =>
          match.toLowerCase() === 'successful' ? 'successful' : 'Failed'
        )
    );
  };

  const formatTransaction = (transactionLines: string[]) => {
    const [transactionNumber, ...details] = transactionLines;
    return (
      <Card key={transactionNumber} className="p-4 mb-4">
        <h3 className="font-bold text-lg mb-2">{transactionNumber}</h3>
        <div className="grid grid-cols-2 gap-2">
          {details.map((detail, detailIndex) => {
            const [key, value] = detail.split(': ');
            return (
              <React.Fragment key={detailIndex}>
                <span className="font-medium">{key}:</span>
                <span
                  className={`${key === 'Signature' ? 'font-mono text-sm break-all' : ''
                    } ${key === 'Status' && value === 'Success'
                      ? 'text-green-500'
                      : ''
                    } ${key === 'Amount' || key === 'Fee' ? 'font-semibold' : ''
                    }`}
                >
                  {value}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </Card>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('Transaction ') && line.endsWith(':')) {
      if (inTransactionList && currentTransaction.length > 0) {
        formattedContent.push(formatTransaction(currentTransaction));
        currentTransaction = [];
      }
      inTransactionList = true;
      currentTransaction.push(line);
    } else if (inTransactionList && line !== '') {
      currentTransaction.push(line);
    } else if (inTransactionList && line === '') {
      if (currentTransaction.length > 0) {
        formattedContent.push(formatTransaction(currentTransaction));
        currentTransaction = [];
      }
      inTransactionList = false;
    } else {
      if (inTransactionList && currentTransaction.length > 0) {
        formattedContent.push(formatTransaction(currentTransaction));
        currentTransaction = [];
        inTransactionList = false;
      }

      // Handle special cases
      if (line.startsWith('Transaction confirmed!')) {
        formattedContent.push(
          <p key={`line-${i}`} className="mb-2 font-bold text-green-600">
            {line}
          </p>
        );
      } else if (line.startsWith('Signature:')) {
        formattedContent.push(
          <p key={`line-${i}`} className="mb-2">
            <strong>Signature: </strong>
            <code>{line.split(': ')[1]}</code>
          </p>
        );
      } else if (line.startsWith('<a href=')) {
        formattedContent.push(
          <p
            key={`line-${i}`}
            className="mb-2"
            dangerouslySetInnerHTML={{ __html: line }}
          />
        );
      } else if (line.includes('Balance changes')) {
        const [intro, changes] = line.split(':');
        formattedContent.push(
          <div key={`line-${i}`} className="mb-2">
            <p>
              <strong>{intro}:</strong>
            </p>
            <ul className="list-disc list-inside">
              {changes.split(',').map((change, changeIndex) => (
                <li key={changeIndex}>
                  <ReactMarkdown>
                    {formatSpecialTerms(change.trim())}
                  </ReactMarkdown>
                </li>
              ))}
            </ul>
          </div>
        );
      } else {
        formattedContent.push(
          <ReactMarkdown key={`line-${i}`} className="mb-2">
            {formatSpecialTerms(line)}
          </ReactMarkdown>
        );
      }
    }
  }

  if (inTransactionList && currentTransaction.length > 0) {
    formattedContent.push(formatTransaction(currentTransaction));
  }

  return <>{formattedContent}</>;
};

function ChatInterface({
  onNetworkChange,
}: {
  onNetworkChange: (network: WalletAdapterNetwork) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [quoteData, setQuoteData] = useState<PriceData | null>(null);
  const [input, setInput] = useState('');
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [submitting, setSubmitting] = useState(false);
  const [livePrice, setLivePrice] = useState<PriceData | null>(null);
  const [showSwapConfirmation, setShowSwapConfirmation] = useState(false);
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isTransactionPending, setIsTransactionPending] = useState(false);
  const [selectableMessages, setSelectableMessages] = useState<string[]>([]);
  const [showAirdropAnimation, setShowAirdropAnimation] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const AirdropAnimation = () => (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50">
      <Card className="w-64">
        <CardContent className="flex flex-col items-center pt-6">
          <DollarSign className="w-16 h-16 text-green-500 animate-bounce mb-4" />
          <p className="text-lg font-semibold">Airdrop Initiated!</p>
        </CardContent>
      </Card>
    </div>
  );

  useEffect(() => {
    const savedMessages = localStorage.getItem('chatMessages');
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
  
  Check Solana balance on any network (mainnet, devnet, testnet) for your wallet or any specified wallet
  View recent transactions for your wallet or any specified wallet
  Generate transaction summaries for your wallet or any specified wallet
  Send SOL to another address on any network
  Request an airdrop on devnet or testnet
  Get current cryptocurrency prices
  Get quotes for token swaps on Solana mainnet
  Show all token balances in a wallet
  Get detailed information about any specific transaction using its hash
  
  Feel free to ask about any of these operations, and I'll guide you through the process!
  
  Note: I'm currently in beta mode, so you might encounter some bugs. We're continuously working to improve and add new features.
  
  Important: Ensure your Phantom wallet is connected to the same network (mainnet, devnet, or testnet) as the operation you're attempting to perform to avoid transaction failures or conflicts.
  
  For example, you can ask: "swap 0.2 sol to usdc" to get a quote for swapping SOL to USDC on Solana mainnet.`;
  };

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }, [messages]);

  const handleSelectableMessageClick = (message: string) => {
    setInput(message);
    setSelectableMessages([]);
  };

  const handleSwap = async () => {
    if (!connected || !publicKey || !sendTransaction) {
        console.error('Wallet not connected or sendTransaction not available');
        return;
    }

    if (!quoteData) {
        console.error('Quote data is missing');
        const errorMessage: Message = {
            sender: 'bot',
            content: 'Swap failed: Quote data is missing.',
        };
        setMessages((prev) => [...prev, errorMessage]);
        return;
    }

    const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!alchemyApiKey) {
        console.error('Alchemy API key is missing');
        const errorMessage: Message = {
            sender: 'bot',
            content: 'Swap failed: Alchemy API key is missing.',
        };
        setMessages((prev) => [...prev, errorMessage]);
        return;
    }

    const swapConnection = new Connection(`https://solana-mainnet.g.alchemy.com/v2/${alchemyApiKey}`);

    console.log('Network for swap:', swapConnection.rpcEndpoint);
    console.log('Quote data:', quoteData);

    try {
        setIsTransactionPending(true);
        console.log('Preparing swap data...');

        const swapData = {
            quoteResponse: quoteData,
            userPublicKey: publicKey.toString(),
            wrapUnwrapSOL: true,
            useSharedAccounts: false,
            feeAccount: null,
            computeUnitPriceMicroLamports: null,
            asLegacyTransaction: false,
        };

        console.log('Swap data:', swapData);

        console.log('Sending swap request to Jupiter API...');
        const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(swapData),
        });

        if (!swapResponse.ok) {
            const errorData = await swapResponse.json();
            console.error('Swap API error response:', errorData);
            throw new Error(`Swap API error: ${swapResponse.statusText}. Details: ${JSON.stringify(errorData)}`);
        }

        console.log('Received swap response. Parsing result...');
        const swapResult = await swapResponse.json();
        console.log('Swap result:', swapResult);

        if (!swapResult.swapTransaction) {
            throw new Error('Swap transaction is missing in the response');
        }

        console.log('Deserializing transaction...');
        const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

        console.log('Sending transaction...');
        const signature = await sendTransaction(transaction, swapConnection);

        console.log('Transaction sent. Signature:', signature);

        const processingMessage: Message = {
          sender: 'bot',
          content: `
            🚧 Swap Feature Under Development 🚧

            Thank you for your interest in the swap feature. Please note:

            • This feature is currently in development and not fully operational.
            • You may be prompted to sign a transaction, but it will not be processed.
            • The transaction will time out without any actual token swap occurring.
            • No funds will be transferred or deducted from your wallet.

            We appreciate your patience as we work on implementing this feature. Stay tuned for updates!

            If you have any questions, feel free to ask about other available features.
          `,
        };
        setMessages((prev) => [...prev, processingMessage]);
        console.log('Confirming transaction...');
        await confirmSwapTransaction(signature, swapConnection);

        console.log('Transaction confirmed');
        setIsTransactionPending(false);

        const confirmationMessage: Message = {
            sender: 'bot',
            content: `Swap confirmed! Signature: ${signature}`,
        };
        setMessages((prev) => [...prev, confirmationMessage]);

        const explorerLink: Message = {
            sender: 'bot',
            content: `<a href="https://explorer.solana.com/tx/${signature}?cluster=mainnet" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 underline">View transaction on Solana Explorer</a>`,
        };
        setMessages((prev) => [...prev, explorerLink]);
    } catch (error) {
        console.error('Swap error:', error);
        const errorMessage: Message = {
            sender: 'bot',
            content: `Swap failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
    } finally {
        setIsTransactionPending(false);
        setShowSwapConfirmation(false);
    }
};
const confirmSwapTransaction = async (signature: string, connection: Connection) => {
    const startTime = Date.now();
    const timeout = 10000; // 60 seconds timeout

    while (Date.now() - startTime < timeout) {
        console.log('Checking transaction status...');
        const status = await connection.getSignatureStatus(signature);
        console.log('Full status response:', status);
        console.log('Transaction status:', status.value?.confirmationStatus);

        if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
            console.log('Transaction confirmed');
            return true;
        }

        if (status.value?.err) {
            console.error('Transaction error:', status.value.err);
            throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }

        console.log('Waiting 2 seconds before next status check...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for 2 seconds before checking again
    }

    console.error('Transaction confirmation timed out');
    throw new Error('Transaction confirmation timed out');
};
  

  const extractMintAddress = (tokenString: string) => {
    const match = tokenString.match(/\(([^)]+)\)/);
    return match ? match[1] : null;
  };

  const formatRoutePlan = (route: string) => {
    const routes = route.split(' -> ');
    return routes.map((label, index) => ({
      swapInfo: {
        ammKey: `ammKey_${index}`,
        label: label,
        inputMint: extractMintAddress(quoteData!['From']),
        outputMint: extractMintAddress(quoteData!['To']),
        inAmount: quoteData!['Input Amount'].split(' ')[0],
        outAmount: quoteData!['Expected Output'].split(' ')[0],
        feeAmount: '0',
        feeMint: extractMintAddress(quoteData!['From']),
      },
      percent: (index + 1) * 10,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !publicKey) return;

    setSubmitting(true);
    setIsTyping(true);
    setSelectableMessages([]);
    const userMessage: Message = { sender: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      const response = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          walletAddress: publicKey.toBase58(),
        }),
      });

      if (!response.ok) throw new Error('API response was not ok');

      const data = await response.json();
      console.log('full', data);

      console.log('flag', data.transactionDetails?.showSwapConfirmation);

      if (data.network) {
        onNetworkChange(data.network as WalletAdapterNetwork);
      }
      setShowSwapConfirmation(data.showSwapConfirmation || false);
      console.log('Quote Data from API:', data.quoteData);

      if (data.quoteData) {
        setQuoteData(data.quoteData);
        console.log('Quote Data from API:', data.quoteData);
        setShowSwapConfirmation(true);
      }
    
      const botMessage: Message = {
        sender: 'bot',
        content: data.response,
        priceData: data.priceData,
      };
      setMessages((prev) => [...prev, botMessage]);
      setIsTyping(false);

      if (data.priceData) {
        setLivePrice(data.priceData);
        setIsLiveUpdating(true);
      }

      setShowSwapConfirmation(data.showSwapConfirmation || false);

      if (data.transactionDetails) {
        handleTransaction(data.transactionDetails);
      }

      const followUpResponse = await fetch('/api/generatefollowups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastBotMessage: data.response,
        }),
      });

      const followUpData = await followUpResponse.json();

      if (followUpData.followUpMessages) {
        setSelectableMessages(followUpData.followUpMessages);
      }
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: Message = {
        sender: 'bot',
        content: `Error: ${(error as Error).message}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
      setIsTyping(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransaction = useCallback(
    async (transactionDetails: TransactionDetails) => {
      if (!connected || !publicKey || !sendTransaction) {
        console.error('Wallet not connected or sendTransaction not available');
        return;
      }

      setIsTransactionPending(true);
      const pendingMessage: Message = {
        sender: 'bot',
        content: 'Transaction pending. Please sign the transaction in your wallet.',
      };
      setMessages((prev) => [...prev, pendingMessage]);

      let transaction;
      try {
        const transactionBuffer = Buffer.from(transactionDetails.transaction, 'base64');
        transaction = VersionedTransaction.deserialize(transactionBuffer);
      } catch (error) {
        console.error('Error deserializing transaction:', error);
        const errorMessage: Message = {
          sender: 'bot',
          content: `Error preparing transaction: ${error instanceof Error ? error.message : 'Unknown error'
            }`,
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsTransactionPending(false);
        return;
      }

      const networkConnection = new Connection(transactionDetails.connection);

      try {
        const signature = await sendTransaction(transaction, networkConnection);

        const processingMessage: Message = {
          sender: 'bot',
          content: 'Transaction sent. Processing...',
        };
        setMessages((prev) => [...prev, processingMessage]);

        const instructions: ParsedInstruction[] = transaction.message.instructions as ParsedInstruction[];

        if (
          instructions.some((instruction: ParsedInstruction) => {
            if (
              'programId' in instruction &&
              instruction.programId.equals(SystemProgram.programId)
            ) {
              const parsed = instruction as ParsedInstruction & { data?: Buffer };
              if (parsed.data && parsed.data.length >= 4) {
                return parsed.data.readUInt32LE(0) === 2;
              }
            }
            return false;
          })
        ) {
          setShowAirdropAnimation(true);
          setTimeout(() => setShowAirdropAnimation(false), 3000);
        }

        const latestBlockHash = await networkConnection.getLatestBlockhash();
        await networkConnection.confirmTransaction({
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: signature,
        });

        setIsTransactionPending(false);

        const confirmationMessage: Message = {
          sender: 'bot',
          content: `Transaction confirmed! Signature: ${signature}`,
        };
        setMessages((prev) => [...prev, confirmationMessage]);

        const explorerLink: Message = {
          sender: 'bot',
          content: `<a href="https://explorer.solana.com/tx/${signature}?cluster=${transactionDetails.network.toLowerCase()}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 underline">View transaction on Solana Explorer</a>`,
        };
        setMessages((prev) => [...prev, explorerLink]);
      } catch (error) {
        console.error('Transaction error:', error);
        const errorMessage: Message = {
          sender: 'bot',
          content: `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'
            }`,
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsTransactionPending(false);
      }
    },
    [connected, publicKey, sendTransaction]
  );

  const SwapConfirmationButtons: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({
    onConfirm,
    onCancel,
  }) => (
    <div className="flex justify-center space-x-4 mt-4">
      <Button onClick={onConfirm} className="bg-green-500 hover:bg-green-600 text-white">
        ✅ Confirm Swap
      </Button>
      <Button onClick={onCancel} className="bg-blue-500 hover:bg-red-600 text-white">
        ❌ Cancel Swap
      </Button>
    </div>
  );

  const renderPriceChart = (priceData: PriceData) => {
    const chartData = priceData.sparklineData.map((price, index) => ({
      time: index,
      price: price,
    }));

    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{priceData.symbol} Price Chart</CardTitle>
          <CardDescription>
            ${priceData.price.toFixed(2)}
            <span
              className={`ml-2 ${priceData.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
            >
              {priceData.priceChange24h >= 0 ? '▲' : '▼'}{' '}
              {Math.abs(priceData.priceChange24h).toFixed(2)}% (24h)
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `${value}h`}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: isDarkMode ? '#1F2937' : 'white',
                  borderRadius: '6px',
                }}
                labelFormatter={(value) => `Time: ${value}h`}
                formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Price']}
              />
              <CartesianGrid strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-2">
            Last updated: {new Date(priceData.lastUpdated).toLocaleString()}
          </p>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className={`flex flex-col lg:flex-row h-screen ${isDarkMode ? 'dark' : ''}`}>
      <Card className="w-full lg:w-64 lg:h-full">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center">
              <Menu className="w-5 h-5 mr-2" /> BlockTalk 🪙
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClientSideWalletMultiButton className="bg-primary hover:bg-primary/90 text-primary-foreground w-full" />
        </CardContent>
      </Card>

      <div className="flex-1 flex flex-col">
        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 ? (
            <>
              <Card className="mt-8">
                <CardHeader>
                  <CardTitle>Welcome to Solana AI Chatbot!</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm">
                    {formatMessageContent(getWelcomeMessageContent())}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'
                    } mb-4`}
                >
                  <Card
                    className={`max-w-[70%] ${msg.sender === 'user' ? 'bg-primary text-primary-foreground' : ''
                      } overflow-hidden`}
                  >
                    <CardContent className="p-3 overflow-x-auto">
                      <div className="break-words">
                        {msg.sender === 'bot' ? (
                          formatMessageContent(msg.content)
                        ) : (
                          <p className="text-sm">{msg.content}</p>
                        )}
                      </div>
                      {msg.priceData && renderPriceChart(msg.priceData)}
                    </CardContent>
                  </Card>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start mb-4">
                  <Card>
                    <CardContent className="p-3 flex items-center space-x-2">
                      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce delay-150"></div>
                      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce delay-300"></div>
                    </CardContent>
                  </Card>
                </div>
              )}
              {showAirdropAnimation && <AirdropAnimation />}
              {isTransactionPending && (
                <div className="flex justify-center items-center mb-4">
                  <Card>
                    <CardContent className="p-4 flex items-center space-x-2">
                      <DollarSign className="w-6 h-6 text-green-500 animate-bounce" />
                      <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                      <span className="text-sm">Processing transaction...</span>
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
          {selectableMessages.length > 0 && (
            <div className="flex flex-wrap justify-start mt-4 space-x-2 space-y-2">
              {selectableMessages.map((msg, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="h-auto py-1 px-3 text-xs sm:text-sm rounded-full"
                  onClick={() => handleSelectableMessageClick(msg)}
                >
                  {msg}
                </Button>
              ))}
            </div>
          )}
          {showSwapConfirmation && (
            <SwapConfirmationButtons
              onConfirm={handleSwap}
              onCancel={() => {
                console.log('Swap cancelled');
                setShowSwapConfirmation(false);
              }}
            />
          )}
           <div ref={messagesEndRef} />
        </ScrollArea>
        <Card className="m-4">
          <CardContent className="p-2">
            <form onSubmit={handleSubmit} className="flex items-center space-x-2">
              <Input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  connected ? 'Type your message...' : 'Please connect your wallet'
                }
                disabled={!connected || submitting}
                className="flex-1"
              />
              <Button type="submit" disabled={!connected || submitting}>
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <SendHorizontal className="w-4 h-4" />
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Home() {
  const [network, setNetwork] = useState<WalletAdapterNetwork>(
    WalletAdapterNetwork.Mainnet
  );
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
