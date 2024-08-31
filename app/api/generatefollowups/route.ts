import { NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";

const model = new ChatOpenAI({
  modelName: "gpt-3.5-turbo",
  temperature: 0.2,
  openAIApiKey: process.env.OPENAI_API_KEY,
});

const memory = new BufferMemory();

const chain = new ConversationChain({
  llm: model,
  memory: memory,
});

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
Given the bot's last response, generate 2-3 follow-up questions or actions that the user might ask or perform next, ensuring they are relevant to the actions listed above.

Bot's last response: "${lastBotMessage}"

Your task is to generate only the follow-up questions or actions. Avoid any suffix, prefix,numbering  or additional text. The follow-up messages should be explicit and specific. For instance:

If the question is about the price of a cryptocurrency, mention the specific asset (whats the current price of SOLANA).
If inquiring about wallet balance, specify the network (e.g., "Check my SOL balance on devnet").
If inquiring about sending transaction , specify wallet like - send 0.2 sol to C1Q85yjUtPQookfxbAFzJo9whF7nnN5RqduDFviZ9FVZ on devnet
Suggested follow-up questions or actions:
`;

    const aiResponse = await chain.call({ input: prompt });

    console.log("AI response:", aiResponse); 

    if (!aiResponse || !aiResponse.response) {
      throw new Error("AI response is undefined or invalid.");
    }

    const followUpMessages = aiResponse.response.split("\n").filter((line: string) => line.trim().length > 0);

    console.log("Generated follow-up messages:", followUpMessages);

    return NextResponse.json({ followUpMessages });
  } catch (error) {
    console.error("Error generating follow-ups:", error);
    return NextResponse.json({ error: "Failed to generate follow-up messages." }, { status: 500 });
  }
}
