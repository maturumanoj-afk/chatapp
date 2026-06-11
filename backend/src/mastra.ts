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

// Simulated Agent Logic based on prompt history
async function handleMockAgentStream(message: string, conversationId: string, threadId: string | undefined, res: express.Response) {
  // Mock sending metadata back to API
  const actualThreadId = threadId || `tr_${Math.random().toString(36).substr(2, 9)}`;
  writeSSE(res, 'metadata', {
    threadId: actualThreadId,
    agentId: 'agent_comp_01',
    usage: { tokens: Math.floor(Math.random() * 100) + 10 }
  });

  const session = db.getSession(conversationId);
  const history = session ? session.messages : [];

  // Normalize message
  const msg = message.toLowerCase().trim();

  // Helper to wait
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Determine stage by scanning the history backwards for the last assistant prompt
  let lastAssistantMsg = '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      lastAssistantMsg = history[i].content.toLowerCase();
      break;
    }
  }

  // 1. Trigger Command ALWAYS starts Stage 1
  if (msg.includes('compensation') || msg.includes('analysis') || msg.includes('review') || msg.includes('start')) {
    // Stream Trace: Workflows loading
    await streamMockToolTrace(res, 'agent-workflowSelection', { action: 'list_workflows' }, { status: 'success', options: ['marketpricing', 'benchmarking'] });

    // Stage 1: Ask for levels (Chips)
    const text = "I can help you analyze employee compensation models. Let's start by selecting the organizational levels to include in this review:";
    for (const word of text.split(' ')) {
      writeSSE(res, 'text-delta', { text: word + ' ' });
      await delay(40);
    }
    await delay(200);

    writeSSE(res, 'component', {
      componentType: 'chips',
      data: {
        message: 'Choose one of the levels below to proceed:',
        options: ['L1: Associate', 'L2: Mid-Level', 'L3: Senior', 'L4: Staff', 'L5: Principal', 'All Levels'],
      }
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 2. If the last question was about organizational levels -> Ask for Job Roles (Stage 2)
  else if (lastAssistantMsg.includes('organizational levels')) {
    // Stream Trace: Query Metadata Job Architecture
    await streamMockToolTrace(
      res, 
      'agent-mongodbQueryTool', 
      { datasource: 'mongodb:survey-metadata.jobarchitecture', filters: ['spec_title'], level: message }, 
      { status: 'success', specializations_found: 5, schema: 'survey-metadata' }
    );

    // Stage 2: Ask for Job Roles (Checkbox)
    const text = "Levels recorded. Now, select the specific Engineering job roles you'd like to analyze in this compensation review:";
    for (const word of text.split(' ')) {
      writeSSE(res, 'text-delta', { text: word + ' ' });
      await delay(40);
    }
    await delay(200);

    writeSSE(res, 'component', {
      componentType: 'checkbox',
      data: {
        message: 'Select engineering roles:',
        options: [
          { label: 'Frontend Engineer', value: 'frontend' },
          { label: 'Backend Engineer', value: 'backend' },
          { label: 'Fullstack Engineer', value: 'fullstack' },
          { label: 'Data Engineer', value: 'data' },
          { label: 'DevOps Engineer', value: 'devops' },
        ],
      }
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 3. If the last question was about job roles -> Ask for Salary Range (Stage 3)
  else if (lastAssistantMsg.includes('job roles')) {
    // Stream Trace: Survey Metadata Filter roles
    await streamMockToolTrace(
      res, 
      'agent-surveyMetadataFilter', 
      { selected_roles: message }, 
      { status: 'success', records_matched: 240 }
    );

    // Stage 3: Ask for Salary Range (Range-Selector)
    const text = "Roles registered. To filter the benchmark datasets, please define the base salary range (annual USD) you want to include in the visual report:";
    for (const word of text.split(' ')) {
      writeSSE(res, 'text-delta', { text: word + ' ' });
      await delay(40);
    }
    await delay(200);

    writeSSE(res, 'component', {
      componentType: 'range-selector',
      data: {
        message: 'Select annual base salary bounds (USD):',
        min: 50000,
        max: 400000,
        step: 5000,
        defaultMin: 90000,
        defaultMax: 250000,
      }
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 4. If the last question was about salary range -> Trigger Databricks Analysis Job (Stage 4)
  else if (lastAssistantMsg.includes('base salary range')) {
    // Stream Trace: Databricks benchmarking tool trigger
    await streamMockToolTrace(
      res, 
      'agent-benchmarkingAgent', 
      { prompt: 'crunch_compensation_benchmarks', threadId: conversationId, salary_bounds: message }, 
      { status: 'success', job_triggered: true, target: 'databricks_spark' }
    );

    // Stage 4: Trigger Databricks Analysis Job (Analysis-status)
    const text1 = "Excellent bounds specified. Triggering the Databricks spark job to crunch compensation benchmarks and equity allocations...";
    for (const word of text1.split(' ')) {
      writeSSE(res, 'text-delta', { text: word + ' ' });
      await delay(30);
    }
    await delay(500);

    const text2 = "\nAnalyzing salary records, calculating 25th/50th/75th percentiles, and auditing pay parity metrics...";
    for (const word of text2.split(' ')) {
      writeSSE(res, 'text-delta', { text: word + ' ' });
      await delay(30);
    }
    await delay(300);

    // Create a pending job
    const job = db.createAnalysisJob(conversationId);
    writeSSE(res, 'text-delta', { text: `\n\nJob ID ${job.id} registered. Streaming execution status...` });

    // Wait a moment before notifying completion
    setTimeout(() => {
      // Complete job
      db.updateAnalysisJob(job.id, 'completed', 'mock-compensation-data');
      console.log(`Analysis job ${job.id} completed. Emitting status to UI.`);
    }, 2500);

    writeSSE(res, 'analysis-status', {
      status: 'pending',
      jobId: job.id,
    });
    writeSSE(res, 'finish', { status: 'success', reason: 'stop' });
  }
  // 5. Default chat fallback
  else {
    const text = `Hi there! I am the Virtusa Compensation Assistant. 

I can run deep analytical reviews on base salaries, equity benchmarks, and organizational level models. 

Try typing **"run compensation analysis"** or **"start review"** to see the custom UI panels and Databricks report integration!`;
    
    for (const chunk of text.split('\n')) {
      writeSSE(res, 'text-delta', { text: chunk + '\n' });
      await delay(100);
    }
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
