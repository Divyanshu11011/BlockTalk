//@ts-nocheck
import { NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import OpenAI from "openai";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ParsedTransactionWithMeta,
  Keypair,
} from "@solana/web3.js";
import { getOrca, OrcaPoolConfig } from "@orca-so/sdk";
import Decimal from "decimal.js";
import { TokenListProvider, TokenInfo } from "@solana/spl-token-registry";
import axios from "axios";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import NodeCache from "node-cache";
import { ChartConfiguration, ChartTypeRegistry } from "chart.js";
import { TOKEN_PROGRAM_ID } from "@project-serum/serum/lib/token-instructions";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const priceCache = new NodeCache({ stdTTL: 60 });

const model = new ChatOpenAI({
  modelName: "gpt-3.5-turbo",
  temperature: 0.5,
  openAIApiKey: process.env.OPENAI_API_KEY,
});

const NETWORK_URLS = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

const KNOWN_TOKENS = {
  mainnet: {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  devnet: {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  testnet: {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
};

const memory = new BufferMemory();

const chain = new ConversationChain({ llm: model, memory: memory });

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) {
  throw new Error("Alchemy API Key not found. Please set it in the .env file.");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connection = new Connection(
  `https://solana-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  "confirmed"
);

const testnetConnection = new Connection(
  "https://api.testnet.solana.com",
  "confirmed"
);

const devnetConnection = new Connection(
  `https://solana-devnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  "confirmed"
);

const solanaMainnetTransactionConnection = new Connection(
  "https://api.mainnet-beta.solana.com",
  "confirmed"
);

const solanaTestnetTransactionConnection = new Connection(
  "https://api.testnet.solana.com",
  "confirmed"
);

const solanaDevnetTransactionConnection = new Connection(
  "https://api.devnet.solana.com",
  "confirmed"
);

export async function POST(request: Request) {
  const { message, walletAddress } = await request.json();

  try {
    console.log("Received message:", message);
    console.log("Wallet address:", walletAddress);
    const gptResponse = await processWithGPT(message);
    console.log("GPT response:", gptResponse);

    const result = await performAction(gptResponse, walletAddress);
    console.log(
      "Action result:",
      JSON.stringify(result, getCircularReplacer())
    );

    let finalResponse;
    if (
      result.actionType === "GET_TRANSACTIONS" ||
      result.actionType === "GENERATE_SUMMARY"
    ) {
      finalResponse = await generateHumanReadableResponse(
        result.transactions,
        result.network,
        result.actionType
      );
    } else {
      finalResponse = await generateHumanReadableResponse(
        result,
        result.network || "unknown",
        result.actionType || "unknown"
      );
    }

    console.log("Final response:", finalResponse);

    return NextResponse.json({
      response: finalResponse,
      priceData: result.priceData,
      transactionDetails: result.transaction
        ? {
            transaction: result.transaction
              .serialize({ requireAllSignatures: false })
              .toString("base64"),
            network: result.network,
            connection: result.connection?.rpcEndpoint,
          }
        : null,
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "An error occurred while processing your request." },
      { status: 500 }
    );
  }
}

function getCircularReplacer() {
  const seen = new WeakSet();
  return (key: string, value: any) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
}

async function getTransactionInfo(txHash: string, network: string) {
  let connectionToUse;
  switch (network) {
    case "testnet":
      connectionToUse = testnetConnection;
      break;
    case "devnet":
      connectionToUse = devnetConnection;
      break;
    default:
      connectionToUse = connection;
  }

  try {
    const tx = await connectionToUse.getParsedTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return {
        error: "Transaction not found",
        message: `The requested transaction could not be found on the ${network} network. Please verify the transaction hash and try again.`,
      };
    }

    const summary = {
      signature: txHash,
      blockTime: tx.blockTime
        ? new Date(tx.blockTime * 1000).toISOString()
        : "Unknown",
      slot: tx.slot,
      fee: `${(tx.meta?.fee || 0) / LAMPORTS_PER_SOL} SOL`,
      status: tx.meta?.err ? "Failed" : "Success",
      instructions: tx.transaction.message.instructions.map((inst: any) => {
        if (inst.program) {
          return `Program: ${inst.program}`;
        } else if (inst.parsed) {
          return `Type: ${inst.parsed.type}`;
        } else {
          return "Unknown instruction";
        }
      }),
      accounts: tx.transaction.message.accountKeys.map((account: any) => ({
        pubkey: account.pubkey.toBase58(),
        signer: account.signer,
        writable: account.writable,
      })),
    };

    // Add balance changes if available
    if (tx.meta && tx.meta.postBalances && tx.meta.preBalances) {
      summary.balanceChanges = tx.transaction.message.accountKeys
        .map((account: any, index: number) => ({
          account: account.pubkey.toBase58(),
          change:
            (tx.meta.postBalances[index] - tx.meta.preBalances[index]) /
            LAMPORTS_PER_SOL,
        }))
        .filter((change) => change.change !== 0);
    }

    // Add logs if available
    if (tx.meta && tx.meta.logMessages) {
      summary.logs = tx.meta.logMessages;
    }

    return {
      network: network,
      transactionInfo: summary,
    };
  } catch (error) {
    console.error(`Error fetching transaction info on ${network}:`, error);
    return {
      error: "Error fetching transaction",
      message: `An error occurred while fetching the transaction information on ${network}. Please try again later.`,
      details: error.message,
    };
  }
}

async function processWithGPT(message: string) {
  const prompt = `
  You are a helpful assistant that interprets user requests related to Solana blockchain transactions and cryptocurrency information. Interpret the following user request and classify it into one of these actions: GET_BALANCE, GET_TRANSACTIONS, SEND_TRANSACTION, SWAP_TOKENS, GENERATE_SUMMARY, GET_CRYPTO_PRICE, GET_TESTNET_BALANCE, GET_DEVNET_BALANCE, REQUEST_AIRDROP, SEND_DEVNET_TRANSACTION, SEND_TESTNET_TRANSACTION, or UNKNOWN. Also, extract any relevant parameters. Also, there are only 2 types of wallets that can be there - MY_WALLET and SPECIFIED_WALLET.

Some sample examples are included below for your understanding. Use them to understand in what format you have to classify the requests. Do note that inputs can vary, and you would need to classify as per the best action.

Examples:
User request: "tell me about my last 5 transactions"
Classification: GET_TRANSACTIONS
walletType: MY_WALLET
count: 5
network: mainnet

User request: "Tell me about my last 5 transactions on testnet"
Classification: GET_TRANSACTIONS
walletType: MY_WALLET
count: 5
network: testnet

User request: "Airdrop me 0.5 sol on my testnet"
classification: REQUEST_AIRDROP
walletType: MY_WALLET
amount:0.5
network: testnet

User request: "Send 2 SOL to address Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
Classification: SEND_TRANSACTION
walletType: MY_WALLET
recipient:Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
amount:2

User request: "What's my account balance?"
Classification: GET_BALANCE
walletType: MY_WALLET

User request: "Swap 1 SOL for USDC from my wallet"
Classification: SWAP_TOKENS
walletType: MY_WALLET
fromToken:SOL
toToken:USDC
amount:1

User request: "Generate a summary of my transactions for the last 30 days"
Classification: GENERATE_SUMMARY
walletType: MY_WALLET
days:30

User request: "What's the current price of Bitcoin?"
Classification: GET_CRYPTO_PRICE
symbol:BTC

User request: "What's my testnet balance?"
Classification: GET_TESTNET_BALANCE
walletType: MY_WALLET

User request: "Generate a summary of my transactions for the last 6 months"
Classification: GENERATE_SUMMARY
walletType: MY_WALLET
timePeriod: 6 months

User request: "last 25 transactions of ob2htHLoCu2P6tX7RrNVtiG1mYTas8NGJEVLaFEUngk"
Classification: GET_TRANSACTIONS
walletType: SPECIFIED_WALLET
address: ob2htHLoCu2P6tX7RrNVtiG1mYTas8NGJEVLaFEUngk
count: 25
network: mainnet

User request: "Show me all token balances in my wallet"
Classification: GET_ALL_BALANCES
walletType: MY_WALLET

User request: "tell me about the transaction with hash ywCMhvfUSuBngxKxd1Dz3v8uqW7aooxwV1TNdAjmy7mPutXR6ri5ky8BQp1bmu95LdoKdp3yDpph9oojKD6Fhyq on devnet"
Classification: GET_TRANSACTION_INFO
txHash: ywCMhvfUSuBngxKxd1Dz3v8uqW7aooxwV1TNdAjmy7mPutXR6ri5ky8BQp1bmu95LdoKdp3yDpph9oojKD6Fhyq
network: devnet

Now, interpret this user request: "${message}"`;

  const response = await chain.call({ input: prompt });
  return response.response;
}

async function performAction(action: string, walletAddress: string) {
  const lines = action.split("\n");
  const actionType = lines[0].split(": ")[1];
  const params = lines.slice(1);

  const getParam = (key: string) => {
    const param = params.find((p) =>
      p.toLowerCase().startsWith(key.toLowerCase())
    );
    return param ? param.split(":")[1].trim() : null;
  };

  const walletType = getParam("walletType") || "MY_WALLET";
  let addressToUse =
    walletType === "SPECIFIED_WALLET" ? getParam("address") : walletAddress;

  // If address is still undefined or "unspecified", use the walletAddress
  if (!addressToUse || addressToUse === "unspecified") {
    addressToUse = walletAddress;
  }

  if (!addressToUse) {
    throw new Error("Wallet address is required for this action.");
  }

  let network: "mainnet" | "testnet" | "devnet" = "mainnet";
  if (actionType.includes("TESTNET")) {
    network = "testnet";
  } else if (actionType.includes("DEVNET")) {
    network = "devnet";
  } else {
    network =
      (getParam("network") as "mainnet" | "testnet" | "devnet") || "mainnet";
  }

  switch (actionType) {
    case "GET_BALANCE":
    case "GET_TESTNET_BALANCE":
    case "GET_DEVNET_BALANCE":
      console.log(
        `Fetching balance for address: ${addressToUse} on ${network}`
      );
      const balanceResult = await getBalance(addressToUse, network);
      if ("error" in balanceResult) {
        return balanceResult.error;
      }
      return `Balance on ${balanceResult.network} is ${balanceResult.balance} SOL`;

    case "GET_TRANSACTIONS":
    case "GENERATE_SUMMARY":
      const count = parseInt(getParam("count") || "10");
      console.log(
        `Fetching ${count} transactions for address: ${addressToUse} on ${network}`
      );
      const transactions = await getLastTransactions(
        addressToUse,
        count,
        network
      );
      return { transactions, network, actionType };

    case "GET_ALL_BALANCES":
      console.log(`Fetching all token balances for address: ${addressToUse}`);
      const allBalances = await getAllTokenBalances(addressToUse);
      return { balances: allBalances, actionType: "GET_ALL_BALANCES" };
    case "GET_TRANSACTION_INFO":
      const txHash = getParam("txHash");
      if (txHash) {
        console.log(
          `Fetching details for transaction: ${txHash} on ${network}`
        );
        const txInfo = await getTransactionInfo(txHash, network);
        return {
          transactionInfo: txInfo,
          actionType: "GET_TRANSACTION_INFO",
          network,
        };
      }
      return "Transaction hash is required for this action.";

    case "REQUEST_AIRDROP":
      const airdropAmount = parseFloat(getParam("amount") || "1");
      const airdropNetwork = getParam("network") || "devnet";
      if (airdropNetwork === "mainnet") {
        return "Airdrop is not available on mainnet. Please use devnet or testnet for testing purposes.";
      }
      if (airdropNetwork !== "devnet" && airdropNetwork !== "testnet") {
        return "Invalid network specified. Airdrop is only available on devnet or testnet.";
      }
      const maxAirdrop = airdropNetwork === "devnet" ? 2 : 1;
      if (airdropAmount > maxAirdrop) {
        return `Airdrop request rejected. The maximum allowed airdrop on ${airdropNetwork} is ${maxAirdrop} SOL. Please request ${maxAirdrop} SOL or less.`;
      }
      console.log(
        `Requesting airdrop of ${airdropAmount} SOL to ${addressToUse} on ${airdropNetwork}`
      );
      const airdropResult = await requestAirdrop(
        addressToUse,
        airdropAmount,
        airdropNetwork
      );
      return airdropResult;

    case "SEND_TRANSACTION":
    case "SEND_TESTNET_TRANSACTION":
    case "SEND_DEVNET_TRANSACTION":
      const recipient = getParam("recipient");
      const amount = parseFloat(getParam("amount") || "0");
      if (recipient && amount) {
        console.log(
          `Sending ${amount} SOL to ${recipient} from ${addressToUse} on ${network}`
        );
        const result = await sendTransaction(
          addressToUse,
          recipient,
          amount,
          network
        );
        if (result.error) {
          return result.error;
        }
        return result;
      }
      return `Insufficient parameters for ${actionType}`;

    case "SWAP_TOKENS":
      const fromToken = getParam("fromToken");
      const toToken = getParam("toToken");
      const swapAmount = parseFloat(getParam("amount") || "0");
      if (fromToken && toToken && swapAmount) {
        console.log(
          `Swapping ${swapAmount} ${fromToken} for ${toToken} from ${addressToUse} on ${network}`
        );
        const result = await swapTokens(
          addressToUse,
          fromToken,
          toToken,
          swapAmount,
          network
        );
        if (result.error) {
          return result.error;
        } else {
          return result.message;
        }
      }
      return "Insufficient parameters for SWAP_TOKENS";

    case "GET_CRYPTO_PRICE":
      const symbol = getParam("symbol");
      if (!symbol) {
        return { response: "Error: No cryptocurrency symbol provided." };
      }
      console.log(`Fetching price for ${symbol}`);
      try {
        const priceData = await getCryptoPrice(symbol);
        return {
          response: `The current price of ${
            priceData.symbol
          } is $${priceData.price.toFixed(
            2
          )}. 24h change: ${priceData.priceChange24h.toFixed(2)}%`,
          priceData: priceData,
        };
      } catch (error) {
        return { response: `Error: ${error.message}` };
      }

    default:
      return "I'm sorry, I couldn't understand your request. Could you please rephrase it?";
  }
}

async function requestAirdrop(
  address: string,
  amount: number,
  network: "devnet" | "testnet"
) {
  const publicKey = new PublicKey(address);
  const connection =
    network === "devnet" ? devnetConnection : testnetConnection;

  // Set maximum airdrop limits
  const maxAirdrop = { devnet: 2, testnet: 1 };

  try {
    // Check if requested amount exceeds the limit
    if (amount > maxAirdrop[network]) {
      return `Airdrop request rejected. The maximum allowed airdrop on ${network} is ${maxAirdrop[network]} SOL. Please request ${maxAirdrop[network]} SOL or less.`;
    }

    // Convert SOL to lamports
    const lamports = amount * LAMPORTS_PER_SOL;

    // Request airdrop
    const signature = await connection.requestAirdrop(publicKey, lamports);

    // Confirm transaction with a longer timeout and more robust error handling
    try {
      await connection.confirmTransaction(signature, "confirmed");
      return `Successfully airdropped ${amount} SOL to ${address} on ${network}. Transaction signature: ${signature}`;
    } catch (confirmError) {
      console.error("Error confirming airdrop transaction:", confirmError);
      return `Airdrop request sent, but confirmation failed. Please check the transaction status manually. Signature: ${signature}`;
    }
  } catch (error) {
    console.error(`Error requesting airdrop on ${network}:`, error);
    return `Failed to request airdrop on ${network}. Error: ${error.message}`;
  }
}

async function getSummarizedTransactionInfo(txHash: string) {
  try {
    const connection = new Connection("https://api.mainnet-beta.solana.com");
    const tx = await connection.getParsedTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return {
        error: "Transaction not found",
        message:
          "The requested transaction could not be found on the network. Please verify the transaction hash and try again.",
      };
    }

    const summary = {
      signature: txHash,
      blockTime: tx.blockTime
        ? new Date(tx.blockTime * 1000).toISOString()
        : "Unknown",
      slot: tx.slot,
      fee: `${(tx.meta?.fee || 0) / LAMPORTS_PER_SOL} SOL`,
      status: tx.meta?.err ? "Failed" : "Success",
      instructions: tx.transaction.message.instructions.map(
        (inst: any) => inst.program || "Unknown"
      ),
    };

    return summary;
  } catch (error) {
    console.error("Error fetching transaction info:", error);
    return {
      error: "Error fetching transaction",
      message:
        "An error occurred while fetching the transaction information. Please try again later.",
    };
  }
}

async function getAllTokenBalances(walletAddress: string) {
  try {
    const publicKey = new PublicKey(walletAddress);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );

    const balances = await Promise.all(
      tokenAccounts.value.map(async (tokenAccount) => {
        const mintAddress = tokenAccount.account.data.parsed.info.mint;
        const amount =
          tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;

        // Fetch token metadata
        const tokenMetadata = await getTokenMetadata(mintAddress);

        return {
          token: tokenMetadata.symbol || "Unknown",
          amount: amount,
          decimals: tokenAccount.account.data.parsed.info.tokenAmount.decimals,
          uiAmount: tokenAccount.account.data.parsed.info.tokenAmount.uiAmount,
        };
      })
    );

    // Add SOL balance
    const solBalance = await connection.getBalance(publicKey);
    balances.unshift({
      token: "SOL",
      amount: solBalance,
      decimals: 9,
      uiAmount: solBalance / LAMPORTS_PER_SOL,
    });

    return balances;
  } catch (error) {
    console.error("Error fetching token balances:", error);
    throw error;
  }
}

