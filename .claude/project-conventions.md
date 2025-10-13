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

### Type Safety
- **Be as type-safe as possible at all times**
- Avoid `as any` casts - they suppress TypeScript's type checking and can hide bugs
- Use proper TypeScript types and interfaces instead of `any`
- Leverage Zod schemas for runtime validation AND type inference
- Ensure middleware that transforms data (like validation) properly types the transformed values
- Enable strict TypeScript compiler options where possible

### Testing Requirements
- **Run the test suite after every change** - use `npm run test:run` to verify all tests pass
- **Ensure all changes are covered by tests** - add unit or integration tests for new functionality
- **When tests fail, assess the root cause:**
  - **More likely:** The newly added code needs to be fixed
  - **Less likely (but possible):** The test case itself needs updating
- **Write tests that verify behavior, not implementation** - tests should validate what the code does, not how it does it
- **Test both happy paths and error cases** - include tests for validation failures, edge cases, and error handling

### Git Commit Workflow
- **Before pausing for input, commit all changes** using the user's previous input as the commit message
- **IMPORTANT: Always include the user's EXACT prompt/input as the first line of the commit message**
- You can add additional context, summary, and technical details after the user's exact words
- Command to use: `git add -A && git commit -m "<user's exact input>\n\n<your additional context and details>"`
- Example format:
  ```
  here's an easy one, the "refresh" button shouldn't be usable unless you're connected to both spotify and youtube

  Disabled refresh button until both services are connected.

  Changes:
  - Added data attributes to connection buttons
  - Updated JavaScript to check both connection states
  - Refresh button now requires both services
  ```
- This ensures the commit history shows what the user actually asked for, not just your interpretation
