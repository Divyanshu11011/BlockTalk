interface Window {
    Jupiter: any;
  }

  type PriceData = {
    symbol: string;
    price: number;
    priceChange24h: number;
    sparklineData: number[];
    lastUpdated: string;
    From?: string;
    To?: string;
    "Input Amount"?: string;
    "Expected Output"?: string;
    "Minimum Output Amount"?: string;
    "Price Impact"?: string;
    Route?: string;
    inputMint?: string;
    outputMint?: string;
    inAmount?: string;
    outAmount?: string;
    otherAmountThreshold?: string;
    priceImpactPct?: number;
    routePlan?: any[];
  };
  
  type Message = {
    sender: "user" | "bot"
    content: string
    priceData?: PriceData
    quoteData?: any
    isSwapConfirmation?: boolean
    inputAmount?: number
    outputAmount?: number
    actionType?: string
  }

  type QuoteData = {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    platformFee: null | any; // Update this if you know the specific structure
    priceImpactPct: string;
    routePlan: Array<{
      swapInfo: {
        ammKey: string;
        label: string;
        inputMint: string;
        outputMint: string;
        inAmount: string;
        outAmount: string;
        feeAmount: string;
        feeMint: string;
      };
      percent: number;
    }>;
  };
  
  type TransactionDetails = {
    transaction: string | Uint8Array | Transaction;
    connection: string;
    network: string;
  };

  type SwapConfirmationButtonsProps = {
    onConfirm: () => void;
    onCancel: () => void;
  };

  type SwapConfirmation = {
    message: string;
    options: Array<{ label: string; value: string }>;
    transactionDetails: TransactionDetails;
  };