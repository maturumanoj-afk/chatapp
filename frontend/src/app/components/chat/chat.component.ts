import { Component, OnInit, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, ChatMessage } from '../../services/chat.service';

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

  // Thought logs expansion state
  public expandedThoughts: Record<string, boolean> = {};

  constructor(private chatService: ChatService) {}

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
        if (input.type === 'range-selector') {
          this.rangeMin = input.payload.defaultMin || input.payload.min;
          this.rangeMax = input.payload.defaultMax || input.payload.max;
        } else if (input.type === 'checkbox') {
          this.checkboxSelections = {};
          input.payload.options.forEach((opt: any) => {
            this.checkboxSelections[opt.value] = false;
          });
        } else if (input.type === 'search') {
          this.searchFilterText = '';
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
  public getFilteredSearchOptions(): any[] {
    if (!this.activeInput || this.activeInput.type !== 'search') return [];
    const query = this.searchFilterText.toLowerCase();
    return this.activeInput.payload.options.filter((opt: string) => 
      opt.toLowerCase().includes(query)
    );
  }

  public selectSearchOption(option: string): void {
    this.chatService.submitInputResponse('search', option, `Selected search filter: ${option}`);
  }

  public toggleCheckbox(value: string): void {
    this.checkboxSelections[value] = !this.checkboxSelections[value];
  }

  public submitCheckboxSelection(): void {
    const selectedValues = Object.keys(this.checkboxSelections).filter(
      key => this.checkboxSelections[key]
    );

    if (selectedValues.length === 0) return;

    const labels = this.activeInput.payload.options
      .filter((opt: any) => selectedValues.includes(opt.value))
      .map((opt: any) => opt.label)
      .join(', ');

    this.chatService.submitInputResponse('checkbox', selectedValues, `Selected roles: ${labels}`);
  }

  public submitRangeSelection(): void {
    const value = { min: this.rangeMin, max: this.rangeMax };
    this.chatService.submitInputResponse(
      'range-selector', 
      value, 
      `Salary limit set: $${this.rangeMin.toLocaleString()} - $${this.rangeMax.toLocaleString()} USD`
    );
  }

  public resetSession(): void {
    this.chatService.clearSession();
  }

  public formatSalary(val: number): string {
    return `$${val.toLocaleString()}`;
  }
}
