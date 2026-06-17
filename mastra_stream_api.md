# Mastra `/stream` API Specification

This document outlines the architecture, schemas, and best practices for the AI streaming endpoint (`POST /stream`). It incorporates our decoupled component strategy, MongoDB schema alignment (`globalProfileId`), and production-ready security recommendations.

---

## 1. Endpoint Overview

- **URL:** `http://localhost:3001/stream`
- **Method:** `POST`
- **Headers:** 
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>` (Recommended for production to extract `globalProfileId` securely)
- **Response Format:** `text/event-stream` (Server-Sent Events)

---

## 2. Request Schema

When the API Gateway forwards a message to the Mastra AI, it sends a JSON body. 

> [!TIP]
> **Idempotency Suggestion:** We recommend the UI generates a unique `messageId` for every request. If a network drop occurs and the UI retries, Mastra can use this ID to prevent duplicate LLM processing.

```json
{
  "messageId": "msg_f4aa5bfb-2ee4-4fa6-9309-fa47c0066173",
  "message": "Market Pricing Analysis",
  "role": "user",
  "conversationId": "35a13c90-efc7-455d-abff-d42f29809719",
  "context": {
    "globalProfileId": 410882,
    "threadId": "tr_g3hd8fwx6",
    "smiCode": "SMI-001",
    "surveyCode": "SURV-2024"
  }
}
```

> [!CAUTION]
> **Zero-Trust Context:** Currently, the UI sends the `context` object. In production, the API Gateway should securely append `globalProfileId` by extracting it from the user's session token to prevent tampering.

---

## 3. Server-Sent Events (SSE) Response Types

Mastra responds with a stream of distinct events. The API Gateway listens to these events and decides whether to save them to the database or forward them to the UI.

### A. `metadata`
Fired at the very beginning of the stream. Contains background IDs and token tracking. The API saves `threadId` to the database; the UI ignores this frame.
```text
event: metadata
data: {"threadId":"tr_g3hd8fwx6", "agentId":"agent_01", "usage":{"tokens":120}}
```

### B. `text-delta`
Streams the conversational AI text, chunk by chunk. Forwarded directly to the UI.
```text
event: text-delta
data: {"text":"Sure, Let's begin "}
```

### C. `component`
Tells the UI to render a specific interactive block. 

**Inline Data (For small components like Chips/Ranges):**
```text
event: component
data: {
  "componentType": "select-pc-range",
  "data": { "min": 50, "max": 60 }
}
```

**Decoupled Data (For massive lists like Jobs/Sectors):**
*(The UI receives this and makes a separate REST GET request to hydrate the data)*
```text
event: component
data: {
  "componentType": "search-job"
}
```

### D. `analysis-status`
Fired when Mastra delegates work to a long-running Databricks/Spark job. The API Gateway starts polling the database using the `jobId`.
```text
event: analysis-status
data: {"status": "pending", "jobId": "job_99a8b2"}
```

### E. `error` (New Recommendation)
A standardized error event so the UI can render friendly fallbacks and retry buttons.
```text
event: error
data: {
  "code": "LLM_TIMEOUT",
  "message": "The AI took too long to respond. Please try again.",
  "retryable": true
}
```

### F. `finish` (New Recommendation)
Fired when the AI is done streaming. Includes a `reason` so the UI knows if it should expect the user to type text or interact with a locked component.
```text
event: finish
data: {
  "status": "success",
  "reason": "requires_action",
  "expectedInputType": "component"
}
```

---

## 4. End-to-End Scenario: The Component Loop

This illustrates exactly what happens when Mastra asks for a Job Specialization using the decoupled architecture.

**1. API -> Mastra Request:**
```json
{
  "messageId": "msg_abc123",
  "message": "Market Pricing Analysis",
  "conversationId": "sess_111",
  "context": { "globalProfileId": 410882 }
}
```

**2. Mastra -> API Response (SSE Stream):**
```text
event: metadata
data: {"threadId":"tr_888"}

event: text-delta
data: {"text":"Please enter a job specialization."}

event: component
data: {"componentType":"search-job"}

event: finish
data: {"status":"success", "reason":"requires_action"}
```

**3. API Gateway Behavior:**
- Intercepts `metadata` and saves `threadId: "tr_888"` to MongoDB.
- Forwards `text-delta` and `search-job` via WebSocket to the UI.

**4. UI Behavior:**
- Renders the text.
- Sees `search-job` and immediately executes `GET /api/v1/jobs` to populate the dropdown.
- User selects "Application Development" and the cycle begins again!

---

## 5. End-to-End Scenario: Handling an Error

This illustrates how an error is cleanly caught and propagated down the stream to the UI.

**1. Mastra -> API Response (SSE Stream):**
If the LLM times out or encounters a validation failure, Mastra gracefully closes the stream with an error event.
```text
event: error
data: {"code":"LLM_TIMEOUT", "message":"The AI took too long to respond. Please try again.", "retryable":true}

event: finish
data: {"status":"failed", "reason":"error"}
```

**2. API Gateway Behavior:**
- Intercepts the `error` event.
- Forwards it via WebSocket to the UI.

**3. UI Behavior:**
- Catches the `error` event.
- Prevents the UI from hanging on a "Loading" state.
- Renders a red error bubble in the chat with the `message`.
- Because `retryable` is true, it optionally reveals a "Regenerate" button for the user.
