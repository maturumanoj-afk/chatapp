import * as fs from 'fs';
import * as path from 'path';
import { ChatSession, ChatMessage, AnalysisJob, AnalysisData } from './types';

const DB_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DB_DIR, 'db.json');

interface Schema {
  chat_sessions: Record<string, ChatSession>;
  analysis_jobs: Record<string, AnalysisJob>;
  analysis_data: Record<string, AnalysisData>;
}

function initDb(): Schema {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const defaultData: Schema = {
      chat_sessions: {},
      analysis_jobs: {},
      analysis_data: {
        'mock-compensation-data': {
          id: 'mock-compensation-data',
          summary: 'Detailed benchmark salary review for engineering departments. Software Engineer average base compensation shows a steady 6.5% growth YoY. Equity grants remain highly concentrated in L4+ roles.',
          charts: [
            { label: 'L1: Associate', min: 70000, max: 95000, average: 82000 },
            { label: 'L2: Mid-Level', min: 95000, max: 130000, average: 112000 },
            { label: 'L3: Senior', min: 130000, max: 180000, average: 155000 },
            { label: 'L4: Staff', min: 180000, max: 240000, average: 210000 },
            { label: 'L5: Principal', min: 240000, max: 320000, average: 285000 },
          ],
          table: [
            { role: 'Frontend Engineer', level: 'L2: Mid-Level', salaryMin: 98000, salaryMax: 125000 },
            { role: 'Backend Engineer', level: 'L2: Mid-Level', salaryMin: 102000, salaryMax: 130000 },
            { role: 'Fullstack Engineer', level: 'L3: Senior', salaryMin: 135000, salaryMax: 175000 },
            { role: 'Data Engineer', level: 'L3: Senior', salaryMin: 140000, salaryMax: 185000 },
            { role: 'DevOps Engineer', level: 'L4: Staff', salaryMin: 185000, salaryMax: 230000 },
          ],
        },
      },
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
    return defaultData;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read database, resetting...', err);
    return { chat_sessions: {}, analysis_jobs: {}, analysis_data: {} };
  }
}

function writeDb(data: Schema) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  getSession(sessionId: string): ChatSession | undefined {
    const data = initDb();
    return data.chat_sessions[sessionId];
  },

  createSession(userId: string, sessionId?: string): ChatSession {
    const data = initDb();
    const id = sessionId || `session_${Math.random().toString(36).substr(2, 9)}`;
    const newSession: ChatSession = {
      session_id: id,
      user_id: userId,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    data.chat_sessions[id] = newSession;
    writeDb(data);
    return newSession;
  },

  saveSession(session: ChatSession): void {
    const data = initDb();
    data.chat_sessions[session.session_id] = session;
    writeDb(data);
  },

  updateSessionThreadId(sessionId: string, threadId: string): void {
    const data = initDb();
    const session = data.chat_sessions[sessionId];
    if (session) {
      session.thread_id = threadId;
      writeDb(data);
    }
  },

  appendMessage(sessionId: string, message: ChatMessage): void {
    const data = initDb();
    const session = data.chat_sessions[sessionId];
    if (session) {
      session.messages.push(message);
      writeDb(data);
    }
  },

  createAnalysisJob(sessionId: string): AnalysisJob {
    const data = initDb();
    const id = `job_${Math.random().toString(36).substr(2, 9)}`;
    const newJob: AnalysisJob = {
      id,
      session_id: sessionId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    data.analysis_jobs[id] = newJob;
    writeDb(data);
    return newJob;
  },

  updateAnalysisJob(jobId: string, status: 'pending' | 'completed' | 'failed', dataId?: string): void {
    const data = initDb();
    const job = data.analysis_jobs[jobId];
    if (job) {
      job.status = status;
      if (dataId) {
        job.analysis_data_id = dataId;
      }
      writeDb(data);
    }
  },

  getAnalysisJob(jobId: string): AnalysisJob | undefined {
    const data = initDb();
    return data.analysis_jobs[jobId];
  },

  getAnalysisData(dataId: string): AnalysisData | undefined {
    const data = initDb();
    return data.analysis_data[dataId];
  },

  saveAnalysisData(analysisData: AnalysisData): void {
    const data = initDb();
    data.analysis_data[analysisData.id] = analysisData;
    writeDb(data);
  },
};
