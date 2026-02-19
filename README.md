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
(Adjust as needed to match current repo layout.)

## Roadmap / Ideas
- Connect to a real LLM / agent backend
- Support saving and loading task graphs
- Multi-user accounts and permissions
- Better visualization for complex workflows

## Motivation
This project explores agentic AI UIs: how non-technical users, developers, and AI agents can share the same task board and collaborate on work.

---

If you want, I can:
- Add a short CONTRIBUTING.md with how to run and test changes
- Add a `dev` snippet that loads `.env` into Node scripts for convenience
- Persist UI panel positions (e.g. API Nodes) in localStorage# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
"# BotAgents" 
