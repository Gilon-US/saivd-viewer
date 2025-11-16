# Epic: Simplify SAIVD-Viewer to Core Video Management Features

## Epic Overview

**Epic Title**: Simplify SAIVD-Viewer to Core Video Management Features  
**Epic ID**: SAIVD-002  
**Type**: Brownfield Simplification  
**Priority**: High  
**Status**: Planning  
**Estimated Story Points**: 13  
**Target Release**: Q1 2025  

## Epic Goal

Transform the forked SAVD App codebase into a streamlined SAIVD-Viewer application that focuses solely on video upload, management, and playback by removing all watermarking and profile features, creating a simplified application where users upload pre-watermarked videos and view them using the integrated video player component.

## Business Context

### Problem Statement

The SAIVD-Viewer application was forked from the full-featured SAVD App but requires a different, simplified feature set. The current codebase contains extensive watermarking workflow infrastructure, public sharing capabilities, and profile features that are not needed for the SAIVD-Viewer use case. This unnecessary complexity:

- Increases maintenance burden
- Creates confusion for users expecting a simpler interface
- Adds technical debt to the codebase
- Complicates future development
- Includes unused database tables and API endpoints

### Business Value

- **Reduced Complexity**: Simpler codebase is easier to maintain and extend
- **Focused User Experience**: Users get a streamlined interface for core video management
- **Lower Technical Debt**: Remove unused features and infrastructure
- **Faster Development**: Future enhancements are easier without unnecessary complexity
- **Cost Reduction**: Fewer external service dependencies (no watermarking service)

### Success Metrics

- **Codebase Reduction**: 30%+ reduction in lines of code
- **Performance**: Page load times improved by 20%+
- **Functionality**: 100% of core features (upload, manage, play) working correctly
- **Error Rate**: Zero errors related to removed features
- **User Satisfaction**: Simplified UI receives positive feedback

## Existing System Context

### Current Relevant Functionality

The forked codebase currently includes:
- Full video upload workflow with Wasabi storage
- External watermarking service integration
- Watermarked video management and tracking
- Public URL generation for sharing
- Public video viewing pages
- User profile pages with photos
- Complex video grid showing original and watermarked versions

### Technology Stack

- **Frontend**: Next.js 15, TypeScript, React, Tailwind CSS, Shadcn UI
- **Backend**: Next.js API routes
- **Database**: Supabase PostgreSQL with Row-Level Security
- **Storage**: Wasabi Cloud Storage (S3-compatible)
- **Authentication**: Supabase Auth
- **External Services**: Watermarking API (TO BE REMOVED)

### Current Architecture Patterns

- Monorepo structure with Next.js App Router
- Serverless architecture using API routes
- Row-level security for data isolation
- Pre-signed URLs for direct uploads
- Asynchronous processing with callbacks

### Integration Points with Existing System

**Database:**
- `videos` table (KEEP - core functionality)
- `watermarked_videos` table (REMOVE)
- `watermarking_jobs` table (REMOVE)
- `public_access_tokens` table (REMOVE)
- `profiles` table (SIMPLIFY - remove photo column)

**API Routes:**
- `/api/auth/*` (KEEP)
- `/api/videos/*` (KEEP - core endpoints)
- `/api/videos/[id]/watermark/*` (REMOVE)
- `/api/callbacks/watermark` (REMOVE)
- `/api/videos/[id]/public-url` (REMOVE)
- `/api/profile/*` (REMOVE)

**Frontend Components:**
- Video upload components (KEEP)
- Video player component (KEEP - CRITICAL)
- Video grid/dashboard (KEEP - SIMPLIFY)
- Watermarking components (REMOVE)
- Profile components (REMOVE)
- Public sharing components (REMOVE)

**External Services:**
- Supabase (KEEP)
- Wasabi Storage (KEEP)
- Watermarking Service (REMOVE)

## Enhancement Details

### What's Being Added/Changed

This is a **simplification epic** that removes unnecessary features from the forked codebase.

**Features to REMOVE:**

1. **Watermarking Workflow:**
   - Watermarking API integration and service client
   - Watermarked videos database table and related schema
   - Watermarking jobs tracking table
   - All watermarking UI components (buttons, status indicators)
   - Watermarking API endpoints
   - Callback handling for watermarking completion

2. **Public Sharing Features:**
   - Public URL generation functionality
   - Public access tokens table
   - Public video viewing pages (`/watch/[token]`)
   - Sharing-related API endpoints
   - Share button UI components

3. **Profile Features:**
   - Public profile pages and components
   - Profile photo functionality
   - Profile-related API endpoints
   - Profile-specific database columns (photo)
   - Profile navigation links

**Features to KEEP:**

