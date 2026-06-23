# MongoDB Schema Refactor: Conversation & Analysis Decoupling

This document outlines the proposed architectural shift from a monolithic MongoDB document to a decoupled, multi-collection approach.

## 1. The Current Architecture (Monolithic)

Currently, the system stores Core Analysis metadata, Analysis Data references, and the entire AI Chat History within a single document in the MongoDB database.

### ⚠️ Identified Risks
1. **Document Size Limits:** MongoDB imposes a hard 16MB limit per document. While `analysisData` holds lightweight references, an actively used `conversationHistory.messages` array could theoretically breach this limit over time.
2. **Update Contention:** Rapid Server-Sent Events (SSE) streaming from the AI (pushing new messages) and asynchronous Databricks jobs (updating analysis status) simultaneously compete to write to the same document. This causes database lock contention and potential race conditions.
3. **Tight Coupling:** The AI microservice and the Core Business Logic microservice are forced to interact with the exact same database collection.

---

## 2. The Proposed Architecture (Decoupled)

We propose splitting the monolithic document into two dedicated collections. Because `analysisId` is functionally equivalent to `conversationId` in the frontend, we can use a **1-to-1 Mapping Strategy** to link them effortlessly.

### Collection A: `analyses`
Owned strictly by the Core Business Logic services. It holds metadata, user associations, and data job references.

```json
{
  "_id": "2f69b8a8-798e-4580-816c-71a812217f54", // Primary Key (The analysisId)
  "globalProfileId": 410882,
  "name": "Market Pricing Q3 2026",
  "organization": { 
    "id": "org_123",
    "name": "Acme Corp"
  },
  "analysisRequestAttributes": {
    "smiCode": 0,
    "survey": { "year": 2026, "code": "SURV-2024" }
  },
  "analysisData": [
    { "id": "data_xyz123", "status": "completed" }
  ],
  "createdAt": "2026-06-22T11:21:14Z",
  "updatedAt": "2026-06-22T12:27:12Z"
}
```

### Collection B: `conversations`
Owned strictly by the AI/LLM microservice. It utilizes the **Bucket Pattern** to guarantee that a conversation can theoretically scale to millions of messages without ever hitting the 16MB limit.

```json
{
  "_id": ObjectId("6a391aaa1755f282d918dbf8"), // Auto-generated
  "conversationId": "2f69b8a8-798e-4580-816c-71a812217f54", // Foreign Key -> Analyses._id
  "globalProfileId": 410882,
  "threadId": "2f69b8a8-798e-4580-816c-71a812217f54",
  "status": "active",
  "userSaved": false,
  
  // BUCKET PATTERN IMPLEMENTATION
  "bucketNumber": 1,         // Allows pagination of history
  "messageCount": 50,        // Max 50 messages per bucket document
  "messages": [
    {
      "messageId": "c3856875...",
      "role": "user",
      "content": "Market Pricing Analysis",
      "createdAt": "2026-06-22T11:21:45Z"
    },
    // ... 49 more messages ...
  ],
  
  "createdAt": "2026-06-22T11:21:14Z",
  "lastMessageAt": "2026-06-22T12:27:12Z"
}
```

---

## 3. How the Bucket Pattern Works
When the AI pushes a new message:
1. The backend queries the `conversations` collection for the document where `conversationId === "2f69b8a..."` sorted by `bucketNumber: -1` (to get the latest bucket).
2. If `messageCount < 50`, it `$push`es the message to the array and increments `messageCount`.
3. If `messageCount === 50`, it creates a *brand new document* with `bucketNumber: 2`, and inserts the message there.

When the UI loads the chat history:
1. The backend fetches the documents matching `conversationId`, sorted by `bucketNumber`.
2. This provides automatic, highly performant pagination.

## 4. User Review Required
> [!IMPORTANT]
> Please review this schema approach with your database team.
> 1. Does the 1-to-1 mapping via `conversationId` satisfy your frontend requirements?
> 2. Are you comfortable with implementing the Bucket Pattern, or would you prefer a simple 1-to-1 split without bucketing for now?
