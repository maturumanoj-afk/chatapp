import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  components?: Array<{
    type: 'chips' | 'search' | 'checkbox' | 'range-selector' | 'analysis';
    payload: any;
  }>;
  traces?: Array<{
    type: string;
    toolName: string;
    toolCallId: string;
    timestamp: string;
    payload: any;
    completed?: boolean;
  }>;
}

export interface WSFrame {
  type: string;
  payload: any;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private socket: WebSocket | null = null;
  private wsUrl = 'ws://localhost:3000/api/v1/chat';
  private apiUrl = 'http://localhost:3000/api/v1';

  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  public messages$: Observable<ChatMessage[]> = this.messagesSubject.asObservable();

  private activeInputSubject = new BehaviorSubject<any | null>(null);
  public activeInput$: Observable<any | null> = this.activeInputSubject.asObservable();

  private analysisResultSubject = new Subject<any>();
  public analysisResult$: Observable<any> = this.analysisResultSubject.asObservable();

  private sessionIdSubject = new BehaviorSubject<string | null>(null);
  public sessionId$: Observable<string | null> = this.sessionIdSubject.asObservable();

  private isConnectedSubject = new BehaviorSubject<boolean>(false);
  public isConnected$: Observable<boolean> = this.isConnectedSubject.asObservable();

  private currentAssistantMessage: ChatMessage | null = null;

  constructor(private http: HttpClient) {}

  public connect(sessionId?: string) {
    if (this.socket) {
      this.socket.close();
    }

    const url = sessionId ? `${this.wsUrl}?conversationId=${sessionId}` : this.wsUrl;
    console.log(`Connecting to WebSocket: ${url}`);
    
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      console.log('WebSocket connection opened');
      this.isConnectedSubject.next(true);
    };

    this.socket.onmessage = (event) => {
      this.handleIncomingFrame(event.data);
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.isConnectedSubject.next(false);
    };

