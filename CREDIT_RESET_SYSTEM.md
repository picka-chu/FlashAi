# Professional Credit Reset System Documentation

## Overview

The Flash AI credit reset system has been redesigned to provide **professional, reliable daily credit resets at 00:00 UTC** for all subscription plans. This system ensures every user receives their daily credit allocation automatically at midnight, regardless of when they last used the app.

## Architecture

### Components

1. **CreditResetService** (`backend/services/creditResetService.ts`)
   - Core service handling credit reset logic
   - Processes users in batches for efficiency
   - Maintains audit trail via `credit_transactions` table
   - Supports timezone-aware resets

2. **CreditResetScheduler** (`backend/tasks/creditResetScheduler.ts`)
   - Manages scheduled execution of credit resets
   - Runs at midnight UTC daily
   - Includes health checks and error handling
   - Provides manual trigger capability for testing

3. **Management Routes** (`backend/routes/creditResetRoutes.ts`)
   - Admin endpoints for monitoring and control
   - Status checks and statistics
   - Manual reset triggering

## Daily Credit Allocation

All plans receive credits at 00:00 UTC:

| Plan | Daily Credits | Duration | Features |
|------|---------------|----------|----------|
| Free | 3 | Unlimited | Limited to 7 days from signup |
| Weekly | 35 | 7 days | Recurring weekly |
| Monthly | 120 | 30 days | Recurring monthly |
| Admin | 999 | Unlimited | For administrators |

## How It Works

### Reset Process

1. **Scheduler Check** (Every minute at UTC 00:00)
   - Checks if it's midnight UTC
   - Verifies database connectivity
   - Initiates batch processing

2. **Batch Processing**
   - Fetches users in batches of 1000
   - For each user:
     - Checks if last reset was before today
     - Calculates daily quota based on plan
     - Applies reset if needed
     - Logs transaction for audit trail

3. **Credit Preservation**
   - Bonus credits above daily quota are preserved
   - Users who haven't used all credits keep them
   - Only resets when credits fall below quota

### Example Scenarios

**Scenario 1: User with Free Plan**
- Last reset: Yesterday at 00:00
- Current credits: 2
- Daily quota: 3
- Action: Reset to 3 credits

**Scenario 2: User with Bonus Credits**
- Last reset: Yesterday at 00:00
- Current credits: 50 (includes 20 bonus from referrals)
- Daily quota: 35
- Action: Keep 50 credits (bonus preserved)

**Scenario 3: Expired Free Account**
- Plan: Free
- Account age: 8 days
- Daily quota: 0 (free credits expire after 7 days)
- Action: No reset, credits remain unchanged

## Database Schema

### Required Tables

```sql
-- Users table (existing)
CREATE TABLE users (
  telegram_id BIGINT PRIMARY KEY,
  credits INTEGER DEFAULT 5,
  plan TEXT DEFAULT 'free',
  last_credit_reset TIMESTAMPTZ DEFAULT now(),
  plan_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  ...
);

-- Credit transactions (for audit trail)
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY,
  telegram_id BIGINT,
  amount INTEGER,
  transaction_type TEXT,
  description TEXT,
  balance_before INTEGER,
  balance_after INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Indexes

```sql
CREATE INDEX idx_users_last_credit_reset ON users(last_credit_reset);
CREATE INDEX idx_credit_transactions_telegram ON credit_transactions(telegram_id);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(transaction_type);
```

## Configuration

### Environment Variables

```bash
# Timezone for reset (default: UTC)
TIMEZONE=UTC

# Admin API key for manual triggers
ADMIN_API_KEY=your_secure_key_here

# Supabase configuration (existing)
SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

## API Endpoints

### Admin Endpoints

All admin endpoints require `X-Admin-Token` header with valid `ADMIN_API_KEY`.

#### Get Scheduler Status
```http
GET /api/admin/credit-reset/status
```

Response:
```json
{
  "status": "ok",
  "scheduler": {
    "isRunning": true,
    "lastResetDate": "2024-04-22",
    "checkInterval": 60000
  },
  "timestamp": "2024-04-22T00:00:00Z"
}
```

#### Get Reset Statistics
```http
GET /api/admin/credit-reset/statistics
```

Response:
```json
{
  "status": "ok",
  "data": {
    "usersNeedingReset": 1250,
    "lastResetTime": "2024-04-22T00:15:30Z"
  },
  "timestamp": "2024-04-22T00:30:00Z"
}
```

#### Trigger Manual Reset
```http
POST /api/admin/credit-reset/trigger
X-Admin-Token: your_admin_key
```

