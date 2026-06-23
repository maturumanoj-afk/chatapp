# Unified API Schemas: UI <-> API <-> Mastra AI

Based on our discussion, here is the unified schema design that maintains context, roles, and a consistent structure across all three applications (UI, API Gateway, and Mastra AI).

## Core Concepts

1. **`conversationId`**: The overarching session identifier shared across UI, API, and Mastra. The UI can generate this (e.g., UUID) and pass it to the API, or the API generates it and returns it to the UI upon connection.
2. **`threadId`**: Mastra's internal identifier for LLM conversation history. The API receives this from Mastra after the first message and includes it in the `context` for subsequent requests.
3. **`role`**: Identifies the sender (`"user"` or `"assistant"`). 
4. **`context`**: A flexible object to pass contextual metadata (e.g., email, business codes, UI state, threadId) seamlessly from UI to API, and API to Mastra.

---

## 1. UI <====> API Gateway (WebSocket)

### 1.1 Connection (UI -> API)
The UI initiates the WebSocket connection, optionally passing a `conversationId` if resuming a session.

```http
GET ws://localhost:3000/api/v1/chat?conversationId=session_abc123
```

### 1.2 Initial Response (API -> UI)
The API confirms the connection and returns the active `conversationId` (generating one if it wasn't provided).

```json
{
  "type": "init",
  "payload": {
    "conversationId": "session_abc123",
    "status": "connected"
  }
}
```

### 1.3 User Message (UI -> API)
When the user sends a message or interacts with a UI component (like clicking a chip), the UI sends a `chat` frame. The UI can attach any relevant `context`.

```json
{
  "type": "chat",
  "payload": {
    "message": "Run compensation analysis",
    "role": "user",
    "context": {
      "globalProfileId": 410882,
      "smiCode": "SMI-001",
      "surveyCode": "SURV-2024"
    }
  }
}
```

### 1.4 Streaming Responses (API -> UI)
The API streams frames back to the UI as it receives data from Mastra.

**Text Delta Frame:**
```json
{
  "type": "text-delta",
  "payload": {
    "text": "Sure, I am running the compensation analysis for SMI-001..."
  }
}
```

**Component Frame (e.g., Chips):**
```json
{
  "type": "component",
  "payload": {
    "componentType": "chips",
    "data": {
      "options": ["View details", "Cancel analysis"]
    }
  }
}
```

---

## 2. API Gateway <====> Mastra AI (HTTP POST /stream)

When the API Gateway receives a message from the UI, it enriches the `context` with backend-managed data (like the `threadId` from previous interactions) and forwards it to Mastra.

### 2.1 Request (API -> Mastra)
This is a standard HTTP POST request with a JSON body.

```http
POST http://localhost:3001/stream
Content-Type: application/json
```
```json
{
  "message": "Run compensation analysis",
  "role": "user",
  "conversationId": "session_abc123",
  "context": {
    "threadId": "tr_881b7a69a23",
    "globalProfileId": 410882,
    "smiCode": "SMI-001",
    "surveyCode": "SURV-2024"
  }
}
```
> [!NOTE]
> If this is the very first message in the conversation, the API will omit `threadId` from the context. Mastra will create a new thread and return the new `threadId`.

### 2.2 Streaming Response (Mastra -> API)
Mastra responds using Server-Sent Events (SSE). It streams text chunks, UI components, and metadata (like the newly created `threadId`).

```text
event: text-delta
data: {"text": "Sure, I am running the "}

event: text-delta
data: {"text": "compensation analysis for SMI-001..."}

event: component
data: {"componentType": "chips", "data": {"options": ["View details", "Cancel analysis"]}}

event: metadata
data: {"threadId": "tr_881b7a69a23", "agentId": "agent_comp_01", "usage": {"tokens": 45}}

event: finish
data: {"status": "success", "reason": "stop"}
```

> [!TIP]
> **Why `event: metadata`?**
> The `metadata` event allows Mastra to pass backend-specific information (like `threadId` or token usage) back to the API without it being rendered on the UI. The API intercepts this, saves the `threadId` to its database for `session_abc123`, and ignores it when forwarding text-deltas and components to the UI.

---

## Summary of Data Flow

1. **UI** sends `message` + `context` (globalProfileId, UI state).
2. **API** receives it, looks up `session_abc123` in its DB to find the `threadId`.
3. **API** merges `threadId` into the `context` and POSTs to **Mastra**.
4. **Mastra** processes the request using `threadId` for history, and returns SSE stream.
5. **API** parses SSE:
   - If `event: metadata`, update the local DB (save the `threadId`).
6. **UI** renders the text and components in real-time.

---

## 3. Interaction Scenarios

Here are detailed payload examples for the specific interaction flows we support.

### Scenario A: Chips (Single Selection)

**1. Mastra -> API (SSE)**
Mastra determines it needs a single selection and emits a component.
```text
event: component
data: {"componentType": "chips", "data": {"message": "Choose a level:", "options": ["L1", "L2", "L3"]}}
```

**2. API -> UI (WebSocket)**
API maps `componentType` directly to `type` for a flat UI consumption.
```json
{
  "type": "chips",
  "payload": {
    "message": "Choose a level:",
    "options": ["L1", "L2", "L3"]
  }
}
```

**3. UI -> API (WebSocket)**
When the user clicks "L2", the UI sends it as a standard chat message.
```json
{
  "type": "chat",
  "payload": {
    "message": "L2",
    "role": "user",
    "conversationId": "session_abc123"
  }
}
```

### Scenario B: Checkbox (Multiple Selection)

**1. Mastra -> API (SSE)**
```text
event: component
data: {"componentType": "checkbox", "data": {"message": "Select roles:", "options": [{"label": "Frontend", "value": "fe"}, {"label": "Backend", "value": "be"}]}}
```

**2. API -> UI (WebSocket)**
```json
{
  "type": "checkbox",
  "payload": {
    "message": "Select roles:",
    "options": [
      {"label": "Frontend", "value": "fe"},
      {"label": "Backend", "value": "be"}
    ]
  }
}
```

**3. UI -> API (WebSocket)**
When the user selects both and submits, the UI sends a JSON array string as the message.
```json
{
  "type": "chat",
  "payload": {
    "message": "[\"fe\", \"be\"]",
    "role": "user",
    "conversationId": "session_abc123"
  }
}
```

### Scenario C: Range Selector

**1. Mastra -> API (SSE)**
```text
event: component
data: {"componentType": "range-selector", "data": {"message": "Salary bounds:", "min": 50000, "max": 200000}}
```

**2. API -> UI (WebSocket)**
```json
{
  "type": "range-selector",
  "payload": {
    "message": "Salary bounds:",
    "min": 50000,
    "max": 200000
  }
}
```

**3. UI -> API (WebSocket)**
UI submits the chosen bounds as a JSON string.
```json
{
  "type": "chat",
  "payload": {
    "message": "{\"min\": 80000, \"max\": 150000}",
    "role": "user",
    "conversationId": "session_abc123"
  }
}
```

### Scenario D: Background Analysis Job

**1. Mastra -> API (SSE)**
Mastra triggers an asynchronous Databricks job and notifies the API of the pending status.
```text
event: analysis-status
data: {"status": "pending", "jobId": "job_999"}
```

**2. API -> UI (WebSocket) [Pending]**
The API relays this to the UI, while simultaneously starting an internal polling mechanism for `job_999`.
```json
{
  "type": "analysis-status",
  "payload": {
    "status": "pending",
    "jobId": "job_999"
  }
}
```

**3. API -> UI (WebSocket) [Completed]**
When the API detects the background job has finished (via polling its database or receiving a Kafka webhook), it autonomously emits a completion frame to the UI.
```json
{
  "type": "analysis-status",
  "payload": {
    "status": "completed",
    "analysis_data_id": "data_xyz789"
  }
}
```

**4. UI -> API (REST HTTP GET)**
The UI sees completion and fetches the massive visual analytical payload via a standard REST endpoint to avoid bloating the WebSocket.
```http
GET http://localhost:3000/api/v1/analysis/data_xyz789
```
