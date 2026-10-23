# ClearShift Redis Streams Relay & Consumer Recovery Runbook (PLT-09)

## 1. Overview & Architectural Principles

In accordance with **ClearShift Project Plan v3.0 §§9.3–9.6, 17** and the non-negotiable constraints of **Issue #64 ([PLT-09])**:
1. **PostgreSQL Is the Single Source of Truth**: All domain writes and outbox event envelopes commit atomically in the same local PostgreSQL transaction. If Redis is down, business transactions continue to commit safely, accumulating events in `platform.outbox`.
2. **At-Least-Once Delivery**: The Redis Streams relay worker (`apps/hub/src/events/relay.ts`) polls unpublished outbox records in FIFO order and publishes them to Redis Streams via `XADD`. Because network partitions or crashes can occur after Redis accepts the message but before PostgreSQL updates `published_at`, consumers must handle duplicate deliveries idempotently.
3. **Durable Deduplication**: Consumers inherit from `IdempotentEventConsumer` (`packages/core/src/events/consumer.ts`). Each consumer records processed `event_id`s in `platform.consumed_events` within the *same* database transaction that applies business state mutations. Duplicate deliveries are skipped without repeating side-effects.
4. **Late Acknowledgement**: Consumers acknowledge messages (`XACK`) in Redis **only after** their database transaction commits successfully.
5. **30-Day Retention Invariant**: PostgreSQL retains published outbox rows for at least 30 days. Unpublished rows are never deleted. Redis stream trimming never trims entries that remain pending in any configured consumer group.

---

## 2. Infrastructure Configuration (Redis Durability)

To prevent silent message loss under memory pressure:
- **AOF Persistence**: Redis must run with `--appendonly yes`.
- **Eviction Policy**: Set `--maxmemory-policy noeviction` so Redis rejects writes rather than evicting stream entries or consumer group state when memory limits are reached.
- **Docker Compose Definition** (`docker/compose.yml` and `infra/compose.yaml`):
  ```yaml
  redis:
    image: redis:8-alpine
    container_name: clearshift-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory-policy noeviction
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
  ```

---

## 3. Failure Modes & Operational Runbooks

### 3.1 Failure Mode A: Crash After DB Commit but Before Redis Publish
- **Symptom**: Outbox record has `published_at IS NULL` in `platform.outbox`.
- **Root Cause**: The application node terminated or network to Redis timed out after PostgreSQL committed the transaction.
- **Automated Recovery**:
  1. The `OutboxRelay` worker automatically picks up any rows where `published_at IS NULL` during its next polling batch (`relayOnce()`).
  2. The relay worker retries with exponential backoff up to `maxRetries` (default: 5).
  3. If Redis recovers, the event is published via `XADD` and marked `published_at = NOW()`.
- **Operator Verification**:
  ```sql
  -- Inspect pending/failing outbox backlog
  SELECT id, event_id, event_type, created_at, retry_count, last_error
  FROM platform.outbox
  WHERE published_at IS NULL
  ORDER BY created_at ASC
  LIMIT 20;
  ```

---

### 3.2 Failure Mode B: Consumer Crash Mid-Processing (Abandoned Pending Messages)
- **Symptom**: A consumer read a message using `XREADGROUP`, but crashed before committing the transaction or calling `XACK`. The message remains in the Redis Pending Entries List (PEL).
- **Automated Recovery**:
  1. Active consumer instances periodically invoke `recoverPending(minIdleTimeMs)` (default: 30,000ms idle).
  2. The consumer issues `XAUTOCLAIM clearshift:events <group> <consumerName> 30000 0-0 COUNT 10`.
  3. Reclaimed messages are re-processed.
  4. If the business transaction previously committed before the crash, `isEventConsumed` detects the existing entry in `platform.consumed_events`, skips duplicate execution, and executes `XACK`.
- **Operator Inspection**:
  ```bash
  # Check pending messages in consumer group
  redis-cli XPENDING clearshift:events crm1-sync-group

  # Check specific idle pending messages
  redis-cli XPENDING clearshift:events crm1-sync-group - + 10
  ```

---

### 3.3 Failure Mode C: Total Redis Data Loss (Disaster Recovery & Replay)
- **Symptom**: Redis volume was corrupted, flushed, or recreated. All streams and consumer groups are empty.
- **Recovery Procedure**:
  1. Ensure Redis is up and healthy (`redis-cli ping` returns `PONG`).
  2. Recreate consumer groups:
     ```bash
     redis-cli XGROUP CREATE clearshift:events crm1-sync-group 0 MKSTREAM
     ```
  3. Execute the outbox replay command from the Hub management service:
     ```typescript
     import { OutboxRelay } from '@cs/hub/events/relay';
     import { getDatabase } from '@cs/db';

     const relay = new OutboxRelay(getDatabase(), redisClient);
     // Replays retained outbox events with their original event_id and payload
     const result = await relay.replay({
       since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
     });
     console.log(`Replayed ${result.replayedCount} events.`);
     ```
  4. **Idempotency Guarantee**: Downstream consumers consuming the replayed stream will check `platform.consumed_events`. Any event that was already executed prior to the crash will be detected as a duplicate, skipped, and acknowledged without corrupting business data.

---

### 3.4 Failure Mode D: Stream Trimming & Retention Governance
- **Requirement**: Never trim pending/unacknowledged stream entries.
- **Policy**:
  - PostgreSQL outbox records younger than 30 days are **never deleted**.
  - Stream entries are only trimmed using `MINID` after verifying that no consumer group has pending entries older than the threshold.
- **Automated Retention Script**:
  ```typescript
  // 1. Purge PostgreSQL outbox records older than 30 days that have published_at set
  const purgedDbRows = await OutboxRepository.purgeExpired(db, 30);

  // 2. Safely trim Redis stream without removing pending entries
  const trimResult = await relay.trimSafely(['crm1-sync-group', 'crm5-projector-group'], 30);
  ```

---

## 4. Operational Health Metrics & Verification Queries

### Outbox Health Query (PostgreSQL)
```sql
SELECT
  COUNT(*) FILTER (WHERE published_at IS NULL AND retry_count < 5) AS backlog_ready,
  COUNT(*) FILTER (WHERE published_at IS NULL AND retry_count >= 5) AS permanent_failures,
  COUNT(*) FILTER (WHERE published_at IS NOT NULL) AS published_retained,
  MAX(NOW() - created_at) FILTER (WHERE published_at IS NULL) AS oldest_unpublished_age
FROM platform.outbox;
```

### Redis Consumer Group Lag Check
```bash
# View consumer group summary, lag, and last delivered ID
redis-cli XINFO GROUPS clearshift:events
```

---

## 5. Escalation & Troubleshooting Contacts
- **Stream Owner**: Platform Group 11 (Platform Role 2 + Integration Lead)
- **Downstream Consumers**: CRM-1, CRM-5, Hub Projections
- **Issue Reference**: ClearShift Issue #64 ([PLT-09])
