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

### Multi-Instance Deployment & Load Balancer Compatibility
- **All implementations must work behind a load balancer** with sticky sessions
- **No per-instance state** - shared secrets and configuration must be externalized
  - CSRF secrets, API keys, configuration values must come from environment variables
  - Never generate or store unique values per instance (except for logs/diagnostics)
- **Assume any user request could route to any server instance** (within session stickiness)
- **Example:** If Instance A generates a random CSRF secret and signs a token, Instance B must be able to validate it with the same secret
- Secrets shared across instances should never be committed to source control

## Development Practices

### When Questioning Approach
- Default to "the HTMX way" unless there's a specific reason to deviate
- If unsure, ask first before implementing a non-standard solution
- Prefer stateless, REST-like patterns over stateful sessions

### Code Style
- Use HTTP standards (headers, status codes, caching) over custom mechanisms
- Keep server logic simple and stateless
- Let the browser handle caching, cookies, and state where appropriate
- **Prefer native HTML elements over custom JavaScript widgets** - Use standard `<select>`, `<input>`, `<button>`, etc. instead of building custom dropdowns, date pickers, or other form controls. Native elements are more accessible, maintainable, and work better with assistive technologies. Accept that some styling limitations are a reasonable tradeoff for simplicity and standards compliance.
- **Separate HTML from TypeScript code** - All HTML responses must be rendered from EJS templates in `views/partials/`, never embedded as string literals in route files. This ensures:
  - Consistency with HTMX patterns (templates contain presentation logic)
  - Better security (template escaping prevents XSS)
  - Easier maintenance (HTML updates don't require code changes)
  - Clearer separation of concerns (routes handle logic, templates handle rendering)

### Type Safety
- **Be as type-safe as possible at all times**
- Avoid `as any` casts - they suppress TypeScript's type checking and can hide bugs
- Use proper TypeScript types and interfaces instead of `any`
- Leverage Zod schemas for runtime validation AND type inference
- Ensure middleware that transforms data (like validation) properly types the transformed values
- Enable strict TypeScript compiler options where possible

### Code Refactoring and Cleanup
- **The project must contain no dead code** - unused functions, variables, imports, or commented-out code
- **After any refactoring work, remove all dead code before committing** - if code is no longer used, it should be deleted entirely
- When replacing or restructuring code, verify that old code is no longer referenced anywhere in the codebase before removing it
- Dead code creates confusion, increases maintenance burden, and obscures the actual implementation

### Testing Requirements
- **Run the test suite after every change** - use `npm run test:run` to verify all tests pass
- **Ensure all changes are covered by tests** - add unit or integration tests for new functionality
- **When tests fail, assess the root cause:**
  - **More likely:** The newly added code needs to be fixed
  - **Less likely (but possible):** The test case itself needs updating
- **Write tests that verify behavior, not implementation** - tests should validate what the code does, not how it does it
- **Test both happy paths and error cases** - include tests for validation failures, edge cases, and error handling

### Git Commit Workflow
- **Before pausing for input, commit all changes** using user prompts as the commit message
- **IMPORTANT: Include ALL user prompts given since the last commit, verbatim and in order**
- **Include a summary of any discussion/clarification between prompts** to capture context and reasoning
- Add technical implementation details, changes, and testing results after the prompts and discussion
- Command format:
  ```
  <user's exact prompt 1>

  Discussion/Clarification:
  - We discussed X and concluded Y
  - User clarified that Z approach is better

  <user's exact prompt 2 (if any)>

  Implementation:
  - Changed A to B
  - Added C for D reason
  - All tests passing (N tests)
  ```
- Example:
  ```
  you didn't add any tests when you added the circuit breaker to the spotify client, add them, also move the configuration for both instances of the circuit breaker to configuration files, they shoudln't be hard coded at the imnplementation site

  Added comprehensive tests for Spotify circuit breaker covering state management, rate limit handling, and token management. Moved circuit breaker configuration to src/config/circuitBreaker.ts so both YouTube and Spotify breakers can be independently configured.

  Changes:
  - Created src/config/circuitBreaker.ts with circuit breaker configurations
  - Added tests/unit/spotifyCircuitBreaker.test.ts with 10 new tests
  - All 321 tests passing
  ```
- This ensures the commit history captures the full context of what was asked, how it was discussed, and why decisions were made
