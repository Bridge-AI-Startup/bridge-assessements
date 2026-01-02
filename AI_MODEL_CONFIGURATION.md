# AI Model Configuration Guide

This guide explains how to configure AI models per use case in BridgeAI.

## Priority Order

The system checks for models in this order (first match wins):
1. **Prompt config** (`prompts/index.ts`) - highest priority
2. **Environment variable per use case** (e.g., `OPENAI_MODEL_ASSESSMENT_GENERATION`)
3. **Environment variable per provider** (e.g., `OPENAI_MODEL`)
4. **Default models** (hardcoded fallbacks)

## Method 1: In Code (`prompts/index.ts`) - Highest Priority

Set the model directly in the prompt configuration file:

```typescript
// server/src/prompts/index.ts

export const PROMPT_GENERATE_ASSESSMENT_COMPONENTS = {
  provider: "anthropic" as AIProvider,
  model: "claude-3-5-sonnet-20241022",  // ← Set model here
  system: `...`,
  userTemplate: (jobDescription: string) => `...`
};

export const PROMPT_ASSESSMENT_CHAT = {
  provider: "openai" as AIProvider,
  model: "gpt-4o",  // ← Different model for chat
  systemTemplate: (...) => `...`,
  userTemplate: (userMessage: string) => userMessage,
};

export const PROMPT_GENERATE_INTERVIEW_QUESTIONS_RETRIEVAL = {
  provider: "gemini" as AIProvider,
  model: "gemini-1.5-pro",  // ← Different model for interview questions
  systemTemplate: (...) => `...`,
  userTemplate: (...) => `...`
};

export const PROMPT_GENERATE_INTERVIEW_SUMMARY = {
  provider: "anthropic" as AIProvider,
  model: "claude-3-5-haiku-20241022",  // ← Faster model for summaries
  system: `...`,
  userTemplate: (transcript: string) => `...`
};
```

**Pros:**
- Version controlled
- Easy to see all configurations in one place
- No need to restart server when changing

**Cons:**
- Requires code change and deployment

## Method 2: Environment Variables Per Use Case

Set models per use case in your `config.env` file:

```env
# Set provider per use case
AI_PROVIDER_ASSESSMENT_GENERATION=anthropic
AI_PROVIDER_ASSESSMENT_CHAT=openai
AI_PROVIDER_INTERVIEW_QUESTIONS=gemini
AI_PROVIDER_INTERVIEW_SUMMARY=anthropic

# Set models per use case (format: PROVIDER_MODEL_USECASE)
OPENAI_MODEL_ASSESSMENT_GENERATION=gpt-4o
OPENAI_MODEL_ASSESSMENT_CHAT=gpt-4o-mini
OPENAI_MODEL_INTERVIEW_QUESTIONS=gpt-4o
OPENAI_MODEL_INTERVIEW_SUMMARY=gpt-4o-mini

ANTHROPIC_MODEL_ASSESSMENT_GENERATION=claude-3-5-sonnet-20241022
ANTHROPIC_MODEL_ASSESSMENT_CHAT=claude-3-5-haiku-20241022
ANTHROPIC_MODEL_INTERVIEW_QUESTIONS=claude-3-5-sonnet-20241022
ANTHROPIC_MODEL_INTERVIEW_SUMMARY=claude-3-5-haiku-20241022

GEMINI_MODEL_ASSESSMENT_GENERATION=gemini-1.5-pro
GEMINI_MODEL_ASSESSMENT_CHAT=gemini-1.5-flash
GEMINI_MODEL_INTERVIEW_QUESTIONS=gemini-1.5-pro
GEMINI_MODEL_INTERVIEW_SUMMARY=gemini-1.5-flash
```

**Environment Variable Naming:**
- Format: `{PROVIDER}_MODEL_{USECASE}`
- Use case names: `ASSESSMENT_GENERATION`, `ASSESSMENT_CHAT`, `INTERVIEW_QUESTIONS`, `INTERVIEW_SUMMARY`
- Example: `OPENAI_MODEL_ASSESSMENT_GENERATION`

**Pros:**
- No code changes needed
- Can be different per environment (dev/staging/prod)
- Easy to test different models

**Cons:**
- Requires server restart
- Not version controlled (unless you commit config.env)

## Method 3: Global Provider Models

Set a default model per provider (applies to all use cases unless overridden):

```env
# Global provider
AI_PROVIDER=openai

# Global models per provider (used if no use-case-specific model is set)
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
GEMINI_MODEL=gemini-1.5-pro
```

**Pros:**
- Simple configuration
- Good for when all use cases use the same model

**Cons:**
- Less flexible
- Can't customize per use case

## Use Case Names

The system recognizes these use case names:
- `assessment_generation` → `ASSESSMENT_GENERATION` (in env vars)
- `assessment_chat` → `ASSESSMENT_CHAT` (in env vars)
- `interview_questions` → `INTERVIEW_QUESTIONS` (in env vars)
- `interview_summary` → `INTERVIEW_SUMMARY` (in env vars)

## Examples

### Example 1: Use GPT-4o for assessment generation, GPT-4o-mini for everything else

**In `prompts/index.ts`:**
```typescript
export const PROMPT_GENERATE_ASSESSMENT_COMPONENTS = {
  provider: "openai" as AIProvider,
  model: "gpt-4o",  // Use GPT-4o for this
  // ...
};
```

**In `config.env`:**
```env
AI_PROVIDER=openai
OPENAI_MODEL=gpt-4o-mini  # Default for other use cases
```

### Example 2: Use different providers and models per use case via env vars

**In `config.env`:**
```env
AI_PROVIDER_ASSESSMENT_GENERATION=anthropic
AI_PROVIDER_ASSESSMENT_CHAT=openai
AI_PROVIDER_INTERVIEW_QUESTIONS=gemini

ANTHROPIC_MODEL_ASSESSMENT_GENERATION=claude-3-5-sonnet-20241022
OPENAI_MODEL_ASSESSMENT_CHAT=gpt-4o
GEMINI_MODEL_INTERVIEW_QUESTIONS=gemini-1.5-pro
```

### Example 3: Mix of code and environment variables

**In `prompts/index.ts`:**
```typescript
// Set provider in code, let env vars handle model
export const PROMPT_GENERATE_ASSESSMENT_COMPONENTS = {
  provider: "anthropic" as AIProvider,
  model: undefined,  // Will use ANTHROPIC_MODEL_ASSESSMENT_GENERATION or ANTHROPIC_MODEL
  // ...
};
```

**In `config.env`:**
```env
ANTHROPIC_MODEL_ASSESSMENT_GENERATION=claude-3-5-sonnet-20241022
```

## Verifying Configuration

When the server starts, it logs the configuration for each use case:

```
✅ LangChain AI initialized
📋 Provider configuration per use case:
   assessment_generation: anthropic (claude-3-5-sonnet-20241022)
   assessment_chat: openai (gpt-4o-mini)
   interview_questions: gemini (gemini-1.5-pro)
   interview_summary: anthropic (claude-3-5-haiku-20241022)
```

This shows which provider and model will be used for each use case.

