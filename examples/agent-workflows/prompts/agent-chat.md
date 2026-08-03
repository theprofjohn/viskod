# Agent Prompt: Chat with User via Viskod Chrome Extension

Use this prompt when the agent needs to communicate with the user through the Viskod in-page chat panel.

---

## Overview

The Viskod Chrome extension injects a chat panel into localhost pages. Users can send messages directly from the inspected page. The agent reads these messages via MCP tools and responds in real time.

## Chat Protocol

### Step 1: Check for Pending Messages

At the start of each interaction (or when idle), call:

```
viskod_get_chat_messages()
```

This returns undelivered user messages. If no messages, the agent can continue with other work.

### Step 2: Read and Understand the Message

Each message has:
- `id` — message identifier
- `role` — always `"user"` (agent messages come from you)
- `text` — the user's message
- `timestamp` — when it was sent

### Step 3: Respond

Based on the message type, take action:

**If it's a question about the UI:**
1. Call `viskod_capture_context` to inspect the current state
2. Analyze the context packet
3. Call `viskod_send_chat_response` with the answer

**If it's a request to fix something:**
1. Call `viskod_capture_context` to understand current state
2. Read source hints and edit the relevant files
3. Call `viskod_send_chat_response` explaining what you changed
4. Call `viskod_notify_ui({ action: 'refresh' })` to trigger page reload
5. The user will see the updated page in real time

**If it's a general question (not UI-related):**
1. Answer directly
2. Call `viskod_send_chat_response` with the answer

### Step 4: Always Respond

Every user message MUST get a response. The user is waiting in the chat panel. Never leave a message unacknowledged.

## Tool Reference

| Tool | Purpose | When to use |
|------|---------|-------------|
| `viskod_get_chat_messages` | Read pending user messages | Start of each interaction |
| `viskod_send_chat_response` | Send a message to the chat panel | After every user message |
| `viskod_notify_ui` | Trigger refresh/overlay inject | After making code changes |

## Response Format

Keep responses concise — the chat panel is small. Aim for 1-3 sentences unless detail is requested.

**Good:**
- "Fixed the card padding. The page will refresh now."
- "The button color is #3b82f6 (blue-600). It passes WCAG AA contrast."
- "I see the issue — the grid is set to 2 columns instead of 3. Let me fix that."

**Bad:**
- Long paragraphs explaining your analysis
- Technical jargon without context
- Ignoring the message to do something else

## Example Flow

```
User sends: "the header is overlapping the content"

1. Agent calls: viskod_get_chat_messages()
   → receives: { id: "abc", text: "the header is overlapping the content" }

2. Agent calls: viskod_capture_context(selector: "header", url: "...")
   → receives context packet with bounding box, computed styles

3. Agent reads source hints, finds src/components/Header.tsx
   → edits the CSS: adds position: sticky + proper z-index

4. Agent calls: viskod_send_chat_response({ text: "Fixed — the header now has position: sticky with z-index: 10. Refreshing now." })

5. Agent calls: viskod_notify_ui({ action: "refresh" })
   → page reloads, user sees the fix
```

---

## Safety Rules

1. Never expose redacted values from capture output.
2. Never modify files outside the project scope.
3. Always respond to user messages — never leave them hanging.
4. If you can't fix something, explain why in the chat.