- User authentication (Supabase Auth)
- Video upload functionality
- Video storage (Wasabi integration)
- Video management (list, view, delete)
- Video player component (CRITICAL - this is the core feature)
- Video grid/dashboard (simplified to show only uploaded videos)
- User isolation (users only see their own videos)
- Basic user profile data (for authentication purposes)

### How It Integrates

- **Database**: Simplifies schema by removing 3 tables and unnecessary columns
- **API**: Reduces API surface area by removing ~8 endpoints
- **Frontend**: Streamlines UI by removing complex watermarking and sharing workflows
- **Services**: Eliminates external watermarking service dependency
- **Performance**: Improves load times by reducing complexity

### Success Criteria

1. Application runs successfully with simplified feature set
2. Users can upload videos (pre-watermarked) without watermarking options
3. Users can view uploaded videos in a clean grid interface
4. Video player component works correctly for all uploaded videos
5. Users can delete their videos
6. No references to removed features remain in codebase
7. Database contains only necessary tables
8. All video management functionality passes testing
9. Application performance maintained or improved
10. Zero errors related to removed features
11. Documentation updated to reflect simplified application
12. Codebase is cleaner and more maintainable

## User Stories Breakdown

### Story 1: Remove Watermarking Backend Infrastructure

**Story Points**: 5  
**Priority**: High  
**Dependencies**: None  

**As a** developer  
**I want to** remove all backend components related to the watermarking workflow  
**So that** the codebase is simplified and no longer depends on external watermarking services  

**Key Tasks:**
- Drop `watermarked_videos` database table with proper migration
- Drop `watermarking_jobs` database table with proper migration
- Remove watermarking API endpoints (`/api/videos/[id]/watermark/*`, `/api/callbacks/watermark`)
- Remove watermarking service client code (`/lib/watermark.ts`)
- Remove watermarking-related environment variables
- Update database views that reference watermarking tables
- Clean up any orphaned foreign key references
- Remove watermarking-related utility functions
- Update API documentation

**Acceptance Criteria:**
- Watermarking database tables successfully removed
- All watermarking API endpoints return 404
- Watermarking service client code deleted
- No references to watermarking in backend code
- Database migrations tested and documented
- All existing video management APIs still functional
- Unit tests updated and passing

### Story 2: Remove Profile and Public Sharing Features

**Story Points**: 5  
**Priority**: High  
**Dependencies**: Story 1  

**As a** developer  
**I want to** remove all profile and public sharing functionality  
**So that** the application focuses only on authenticated user video management  

**Key Tasks:**
- Remove `photo` column from `profiles` table (or simplify profiles table)
- Drop `public_access_tokens` table with proper migration
- Remove profile API endpoints (`/api/profile/*`)
- Remove public URL generation endpoints (`/api/videos/[id]/public-url`)
- Remove public video viewing routes (`/watch/[token]`)
- Remove public profile pages (`/profile/[userId]`)
- Clean up profile-related database policies
- Remove sharing-related utility functions
- Update navigation and routing

**Acceptance Criteria:**
- Profile and public access tables successfully removed or simplified
- All profile and sharing API endpoints return 404
- Public viewing routes removed
- No references to profiles or sharing in backend code
- Database migrations tested and documented
- User authentication still functional
- Unit tests updated and passing

### Story 3: Simplify Frontend UI and Navigation

**Story Points**: 3  
**Priority**: High  
**Dependencies**: Story 1, Story 2  

**As a** user  
**I want** a simplified interface that focuses on uploading and viewing my videos  
**So that** I can easily manage my video library without unnecessary complexity  

**Key Tasks:**
- Remove watermarking UI components (`WatermarkButton`, `WatermarkStatus`, etc.)
- Remove profile UI components (`ProfileHeader`, `ProfilePhoto`, public profile pages)
- Simplify `VideoGrid` component to show only uploaded videos (no watermarked versions)
- Simplify `VideoCard` component (remove watermark status, public URL options)
- Update navigation to remove profile and sharing links
- Verify video player component integration and functionality
- Update dashboard layout for simplified workflow
- Remove unused routes and pages
- Update user-facing documentation
- Clean up unused component imports and dependencies
- Update UI tests

**Acceptance Criteria:**
- Video grid shows only uploaded videos (no watermarked column)
- No watermarking buttons or status indicators visible
- No profile or sharing links in navigation
- Video player component works correctly for all videos
- Dashboard layout is clean and intuitive
- No broken links or UI elements
- No console errors or warnings
- All UI components render correctly on mobile and desktop
- Integration tests passing
- User can complete full workflow: upload → view list → play video → delete

## Compatibility Requirements

