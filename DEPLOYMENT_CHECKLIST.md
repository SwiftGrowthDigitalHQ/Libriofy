# Super Admin Auth Repair - Quick Deployment Checklist

**Deployment Date**: [Enter Date]  
**Status**: [Enter Status]  
**Engineer**: [Enter Name]  

---

## PRE-DEPLOYMENT CHECKS (Dev Environment)

- [ ] Clone/pull latest code with fixes
- [ ] Verify build: `npm run build` (should complete without errors)
- [ ] Confirm files exist:
  - [ ] `supabase/migrations/20260510180000_auth_trusted_devices_rls_fix.sql`
  - [ ] `src/lib/otpAuth.server.ts` (with rls_policy_violation classification)
  - [ ] `src/lib/authRuntimeIntegrity.server.ts` (with AUTH_RLS_POLICY_FAILURE)

---

## DATABASE MIGRATION (Production - Maintenance Window)

**Time Window**: __________ (Recommend: Low-traffic hours)  
**Duration**: ~5 minutes

### Migration Application

**Method A: Via Supabase CLI**
```bash
supabase migration up
# Output should show:
# → Applied migration: 20260510180000_auth_trusted_devices_rls_fix.sql
```

**Method B: Via Supabase Dashboard**
- [ ] Login to Supabase dashboard
- [ ] Navigate to SQL Editor
- [ ] Create new query
- [ ] Copy entire contents of `supabase/migrations/20260510180000_auth_trusted_devices_rls_fix.sql`
- [ ] Run query
- [ ] Verify: No errors, query completed successfully

### Verification (Post-Migration)

Run in Supabase SQL Editor:
```sql
-- Check 1: Verify policies exist
SELECT COUNT(*) as total_policies, 
       COUNT(CASE WHEN policyname LIKE 'service_role%' THEN 1 END) as service_role_policies
FROM pg_policies
WHERE schemaname='public' AND tablename='auth_trusted_devices';

-- Expected: total_policies >= 7, service_role_policies >= 4
```

- [ ] Result shows 7+ total policies
- [ ] Result shows 4+ service_role policies
- [ ] No SQL errors

---

## CODE DEPLOYMENT (Production)

**Deployment Method**: [Select one]
- [ ] **Option A**: Git push to main → Vercel auto-deploys
- [ ] **Option B**: Manual Vercel deploy: `vercel --prod`
- [ ] **Option C**: Vercel dashboard manual deploy

**Deployment Steps**:
1. [ ] Code pushed/deployed to production
2. [ ] Build completed successfully
3. [ ] Deployment URL: `https://www.libriofy.com`
4. [ ] Verify code is running (check version via network tab or Vercel dashboard)

---

## PRODUCTION SMOKE TESTS (Post-Deployment)

### Test 1: Health Check
```bash
curl -s https://www.libriofy.com/api/health/ready | jq '.ok'
```
- [ ] Response: `true`
- [ ] Status code: 200

### Test 2: Super Admin Login
```
1. Navigate to: https://www.libriofy.com/super-admin-login
2. Enter test super admin email
3. Wait for OTP email
4. Enter OTP code
```
- [ ] Step 3: Email received (check email)
- [ ] Step 4: Login succeeds, redirects to super admin dashboard
- [ ] NOT: 503 Service Unavailable

### Test 3: Session Refresh
```
1. After login, keep page open for 2+ minutes
2. Check Network tab for auth/refresh requests
3. Verify refresh returns 200
```
- [ ] Refresh token requests return 200 OK
- [ ] NOT: 503 errors
- [ ] NOT: 401 Unauthorized

### Test 4: Multiple Logins
```
1. Logout from super admin
2. Repeat Test 2 with different test account (if available)
3. Verify consistent success
```
- [ ] Test 2 succeeds
- [ ] No intermittent 503s
- [ ] Multiple sessions created successfully

---

## ERROR MONITORING (24 Hours Post-Deployment)

### Observability Checks

Check application logs for:
```
SHOULD NOT APPEAR:
- "AUTH_RLS_POLICY_VIOLATION"
- "new row violates row level security"
- Error code 42501 on auth_trusted_devices INSERT

SHOULD APPEAR (IF ANY ERRORS):
- "AUTH_RLS_POLICY_FAILURE" (with context about what's misconfigured)
- Proper error categorization with remediations
```