Response:
```json
{
  "status": "success",
  "message": "Credit reset triggered successfully",
  "results": {
    "processed": 5000,
    "reset": 4850,
    "skipped": 150,
    "creditsDistributed": 567500,
    "duration": "2345ms",
    "errors": []
  },
  "timestamp": "2024-04-22T00:35:00Z"
}
```

#### Health Check
```http
GET /api/admin/credit-reset/health
```

Response:
```json
{
  "status": "healthy",
  "scheduler": {
    "isRunning": true,
    "lastResetDate": "2024-04-22",
    "checkInterval": 60000
  },
  "usersNeedingReset": 1250,
  "lastResetTime": "2024-04-22T00:15:30Z",
  "timestamp": "2024-04-22T00:35:00Z"
}
```

## Monitoring & Logging

### Log Messages

The system logs important events:

```
[CreditReset] Starting midnight reset at 2024-04-22T00:00:00Z
[CreditReset] Completed in 2345ms
[CreditReset] Summary: {
  processed: 5000,
  reset: 4850,
  skipped: 150,
  creditsDistributed: 567500,
  errors: 0
}
```

### Error Handling

- **Database Connection Failures**: Logged and retried next cycle
- **User Update Failures**: Individual errors logged, process continues
- **Batch Processing**: Continues even if some users fail
- **Health Checks**: Verify database connectivity before reset

## Testing

### Manual Reset (Development)

```bash
# Trigger a manual reset via API
curl -X POST http://localhost:3000/api/admin/credit-reset/trigger \
  -H "X-Admin-Token: your_admin_key"
```

### Test Scenarios

1. **Test Free Plan Reset**
   - Create test user with free plan
   - Set `last_credit_reset` to yesterday
   - Trigger manual reset
   - Verify credits reset to 3

2. **Test Bonus Credit Preservation**
   - Create test user with 50 credits
   - Set plan to weekly (35 daily)
   - Trigger manual reset
   - Verify credits remain 50

3. **Test Expired Free Account**
   - Create test user with free plan
   - Set `created_at` to 8 days ago
   - Trigger manual reset
   - Verify credits unchanged

## Migration Guide

### Upgrading from 24-Hour Rolling Window

If upgrading from the previous 24-hour rolling window system:

1. **Database**: Ensure `last_credit_reset` column exists
2. **Schema**: Run `CONSOLIDATED_PRODUCTION_SCHEMA.sql` if needed
3. **Scheduler**: New scheduler automatically starts on server boot
4. **Monitoring**: Check logs for successful initialization

### Rollback

If needed to revert:

1. Stop the server
2. Remove scheduler initialization from `server.ts`
3. Revert to previous `syncUserCredits` implementation
4. Restart server

## Performance Considerations

- **Batch Size**: 1000 users per batch (configurable)
- **Check Interval**: 60 seconds (checks if it's midnight)
- **Processing Time**: ~2-5 seconds for 5000 users
- **Database Load**: Minimal impact, uses indexed queries
- **Memory**: Constant memory usage regardless of user count

## Security

- Admin endpoints require `X-Admin-Token` header
- Service role key used for backend operations
- All credit operations logged in `credit_transactions`
- No direct user access to reset endpoints
- Audit trail maintained for compliance

## Troubleshooting

### Credits Not Resetting

1. Check scheduler status: `GET /api/admin/credit-reset/status`
2. Verify `last_credit_reset` column exists
3. Check logs for errors
4. Manually trigger: `POST /api/admin/credit-reset/trigger`

### Performance Issues

1. Check database indexes exist
2. Monitor batch processing time
3. Adjust batch size if needed
4. Check for database connection issues

### Timezone Issues

1. Verify `TIMEZONE` environment variable
2. Check server system timezone
3. Ensure database uses UTC timestamps
4. Review logs for timezone-related errors

## Future Enhancements

- [ ] Per-user timezone support
- [ ] Gradual credit reset (hourly instead of daily)
- [ ] Credit rollover policies
- [ ] Subscription pause functionality
- [ ] Advanced analytics dashboard
- [ ] Webhook notifications for resets
- [ ] A/B testing for credit allocation

## Support

For issues or questions:

1. Check logs: `docker logs flash-ai-backend`
2. Review this documentation
3. Check database schema
4. Test with manual reset endpoint
5. Contact support team

## Version History

- **v2.0** (2024-04-22): Professional midnight reset system
  - Strict 00:00 UTC reset timing
  - Batch processing for efficiency
  - Comprehensive audit trail
  - Admin monitoring endpoints
  
- **v1.0** (Previous): 24-hour rolling window
  - Reset on user activity
  - No scheduled processing
  - Limited audit trail