    this.socket.onclose = () => {
      console.log('WebSocket connection closed');
      this.isConnectedSubject.next(false);
    };
  }

  private handleIncomingFrame(dataStr: string) {
    try {
      const frame: any = JSON.parse(dataStr);
      console.log('Received frame:', frame);

      switch (frame.type) {
        case 'init':
          const sid = frame.payload.conversationId;
          this.sessionIdSubject.next(sid);
          localStorage.setItem('chat_session_id', sid);
          break;

        case 'tool-call-delta':
        case 'tool-call':
        case 'tool-output':
        case 'tool-input-streaming-end':
          this.appendAssistantTrace(frame);
          break;

        case 'text-delta':
          this.appendAssistantToken(frame.payload.text);
          break;

        case 'chips':
        case 'search':
        case 'checkbox':
        case 'range-selector':
        case 'search-job':
        case 'search-location':
        case 'select-industry':
        case 'select-pc-range':
          // Set active input options for user input footer
          this.activeInputSubject.next({
            type: frame.type,
            payload: frame.payload
          });
          break;

        case 'analysis-status':
          if (frame.payload.status === 'completed') {
            const dataId = frame.payload.analysis_data_id;
            this.fetchAnalysisData(dataId).subscribe({
              next: (data) => {
                this.appendAnalysisMessage(data);
              },
              error: (err) => console.error('Error fetching analysis data:', err)
            });
          } else {
            // Processing status update
            this.appendAssistantToken('\n*[Job Status: Databricks processing job active...]*\n');
          }
          break;

        case 'finish':
          this.finalizeAssistantMessage();
          break;

        case 'error':
          this.appendAssistantToken(`\n*[Error: ${frame.payload.message}]*\n`);
          this.finalizeAssistantMessage();
          break;
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }

  private appendAssistantTrace(frame: any) {
    const messages = this.messagesSubject.value;

    if (!this.currentAssistantMessage) {
      this.currentAssistantMessage = {
        id: `msg_${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        traces: []
      };
      this.messagesSubject.next([...messages, this.currentAssistantMessage]);
    }

    if (!this.currentAssistantMessage.traces) {
      this.currentAssistantMessage.traces = [];
    }

    const traces = this.currentAssistantMessage.traces;
    const existing = traces.find(t => t.toolCallId === frame.toolCallId);

    if (existing) {
      if (frame.type === 'tool-call-delta') {
        if (frame.payload && frame.payload.argsTextDelta) {
          existing.payload.argsTextDelta = (existing.payload.argsTextDelta || '') + frame.payload.argsTextDelta;
        }
      } else if (frame.type === 'tool-call') {
        existing.payload.args = frame.payload.args;
        existing.type = 'tool-call';
      } else if (frame.type === 'tool-output') {
        existing.payload.output = frame.payload.output;
        existing.completed = true;
        existing.type = 'tool-output';
      }
    } else {
      traces.push({
        type: frame.type,
        toolName: frame.toolName,
        toolCallId: frame.toolCallId,
        timestamp: new Date().toISOString(),
        payload: frame.payload ? { ...frame.payload } : {},
        completed: frame.type === 'tool-output'
      });
    }

    this.messagesSubject.next([...messages]);
  }

  private appendAssistantToken(text: string) {
    const messages = this.messagesSubject.value;

    if (!this.currentAssistantMessage) {
      this.currentAssistantMessage = {
        id: `msg_${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString()
      };
      this.messagesSubject.next([...messages, this.currentAssistantMessage]);
    }

    this.currentAssistantMessage.content += text;
    this.messagesSubject.next([...messages]);
  }

  private finalizeAssistantMessage() {
    this.currentAssistantMessage = null;
  }

  private appendAnalysisMessage(analysisData: any) {
    const messages = this.messagesSubject.value;
    
    // Create an assistant message bubble containing the analytical data component
    const analysisMessage: ChatMessage = {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      role: 'assistant',
      content: 'I have compiled the analytical benchmarks and compensation metrics. Here is the visual report generated by Databricks:',
      timestamp: new Date().toISOString(),
      components: [
        {
          type: 'analysis',
          payload: analysisData
        }
      ]
    };

    this.messagesSubject.next([...messages, analysisMessage]);
    this.activeInputSubject.next(null); // Clear any pending input panels
  }

  public sendMessage(text: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error('Cannot send message, WebSocket is not open');
      return;
    }

    const sessionId = this.sessionIdSubject.value;
    if (!sessionId) return;

    // Append client-side message for instantaneous UI feel
    const userMsg: ChatMessage = {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };
    this.messagesSubject.next([...this.messagesSubject.value, userMsg]);

    const frame: WSFrame = {
      type: 'chat',
      payload: {
        message: text,
        role: 'user',
        conversationId: sessionId,
        context: {
          email: 'myemail@email.com',
          smiCode: 'SMI-001',
          surveyCode: 'SURV-2024'
        }
      }
    };
    
    this.socket.send(JSON.stringify(frame));
    this.activeInputSubject.next(null); // Reset active inputs when user enters a manual message
  }

  public submitInputResponse(inputType: string, value: any, displayLabel: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const sessionId = this.sessionIdSubject.value;
    if (!sessionId) return;

    // Append the user's action into the chat history for conversational flow
    const userMsg: ChatMessage = {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: displayLabel,
      timestamp: new Date().toISOString()
    };
    this.messagesSubject.next([...this.messagesSubject.value, userMsg]);

    // Send back formatted text payload matching stage expectations
    const frame: WSFrame = {
      type: 'chat',
      payload: {
        message: JSON.stringify(value),
        role: 'user',
        conversationId: sessionId,
        context: {
          email: 'myemail@email.com',
          smiCode: 'SMI-001',
          surveyCode: 'SURV-2024'
        }
      }
    };

    this.socket.send(JSON.stringify(frame));
    this.activeInputSubject.next(null); // Clear active input panel
  }

  public fetchAnalysisData(dataId: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/analysis/${dataId}`);
  }

  public clearSession() {
    localStorage.removeItem('chat_session_id');
    this.messagesSubject.next([]);
    this.activeInputSubject.next(null);
    this.sessionIdSubject.next(null);
    this.connect();
  }
}
