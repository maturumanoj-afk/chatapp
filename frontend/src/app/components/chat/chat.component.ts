import { Component, OnInit, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, ChatMessage } from '../../services/chat.service';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  public messages: ChatMessage[] = [];
  public activeInput: any | null = null;
  public sessionId: string | null = null;
  public isConnected = false;

  // Form inputs
  public userMessageText = '';
  
  // Custom input states
  public searchFilterText = '';
  public checkboxSelections: Record<string, boolean> = {};
  public rangeMin = 80000;
  public rangeMax = 250000;

  // Component specific states
  public jobOptions: any[] = [];
  public locationOptions: any[] = [];
  public sectorData: any = { superSector: [], subSector: [], otherSector: [] };
  public activeSectorTab: 'superSector' | 'subSector' | 'otherSector' = 'superSector';
  public locationQuery: string = '';

  // Thought logs expansion state
  public expandedThoughts: Record<string, boolean> = {};

  constructor(public chatService: ChatService, private http: HttpClient) {}

  public toggleThoughts(msgId: string): void {
    this.expandedThoughts[msgId] = !this.expandedThoughts[msgId];
  }

  ngOnInit(): void {
    // Load active session from storage if it exists
    let storedSession = localStorage.getItem('chat_session_id');
    if (storedSession === 'undefined' || storedSession === 'null') {
      storedSession = null;
    }
    
    // Connect to WebSocket
    this.chatService.connect(storedSession || undefined);

    // Subscribe to messages
    this.chatService.messages$.subscribe(msgs => {
      this.messages = msgs;
    });

    // Subscribe to active input panels requested by Mastra
    this.chatService.activeInput$.subscribe(input => {
      this.activeInput = input;
      // Initialize states when input panel changes
      if (input) {
        if (input.type === 'select-pc-range') {
          this.rangeMin = input.payload?.min || 50;
          this.rangeMax = input.payload?.max || 60;
        } else if (input.type === 'search-job') {
          this.http.get<any[]>('http://localhost:3000/api/v1/jobs').subscribe(data => this.jobOptions = data);
        } else if (input.type === 'search-location') {
          this.locationQuery = '';
          this.http.get<any[]>('http://localhost:3000/api/v1/locations').subscribe(data => this.locationOptions = data);
        } else if (input.type === 'select-industry') {
          this.http.get<any>('http://localhost:3000/api/v1/sectors').subscribe(data => {
            this.sectorData = data;
            this.activeSectorTab = 'superSector';
            this.checkboxSelections = {};
            // Init all to false
            Object.values(data).flat().forEach((val: any) => this.checkboxSelections[val] = false);
          });
        }
      }
    });

    // Subscribe to Session ID
    this.chatService.sessionId$.subscribe(id => {
      this.sessionId = id;
    });

    // Subscribe to Connection Status
    this.chatService.isConnected$.subscribe(status => {
      this.isConnected = status;
    });
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    try {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    } catch (err) {}
  }

  // Action methods
  public sendTextMessage(): void {
    if (!this.userMessageText.trim()) return;
    this.chatService.sendMessage(this.userMessageText);
    this.userMessageText = '';
  }

  public triggerAnalysisFlow(): void {
    this.chatService.sendMessage('Run compensation analysis');
  }

  public selectChip(option: string): void {
    this.chatService.submitInputResponse('chips', option, `Selected: ${option}`);
  }

  // Filtered search options
  public filterLocations(): void {
    const q = this.locationQuery.toLowerCase();
    this.http.get<any[]>(`http://localhost:3000/api/v1/locations?q=${q}`).subscribe(data => this.locationOptions = data);
  }

  public filterJobs(event: any): void {
    const q = event.target.value.toLowerCase();
    this.http.get<any[]>(`http://localhost:3000/api/v1/jobs?q=${q}`).subscribe(data => this.jobOptions = data);
  }

  public toggleCheckbox(value: string): void {
    this.checkboxSelections[value] = !this.checkboxSelections[value];
  }

  public submitIndustrySelection(): void {
    const selectedValues = Object.keys(this.checkboxSelections).filter(key => this.checkboxSelections[key]);
    if (selectedValues.length === 0) return;
    this.chatService.sendMessage(selectedValues.join(', '));
  }

  public submitJobSelection(jobTitle: string): void {
    this.chatService.sendMessage(jobTitle);
  }

  public submitLocationSelection(city: string): void {
    this.chatService.sendMessage(city);
  }

  public submitPcRangeSelection(): void {
    this.chatService.sendMessage(`${this.rangeMin} - ${this.rangeMax}`);
  }

  public exportData(analysisId: string): void {
    window.open(`http://localhost:3000/api/v1/export/${analysisId}`, '_blank');
  }

  public resetSession(): void {
    this.chatService.clearSession();
  }

  public formatSalary(val: number): string {
    return `$${val.toLocaleString()}`;
  }
}
