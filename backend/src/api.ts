import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import url from 'url';
import { db } from './db';
import { WSFrame, ChatMessage } from './types';
import dotenv from 'dotenv';
import Fuse from 'fuse.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Request & Response Logging Middleware
app.use((req, res, next) => {
  if (!req.url.startsWith('/api')) return next();
  
  console.log(`\n=========================================`);
  console.log(`[API REQUEST] ${req.method} ${req.url}`);
  if (Object.keys(req.query).length > 0) console.log(`[API QUERY]`, req.query);
  if (Object.keys(req.body).length > 0) console.log(`[API BODY]`, req.body);
  
  const originalJson = res.json;
  res.json = function (body) {
    console.log(`[API RESPONSE] ${res.statusCode}`);
    console.log(`[API PAYLOAD]`, JSON.stringify(body, null, 2).substring(0, 500) + (JSON.stringify(body).length > 500 ? '\n... (truncated)' : ''));
    console.log(`=========================================\n`);
    return originalJson.call(this, body);
  };
  
  next();
});
const PORT = process.env.PORT || 3000;
const MASTRA_URL = `http://localhost:${process.env.MASTRA_PORT || 3001}/stream`;

// REST Endpoint: Get analysis data
app.get('/api/v1/analysis/:id', (req, res) => {
  const dataId = req.params.id;
  console.log(`REST: Fetching analysis data for ID: ${dataId}`);
  const data = db.getAnalysisData(dataId);
  if (!data) {
    res.status(404).json({ error: 'Analysis data not found' });
    return;
  }
  res.json(data);
});

// Mock DB matching the MongoDB Schema for jobs
const MOCK_JOB_HIERARCHY = {
  families: [
    {
      id: "AFS",
      name: "Administration, Facilities & Secretarial",
      subFamilies: [
        {
          id: "01",
          name: "Administration & Secretarial",
          specializations: [
            { id: "021", name: "Executive Secretary/Executive Assistant", sampleSize: { incs: 261 } },
            { id: "022", name: "Administrative Support", sampleSize: { incs: 150 } }
          ]
        },
        {
          id: "02",
          name: "Facilities Management",
          specializations: [
            { id: "031", name: "Facilities Operations", sampleSize: { incs: 80 } },
            { id: "032", name: "Workplace Services", sampleSize: { incs: 40 } }
          ]
        }
      ]
    },
    {
      id: "IT",
      name: "Engineering & IT",
      subFamilies: [
        {
          id: "10",
          name: "Software Engineering",
          specializations: [
            { id: "101", name: "Application Development & Maintenance", sampleSize: { incs: 140 } },
            { id: "102", name: "Mobile & Web Application Development", sampleSize: { incs: 85 } },
            { id: "103", name: "Development Engineering - Sp 1", sampleSize: { incs: 42 } },
            { id: "104", name: "Development Engineering - Sp 2", sampleSize: { incs: 38 } },
            { id: "105", name: "IT Software Development & Operations (DevOps)", sampleSize: { incs: 50 } }
          ]
        },
        {
          id: "11",
          name: "Research & Development",
          specializations: [
            { id: "111", name: "AI & Machine Learning Research", sampleSize: { incs: 25 } },
            { id: "112", name: "Backend Systems Engineering", sampleSize: { incs: 60 } },
            { id: "113", name: "Frontend Interface Engineering", sampleSize: { incs: 70 } },
            { id: "114", name: "Research & Development", sampleSize: { incs: 90 } }
          ]
        }
      ]
    }
  ]
};

// Flatten specializations for fuse.js searching
const FLATTENED_SPECIALIZATIONS: any[] = [];
MOCK_JOB_HIERARCHY.families.forEach(f => {
  f.subFamilies.forEach(sf => {
    sf.specializations.forEach(sp => {
      FLATTENED_SPECIALIZATIONS.push({
        id: sp.id,
        title: sp.name,
        records: sp.sampleSize.incs,
        type: 'Specialization'
      });
    });
  });
});

const fuse = new Fuse(FLATTENED_SPECIALIZATIONS, {
  keys: ['title'],
  threshold: 0.3, // Fuzzy matching threshold
  includeScore: true
});

