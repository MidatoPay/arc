# MidatoPay — Complete Migration from Solana to Arc Mainnet

You must migrate the existing MidatoPay application in this repository from Solana to **Arc Mainnet**, preserving all existing business logic, functionality, integrations, and application behavior that are unrelated to the blockchain migration.

This is a critical infrastructure migration. Do not start coding until you fully understand the current implementation, document the architecture, and resolve all relevant questions with me.

## Phase 1 — Repository Investigation (NO CODE CHANGES)

Before asking me questions, thoroughly inspect the entire repository.

Understand and document:

- The application architecture, modules, dependencies, and data flows.
- Every Solana-specific implementation, including RPC clients, SDKs, wallets, transaction construction, signing, confirmation, account handling, token transfers, balances, and network configuration.
- Every location where SOL is used to pay transaction fees or where USDC is used for payments, collections, transfers, accounting, or balance calculations.
- All smart contracts, APIs, backend services, frontend components, scripts, tests, deployment configurations, and third-party integrations affected by the migration.
- Every environment variable and configuration reference associated with Solana.
- How the existing application handles errors, transaction failures, retries, and confirmations.

Trace the actual dependencies and execution paths. Do not rely exclusively on filenames, search results, or assumptions.

## Phase 2 — Documentation and Architecture Planning

Before asking questions or modifying code, create a dedicated Markdown documentation folder, such as `docs/arc-migration/`, containing at least:

1. `CURRENT_ARCHITECTURE.md` — How the existing application works, including relevant modules and transaction flows.
2. `SOLANA_DEPENDENCIES.md` — Complete inventory of Solana-specific code, SDKs, dependencies, RPC calls, and configurations.
3. `ARC_MAINNET_RESEARCH.md` — Verified Arc Mainnet specifications, RPC configuration, chain ID, transaction model, gas mechanism, USDC support, wallet compatibility, and relevant tooling.
4. `MIGRATION_IMPACT.md` — Every component that must change, why it must change, and its dependencies.
5. `TARGET_ARCHITECTURE.md` — The proposed Arc implementation and how it maps to the existing architecture.
6. `ENVIRONMENT_VARIABLES.md` — Existing variables, which ones remain unchanged, and the exact Solana-to-Arc RPC variable renames.
7. `MIGRATION_PLAN.md` — Ordered implementation steps, dependencies, risks, testing strategy, and rollback considerations.
8. `OPEN_QUESTIONS.md` — All unresolved technical decisions and questions requiring my input.

These documents must reflect the actual repository, not generic assumptions. Verify Arc-specific details against official documentation. Clearly distinguish verified facts from assumptions and unresolved decisions.

Arc is an EVM-compatible blockchain, so evaluate the appropriate EVM tooling and transaction model rather than attempting to reproduce Solana's architecture on Arc.

## Phase 3 — Ask Questions Before Implementation

After completing the investigation and documentation, present me with all relevant questions before changing any code.

Ask as many questions as necessary to eliminate ambiguity, including questions about:

- Wallet integration and address compatibility.
- EVM transaction signing and submission.
- USDC transfers, collections, settlements, balances, and accounting.
- Gas payment and transaction fee handling.
- RPC providers, network configuration, and environment variables.
- Smart contracts, token standards, and existing Solana program dependencies.
- Transaction confirmations, retries, errors, and security requirements.
- Testing, deployment, backwards compatibility, and migration risks.

Do not ask questions that the repository or official documentation can already answer. Explain the context and implications of each question, and group related questions together.

Wait for my answers. If new questions arise during the investigation or implementation planning, ask them before making the affected decisions. Update the Markdown documentation with the answers.

## Phase 4 — Migration Requirements

Once I explicitly approve the plan, implement the migration with the following strict requirements.

### A. Blockchain migration

Replace the Solana-specific infrastructure with the appropriate Arc Mainnet implementation.

Migrate every blockchain-dependent component that genuinely requires modification, including RPC interactions, transaction creation and signing, wallet integration, token transfers, balance queries, transaction status checks, and related tests.

Use verified Arc Mainnet configuration and compatible EVM tooling.

Do not introduce unnecessary abstractions, dependencies, architectural rewrites, or new features.