- [x] Existing video upload API remains functional
- [x] Video storage (Wasabi) integration unchanged
- [x] User authentication flow preserved
- [x] Video player component works correctly
- [x] Database migrations are backward compatible (with proper backup)
- [x] No breaking changes to core video management features
- [x] Performance impact is positive (reduced complexity)
- [x] User data (videos) is preserved during migration

## Risk Assessment & Mitigation

### Primary Risk: Breaking Existing Video Upload/Management Functionality

**Impact**: High  
**Probability**: Medium  

**Mitigation:**
- Create comprehensive test suite before starting removals
- Remove features incrementally (backend → sharing → frontend)
- Use feature flags to toggle removed functionality during transition
- Maintain detailed documentation of removed components
- Test video upload and playback after each story completion
- Perform thorough regression testing

**Rollback Plan:**
- Maintain database backups before each migration
- Keep git branches for each major removal phase
- Document all removed endpoints and components for potential restoration
- Use database migration rollback scripts
- Maintain staging environment with original codebase for comparison

### Secondary Risk: Database Migration Complexity

**Impact**: High  
**Probability**: Low  

**Mitigation:**
- Test migrations in development environment first
- Create rollback scripts for each migration
- Backup production database before migrations
- Use Supabase migration tools properly
- Verify foreign key constraints before dropping tables
- Test data integrity after migrations

### Tertiary Risk: Orphaned Code or Dependencies

**Impact**: Medium  
**Probability**: Medium  

**Mitigation:**
- Use code search tools to find all references
- Review import statements across codebase
- Check for unused environment variables
- Remove unused npm packages
- Run linting and type checking
- Perform code review for each story

## Dependencies

### Internal Dependencies

- Existing video upload and storage infrastructure
- Supabase authentication system
- Video player component
- Current database schema and RLS policies

### External Dependencies

- Supabase (database and auth)
- Wasabi Cloud Storage
- Next.js framework
- React and TypeScript

### Removed Dependencies

- External watermarking service API
- Watermarking service authentication tokens
- Public URL generation libraries

## Definition of Done

### Epic Completion Criteria

- [x] All three stories completed with acceptance criteria met
- [x] Watermarking infrastructure completely removed from codebase
- [x] Profile and sharing features completely removed from codebase
- [x] Frontend UI simplified and functional
- [x] Video upload functionality verified working
- [x] Video player component verified working for all video formats
- [x] Video management (list, delete) verified working
- [x] Database schema cleaned and optimized
- [x] No broken links or UI elements
- [x] No console errors or warnings
- [x] All tests passing (unit, integration, e2e)
- [x] Documentation updated to reflect simplified application
- [x] Code review completed for all changes
- [x] No regression in existing core features
- [x] Performance benchmarks met or exceeded

### Quality Gates

- [x] Code review completed for all changes
- [x] Unit tests written and passing (>85% coverage)
- [x] Integration tests passing
- [x] End-to-end tests passing for core workflows
- [x] Database migrations tested and documented
- [x] No high/critical security issues
- [x] Performance testing shows improvement or no degradation
- [x] Cross-browser testing completed
- [x] Mobile responsiveness verified
- [x] Accessibility standards maintained

## Timeline

### Story 1: Backend Infrastructure Removal (Week 1)
- Database schema changes and migrations
- API endpoint removal
- Service client cleanup
- Testing and validation

### Story 2: Profile and Sharing Removal (Week 2)
- Additional database changes
- API endpoint removal
- Route cleanup
- Testing and validation

### Story 3: Frontend Simplification (Week 3)
- UI component removal and simplification
- Navigation updates
- Video player verification
- End-to-end testing
- Documentation updates

## Story Manager Handoff

**Story Manager Handoff:**

"Please develop detailed user stories for this brownfield simplification epic. Key considerations:

- This is a **removal/simplification project** for an existing system running Next.js 15, TypeScript, React, Supabase PostgreSQL, and Wasabi Cloud Storage
- Integration points: Supabase authentication, Wasabi storage, video upload API, video player component
- Existing patterns to follow: Current Next.js App Router structure, Supabase RLS policies, API route patterns
- Critical compatibility requirements:
  - Video upload functionality must continue working
  - Video player component must work correctly
  - User authentication must remain functional
  - Database integrity must be maintained
- Each story must include verification that existing video management functionality remains intact
- Stories should be executed in sequence: Backend removal → Sharing/Profile removal → Frontend simplification
- Emphasize testing after each removal to catch breaking changes early

The epic should maintain system integrity while delivering a simplified, focused video management and playback application."

---

**Epic Owner**: Product Manager  
**Technical Lead**: Senior Full-Stack Developer  
**Created**: 2025-11-13  
**Last Updated**: 2025-11-13
