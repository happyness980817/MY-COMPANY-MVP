# MVP - Minimum Viable Product - for my Startup (AI-Assisted Counseling Platform)

A prototype counseling platform that applies Byron Katie’s The Work methodology with AI assistance.

## Overview

- Implements Byron Katie’s The Work
- AI assistance powered by OpenAI **Responses API**
- Inspired by the book _The Right It_ (Alberto Savoia)
- Minimal feature set focused on demand validation
- No database, no authentication(login/logout)

## Tech Stack

- Node.js
- Express
- Socket.IO
- OpenAI Responses API
- Pug

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables:

```bash
cp .env.sample .env
# Edit .env with your OpenAI API key
```

3. Run the server:

```bash
npm start
```

## App Flow (Routes)

- `POST /create` – Generate a 20-char room code (shown **once**), saves it to the session, optionally proceed to enter
- `POST /enter` – Joins an existing room with the provided code; saves state to the session
- `GET /room` – Renders the counselor/client view from the session (the room code is never shown in the UI)

> For production, use a persistent session store (e.g., Redis or MongoDB) and secure cookies.

## Notes

- For fast demand validation with limited resources, only minimal features included.
- This MVP will follow a Discord user test using _The Work_ assistant chatbot.
