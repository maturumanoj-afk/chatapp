# Comprehensive Error Handling Implementation Guide

This document serves as a step-by-step implementation guide for building out the missing error handling layers in the NestJS application. It focuses on WebSockets, Server-Sent Events (SSE), Database Concurrency, and advanced external API resilience (Circuit Breaking & Retries).

---

## 1. WebSocket Exception Filtering (`WsExceptionFilter`)

**Objective:** Standard HTTP exception filters do not catch errors thrown inside a `@WebSocketGateway`. We need a dedicated filter to catch `WsException` and return a structured JSON error frame back to the UI.

### Implementation Steps
1. **Create `WsExceptionFilter.ts`** in the `src/chat/` or `src/app/common/` directory.
2. Implement the `BaseWsExceptionFilter` or `ExceptionFilter` interface from `@nestjs/websockets`.
3. Catch both `WsException` and general `Error` classes.
4. Extract the active socket client from the `ArgumentsHost`.
5. Emit a standardized error frame.

**Code Example:**
```typescript
import { Catch, ArgumentsHost, WsExceptionFilter } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io'; // or 'ws' depending on your adapter

@Catch()
export class ChatWsExceptionFilter implements WsExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const errorMsg = exception instanceof WsException ? exception.getError() : 'Internal Server Error';

    // Emit standard error frame to the frontend
    client.emit('error', {
      type: 'error',
      payload: { message: errorMsg }
    });
    
    // TODO: Send to PolarisLogger here
  }
}
```
6. **Apply the Filter:** Apply `@UseFilters(new ChatWsExceptionFilter())` directly above your `@WebSocketGateway()` class in `chat.gateway.ts`.

---

## 2. Server-Sent Events (SSE) Stream Handling

**Objective:** If the LLM connection fails *after* the initial `200 OK` header is sent for a stream, we cannot use HTTP status codes to signal an error. We must push an error frame down the open stream before closing it.

### Implementation Steps
1. In your `mastra` or `LLM` service that handles the stream, wrap the asynchronous iteration of the LLM chunks in a `try/catch` block.
2. If an error is caught during streaming, manually write an `event: error` frame to the HTTP response object.
3. Close the stream safely (`res.end()`).

**Code Example:**
```typescript
try {
  for await (const chunk of llmStream) {
    res.write(`event: text-delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
  }
  res.write(`event: finish\ndata: {"status":"success"}\n\n`);
} catch (error) {
  // Catch mid-stream failure
  res.write(`event: error\ndata: ${JSON.stringify({ message: 'LLM Stream interrupted', retryable: true })}\n\n`);
  res.write(`event: finish\ndata: {"status":"failed"}\n\n`);
} finally {
  res.end();
}
```

---

## 3. LLM Resilience: Retry Logic & Circuit Breaking

**Objective:** External LLM APIs (OpenAI/Mastra) are prone to rate limiting (`429`) and sudden outages (`500`/`503`). We must implement **Exponential Backoff Retries** to handle temporary rate limits, and a **Circuit Breaker** to prevent cascading failures during an outage.

### Implementation Steps
1. **Install Resilience Libraries:** We recommend `opossum` for Circuit Breaking, and `axios-retry` or a custom RxJS `retryWhen` operator for HTTP calls.
   ```bash
   npm install opossum
   npm install @types/opossum -D
   ```
2. **Configure the Circuit Breaker:** Wrap the external LLM API call in the Opossum circuit breaker.
   - **Failure Threshold:** E.g., If 50% of requests fail over 10 seconds, open the circuit.
   - **Reset Timeout:** E.g., Wait 30 seconds before attempting a half-open trial.
3. **Configure the Retry Logic:** This should execute *inside* the circuit breaker loop. If a `429` is caught, wait exponentially (e.g., 1s, 2s, 4s) before retrying. If it fails 3 times, throw the error so the Circuit Breaker can track the failure.

**Code Example (`llm.service.ts`):**
```typescript
import CircuitBreaker from 'opossum';

export class LlmService {
  private breaker: CircuitBreaker;

  constructor() {
    const options = {
      timeout: 10000, // If function takes longer than 10s, trigger a failure
      errorThresholdPercentage: 50, // When 50% of requests fail, open circuit
      resetTimeout: 30000 // After 30s, try one request to see if service is back
    };

    this.breaker = new CircuitBreaker(this.callLlmApiWithRetry.bind(this), options);
    
    this.breaker.fallback(() => {
      throw new Error("LLM Service is temporarily unavailable due to high load.");
    });
  }