async function getTokenMetadata(mintAddress: string) {
  try {
    const response = await axios.get(
      `https://public-api.solscan.io/token/meta?tokenAddress=${mintAddress}`
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching token metadata:", error);
    return { symbol: "Unknown" };
  }
}

async function getBalance(
  address: string,
  network: "mainnet" | "testnet" | "devnet" = "mainnet"
) {
  const publicKey = new PublicKey(address);
  let connectionToUse;
  switch (network) {
    case "testnet":
      connectionToUse = testnetConnection;
      break;
    case "devnet":
      connectionToUse = devnetConnection;
      break;
    default:
      connectionToUse = connection;
  }
  try {
    const balance = await connectionToUse.getBalance(publicKey);
    return { balance: balance / LAMPORTS_PER_SOL, address, network };
  } catch (error) {
    console.error(`Error getting balance for ${network}:`, error);
    return {
      error: `Unable to fetch balance for ${network}. Please try again later or contact support.`,
      address,
      network,
    };
  }
}

async function getLastTransactions(
  address: string,
  count: number,
  network: "mainnet" | "testnet" | "devnet" = "mainnet"
) {
  const publicKey = new PublicKey(address);
  let connectionToUse;
  switch (network) {
    case "testnet":
      connectionToUse = testnetConnection;
      break;
    case "devnet":
      connectionToUse = devnetConnection;
      break;
    default:
      connectionToUse = connection;
  }

  try {
    const signatures = await connectionToUse.getSignaturesForAddress(
      publicKey,
      { limit: count }
    );

    if (signatures.length === 0) {
      return `No transactions found for the address ${address} on ${network}`;
    }

    const transactions = await connectionToUse.getParsedTransactions(
      signatures.map((sig) => sig.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    return transactions
      .filter((tx): tx is ParsedTransactionWithMeta => tx !== null)
      .map((tx) => ({
        signature: tx.transaction.signatures[0],
        blockTime: tx.blockTime
          ? new Date(tx.blockTime * 1000).toISOString()
          : "Unknown",
        slot: tx.slot,
        fee:
          tx.meta?.fee !== undefined
            ? `${(tx.meta.fee / LAMPORTS_PER_SOL).toFixed(6)} SOL`
            : "Unknown",
        status: tx.meta?.err ? "Failed" : "Success",
        amount:
          tx.meta?.postBalances[0] !== undefined &&
          tx.meta?.preBalances[0] !== undefined
            ? `${(
                (tx.meta.preBalances[0] - tx.meta.postBalances[0]) /
                LAMPORTS_PER_SOL
              ).toFixed(6)} SOL`
            : "Unknown",
        type: tx.transaction.message.instructions[0]?.program || "Unknown",
      }));
  } catch (error) {
    console.error(
      `Error fetching transactions for ${address} on ${network}:`,
      error
    );
    return `Error fetching transactions for ${address} on ${network}: ${error.message}`;
  }
}

async function sendTransaction(
  fromAddress: string,
  recipientAddress: string,
  amount: number,
  network: "mainnet" | "testnet" | "devnet" = "mainnet"
) {
  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(recipientAddress);

  let connectionToUse;
  switch (network) {
    case "testnet":
      connectionToUse = solanaTestnetTransactionConnection;
      break;
    case "devnet":
      connectionToUse = solanaDevnetTransactionConnection;
      break;
    default:
      connectionToUse = solanaMainnetTransactionConnection;
  }

  // Check the balance before creating the transaction
  const balance = await connectionToUse.getBalance(fromPubkey);
  const balanceInSOL = balance / LAMPORTS_PER_SOL;

  if (balanceInSOL < amount) {
    return {
      error: `Insufficient balance. Your current balance is ${balanceInSOL.toFixed(
        6
      )} SOL, which is less than the requested send amount of ${amount} SOL.`,
      network: network,
    };
  }

  const transaction = new Transaction();

  transaction.add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: amount * LAMPORTS_PER_SOL,
    })
  );

  const { blockhash } = await connectionToUse.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;

  console.log("Preparing transaction on network:", network);
  console.log("Using connection:", connectionToUse.rpcEndpoint);

  console.log("Serializing transaction...");
  const serializedTransaction = transaction
    .serialize({ requireAllSignatures: false })
    .toString("base64");
  console.log(
    "Transaction serialized in sendTransaction:",
    serializedTransaction
  );

  return {
    transaction: transaction,
    message: `Transaction created to send ${amount} SOL from ${fromAddress} to ${recipientAddress} on ${network}.`,
    network: network,
    connection: connectionToUse,
  };
}

