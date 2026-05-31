/**
 * Core ReAct agent loop — LLM → Tool Call → Repeat.
 * Adapted from Meridian architecture. OpenAI-compatible (OpenRouter by default).
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, ".env"), override: true });
import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import { buildSystemPrompt } from "./prompt.js";
import { executeTool } from "./tools/executor.js";
import toolDefinitions, { SCREENER_TOOLS, DECIDER_TOOLS } from "./tools/definitions.js";
import config from "./config.js";

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY,
  timeout: 5 * 60 * 1000,
});

const DEFAULT_MODEL = process.env.LLM_MODEL || "openai/gpt-4o-mini";

function getToolsForRole(agentType) {
  if (agentType === "SCREENER") {
    return toolDefinitions.filter(t => SCREENER_TOOLS.has(t.function.name));
  }
  if (agentType === "DECIDER") {
    return toolDefinitions.filter(t => DECIDER_TOOLS.has(t.function.name));
  }
  return toolDefinitions;
}

const ONCE_PER_SESSION = new Set(["recommend_buy"]);
const firedOnce = new Set();

export async function agentLoop(goal, {
  maxSteps = config.models.maxSteps,
  agentType = "GENERAL",
  model = null,
  onToolStart = null,
  onToolFinish = null,
} = {}) {
  const systemPrompt = buildSystemPrompt(agentType);
  const providerMode = "system";

  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: goal },
  ];

  let sawToolCall = false;

  for (let step = 0; step < maxSteps; step++) {
    console.log(`  [agent] Step ${step + 1}/${maxSteps}`);

    // Retry on transient errors
    let response;
    const activeModel = model || DEFAULT_MODEL;
    const FALLBACK = "stepfun/step-3.5-flash:free";

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await client.chat.completions.create({
          model: attempt > 1 ? FALLBACK : activeModel,
          messages,
          tools: getToolsForRole(agentType),
          temperature: config.models.temperature,
          max_tokens: config.models.maxTokens,
        });
        break;
      } catch (error) {
        const code = error.status;
        if (code === 429) {
          await new Promise(r => setTimeout(r, 10000 * (attempt + 1)));
          continue;
        }
        if (code === 502 || code === 503 || code === 529) {
          await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }

    if (!response?.choices?.length) {
      throw new Error("API returned no choices");
    }

    const msg = response.choices[0].message;

    // Repair malformed JSON in tool args
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function?.arguments) {
          try {
            JSON.parse(tc.function.arguments);
          } catch {
            try {
              tc.function.arguments = JSON.stringify(JSON.parse(jsonrepair(tc.function.arguments)));
            } catch {
              tc.function.arguments = "{}";
            }
          }
        }
      }
    }

    messages.push(msg);

    // No tool calls → done
    if (!msg.tool_calls?.length) {
      if (!msg.content) {
        messages.pop();
        console.log("  [agent] Empty response, retrying...");
        continue;
      }
      console.log("  [agent] Final answer reached");
      return { content: msg.content };
    }

    sawToolCall = true;

    // Execute tools in parallel
    const toolResults = await Promise.all(msg.tool_calls.map(async (tc) => {
      const name = tc.function.name.replace(/<.*$/, "").trim();
      let args;

      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      // Block once-per-session tools
      if (ONCE_PER_SESSION.has(name) && firedOnce.has(name)) {
        return {
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ blocked: true, reason: `${name} already used this session` }),
        };
      }

      await onToolStart?.({ name, args, step });

      const result = await executeTool(name, args);
      firedOnce.add(name);

      await onToolFinish?.({ name, args, result, step });

      return {
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      };
    }));

    messages.push(...toolResults);
  }

  return { content: "Max steps reached. Check logs for partial results." };
}
