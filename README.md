# Syncist

Syncist is a tool for keeping Linear and Todoist in sync; enabling teams to manage and track development tasks in Todoist.

## Infrastructure

This is designed to be a simple tool that can easily be replicated across teams. Syncist is using Supabase for the database to enable teams to easily spin up a new environment.

All hosting and functions are being built to run on Cloudflare Workers.

## Outline

### General Behavior

1. When task added to "in progress", "testing", or "done" in Linear:

- Send to webhook
- Check for Todoist task
- If no task, create one
- Add issue ID as label
- If task found, update it as needed

2. When task completed in Todoist:

- Check if task label exists in Linear
- If so, mark done, then delete label in Todoist

### Flow (v0.1)

1. Create account
2. Oauth login for Linear
3. Oauth login for Todoist
4. Select Linear team
5. Select Todoist project

# Setup

1. Set up Supabase environment
2. Deploy worker script to Cloudflare using Wrangler CLI
3. Create Todoist application
4. Obtain Todoist token and add to secrets
5. Obtain Linear token and add to secrets
6. Set up Todoist webhook
7. Set up Linear webhook

## Configuration

### Wrangler Configuration

Create a `wrangler.toml` file in the project root with your environment variables:

```toml
name = "syncist"
main = "src/index.ts"
compatibility_date = "2023-01-01"

[vars]
# Uncomment to enable assignee filtering
# LINEAR_ASSIGNEE_ID = "your-linear-user-id"
SUPABASE_URL = "your-supabase-url"
SUPABASE_PUBLIC_KEY = "your-supabase-key"

# Note: Sensitive variables like LINEAR_API_KEY and TODOIST_API_KEY 
# should be set as secrets using: wrangler secret put LINEAR_API_KEY
```

**Note:** The `wrangler.toml` file is gitignored to protect your configuration. Make sure to create it locally and configure it with your values.

### Environment Variables

- `LINEAR_API_KEY` (required): Linear API token for authentication
- `SUPABASE_URL` (required): Supabase instance URL
- `SUPABASE_PUBLIC_KEY` (required): Supabase public API key
- `LINEAR_ASSIGNEE_ID` (optional): Filter syncing to only issues assigned to a specific user
  - Format: Linear user ID (e.g., "user-abc-123-def-456")
  - If set: Only issues assigned to this user will be synced to Todoist
  - If not set: All issues will be synced (default behavior)
  - Unassigned issues will not be synced when this filter is active
  - **Dynamic assignment behavior:**
    - When an issue is assigned to the filtered user: Automatically creates task in Todoist (if in active state)
    - When an issue is unassigned from the filtered user: Automatically removes task from Todoist