async function swapTokens(
  walletAddress: string,
  fromToken: string,
  toToken: string,
  amount: number,
  network: "mainnet" | "testnet" | "devnet"
) {
  try {
    const connection = new Connection(NETWORK_URLS[network], "confirmed");
    const wallet = new PublicKey(walletAddress);
    const swapProgramId = new PublicKey(
      "SwapsVeCiPHMUAtzQWZw7RjsKjgCjhwU55QGu4U1Szw"
    );

    // You need to find or create a swap pool for the token pair
    const tokenSwapStateAccount = new PublicKey("YOUR_SWAP_POOL_ADDRESS");

    const fromTokenPublicKey = new PublicKey(
      KNOWN_TOKENS[network][fromToken.toUpperCase()]
    );
    const toTokenPublicKey = new PublicKey(
      KNOWN_TOKENS[network][toToken.toUpperCase()]
    );

    const tokenSwap = await TokenSwap.loadTokenSwap(
      connection,
      tokenSwapStateAccount,
      swapProgramId,
      wallet
    );

    const swapInstruction = TokenSwap.swapInstruction(
      tokenSwap.tokenSwap,
      tokenSwap.authority,
      wallet,
      fromTokenPublicKey,
      tokenSwap.tokenAccountA,
      tokenSwap.tokenAccountB,
      toTokenPublicKey,
      tokenSwap.poolToken,
      tokenSwap.feeAccount,
      null,
      tokenSwap.swapProgramId,
      TOKEN_PROGRAM_ID,
      amount * Math.pow(10, 9), // Assuming 9 decimals, adjust if needed
      0 // Minimum amount to receive, set to 0 for simplicity
    );

    const transaction = new Transaction().add(swapInstruction);

    return {
      transaction: transaction
        .serialize({ requireAllSignatures: false })
        .toString("base64"),
      message: `Swap transaction created to exchange ${amount} ${fromToken} for ${toToken} on ${network}. This transaction needs to be signed by the user.`,
      network: network,
      connection: connection.rpcEndpoint,
    };
  } catch (error) {
    console.error("Error in swapTokens:", error);
    return { error: `Failed to create swap transaction: ${error.message}` };
  }
}