### Monitoring Dashboard
- [ ] Check Sentry/error tracking for spike in AUTH_SESSION_STORE_UNAVAILABLE
- [ ] Monitor super admin login success rate (should be high)
- [ ] Check database slow query logs (auth_trusted_devices INSERT/UPDATE should be fast)

### Log Search (Sentry/Datadog/CloudWatch)

Search for:
```
"AUTH_SESSION_STORE_FAILURE" OR "rls_policy_violation" OR "42501"
```

- [ ] No results = SUCCESS ✓
- [ ] Results = Investigate immediately ⚠️

---

## ROLLBACK PROCEDURES

### If Issues Occur During Deployment

**Option 1: Revert Code Only** (Database unchanged)
```bash
# Revert to previous code version via Vercel
# From Vercel dashboard:
# 1. Go to Deployments
# 2. Find last known good deployment
# 3. Click "Promote to Production"

# Result: Old code runs against fixed database (no sessions lost)
# Status: Login should work but may not see improved error messages
```

**Option 2: Full Rollback** (Database + Code)
```bash
# 1. Revert Supabase migration
supabase migration down 1

# 2. Revert code to previous version via Vercel

# Result: Complete rollback
# Status: Back to original state (login fails with 503)
# WARNING: Do this only if migration caused issues
```

**Rollback Decision Matrix**:
| Issue | Rollback Strategy |
|-------|-------------------|
| Code deployment failed | Option 1 (code only) |
| Database migration failed | Option 2 (full) |
| Auth still returning 503 | INVESTIGATE - don't rollback |
| Unexpected RLS policy errors | Option 1 (code), keep DB fixed |

---

## POST-DEPLOYMENT SIGN-OFF

### Deployment Completed By
- [ ] **Engineer Name**: ________________________
- [ ] **Timestamp**: ________________________
- [ ] **Deployment ID/Commit**: ________________________

### Verification Completed By
- [ ] **QA/Reviewer Name**: ________________________
- [ ] **Timestamp**: ________________________
- [ ] **All checks passed**: YES / NO

### Incident Response Contact
- [ ] **On-call Engineer**: ________________________
- [ ] **Escalation Number**: ________________________
- [ ] **Slack Channel**: ________________________

---

## COMMON ISSUES & QUICK FIXES

### Issue: Still seeing 503 after deployment

**Diagnostic**:
1. Check if database migration was applied
2. Verify service_role policies exist: `SELECT * FROM pg_policies WHERE tablename='auth_trusted_devices' AND policyname LIKE '%service_role%'`
3. Check Supabase logs for RLS errors

**Fix**:
- Rerun database migration
- Clear browser cache (Ctrl+Shift+Delete)
- Test in private/incognito window

### Issue: OTP sent but verify fails with different error

**Diagnostic**:
1. Check error code returned
2. Look for "rls_policy_violation" in logs
3. Verify service_role_insert policy exists

**Fix**:
- Confirm all 4 service_role policies were created
- Check that RLS is enabled on auth_trusted_devices
- Verify SUPABASE_SERVICE_ROLE_KEY is valid

### Issue: Login works but refresh fails

**Diagnostic**:
1. Check if UPDATE policy for service_role was created
2. Verify refresh endpoint returns specific error

**Fix**:
- Ensure "service_role update trusted devices" policy exists
- Check database logs for specific RLS violations

---

## Success Criteria

✅ **Deployment is successful if**:
1. Super admin login succeeds (no 503)
2. OTP verification succeeds (no 503)
3. Session refresh succeeds (no 503)
4. All 7+ RLS policies are created
5. No AUTH_RLS_POLICY_VIOLATION errors in logs
6. Health check passes: `api/health/ready?flow=super_admin_verify`

---

## Documentation

Related files:
- `SUPER_ADMIN_AUTH_REPAIR_COMPLETE.md` - Full technical details
- `AUTH_SYSTEM_FLOW.md` - System architecture
- `supabase/migrations/20260510180000_auth_trusted_devices_rls_fix.sql` - Migration source

---

**Last Updated**: May 10, 2026  
**Status**: Ready for deployment  
