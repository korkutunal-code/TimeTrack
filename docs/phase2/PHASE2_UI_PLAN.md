# Phase 2 UI Plan

**Date:** 2026-05-25  
**Status:** Draft

## Overview

UI components and screens for Phase 2 HR leave and timesheet approval features.

## Design Principles

1. Mobile-first for employee actions
2. 2-3 taps maximum for common tasks
3. Consistent with Phase 1 design language (Tailwind, Radix UI)
4. Clear status indicators with color coding
5. Accessible (WCAG 2.1 AA)

## Employee Screens

### Leave Dashboard

- Available balances (cards per leave type)
- Pending requests list
- "Request Leave" button (primary action)
- Calendar view showing approved leave and holidays

### Request Leave Form

- Leave type selector
- Date range picker
- Days calculation (auto, excludes weekends/holidays)
- Reason field (optional or required based on leave type)
- Submit button

### Timesheet View

- Weekly hours summary
- Daily breakdown
- Submit for approval button
- Status indicator (draft/submitted/approved)

## Manager Screens

### Team Leave

- Pending requests list (approve/deny actions)
- Team calendar view
- Leave usage summary per employee

### Team Timesheets

- Submitted timesheets list
- Approve/reject actions with notes
- Weekly summary report

## Admin Screens

### Leave Types Management

- List of leave types
- Create/edit form
- Color picker, accrual settings

### Public Holidays Management

- Calendar view
- Add/edit/delete holidays
- Recurring vs one-time

### Work Schedules Management

- Default schedule settings
- Per-employee overrides
- Effective date ranges

## Component Library

### New Components

- LeaveBalanceCard: Shows balance for one leave type
- LeaveRequestForm: Request leave modal/screen
- LeaveRequestList: List of requests with status
- TimesheetApprovalCard: Weekly timesheet with approval actions
- HolidayCalendar: Calendar with holidays and leave
- StatusBadge: Consistent status indicators

### Reused Components

- Button, Card, Badge, Dialog (from Phase 1)
- Calendar components (react-day-picker)
- Form components (Radix UI)

## Wireframes

### Employee Leave Request Flow

1. Tap "Request Leave" → Form opens
2. Select leave type → Balance shown
3. Pick date range → Days calculated
4. Add reason (if required) → Submit
5. Confirmation toast → Request appears in pending list

### Manager Approval Flow

1. Notification badge on Team Leave
2. View pending requests list
3. Tap request → Details modal
4. Approve/Deny with notes → Action
5. Confirmation toast → Request moves to approved/denied

## Responsive Design

- Mobile: Single column, full-width buttons
- Tablet: Two-column layout for lists
- Desktop: Sidebar navigation, detailed tables

## Accessibility

- ARIA labels for all interactive elements
- Keyboard navigation support
- Color contrast ratios meet WCAG AA
- Screen reader announcements for status changes

## Technology Stack

- React + TypeScript
- Tailwind CSS v4
- Radix UI primitives
- react-day-picker for calendars
- sonner for toast notifications
- lucide-react for icons
