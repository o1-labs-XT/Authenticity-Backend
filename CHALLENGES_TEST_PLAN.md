# Challenges Resource Test Plan - Focused Approach

## Philosophy
Only test what provides value:
- Business logic and validation rules
- API contract (response shapes)
- Error handling patterns
- Things that could break during refactoring

Skip testing:
- Simple database call forwarding
- Framework behavior (Express, Knex)
- Implementation details

## Tests to Implement

### 1. Handler Validation Tests (`test/handlers/challenges.handler.test.ts`)

Focus on **actual business logic** that could have bugs:

#### `createChallenge` Validation
- ✅ Should require all mandatory fields (title, description, startTime, endTime)
- ✅ Should return specific field errors for missing data
- ✅ Should handle invalid date strings gracefully
- ✅ Should validate startTime < endTime (if we add this business rule)

#### Response Transformation
- ✅ Should transform snake_case to camelCase in responses
- ✅ Should convert date strings to Date objects
- ✅ Should return consistent shape for all endpoints

#### Error Handling
- ✅ Should use ApiError with correct status codes
- ✅ Should pass errors to next() for middleware handling

### 2. Repository Tests - SKIP MOST

Only test if there's actual logic:
- ❌ Skip testing simple Knex method calls
- ❌ Skip testing parameter passing
- ✅ Only test if we add business logic (e.g., data transformation)

## Implementation

```typescript
// test/handlers/challenges.handler.test.ts

describe('ChallengesHandler', () => {
  describe('createChallenge validation', () => {
    it('should require title field');
    it('should require description field');
    it('should require startTime field');
    it('should require endTime field');
    it('should handle invalid date format');
    // Add more as business rules emerge
  });

  describe('response transformation', () => {
    it('should convert snake_case to camelCase');
    it('should format dates consistently');
  });

  describe('error handling', () => {
    it('should return 404 for missing challenge');
    it('should return 201 for successful creation');
    it('should return 204 for successful deletion');
  });
});
```

## Why This Approach is Better

1. **Tests have clear value** - Each test prevents a real bug
2. **Fast to write and maintain** - Less mocking complexity
3. **Documents business rules** - Tests show what's actually required
4. **Resilient to refactoring** - Test behavior, not implementation

## Future Integration Tests

Later, test the full stack:
- Database constraints
- Transaction behavior
- Concurrent updates
- Full HTTP request/response cycle

## Decision

Write ~10-15 focused unit tests that actually provide value, not 50+ tests that just verify mocking.