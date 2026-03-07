# Authentication and Access

### AUTH_01
All user authentication is handled through Clerk.

The web app and CLI authentication flows should rely on Clerk as the identity provider rather than introducing a separate custom auth system in v1.

### AUTH_02
Project ownership is the core access-control rule in v1.

Each project belongs to exactly one user in the initial version, and only that user can view or interact with that project's scenarios, runs, and configuration.

### AUTH_03
V1 does not include a role system or multi-user collaboration.

There are no admin, editor, or viewer roles in the initial version, and projects are single-user only.

### AUTH_04
Web app access requires an authenticated Clerk user.

Users must sign in through the web app before they can create projects, edit scenarios, or inspect run results.

### AUTH_05
CLI access requires OAuth 2.0 login through the user's browser.

The CLI initiates an authorization flow, the user authenticates in the browser through Clerk, and the CLI receives an access token for API requests.

### AUTH_06
CLI tokens are user-bound and must only be used against that user's projects.

Although the token represents the authenticated user, every CLI operation must still be executed against a specific project owned by that same user.

### AUTH_07
Authentication and authorization failures are explicit API outcomes.

The system should clearly distinguish unauthenticated requests, expired or invalid tokens, and authenticated users attempting to access projects they do not own.

### AUTH_08
Project creation establishes ownership immediately.

When a user creates a project, that user becomes its owner and can immediately author scenarios and run evaluations within it.

### AUTH_09
Project access rules must apply consistently across web and CLI surfaces.

A user who owns a project in the web app should be able to use the CLI against that same project, and a user who does not own the project should be blocked in both places.

### AUTH_10
Sensitive credentials remain outside scenario content.

Authentication tokens, local secrets, and environment credentials used during execution must not be stored as part of scenario definitions or exposed through normal project authoring flows.