let tokenList: TokenInfo[] | null = null;

const tokenCache = new NodeCache({ stdTTL: 3600 });

async function getTokenList(
  network: "mainnet" | "testnet" | "devnet"
): Promise<Map<string, string>> {
  const cacheKey = `tokenList_${network}`;
  let tokenList = tokenCache.get<Map<string, string>>(cacheKey);

  if (!tokenList) {
    const response = await axios.get(
      "https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json"
    );
    const tokens = response.data.tokens;

    tokenList = new Map();
    tokens.forEach((token: any) => {
      if (
        token.chainId ===
        (network === "mainnet" ? 101 : network === "testnet" ? 102 : 103)
      ) {
        tokenList.set(token.symbol.toUpperCase(), token.address);
      }
    });

    tokenCache.set(cacheKey, tokenList);
  }

  return tokenList;
}

async function getTokenAddress(
  symbol: string,
  network: "mainnet" | "testnet" | "devnet"
): Promise<string> {
  console.log(`Fetching address for token ${symbol} on ${network}`);
  const tokenList = await getTokenList(network);
  console.log(`Token list for ${network}:`, Array.from(tokenList.entries()));
  const address = tokenList.get(symbol.toUpperCase());

  if (!address) {
    throw new Error(`Token ${symbol} not found for network ${network}`);
  }

  console.log(`Address for ${symbol} on ${network}: ${address}`);
  return address;
}