### B. Preserve existing application behavior

**Do not modify code unrelated to the blockchain migration.**

Preserve the existing business logic, API contracts, UI, database schema, authentication, integrations, application structure, naming conventions, and behavior wherever possible.

Do not refactor, redesign, rename, optimize, or clean up unrelated code. If a component must change because of a direct dependency on Solana, document the reason.

Do not remove existing functionality simply because it is inconvenient to port. Identify incompatible functionality and ask me how to proceed.

### C. Environment variables

All existing environment variables must remain unchanged, except for the names of variables that specifically identify or configure the Solana RPC.

Rename only those RPC-related variables to their corresponding Arc RPC names.

- Preserve all other variable names.
- Preserve existing semantics and values wherever applicable.
- Update every reference to renamed RPC variables across the application, deployment configurations, scripts, documentation, and CI/CD workflows.
- Do not rename unrelated variables or introduce unnecessary new variables.
- Never expose or overwrite secrets.
- If Arc requires an additional configuration value that cannot reasonably be derived from existing configuration, document it and ask me before introducing it.

Provide a precise old-name → new-name mapping.

### D. USDC and gas payments

The current Solana implementation uses SOL for transaction fees and USDC for application payments.

On Arc, USDC is also used as the gas token. Adapt the transaction and payment flows accordingly:

- Use the verified Arc Mainnet USDC configuration for payments and gas.
- Remove the assumption that users need SOL to pay transaction fees.
- Update gas estimation, fee handling, transaction submission, balance checks, and any relevant user-facing messages.
- Distinguish between USDC available for gas and USDC committed to application payments. A user's total USDC balance must not be treated as entirely spendable if some is required for gas or other pending transactions.
- Prevent double-counting gas fees and payment amounts in accounting or balance calculations.
- Preserve existing payment amounts, business rules, fees charged by MidatoPay, and settlement behavior unless a change is strictly necessary for Arc compatibility and has been approved.
- Do not assume that changing the gas token automatically makes all existing Solana payment logic compatible with Arc.
- Verify the actual Arc Mainnet gas mechanism and USDC contract/address before implementation.

### E. Dependencies and security

Remove Solana-only dependencies only when they are no longer needed anywhere in the repository. Introduce compatible EVM dependencies only where required.

Review the migration for chain ID validation, wrong-network protection, transaction replay considerations, address handling, token decimals, RPC failures, fee estimation, and transaction confirmation behavior.

Do not introduce private-key handling or weaken existing security controls.

## Phase 5 — Testing and Verification

Before declaring the migration complete:

- Update and run all relevant tests.
- Add or adapt tests for Arc transaction submission, USDC transfers, gas payments, balances, failures, and confirmations.
- Verify that the application cannot accidentally submit transactions to Solana or another unintended network.
- Check that no unintended Solana references remain in active application code or configuration.
- Verify that unrelated application behavior has not changed.
- Run the available build, type checks, linting, and test suites.
- Clearly report any checks that could not be executed and why.

Do not claim that a test, deployment, or transaction succeeded unless it was actually verified.

## Working Rules

1. Start with repository investigation, not implementation.
2. Do not modify application code during the initial investigation, documentation, and questioning phases.
3. Create and maintain the Markdown files as the authoritative migration documentation.
4. Ask me questions only after you have sufficient repository context to make those questions precise.
5. Wait for my explicit approval before implementing the migration.
6. When implementation begins, work incrementally and validate each stage.
7. If a decision could affect unrelated functionality, financial correctness, security, or compatibility, stop and ask me.
8. Do not invent Arc specifications, contract addresses, RPC endpoints, or environment variable names.
9. Keep a record of all code changes and explain why each blockchain-related component needed modification.

## Your First Deliverable

Your first response must contain:

1. A concise summary of the current application architecture.
2. A complete inventory of Solana-dependent components and their impact on the migration.
3. The initial Markdown documentation files described above.
4. A prioritized list of unresolved questions, with explanations and recommended options where appropriate.
5. A proposed migration plan and risk assessment.

**Do not implement the migration or modify application code until I have reviewed the findings, answered the necessary questions, and explicitly approved the plan.**