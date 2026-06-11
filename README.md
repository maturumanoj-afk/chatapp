# Angular & Mastra Chat App POC

This is a Proof-of-Concept (POC) Chat Application demonstrating a real-time, component-driven chat interface powered by an Angular frontend, a Node.js API Gateway, and a mock Mastra AI agent backend.

## Architecture

The project is structured as a monorepo containing two main parts:

### 1. Frontend (`/frontend`)
- **Framework**: Angular 18+
- **Styling**: Tailwind CSS
- **Features**: 
  - Real-time WebSocket communication with the API Gateway.
  - Dynamic rendering of rich UI components (Chips, Checkboxes, Range Selectors) driven by the AI stream.
  - Interactive "thought" tracing and analysis dashboards.

### 2. Backend (`/backend`)
- **API Gateway (`src/api.ts`)**: An Express & `ws` WebSocket server that sits between the UI and the AI Agent. It manages session context (`conversationId` <-> `threadId` mapping) and forwards client messages.
- **Mastra AI Mock (`src/mastra.ts`)**: An Express server exposing a POST `/stream` endpoint. It simulates an AI agent using Server-Sent Events (SSE) to stream text deltas, trigger UI components, and mock background Databricks analysis jobs.
- **Mock DB (`src/db.ts`)**: A local file-based JSON store (`data/db.json`) replacing MongoDB for the purpose of the POC.

## Communication & Schemas

The entire flow relies on a strict payload structure designed to seamlessly pass context, thread IDs, and UI component instructions. 
For a detailed breakdown of the request/response structures and the SSE event streaming formats, see [API_SCHEMAS.md](./API_SCHEMAS.md).

## Running the Application Locally

### Prerequisites
- Node.js (v18+)
- npm

### Starting the Services
First, install dependencies and start the backend services:

```bash
cd backend
npm install
npm run start
```
*(This launches the API Gateway on `http://localhost:3000` and the Mastra agent on `http://localhost:3001`)*

In a separate terminal, install dependencies and start the frontend:
```bash
cd frontend
npm install
npm start
```
*(This launches the Angular application on `http://localhost:4200`)*

Open your browser to `http://localhost:4200` to test the chat application! Try typing `"Run compensation analysis"` to trigger the mock agent flow.