async function getAvailableTokensForSwap(
  network: "mainnet" | "testnet" | "devnet"
): Promise<string[]> {
  const jupiterApiUrl = "https://quote-api.jup.ag/v6/tokens";
  try {
    const response = await axios.get(jupiterApiUrl, {
      params: {
        env: network === "mainnet" ? undefined : network,
      },
    });
    const tokens = response.data;
    return tokens.map((token: any) => token.symbol);
  } catch (error) {
    console.error(`Error fetching available tokens for ${network}:`, error);
    return [];
  }
}

function generateSummaryFromTransactions(
  transactions: any[],
  days: number,
  network: string
) {
  if (typeof transactions === "string") {
    return transactions;
  }

  const summary = {
    totalTransactions: transactions.length,
    sent: 0,
    received: 0,
    netAmount: 0,
    largestTransaction: { amount: 0, type: "", date: "" },
    mostFrequentTransactionType: "",
  };

  const transactionTypes: { [key: string]: number } = {};

  transactions.forEach((tx) => {
    const amount = parseFloat(tx.amount.split(" ")[0]);
    if (amount > 0) {
      summary.sent++;
      summary.netAmount -= amount;
    } else {
      summary.received++;
      summary.netAmount += Math.abs(amount);
    }

    // Track largest transaction
    if (Math.abs(amount) > Math.abs(summary.largestTransaction.amount)) {
      summary.largestTransaction = {
        amount: amount,
        type: amount > 0 ? "Sent" : "Received",
        date: tx.blockTime,
      };
    }

    // Count transaction types
    transactionTypes[tx.type] = (transactionTypes[tx.type] || 0) + 1;
  });

  // Find most frequent transaction type
  summary.mostFrequentTransactionType = Object.entries(transactionTypes).reduce(
    (a, b) => (a[1] > b[1] ? a : b)
  )[0];

  const recentTransactions = transactions.slice(0, 5);

  const report = `Summary for the last ${days} days on ${network}:

Total Transactions: ${summary.totalTransactions}
Sent: ${summary.sent}
Received: ${summary.received}
Net Amount: ${summary.netAmount.toFixed(4)} SOL

Largest Transaction: ${Math.abs(summary.largestTransaction.amount).toFixed(
    4
  )} SOL ${summary.largestTransaction.type} on ${new Date(
    summary.largestTransaction.date
  ).toLocaleString()}
Most Frequent Transaction Type: ${summary.mostFrequentTransactionType}

Recent Transactions: ${recentTransactions
    .map(
      (tx) =>
        `- ${tx.type}: ${tx.amount} on ${new Date(
          tx.blockTime
        ).toLocaleString()}`
    )
    .join("\n")}

This summary is based on the ${
    transactions.length
  } transactions fetched for the specified time period.`;

  return report;
}

