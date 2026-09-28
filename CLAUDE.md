# AI Assistant Guidelines

- Never assume missing context. Ask questions if uncertain
- Never hallucinate libraries or packages – only use known, verified npm packages
- Always confirm file paths and module names exist before referencing them in code or tests
- Never delete or overwrite existing code unless explicitly instructed to
- Always run linting and type checking before marking tasks complete
- Use the correct package manager as specified in the project
- Fix things at the cause, not the symptom

---

# Readable Code Principles

- Write code that minimizes time-till-understanding for future self and others
- Choose specific, concrete names over abstract or generic ones
- Avoid abbreviations like `tmp`, `str`, `obj`, `retval`, `get`
- Use longer, descriptive names that clearly express intent
- Be consistent with naming conventions throughout the codebase
- Use camelCase for variables and PascalCase for components
- Name boolean functions with `is`, `has`, or `can` prefixes (e.g., `isEmpty`)
- Use verbs for functions/methods, nouns for classes
- Add `_` prefix for private functions
- Extract unrelated subproblems into separate functions
- **DRY (Don't Repeat Yourself):** Every piece of knowledge should have a single, unambiguous representation. Extract duplicated logic into shared functions or modules
- Avoid giant expressions – break them into smaller, named parts
- Use UPPER_CASE for constants
- Remove obvious words and redundant protocol names from variable names
- Delete commented-out code instead of leaving it disabled
- Use explaining variables instead of comments when possible

  ```typescript
  // Bad: Hard to understand
  if (txStateMessage[Object.keys(txStateMessage)[0]][7] === 1) {
    // do something
  }

  // Better: Use explaining variable
  const isPendingState = txStateMessage[Object.keys(txStateMessage)[0]][7] === 1;
  if (isPendingState) {
    // do something
  }

  // Best: Extract and name the logic clearly
  const getFirstTransactionState = (message: any) => Object.keys(message)[0];
  const isTransactionPending = (state: number) => state === 1;

  const firstTransaction = getFirstTransactionState(txStateMessage);
  const isPendingState = isTransactionPending(txStateMessage[firstTransaction][7]);
  if (isPendingState) {
    // do something
  }
  ```

- **YAGNI (You Aren't Gonna Need It):** Don't write code before you need it. Avoid overly generic code and "we might need it later" thinking.

  ```typescript
  // Not YAGNI: Adds optional params for "flexibility" before needed
  function fetchData(url: string, headers?: Record<string, string>, timeout?: number) {
    // ...
  }

  // YAGNI: Only add parameters you actually need now
  function fetchData(url: string) {
    // ...
  }
  ```

  Prefer writing the function with only the required parameters. Only add parameters (like `headers`, `timeout`) when and if there is a real use-case.

---

# Code Organization

- Never create a file longer than 300 lines of code. If a file approaches this limit, refactor by splitting it into modules or helper files
- Organize code into clearly separated modules, grouped by feature or responsibility
- Use barrel exports (`index.ts` files) to create clean import paths

---

# Coding Standards

- Use TypeScript with strict mode enabled
- Follow the project's ESLint and Prettier configurations
- Prefer `const` over `let`, and avoid `var` entirely
- Use `async/await` over Promises for better readability
- Write TSDoc comments for all public functions and classes:

  ```typescript
  /**
   * Brief description of what the function does.
   *
   * @param param1 - Description of the parameter
   * @param param2 - Description of the parameter
   * @returns Description of what is returned
   * @throws {ErrorType} Description of when this error is thrown
   */
  function example(param1: string, param2: number): Promise<Result> {
    // implementation
  }
  ```

- Use proper error handling with custom error classes when appropriate
- Prefer composition over inheritance and favor functional programming patterns

---

# Project Conventions

- **PascalCase** for:
  - React components and their files (e.g., `ProjectDetail.tsx`, `CodeViewer.tsx`)
  - Class names (e.g., `UserService`, `ApiError`)
  - Type/Interface names (e.g., `UserProfile`, `ApiResponse`)

- **camelCase** for:
  - Variables (e.g., `userData`, `isLoading`)
  - Functions (e.g., `getUserData`, `calculateTotal`)
  - Class instances (e.g., `userService`, `apiClient`)
  - React hooks (e.g., `useAuth`, `useState`)
  - Hook files (e.g., `useAuth.ts`, `useLocalStorage.ts`)

- **kebab-case** for:
  - Folder names (e.g., `components/`, `utils/`)
  - Non-component files (e.g., `api-client.ts`, `test-utils.ts`)
  - CSS class names (e.g., `header-container`)

- **SCREAMING_SNAKE_CASE** for:
  - Constants (e.g., `MAX_RETRIES`, `API_URL`)
  - Enum values (e.g., `HttpStatus.NOT_FOUND`)

- Follow consistent file structure with components, services, utils folders
- Maintain consistent architecture patterns across the codebase

---

# Commit Messages

- Keep it one-line
- Do not add "Co-Authored-By" lines to commit messages unnecessarily as it is already present in GitHub if used

---

# Documentation Standards

- Update `README.md` when new features are added, dependencies change, or setup steps are modified
- Comment complex logic and ensure everything is understandable to a mid-level developer
- When writing complex logic, add a `// Reason:` comment explaining the why, not just the what
- Keep `package.json` scripts up to date with proper descriptions