// REST Endpoints for UI Components
app.get('/api/v1/jobs/hierarchy', (req, res) => {
  const surveyCode = req.query.surveyCode as string;
  console.log(`[Mock API] Fetching hierarchy for survey: ${surveyCode}`);
  res.json({
    categories: [
      {
        name: "Job Family",
        initialTitles: [
          { title: "Administration, Facilities & Secretarial", records: 450 },
          { title: "Engineering & Science", records: 820 },
          { title: "Finance & Accounting", records: 310 }
        ]
      },
      {
        name: "Sub-Family",
        initialTitles: [
          { title: "Software Engineering", records: 250 },
          { title: "Facilities Management", records: 120 },
          { title: "Tax & Treasury", records: 80 }
        ]
      },
      {
        name: "Specialization",
        initialTitles: [
          { title: "Application Development & Maintenance", records: 140 },
          { title: "AI & Machine Learning Research", records: 25 },
          { title: "Backend Systems Engineering", records: 60 }
        ]
      },
      { name: "Career Stream", initialTitles: [] },
      { name: "Career Level", initialTitles: [] },
      { name: "Job Title", initialTitles: [] }
    ]
  });
});

app.get('/api/v1/jobs', (req, res) => {
  const query = (req.query.q as string || '').toLowerCase();
  const surveyCode = req.query.surveyCode as string;
  const title = req.query.title as string;
  
  console.log(`[Mock API] Searching jobs - Query: "${query}", Title: "${title}", Survey: "${surveyCode}"`);
  
  if (!query) {
    const totalRecords = FLATTENED_SPECIALIZATIONS.reduce((sum, item) => sum + item.records, 0);
    res.json({ totalRecords, query, results: FLATTENED_SPECIALIZATIONS });
    return;
  }

  const searchResults = fuse.search(query);
  const matchedItems = searchResults.map(r => r.item);
  const totalRecords = matchedItems.reduce((sum, item) => sum + item.records, 0);

  res.json({ totalRecords, query, results: matchedItems });
});

app.get('/api/v1/locations', (req, res) => {
  const query = (req.query.q as string || '').toLowerCase();
  const allLocations = [
    { city: 'Boston', state: 'MA' },
    { city: 'New York', state: 'NY' },
    { city: 'San Francisco', state: 'CA' },
    { city: 'Austin', state: 'TX' },
    { city: 'Seattle', state: 'WA' }
  ];
  const filtered = query ? allLocations.filter(l => l.city.toLowerCase().includes(query)) : allLocations;
  res.json(filtered);
});

app.get('/api/v1/sectors', (req, res) => {
  res.json({
    superSector: [
      'Banking & Financial Services', 'Chemicals', 'Consumer Goods', 
      'Energy', 'Health Care Services', 'Life Sciences', 'Logistics', 
      'Mining & Metals', 'Other Manufacturing', 'Other Non-Manufacturing', 
      'Retail & Wholesale', 'Service (Non-Financial)', 'Transportation Equipment'
    ],
    subSector: ['Software', 'Hardware', 'Networking'],
    otherSector: ['Non-Profit', 'Government']
  });
});

app.get('/api/v1/export/:id', (req, res) => {
  const dataId = req.params.id;
  const data = db.getAnalysisData(dataId);
  if (!data) {
    res.status(404).json({ error: 'Analysis data not found' });
    return;
  }
  
  // Generate CSV
  let csv = 'Role,Seniority,Base Salary Min,Base Salary Max\n';
  data.table.forEach(row => {
    // Quote strings to prevent commas from breaking columns
    csv += `"${row.role}","${row.level}",${row.salaryMin},${row.salaryMax}\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=analysis_${dataId}.csv`);
  res.send(csv);
});

// Create HTTP server to share with WebSocket
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ noServer: true });

