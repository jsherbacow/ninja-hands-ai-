# Security Specification - Basketball Legends

## Data Invariants
1. A leaderboard entry must have a valid `userId` that matches the authenticated user.
2. A score must be a non-negative number.
3. Level must be at least 1.
4. `timestamp` must be the exact server time of the request.
5. Leaderboard entries are immutable once created (no updates or deletes by users).
6. User profiles can only be created and updated by the owner of that UID.
7. All document IDs must follow a strict alphanumeric format.

## The Dirty Dozen Payloads (Leaderboard)

1. **Identity Spoofing**: `{"userId": "another_user_id", "displayName": "Attacker", "score": 9999, "level": 1, "timestamp": "request.time"}`
2. **Missing Field**: `{"userId": "uid", "displayName": "Player", "score": 100, "level": 1}` (Missing timestamp)
3. **Ghost Field**: `{"userId": "uid", "displayName": "Player", "score": 100, "level": 1, "timestamp": "request.time", "isAdmin": true}`
4. **Invalid Type (Score)**: `{"userId": "uid", "displayName": "Player", "score": "9000", "level": 1, "timestamp": "request.time"}`
5. **Negative Score**: `{"userId": "uid", "displayName": "Player", "score": -50, "level": 1, "timestamp": "request.time"}`
6. **Invalid Level**: `{"userId": "uid", "displayName": "Player", "score": 100, "level": 0, "timestamp": "request.time"}`
7. **Clock Manipulation**: `{"userId": "uid", "displayName": "Player", "score": 100, "level": 1, "timestamp": "2020-01-01T00:00:00Z"}`
8. **PII Leak Attempt (displayName)**: `{"userId": "uid", "displayName": "A very long name that exceeds the 50 character limit set in rules...", "score": 100, "level": 1, "timestamp": "request.time"}`
9. **Unauthenticated Write**: `{...}` (No auth token)
10. **ID Poisoning**: `create` at `leaderboard/%00dangerousID`
11. **Malicious Update**: Attempt to `update` an existing leaderboard entry.
12. **Unauthorized Read**: `get` on a user profile that isn't yours (if PII is present).

## Test Runner
Testing will be performed via logical analysis and then by deploying the rules.
