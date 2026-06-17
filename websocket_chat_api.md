# WebSocket API Specification: `/api/v1/chat`

This document outlines the **current, existing configuration** for the WebSocket connection between the Angular UI and the Node API Gateway. It details the exact JSON frames exchanged back and forth.

---

## 1. Connection Initialization

**Endpoint:** `ws://localhost:3000/api/v1/chat`
**Query Parameters:** 
- `conversationId` (Optional): Passed by the UI when resuming an existing session.

When the connection successfully opens, the API Gateway immediately sends an `init` frame to the UI to confirm the active session ID.

**Response Frame (API -> UI):**
```json
{
  "type": "init",
  "payload": {
    "conversationId": "session_a1b2c3",
    "status": "connected"
  }
}
```

---

## 2. Request Frames (UI -> API)

Currently, the UI sends only one type of frame to the server: the `chat` frame. This frame is sent whenever the user types a manual message OR when the user clicks/submits a UI component.

**Important:** Note the use of `globalProfileId` in the context payload, aligning with the MongoDB schema.

**Request Frame:**
```json
{
  "type": "chat",
  "payload": {
    "message": "Market Pricing Analysis",
    "role": "user",
    "conversationId": "session_a1b2c3",
    "context": {
      "globalProfileId": 410882,
      "smiCode": "SMI-001",
      "surveyCode": "SURV-2024"
    }
  }
}
```

---

## 3. Response Frames (API -> UI)

As the API Gateway receives streamed data from the Mastra AI, it wraps the data in standard WebSocket frames and forwards them to the UI.

### A. Text Stream (`text-delta`)
Sent rapidly chunk-by-chunk as the AI generates conversational text.
```json
{
  "type": "text-delta",
  "payload": {
    "text": "Sure, I am accessing TRS data..."
  }
}
```

### B. Decoupled Components (`search-job`, `search-location`, `select-industry`)
Instructs the UI to render a massive data component. The payload is intentionally `null`. The UI is expected to fetch the data options via separate REST API calls (`GET /api/v1/jobs`, etc.).
```json
{
  "type": "search-job",
  "payload": null
}
```

### C. Inline Components (`chips`, `select-pc-range`, `checkbox`)
Instructs the UI to render smaller, self-contained interactive components. The exact configuration options are passed directly within the payload.
```json
{
  "type": "chips",
  "payload": {
    "options": ["Industry", "Location", "Revenue"]
  }
}
```

### D. Background Job Status (`analysis-status`)
Sent to notify the UI about the progress of the Databricks analysis job. 
When `status` is `"completed"`, the UI triggers a REST API call (`GET /api/v1/analysis/:id`) to download the massive data table.
```json
{
  "type": "analysis-status",
  "payload": {
    "status": "completed",
    "analysis_data_id": "mock-compensation-data"
  }
}
```

### E. Error (`error`)
Sent by the API Gateway to the UI if the connection to Mastra fails or times out.
```json
{
  "type": "error",
  "payload": {
    "message": "Mastra connection failed: stream closed unexpectedly."
  }
}
```

---

## 4. End-to-End Component Flow Example

This demonstrates the exact JSON frames exchanged when a user interacts with the "Position Class" component.

**1. Mastra decides it needs a PC range. API sends to UI:**
```json
{
  "type": "select-pc-range",
  "payload": {
    "min": 50,
    "max": 60
  }
}
```

**2. The UI renders a slider defaulting to 50-60. The user slides it to 52-58 and hits Submit. UI sends to API:**
```json
{
  "type": "chat",
  "payload": {
    "message": "52 - 58",
    "role": "user",
    "conversationId": "session_a1b2c3",
    "context": {
      "globalProfileId": 410882
    }
  }
}
```

**3. The API forwards this to Mastra. Mastra starts the background job. API sends to UI:**
```json
{
  "type": "analysis-status",
  "payload": {
    "status": "pending",
    "jobId": "job_999"
  }
}
```