async function generateChart(
  transactions: (ParsedTransactionWithMeta | null)[]
) {
  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 800, height: 400 });

  const data = transactions.reduce((acc, tx) => {
    if (tx && tx.blockTime) {
      const date = new Date(tx.blockTime * 1000).toISOString().split("T")[0];
      acc[date] = (acc[date] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const chartData = {
    labels: Object.keys(data),
    datasets: [
      {
        label: "Transactions per day",
        data: Object.values(data),
        fill: false,
        borderColor: "rgb(75, 192, 192)",
        tension: 0.1,
      },
    ],
  };

  const configuration: ChartConfiguration<
    keyof ChartTypeRegistry,
    number[],
    string
  > = {
    type: "line",
    data: chartData,
    options: {},
  };

  const image = await chartJSNodeCanvas.renderToBuffer(configuration);
  return image.toString("base64");
}

async function getTransactionHistory(address, days = 30) {
  try {
    const response = await axios.get(
      "https://api.solscan.io/account/transaction",
      {
        params: {
          address: address,
          limit: 50, // Adjust as needed
        },
      }
    );

    const transactions = response.data.data.slice(0, days);

    let summary = {
      total: transactions.length,
      sent: 0,
      received: 0,
      netAmount: 0,
    };

    let recentTransactions = transactions.map((tx) => {
      const isSent = tx.src === address;
      const amount = tx.lamport / 1e9; // Convert lamports to SOL

      if (isSent) {
        summary.sent++;
        summary.netAmount -= amount;
      } else {
        summary.received++;
        summary.netAmount += amount;
      }

      return {
        type: isSent ? "Sent" : "Received",
        amount: amount,
        date: new Date(tx.blockTime * 1000).toLocaleString(),
        signature: tx.txHash,
      };
    });

    return { summary, recentTransactions };
  } catch (error) {
    console.error("Error fetching transaction history:", error);
    return { error: "Failed to fetch transaction history" };
  }
}

async function getCryptoPrice(symbol: string) {
  const cacheKey = `price_${symbol.toLowerCase()}`;
  const cachedData = priceCache.get(cacheKey);
  if (cachedData) {
    return cachedData;
  }

  try {
    const response = await axios.get(
      `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=USD&limit=24`,
      { timeout: 5000 }
    );

    if (!response.data || !response.data.Data || !response.data.Data.Data) {
      throw new Error("Invalid response from CryptoCompare");
    }

    const historicalData = response.data.Data.Data;
    const currentPrice = historicalData[historicalData.length - 1].close;
    const sparklineData = historicalData.map((dataPoint) => dataPoint.close);
    const priceChange24h =
      ((currentPrice - sparklineData[0]) / sparklineData[0]) * 100;

    const result = {
      symbol: symbol.toUpperCase(),
      price: currentPrice,
      priceChange24h: priceChange24h,
      sparklineData: sparklineData,
      lastUpdated: new Date().toISOString(),
    };

    console.log(`Price fetched from CryptoCompare`);
    priceCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`Error fetching from CryptoCompare:`, error);
    throw new Error(`Unable to fetch price for ${symbol}`);
  }
}

async function getCryptoPriceFromCryptoCompare(symbol: string) {
  const [priceResponse, historyResponse] = await Promise.all([
    axios.get(
      `https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=USD`,
      { timeout: 5000 }
    ),
    axios.get(
      `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=USD&limit=24`,
      { timeout: 5000 }
    ),
  ]);

  if (!priceResponse.data || !priceResponse.data.USD) {
    throw new Error("Invalid response from CryptoCompare for current price");
  }

  if (
    !historyResponse.data ||
    !historyResponse.data.Data ||
    !historyResponse.data.Data.Data
  ) {
    throw new Error("Invalid response from CryptoCompare for historical data");
  }

  const currentPrice = priceResponse.data.USD;
  const sparklineData = historyResponse.data.Data.Data.map(
    (dataPoint) => dataPoint.close
  );

  // Calculate 24h change
  const priceChange24h =
    ((currentPrice - sparklineData[0]) / sparklineData[0]) * 100;

  return {
    symbol: symbol.toUpperCase(),
    price: currentPrice,
    priceChange24h: priceChange24h,
    sparklineData: sparklineData,
    lastUpdated: new Date().toISOString(),
  };
}

async function getCryptoPriceFromBinance(symbol: string) {
  const response = await axios.get(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
    { timeout: 5000 }
  );
  if (!response.data || !response.data.price) {
    throw new Error("Invalid response from Binance");
  }
  return {
    symbol: symbol.toUpperCase(),
    price: parseFloat(response.data.price),
    lastUpdated: new Date().toISOString(),
  };
}

async function getCryptoPriceFromCoinbase(symbol: string) {
  const response = await axios.get(
    `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,
    { timeout: 5000 }
  );
  if (!response.data || !response.data.data || !response.data.data.amount) {
    throw new Error("Invalid response from Coinbase");
  }
  return {
    symbol: symbol.toUpperCase(),
    price: parseFloat(response.data.data.amount),
    lastUpdated: new Date().toISOString(),
  };
}

async function generateHumanReadableResponse(
  result: any,
  network: string,
  action: string
) {
  let resultString = "";
  let fullTransactionList = "";
  let finalResponse = "";

  if (action === "GET_ALL_BALANCES") {
    result.balances.forEach((balance: any) => {
      resultString += `${balance.token}: ${balance.uiAmount}\n`;
    });
  } else if (action === "GET_TRANSACTION_INFO") {
    if (result.error) {
      resultString = `Error: ${result.message}`;
    } else if (
      result.transactionInfo &&
      result.transactionInfo.transactionInfo
    ) {
      const txInfo = result.transactionInfo.transactionInfo;
      resultString = `Transaction Details on ${network}: 
Signature: ${txInfo.signature}
Block Time: ${txInfo.blockTime}
Slot: ${txInfo.slot}
Fee: ${txInfo.fee}
Status: ${txInfo.status}
Instructions: ${
        Array.isArray(txInfo.instructions)
          ? txInfo.instructions.join(", ")
          : JSON.stringify(txInfo.instructions)
      }
Accounts Involved: ${txInfo.accounts.map((acc: any) => acc.pubkey).join(", ")}
Balance Changes: ${txInfo.balanceChanges
        .map((change: any) => `${change.account}: ${change.change} SOL`)
        .join(", ")}
${txInfo.logs ? `Logs: ${txInfo.logs.join("\n")}` : ""}`;
    } else {
      resultString = "Unable to process transaction information.";
    }
  } else if (
    Array.isArray(result) &&
    result.length > 0 &&
    "signature" in result[0]
  ) {
    // This is a transaction list
    fullTransactionList = result
      .map(
        (tx, index) => `Transaction ${index + 1}:
Signature: ${tx.signature}
Time: ${tx.blockTime}
Status: ${tx.status}
Fee: ${tx.fee}
Amount: ${tx.amount}
Type: ${tx.type}`
      )
      .join("\n");

    resultString = `Summary of ${result.length} transactions on the ${network} network.`;
  } else if (typeof result === "string") {
    resultString = result;
  } else {
    resultString = JSON.stringify(result, getCircularReplacer(), 2);
  }

  const prompt = `You are a helpful assistant that explains Solana blockchain transactions and cryptocurrency information in simple terms. Convert the following data into a human-readable format, keeping in mind that this information is from the ${network} network:

${resultString}

Provide a clear and concise explanation of the information or action described in the data. Keep your tone helpful and professional. Include all the data you received without missing anything. You don't have to mention that you are explicitly showing the data in "human readable format". Conclude with an invitation for the user to ask for further assistance if needed.`;

  const response = await chain.call({ input: prompt });
  console.log("\n Action type is", action);
  console.log(fullTransactionList);

  // For GET_TRANSACTIONS and GENERATE_SUMMARY, append the full transaction list
  if (action === "GET_TRANSACTIONS" || action === "GENERATE_SUMMARY") {
    finalResponse = `${response.response}\n\nHere is the full list of transactions:\n${fullTransactionList}`;
  } else {
    finalResponse = response.response;
  }

  return finalResponse;
}
