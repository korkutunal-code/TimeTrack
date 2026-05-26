# Phase 2 Agent Worktree Plan

**Date:** 2026-05-25  
**Status:** Draft

## Overview
Parallel development strategy using git worktrees for Phase 2 implementation.

## Worktree Assignments

### Phase 2A: Foundation
1. **feature/phase2-leave-types**
   - Leave types model/service
   - Admin management UI
   - Default types (vacation, sick, unpaid)
   
2. **feature/phase2-public-holidays**
   - Public holidays model/service
   - Admin calendar management
   - US federal holidays seed data

3. **feature/phase2-work-schedules**
   - Work schedules model/service
   - Default schedule (Mon-Fri, 8h/day)
   - Per-employee overrides

### Phase 2B: Leave Requests
4. **feature/phase2-leave-requests**
   - Leave requests model/service
   - Employee request UI
   - Balance calculation logic

5. **feature/phase2-leave-approval**
   - Manager approval workflow
   - Approval/denial UI
   - Notification system

### Phase 2C: Timesheet Approval
6. **feature/phase2-timesheet-submission**
   - Timesheet approval model
   - Employee submission UI
   - Weekly aggregation

7. **feature/phase2-timesheet-approval**
   - Manager approval workflow
   - Approval/rejection UI
   - Audit trail integration

### Phase 2D: Integration
8. **feature/phase2-payroll-export**
   - Enhanced payroll export
   - Leave data integration
   - CSV format compatibility

9. **qa/phase2-integration-tests**
   - End-to-end workflow tests
   - Security rules validation
   - Performance testing

## Merge Order
1. Phase 2A branches → main (foundation)
2. Phase 2B branches → main (leave requests)
3. Phase 2C branches → main (timesheet approval)
4. Phase 2D branches → main (integration)

## Dependencies
- Phase 2B depends on Phase 2A (leave types must exist)
- Phase 2C depends on Phase 2A (work schedules for hour calculation)
- Phase 2D depends on Phase 2B and 2C (integration requires all features)

## Conflict Prevention
- Each worktree owns specific files/collections
- Shared files (App.tsx, database.ts) merged carefully
- Regular sync with main branch

## Testing Strategy
- Each branch: unit tests for new code
- Before merge: integration tests
- After merge: regression tests