  // Wraps your actual HTTP call with simple retry logic
  private async callLlmApiWithRetry(payload: any, attempt = 1): Promise<any> {
    try {
      return await axios.post('...', payload);
    } catch (error) {
      if (error.response?.status === 429 && attempt <= 3) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 500));
        return this.callLlmApiWithRetry(payload, attempt + 1);
      }
      throw error; // Let the Circuit Breaker handle it
    }
  }
}
```

---

## 4. Database Concurrency & Retry Logic

**Objective:** When implementing the Conversation "Bucket Pattern", multiple rapid user interactions or backend job completions might attempt to push to the same MongoDB array simultaneously, resulting in a `WriteConflict`.

### Implementation Steps
1. Update your `mongo-repository.ts` to inspect the error codes of failed database operations.
2. Specifically catch MongoDB Error Code `112` (WriteConflict) or Mongoose `VersionError`.
3. Implement a tight retry loop (max 3 attempts) that re-fetches the latest version of the document and attempts the push again.

**Code Example:**
```typescript
async appendToBucketWithRetry(conversationId: string, message: any, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      // Attempt to push to the bucket
      return await this.collection.updateOne(
        { conversationId, messageCount: { $lt: 50 } },
        { $push: { messages: message }, $inc: { messageCount: 1 } }
      );
    } catch (error) {
      // Check for MongoDB WriteConflict
      if (error.code === 112) {
        attempt++;
        if (attempt >= maxRetries) throw new Error("Max database retry limits reached.");
        // Short jittered delay before retry
        await new Promise(res => setTimeout(res, Math.random() * 50)); 
        continue;
      }
      throw error;
    }
  }
}
```

---

## 5. SIEM Compliance & Audit Logging
To fulfill the placeholders in `main.ts`:
1. Create a global `@Injectable()` Interceptor (`AuditLoggingInterceptor`).
2. Bind it globally using `app.useGlobalInterceptors()`.
3. Inside `intercept()`, extract the user's `globalProfileId` from the Request payload/JWT.
4. Log the Method, Route, ProfileId, and IP Address to your SIEM-compliant logging stream (independent of your standard error PolarisLogger).

---

## 6. Internationalization (i18n) & Standardized Error Codes

**Objective:** The backend must never send hardcoded English error strings to the UI, as the UI will support multiple language packs in the future. We must define a strict parent-child error code dictionary.

### Implementation Steps
1. **Define a Standardized Error Dictionary:** Create a shared `enum` or `constants` file in your `libs/` or `common/` directory that maps every possible error to a namespaced string code (e.g., `Category.SpecificError`).
2. **Update Exception Filters:** Modify both the `FormattedExceptionFilter` and `WsExceptionFilter` to always return the `errorCode` alongside an optional `defaultMessage` (for backend debugging only).
3. **Frontend i18n Mapping:** The Angular frontend will use libraries like `@ngx-translate/core` or Angular's native i18n to map the incoming `errorCode` to the user's selected language JSON file.

**Code Example (Shared Error Dictionary):**
```typescript
export const ErrorCodes = {
  LLM: {
    TIMEOUT: 'ERR_LLM_TIMEOUT',
    RATE_LIMIT: 'ERR_LLM_RATE_LIMIT',
    MALFORMED_OUTPUT: 'ERR_LLM_MALFORMED_OUTPUT'
  },
  WEBSOCKET: {
    DISCONNECTED: 'ERR_WS_DISCONNECTED',
    INVALID_PAYLOAD: 'ERR_WS_INVALID_PAYLOAD'
  },
  DATABASE: {
    CONCURRENCY_FAIL: 'ERR_DB_CONCURRENCY_FAIL',
    NOT_FOUND: 'ERR_DB_NOT_FOUND'
  }
};
```

**Code Example (Backend Response Frame):**
```json
{
  "type": "error",
  "payload": {
    "errorCode": "ERR_LLM_TIMEOUT",
    "defaultMessage": "The AI took too long to respond." // For developer debugging only
  }
}
```

**Code Example (Frontend Angular Template):**
```html
<!-- The UI uses the translation pipe to render the correct language -->
<div class="error-bubble">
  {{ incomingError.payload.errorCode | translate }}
</div>
```