// Handle upgrade request
server.on('upgrade', (request, socket, head) => {
  const parsedUrl = url.parse(request.url || '', true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/v1/chat') {
    // 1. Validate auth headers
    const authHeader = request.headers['authorization'];
    const mssoHeader = request.headers['x-msso-session'];
    
    console.log(`WS Upgrade: Validating auth headers. Authorization: ${authHeader || 'None'}, X-MSSO-Session: ${mssoHeader || 'None'}`);
    
    // In a real application, you'd verify JWT or Okta session. 
    // Here we log the headers and allow connection.
    if (!authHeader && !mssoHeader) {
      console.warn('WS Upgrade: No authentication headers provided (Authorization or X-MSSO-Session). Proceeding for POC...');
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (ws: WebSocket, request) => {
  const parsedUrl = url.parse(request.url || '', true);
  let sessionId = parsedUrl.query.conversationId as string || parsedUrl.query.session_id as string;
  if (sessionId === 'undefined' || sessionId === 'null') {
    sessionId = '';
  }

  console.log(`WS: Connected. Session ID query param: ${sessionId || 'None'}`);

  // 2. Load or create session
  let session;
  if (sessionId) {
    session = db.getSession(sessionId);
    if (!session) {
      console.log(`WS: Session ${sessionId} not found, creating new one`);
      session = db.createSession('user_poc', sessionId);
    }
  } else {
    session = db.createSession('user_poc');
    sessionId = session.session_id;
  }

  // 3. Send init frame back to UI
  const initFrame: WSFrame = {
    type: 'init',
    payload: { conversationId: sessionId, status: 'connected' },
  };
  ws.send(JSON.stringify(initFrame));

  // Handle incoming messages
  ws.on('message', async (data) => {
    try {
      const frame: WSFrame = JSON.parse(data.toString());
      console.log(`WS: Received frame type "${frame.type}"`, frame.payload);

      if (frame.type === 'chat') {
        const { message, role, context, conversationId, session_id } = frame.payload;
        const targetSessionId = conversationId || session_id || sessionId;
        
        if (!message || !targetSessionId) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Missing message or session info' } }));
          return;
        }

        const session = db.getSession(targetSessionId);
        const threadId = session?.thread_id;
        const mergedContext = { ...context, threadId };

        // Save user message to DB
        const userMsg: ChatMessage = {
          id: `msg_${Math.random().toString(36).substr(2, 9)}`,
          role: role || 'user',
          content: message,
          timestamp: new Date().toISOString(),
        };
        db.appendMessage(targetSessionId, userMsg);

        // Forward to Mastra via HTTP SSE stream
        try {
          const response = await fetch(MASTRA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, role: role || 'user', conversationId: targetSessionId, context: mergedContext }),
          });

          if (!response.ok) {
            throw new Error(`Mastra stream error: ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error('Mastra stream returned empty body');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let assistantContent = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // keep incomplete line

            let currentEvent = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim();
                if (!dataStr) continue;

                try {
                  const dataPayload = JSON.parse(dataStr);
                  
                  if (currentEvent === 'metadata') {
                    if (dataPayload.threadId) {
                      db.updateSessionThreadId(targetSessionId, dataPayload.threadId);
                    }
                  } else if (currentEvent === 'component') {
                    // Send to UI mapping componentType directly to type
                    ws.send(JSON.stringify({ type: dataPayload.componentType, payload: dataPayload.data }));
                  } else if (currentEvent === 'analysis-status') {
                    ws.send(JSON.stringify({ type: 'analysis-status', payload: dataPayload }));
                    if (dataPayload.status === 'pending') {
                      monitorAnalysisJob(dataPayload.jobId, ws);
                    }
                  } else {
                    ws.send(JSON.stringify({ type: currentEvent, payload: dataPayload }));
                  }

                  // Track assistant content for saving to DB later
                  if (currentEvent === 'text-delta') {
                    assistantContent += dataPayload.text;
                  }

                } catch (parseErr) {
                  console.error('Error parsing SSE line:', line, parseErr);
                }
              }
            }
          }

          // Save assistant message to DB
          if (assistantContent.trim()) {
            const assistantMsg: ChatMessage = {
              id: `msg_${Math.random().toString(36).substr(2, 9)}`,
              role: 'assistant',
              content: assistantContent,
              timestamp: new Date().toISOString(),
            };
            db.appendMessage(targetSessionId, assistantMsg);
          }

        } catch (streamErr: any) {
          console.error('Error streaming from Mastra:', streamErr);
          ws.send(JSON.stringify({ type: 'error', payload: { message: `Mastra connection failed: ${streamErr.message}` } }));
        }
      }
    } catch (err) {
      console.error('Error processing WS message:', err);
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON payload' } }));
    }
  });

  ws.on('close', () => {
    console.log(`WS: Connection closed for session ${sessionId}`);
  });
});

// Monitor simulated background Databricks jobs in the DB
function monitorAnalysisJob(jobId: string, ws: WebSocket) {
  console.log(`API: Monitoring job ${jobId}`);
  const interval = setInterval(() => {
    const job = db.getAnalysisJob(jobId);
    if (!job) {
      clearInterval(interval);
      return;
    }

    if (job.status === 'completed') {
      console.log(`API: Job ${jobId} completed! Notifying UI.`);
      const completedFrame: WSFrame = {
        type: 'analysis-status',
        payload: {
          status: 'completed',
          analysis_data_id: job.analysis_data_id,
        },
      };
      ws.send(JSON.stringify(completedFrame));
      clearInterval(interval);
    } else if (job.status === 'failed') {
      console.log(`API: Job ${jobId} failed.`);
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Analysis job execution failed in Databricks' } }));
      clearInterval(interval);
    }
  }, 500);
}

server.listen(PORT, () => {
  console.log(`[API Gateway] Server running on http://localhost:${PORT}`);
});
