import express from 'express';
import cors from 'cors';
import { db } from './db';
import { WSFrame } from './types';

// We check if environment variables are set for a real LLM.
// If not, or if MOCK_MODE is enabled, we fall back to a rich simulation of the agent loop.
const useMock = process.env.MOCK_MODE !== 'false' || (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.MASTRA_PORT || 3001;

// Define helper to write SSE lines
function writeSSE(res: express.Response, type: string, payload: any) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// Define helper to write detailed agent tracing frames
function writeSSETrace(res: express.Response, type: string, toolName: string, toolCallId: string, payload: any) {
  const data = {
    runId: 'run_' + Math.random().toString(36).substr(2, 9),
    from: 'AGENT',
    toolName,
    toolCallId,
    payload,
  };
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Helper to stream a detailed tool call lifecycle (delta -> final call -> output)
async function streamMockToolTrace(
  res: express.Response,
  toolName: string,
  args: any,
  output: any
) {
  const toolCallId = 'call_' + Math.random().toString(36).substr(2, 9);
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // 1. Tool Call Delta (stream argument tokens)
  writeSSETrace(res, 'tool-call-delta', toolName, toolCallId, { argsTextDelta: JSON.stringify(args).slice(0, 15) });
  await delay(100);
  writeSSETrace(res, 'tool-call-delta', toolName, toolCallId, { argsTextDelta: JSON.stringify(args).slice(15) });
  await delay(100);
  writeSSETrace(res, 'tool-input-streaming-end', toolName, toolCallId, {});
  await delay(50);
  
  // 2. Tool Call Finalized
  writeSSETrace(res, 'tool-call', toolName, toolCallId, { toolCallId, toolName, args });
  await delay(400); // Simulate background database execution latency
  
  // 3. Tool Output Delivered
  writeSSETrace(res, 'tool-output', toolName, toolCallId, { output });
  await delay(200);
}

async function handleMockAgentStream(message: string, conversationId: string, threadId: string | undefined, res: express.Response) {
  const actualThreadId = threadId || `tr_${Math.random().toString(36).substr(2, 9)}`;
  writeSSE(res, 'metadata', {
    threadId: actualThreadId,
    agentId: 'agent_comp_01',
    usage: { tokens: Math.floor(Math.random() * 100) + 10 }
  });

  const session = db.getSession(conversationId);
  const history = session ? session.messages : [];
  const msg = message.toLowerCase().trim();
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  let lastAssistantMsg = '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      lastAssistantMsg = history[i].content.toLowerCase();
      break;
    }
  }

  // 1. Initial Prompt
  if (msg.includes('market pricing analysis') || msg.includes('new analysis')) {
    const text = "Understood. Now accessing TRS 2024 data for Acme Corp. Please enter a job specialization in the job finder below.";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }
    
    writeSSE(res, 'component', {
      componentType: 'search-job'
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 2. Job Selected -> Ask Refinements
  else if (lastAssistantMsg.includes('job specialization')) {
    const text = "Before I do the analysis, would you like to apply any refinements?";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }
    
    writeSSE(res, 'component', {
      componentType: 'chips',
      data: { options: ['Industry : Super Sector', 'Location', 'Revenue', 'Position Class', 'All Data'] }
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 3. User selects "Industry : Super Sector"
  else if (msg.includes('industry')) {
    const text = "Understood! What refinement would you like to do under Industries? Select the Industry from the list below";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }
    
    writeSSE(res, 'component', {
      componentType: 'select-industry'
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 4. Industry selected -> Ask Refinements again
  else if (lastAssistantMsg.includes('select the industry from the list below')) {
    const text = "Got it! Added refinement for Industry. Would you like to add more refinement?";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }
    
    writeSSE(res, 'component', {
      componentType: 'chips',
      data: { options: ['Industry : Super Sector', 'Location', 'Revenue', 'Position Class', 'No, Proceed with current selection'] }
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 5. User selects "Location"
  else if (msg.includes('location')) {
    const text = "Understood! Enter a city in the city search below";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }
    
    writeSSE(res, 'component', {
      componentType: 'search-location'
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 6. Location selected -> Ask Refinements again
  else if (lastAssistantMsg.includes('enter a city')) {
    const text = "Got it! Added refinement for location only for Boston. Would you like to add more refinement?";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }
    
    writeSSE(res, 'component', {
      componentType: 'chips',
      data: { options: ['Industry : Super Sector', 'Location', 'Revenue', 'Position Class', 'No, Proceed with current selection'] }
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 7. User selects "Position Class"
  else if (msg.includes('position class')) {
    const text = "Understood! Please provide the position class range.";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }
    
    writeSSE(res, 'component', {
      componentType: 'select-pc-range',
      data: { min: 50, max: 60 }
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 8. PC Range selected -> Run Analysis
  else if (lastAssistantMsg.includes('position class range')) {
    const text = "Got it! Working on the analysis for Acme Corp with 2025 Bulgaria TRS and refining with revenue with over $500M. Kindly wait\n\nHere's the detailed information for your Analysis";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }

    const job = db.createAnalysisJob(conversationId);
    setTimeout(() => {
      db.updateAnalysisJob(job.id, 'completed', 'mock-compensation-data');
    }, 2000);

    writeSSE(res, 'analysis-status', {
      status: 'pending',
      jobId: job.id,
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // Default start
  else {
    const text = "Sure, Lets begin with the new analysis. What would you like to do?";
    for (const word of text.split(' ')) { writeSSE(res, 'text-delta', { text: word + ' ' }); await delay(20); }
    writeSSE(res, 'component', {
      componentType: 'chips',
      data: { options: ['Market Pricing Analysis', 'Benchmarking'] }
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
}

app.post('/stream', async (req, res) => {
  const { message, conversationId, role, context } = req.body;

  if (!message || !conversationId) {
    res.status(400).json({ error: 'message and conversationId are required' });
    return;
  }

  // Set headers for SSE stream
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Ensure headers are flushed

  console.log(`Mastra: Handling stream request for session ${conversationId}, message: "${message}"`);

  if (useMock) {
    await handleMockAgentStream(message, conversationId, context?.threadId, res);
  } else {
    // Under a real Mastra setup:
    // import { Mastra } from '@mastra/core';
    // ...
    // Since we are mocking the LLM provider for the POC workspace, we fallback gracefully here.
    await handleMockAgentStream(message, conversationId, context?.threadId, res);
  }

  res.end();
});

app.listen(PORT, () => {
  console.log(`[Mastra Agent] Service running on http://localhost:${PORT} (SSE Mock Mode: ${useMock})`);
});
