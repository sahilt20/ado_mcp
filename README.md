# Azure DevOps MCP Server

A production-ready Model Context Protocol (MCP) server for Azure DevOps with read-only tools for Projects, Work Items, Repos, Pipelines, Releases, Tests, and Wiki.

## Repository

- GitHub: https://github.com/sahilt20/ado_mcp
- Package name: `azure-devops-mcp`
- Runtime server name: `azure-devops-mcp`

## Features

- Read-only Azure DevOps integrations
- 57 MCP tools across major Azure DevOps domains
- Standard MCP stdio transport
- Type-safe input validation using `zod`

## Tool Coverage

### Projects and Teams
- `list_projects`
- `get_project`
- `list_teams`
- `get_team_members`

### Work Items
- `get_work_item`
- `get_work_items_batch`
- `query_work_items`
- `get_work_item_updates`
- `get_work_item_comments`
- `list_iterations`
- `get_iteration_work_items`
- `list_area_paths`
- `list_work_item_types`

### Repositories and Pull Requests
- `list_repositories`
- `get_repository`
- `list_branches`
- `get_branch_stats`
- `list_commits`
- `get_commit`
- `get_commit_changes`
- `list_pull_requests`
- `get_pull_request`
- `get_pull_request_threads`
- `get_pull_request_commits`
- `get_pull_request_work_items`
- `search_code`
- `get_file_content`
- `get_repo_diff`

### Pipelines and Builds
- `list_pipelines`
- `get_pipeline_run`
- `list_pipeline_runs`
- `list_build_definitions`
- `list_builds`
- `get_build`
- `get_build_timeline`
- `get_build_log`
- `get_build_artifacts`
- `get_build_changes`

### Releases
- `list_release_definitions`
- `get_release_definition`
- `list_releases`
- `get_release`
- `get_release_approvals`

### Tests
- `list_test_plans`
- `list_test_suites`
- `list_test_runs`
- `get_test_run_results`
- `get_code_coverage`

### Wiki
- `list_wikis`
- `get_wiki_page`
- `list_wiki_pages`

### Composite / Analytics
- `get_sprint_summary`
- `trace_work_item`
- `summarize_repo_changes`
- `get_pipeline_health`
- `compare_sprints`
- `get_project_dashboard`
- `get_developer_activity`

## Prerequisites

- Node.js 18+
- npm 9+
- Azure DevOps Personal Access Token (PAT)

Recommended PAT scopes (read-only):
- Work Items: Read
- Code: Read
- Build: Read
- Release: Read
- Test Management: Read
- Project and Team: Read
- Wiki: Read

## Setup

1. Clone repository

```bash
git clone https://github.com/sahilt20/ado_mcp.git
cd ado_mcp
```

2. Install dependencies

```bash
npm install
```

3. Build

```bash
npm run build
```

4. Configure environment variables

```bash
export ADO_ORG_URL="https://dev.azure.com/<your-org>"
export ADO_PAT="<your-pat>"
# optional
export ADO_DEFAULT_PROJECT="<your-default-project>"
```

## Run

```bash
npm start
```

This starts the MCP server over stdio.

## MCP Client Configuration Example

Use this command from your MCP-compatible client configuration:

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "node",
      "args": ["/absolute/path/to/ado_mcp/dist/index.js"],
      "env": {
        "ADO_ORG_URL": "https://dev.azure.com/<your-org>",
        "ADO_PAT": "<your-pat>",
        "ADO_DEFAULT_PROJECT": "<optional-default-project>"
      }
    }
  }
}
```

If installed globally, you can use the binary command directly:

```bash
npm install -g .
azure-devops-mcp
```

## Development

Watch mode:

```bash
npm run dev
```

Compile once:

```bash
npm run build
```

## Publish to GitHub with CLI

If starting from scratch in a local folder:

```bash
git init -b main
git add .
git commit -m "Initial commit"
gh auth login
gh repo create <repo-name> --source=. --remote=origin --public --push
```

Use `--private` instead of `--public` if needed.

## Troubleshooting

- `ADO_ORG_URL environment variable is required`
  - Set `ADO_ORG_URL` to your org URL, for example `https://dev.azure.com/myorg`
- `ADO_PAT environment variable is required`
  - Generate PAT: `https://dev.azure.com/<org>/_usersSettings/tokens`
- Permission errors from tools
  - Verify PAT has matching read scopes for requested API area

## Security Notes

- Never commit PATs or `.env` files with secrets
- Rotate PATs regularly
- Keep this server read-only unless you intentionally add write endpoints

## License

MIT (or your preferred license)
