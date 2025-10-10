# Project Conventions

## Architecture Principles

### HTMX/Hyperscript Philosophy
- **Server is the source of truth** for data and business logic
- **Client manages its own UI state** (tokens, preferences, etc.)
- **Server should be stateless** - no session storage in memory
- Use HTTP caching headers instead of manual client-side caching
- Prefer standard HTTP mechanisms over custom solutions

### Authentication
- **Store OAuth tokens client-side** (httpOnly cookies or localStorage)
- **Send tokens with each request** via headers or request parameters
- **Server validates tokens on demand** - no server-side session state
- Server doesn't remember who you are - you prove it with each request

### State Management
- **Server-side:** Business logic, data fetching, validation
- **Client-side:** UI state, auth tokens, user preferences
- **HTTP caching:** Use Cache-Control headers for data caching
- **sessionStorage:** Only for temporary UI state within a page session

## Development Practices

### When Questioning Approach
- Default to "the HTMX way" unless there's a specific reason to deviate
- If unsure, ask first before implementing a non-standard solution
- Prefer stateless, REST-like patterns over stateful sessions

### Code Style
- Use HTTP standards (headers, status codes, caching) over custom mechanisms
- Keep server logic simple and stateless
- Let the browser handle caching, cookies, and state where appropriate
