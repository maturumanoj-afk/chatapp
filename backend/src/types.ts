export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  components?: Array<{
    type: 'chips' | 'search' | 'checkbox' | 'range-selector' | 'analysis';
    payload: any;
  }>;
}

export interface ChatSession {
  session_id: string;
  user_id: string;
  thread_id?: string;
  messages: ChatMessage[];
  createdAt: string;
}

export interface AnalysisData {
  id: string;
  summary: string;
  charts: Array<{
    label: string;
    min: number;
    max: number;
    average: number;
  }>;
  table: Array<{
    role: string;
    level: string;
    salaryMin: number;
    salaryMax: number;
  }>;
}

export interface AnalysisJob {
  id: string;
  session_id: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  analysis_data_id?: string;
}

// WS Frame Types
export type WSFrameType =
  | 'init'
  | 'text-delta'
  | 'chips'
  | 'search'
  | 'checkbox'
  | 'range-selector'
  | 'analysis-status'
  | 'finish'
  | 'error'
  | 'chat'
  | 'input-response';

export interface WSFrame {
  type: WSFrameType;
  payload: any;
}
