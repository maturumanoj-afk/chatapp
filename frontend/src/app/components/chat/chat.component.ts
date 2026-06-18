import { Component, OnInit, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, ChatMessage } from '../../services/chat.service';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

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
  public jobSearchMode: 'categories' | 'search' = 'categories';
  public jobCategories: any[] = [];
  public jobSearchResults: any[] = [];
  public jobTotalRecords: number = 0;
  public selectedJobTitle: string = '';
  public activeCategory: any | null = null;
  private searchSubject = new Subject<string>();
  
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
    
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(query => {
      this.executeJobSearch(query);
    });

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
          this.jobSearchMode = 'categories';
          this.searchFilterText = '';
          const surveyCode = this.chatService.surveyCode;
          this.http.get<any>(`${environment.apiUrl}/jobs/hierarchy?surveyCode=${surveyCode}`).subscribe(data => {
            this.jobCategories = data.categories;
          });
        } else if (input.type === 'search-location') {
          this.locationQuery = '';
          this.http.get<any[]>(`${environment.apiUrl}/locations`).subscribe(data => this.locationOptions = data);
        } else if (input.type === 'select-industry') {
          this.http.get<any>(`${environment.apiUrl}/sectors`).subscribe(data => {
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
  public filterLocations(event: any): void {
    const q = event.target.value.toLowerCase();
    this.http.get<any[]>(`${environment.apiUrl}/locations?q=${q}`).subscribe(data => this.locationOptions = data);
  }

  public filterJobs(event: any): void {
    const query = event.target.value;
    if (query.trim().length > 0) {
      this.jobSearchMode = 'search';
      this.searchSubject.next(query);
    } else {
      if (this.activeCategory) {
        this.jobSearchMode = 'search';
        this.jobTotalRecords = this.activeCategory.initialTitles.reduce((sum: number, item: any) => sum + item.records, 0);
        this.jobSearchResults = [...this.activeCategory.initialTitles];
      } else {
        this.jobSearchMode = 'categories';
      }
    }
  }

  private executeJobSearch(query: string): void {
    const surveyCode = this.chatService.surveyCode;
    const title = this.activeCategory ? this.activeCategory.name : '';
    
    this.http.get<any>(`${environment.apiUrl}/jobs?surveyCode=${surveyCode}&title=${encodeURIComponent(title)}&q=${encodeURIComponent(query)}`).subscribe(data => {
      this.jobTotalRecords = data.totalRecords;
      this.jobSearchResults = data.results;
    });
  }

  public toggleCheckbox(value: string): void {
    this.checkboxSelections[value] = !this.checkboxSelections[value];
  }

  public submitIndustrySelection(): void {
    const selectedValues = Object.keys(this.checkboxSelections).filter(key => this.checkboxSelections[key]);
    if (selectedValues.length === 0) return;
    this.chatService.sendMessage(selectedValues.join(', '));
  }

  public submitJobSelection(): void {
    if (this.selectedJobTitle) {
      this.chatService.sendMessage(this.selectedJobTitle);
    }
  }

  public selectCategory(cat: any): void {
    this.activeCategory = cat;
    this.jobSearchMode = 'search';
    this.searchFilterText = '';
    this.selectedJobTitle = '';
    
    // Set initial data
    this.jobTotalRecords = cat.initialTitles.reduce((sum: number, item: any) => sum + item.records, 0);
    this.jobSearchResults = [...cat.initialTitles];
  }

  public goBackToCategories(): void {
    this.jobSearchMode = 'categories';
    this.searchFilterText = '';
    this.activeCategory = null;
    this.selectedJobTitle = '';
  }

  public submitLocationSelection(city: string): void {
    this.chatService.sendMessage(city);
  }

  public submitPcRangeSelection(): void {
    this.chatService.sendMessage(`${this.rangeMin} - ${this.rangeMax}`);
  }

  public viewAnalysisDetails(analysisId: string): void {
    // In a real app, this would probably open a modal or route to a detailed view
    // For this POC, we can simulate downloading or viewing the raw data
    console.log(`User wants to view details for ${analysisId}`);
    window.open(`${environment.apiUrl}/export/${analysisId}`, '_blank');
  }

  public resetSession(): void {
    this.chatService.clearSession();
  }

  public formatSalary(val: number): string {
    return `$${val.toLocaleString()}`;
  }
}
