import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface GameStats {
  score: number;
  combo: number;
  level: number;
  state: 'playing' | 'gameover' | 'level-up';
}

export const getSenseiCommentary = async (stats: GameStats): Promise<string> => {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY is not set.");
    return "Precision is the path of the warrior.";
  }

  try {
    let prompt = "";
    if (stats.state === 'level-up') {
      prompt = `You are a wise Ninja Sensei. The student reached level ${stats.level} with a score of ${stats.score}. Give a very short, inspirational, 1-sentence zen wisdom comment.`;
    } else if (stats.state === 'gameover') {
      prompt = `You are a wise Ninja Sensei. The student's journey ended at level ${stats.level} with a score of ${stats.score}. Give a very short, profound, 1-sentence zen comment on their performance and encouragement to try again.`;
    } else {
      prompt = `You are a wise Ninja Sensei. The student is currently at level ${stats.level} with a score of ${stats.score}. Give a very short, 1-sentence zen tip.`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text?.trim() || "The blade must be one with the hand.";
  } catch (error) {
    console.error("Error getting Sensei commentary:", error);
    return "The blade must be one with the hand.";
  }
};
