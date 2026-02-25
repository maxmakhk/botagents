# BotAgents

BotAgents is an agentic AI task UI that turns natural language into structured, multi-step workflows.

A frontend-first prototype to experiment with how humans and AI agents can collaborate on tasks.

## Features
- Create tasks with natural language and break them down into smaller steps.
- Visual UI for browsing, editing, and executing tasks.
- React + Vite architecture, ready to plug into any LLM / agent backend.
- Firebase-ready project structure for authentication and persistence (optional).

## Tech Stack
- React 18 + Vite
- TypeScript-ready tooling (can be enabled later)
- Tailwind CSS or plain CSS (update depending on your setup)
- Firebase (for auth / data, if configured)

## Getting Started
### Prerequisites
- Node.js (LTS) installed
- npm or pnpm
- (Optional) A Firebase project if you want authentication or persistence

### Installation
```bash
git clone https://github.com/maxmakhk/botagents.git
cd botagents
npm install
```
# Bot Agents

Task-Based AI Collaboration Agents — currently in development.

Bot Agents is an AI-assisted industrial process management prototype designed to turn natural language instructions into structured, multi-step workflows while providing precise, visual monitoring for management.

Key capabilities:

- Multi-user collaboration
- Highly user-friendly visual interface
- Comprehensive monitoring and visual output

While the project is not yet publicly released, the goal is to make it free and open-source with one-click installation for easy deployment.

---

Continuing the Bot Agents demo: this project introduces an automated visual output screen tailored for equipment monitoring. Core highlights:

- Visual components that enhance user experience and clarity
- One-click deployment for quick setup
- Collaborative workflows to facilitate teamwork
- Ease of use to make the system accessible to non-technical users

This system aims to differentiate itself from existing solutions by offering tight integration between task automation, monitoring, and extensibility.

---

Core progress and roadmap

The task-control core is approaching functional maturity. Current capabilities include:

- Generating workflows from prompts, with the ability to edit or extend each node
- Each node can connect to an unlimited number of APIs or sensors via flexible variables
- Planned integration of vision AI to detect items and trigger tasks automatically
- Runtime-editable node functions (node-level `fnString`) for dynamic behavior

Comparison & intent

Open-source projects such as n8n and OpenClaw demonstrate the value of workflow automation. Bot Agents targets a complementary space — helping teams rapidly build highly integrated systems for monitoring and automation in industrial contexts.

---

## Features

- Create tasks with natural language and break them into actionable workflows
- Visual UI for browsing, editing, and executing tasks
- Per-node editable functions (`fnString`) so each node can maintain its own behavior
- Real-time visual output for monitoring equipment and processes
- Integrations for APIs, sensors, and planned vision AI support

## Tech Stack

- React 18 + Vite
- TypeScript-ready tooling (can be enabled later)
- Tailwind CSS or plain CSS (update depending on your setup)
- Firebase (for auth / data, if configured)

## Getting Started

### Prerequisites
- Node.js (LTS)
- npm or pnpm
- (Optional) Firebase project for persistence/auth

### Installation

```bash
git clone https://github.com/maxmakhk/botagents.git
cd botagents
npm install
```

### Environment variables

Copy `.env.example` to `.env.local` (or create a `.env`) and fill the values. Example keys used by this project:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_AI_CHAT_ENDPOINT=
VITE_COMPANY_NAME=
```

Do NOT commit files containing secrets. `.env` and `.env.local` are included in `.gitignore` by default.

> Note: Frontend code (Vite) reads variables via `import.meta.env`. Node scripts in `scripts/` expect standard `process.env` values — you can export them in your shell or use a tool like `dotenv-cli` to load the same `.env` file for Node scripts.

### Run locally

```bash
npm run dev
```
Open the URL printed in the terminal (typically http://localhost:5173).

## Useful scripts

- `npm run dev` — start Vite dev server
- `npm run build` — build for production
- `npm run preview` — preview production build
- Node helper scripts: `node scripts/cleanup-duplicate-rules.js` (ensure required env vars are available to Node)

## Project structure (high level)

```
src/
  features/            // feature areas (VariableManager, etc.)
    variableManager/   // main UI and hooks for variable & workflow editor
  App.jsx              // app entry
  main.jsx
public/
scripts/               // small Node utilities (may require process.env)
.env.example           // example env keys (no secret values)
```

## Roadmap / Ideas

- Integrate vision AI for automated detection + task triggers
- One-click deployment and installer scripts
- Persist node-level `fnString` and project data in project storage
- Multi-user accounts, roles, and permissions

## Motivation

Bot Agents explores how humans and AI agents can collaborate on tasks through a shared visual taskboard and runtime that connects sensors, APIs, and AI logic.

---

If you'd like, I can:
- Add a short `CONTRIBUTING.md` with development and testing steps
- Add an installer/dev convenience script that loads `.env` for Node scripts
- Add a clickable thumbnail linking to your LinkedIn demo (images are supported in README)
