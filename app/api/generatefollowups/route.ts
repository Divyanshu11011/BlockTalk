import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Check if the API key is defined
const apiKey = process.env.NEXT_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("NEXT_PUBLIC_GEMINI_API_KEY is not defined in the environment variables.");
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

export async function POST(request: Request) {
  const { lastBotMessage } = await request.json();

  try {
    console.log("Received last bot message:", lastBotMessage);  

    const prompt = `
You are a helpful assistant that suggests precise follow-up questions based on the previous bot message. The user interacts with a system that supports the following actions related to the Solana blockchain and cryptocurrency:

1) Checking the balance of a wallet on a specific network (mainnet, testnet, or devnet).
2) Retrieving the last few transactions from a wallet.
3) Sending SOL to another wallet on a specific network (mainnet, testnet, or devnet).
4) Checking the current price of a specific cryptocurrency.
Given the bot's last response, generate 2-3 follow-up questions or actions that the user might ask or perform next, ensuring strictly they are similar to the actions listed above and not any other question that is not provided in list at all !.

Bot's last response: "${lastBotMessage}"

Your task is to generate only the follow-up questions or actions. Avoid any suffix, prefix,numbering  or additional text and when generating questions about transactions - generate for solana. The follow-up messages should be explicit and specific. For instance:

If the question is about the price of a cryptocurrency, mention the specific asset (whats the current price of SOLANA).
If inquiring about wallet balance, specify the network (e.g., "Check my SOL balance on devnet").
If inquiring about sending transaction , specify wallet like - send 0.2 sol to C1Q85yjUtPQookfxbAFzJo9whF7nnN5RqduDFviZ9FVZ on devnet
If inquiring for swaps then only suggest swap 0.4 sol to usdc (no other asset other than usdc should be used).
Suggested follow-up questions or actions:

`;

    const result = await model.generateContent(prompt);
    const aiResponse = await result.response;

    console.log("AI response:", aiResponse); 

    if (!aiResponse) {
      throw new Error("AI response is undefined or invalid.");
    }

    const followUpMessages = aiResponse.text().split("\n").filter((line: string) => line.trim().length > 0);

    console.log("Generated follow-up messages:", followUpMessages);

    return NextResponse.json({ followUpMessages });
  } catch (error) {
    console.error("Error generating follow-ups:", error);
    return NextResponse.json({ error: "Failed to generate follow-up messages." }, { status: 500 });
  }
}