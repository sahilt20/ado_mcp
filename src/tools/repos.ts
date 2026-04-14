import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdoClient } from '../client.js';
import { text, error, formatDate, formatCommit, formatPullRequest, truncate } from '../utils.js';

export function register(server: McpServer, client: AdoClient) {
  server.tool(
    'list_repositories',
    'List all Git repositories in a project.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ project }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/git/repositories`);
        const repos = data.value || [];
        if (!repos.length) return text('No repositories found.');

        const lines = ['# Repositories\n'];
        for (const r of repos) {
          lines.push(`- **${r.name}** | ID: ${r.id} | Size: ${(r.size / 1024 / 1024).toFixed(1)} MB | Default branch: ${r.defaultBranch?.replace('refs/heads/', '') || 'N/A'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_repository',
    'Get detailed information about a specific Git repository.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
    },
    async ({ project, repositoryId }) => {
      try {
        const p = client.resolveProject(project);
        const r = await client.get<any>(`${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}`);
        const lines = [
          `# Repository: ${r.name}`,
          `- **ID:** ${r.id}`,
          `- **Project:** ${r.project?.name || 'N/A'}`,
          `- **Default Branch:** ${r.defaultBranch?.replace('refs/heads/', '') || 'N/A'}`,
          `- **Size:** ${(r.size / 1024 / 1024).toFixed(1)} MB`,
          `- **Remote URL:** ${r.remoteUrl || 'N/A'}`,
          `- **Web URL:** ${r.webUrl || 'N/A'}`,
          `- **Is Disabled:** ${r.isDisabled || false}`,
        ];
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_branches',
    'List all branches in a Git repository with their latest commit info.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
    },
    async ({ project, repositoryId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/refs`,
          { filter: 'heads/', '$top': '100' }
        );
        const refs = data.value || [];
        if (!refs.length) return text('No branches found.');

        const lines = ['# Branches\n'];
        for (const ref of refs) {
          const branchName = ref.name?.replace('refs/heads/', '') || 'Unknown';
          lines.push(`- **${branchName}** | Commit: ${ref.objectId?.slice(0, 8) || 'N/A'} | By: ${ref.creator?.displayName || 'Unknown'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_branch_stats',
    'Get statistics for a branch compared to the default branch (ahead/behind count).',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      branchName: z.string().describe('Branch name (without refs/heads/)'),
    },
    async ({ project, repositoryId, branchName }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/stats/branches`,
          { name: branchName }
        );
        const lines = [
          `# Branch Stats: ${branchName}`,
          `- **Ahead:** ${data.aheadCount ?? 'N/A'} commits`,
          `- **Behind:** ${data.behindCount ?? 'N/A'} commits`,
          `- **Is Base Version:** ${data.isBaseVersion ?? 'N/A'}`,
        ];
        if (data.commit) {
          lines.push(`- **Latest Commit:** ${data.commit.commitId?.slice(0, 8)} | ${data.commit.author?.name} | ${data.commit.comment}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_commits',
    'List commits in a Git repository with optional filters for branch, author, date range.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      branch: z.string().optional().describe('Branch name to list commits from'),
      author: z.string().optional().describe('Filter by author name or email'),
      fromDate: z.string().optional().describe('Start date (ISO format, e.g. 2024-01-01)'),
      toDate: z.string().optional().describe('End date (ISO format)'),
      top: z.number().optional().default(30).describe('Max commits to return (default 30)'),
      itemPath: z.string().optional().describe('Filter to commits affecting this file/folder path'),
    },
    async ({ project, repositoryId, branch, author, fromDate, toDate, top, itemPath }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = {
          '$top': top,
        };
        if (branch) params['searchCriteria.itemVersion.version'] = branch;
        if (author) params['searchCriteria.author'] = author;
        if (fromDate) params['searchCriteria.fromDate'] = fromDate;
        if (toDate) params['searchCriteria.toDate'] = toDate;
        if (itemPath) params['searchCriteria.itemPath'] = itemPath;

        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/commits`,
          params
        );
        const commits = data.value || [];
        if (!commits.length) return text('No commits found.');

        const lines = [`# Commits (${commits.length})\n`];
        for (const c of commits) {
          lines.push(formatCommit(c));
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_commit',
    'Get detailed information about a specific commit including changes.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      commitId: z.string().describe('Full or short commit SHA'),
    },
    async ({ project, repositoryId, commitId }) => {
      try {
        const p = client.resolveProject(project);
        const c = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/commits/${commitId}`,
          { changeCount: '100' }
        );
        const lines = [
          `# Commit ${c.commitId}`,
          `- **Author:** ${c.author?.name} <${c.author?.email}>`,
          `- **Date:** ${formatDate(c.author?.date)}`,
          `- **Committer:** ${c.committer?.name}`,
          `- **Message:** ${c.comment}`,
          `- **Parents:** ${(c.parents || []).map((pid: string) => pid.slice(0, 8)).join(', ') || 'None (root commit)'}`,
          `- **Change Count:** ${c.changeCounts ? `Add: ${c.changeCounts.Add || 0}, Edit: ${c.changeCounts.Edit || 0}, Delete: ${c.changeCounts.Delete || 0}` : 'N/A'}`,
        ];

        if (c.changes?.length) {
          lines.push(`\n**Changed Files:**`);
          for (const ch of c.changes.slice(0, 50)) {
            lines.push(`  - ${ch.changeType}: ${ch.item?.path || 'Unknown'}`);
          }
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_commit_changes',
    'Get the list of files changed in a specific commit.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      commitId: z.string().describe('Commit SHA'),
    },
    async ({ project, repositoryId, commitId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/commits/${commitId}/changes`
        );
        const changes = data.changes || [];
        if (!changes.length) return text('No changes in this commit.');

        const lines = [`# Changes in ${commitId.slice(0, 8)} (${changes.length} files)\n`];
        for (const ch of changes) {
          lines.push(`- ${ch.changeType}: ${ch.item?.path || 'Unknown'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_pull_requests',
    'List pull requests in a repository with optional filters for status, creator, and target branch.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      status: z.enum(['active', 'abandoned', 'completed', 'all']).optional().default('active').describe('PR status filter'),
      creatorId: z.string().optional().describe('Filter by creator display name or unique name'),
      targetBranch: z.string().optional().describe('Filter by target branch name'),
      top: z.number().optional().default(25).describe('Max results (default 25)'),
    },
    async ({ project, repositoryId, status, creatorId, targetBranch, top }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = {
          '$top': top,
        };
        if (status && status !== 'all') params['searchCriteria.status'] = status;
        if (creatorId) params['searchCriteria.creatorId'] = creatorId;
        if (targetBranch) params['searchCriteria.targetRefName'] = `refs/heads/${targetBranch}`;

        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests`,
          params
        );
        const prs = data.value || [];
        if (!prs.length) return text('No pull requests found.');

        const lines = [`# Pull Requests (${prs.length})\n`];
        for (const pr of prs) {
          const src = pr.sourceRefName?.replace('refs/heads/', '') || '?';
          const tgt = pr.targetRefName?.replace('refs/heads/', '') || '?';
          lines.push(`- **#${pr.pullRequestId}** | ${pr.status} | ${pr.createdBy?.displayName || 'Unknown'} | ${src} → ${tgt} | ${pr.title}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_pull_request',
    'Get detailed information about a specific pull request.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      pullRequestId: z.number().describe('Pull request ID'),
    },
    async ({ project, repositoryId, pullRequestId }) => {
      try {
        const p = client.resolveProject(project);
        const pr = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}`
        );
        return text(formatPullRequest(pr));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_pull_request_threads',
    'Get all review comment threads on a pull request, including inline code comments and general discussions.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      pullRequestId: z.number().describe('Pull request ID'),
    },
    async ({ project, repositoryId, pullRequestId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/threads`
        );
        const threads = data.value || [];
        if (!threads.length) return text('No comment threads on this PR.');

        const lines = [`# PR #${pullRequestId} — Comment Threads (${threads.length})\n`];
        for (const t of threads) {
          const status = t.status || 'unknown';
          const filePath = t.threadContext?.filePath || 'General';
          lines.push(`### Thread (${status}) — ${filePath}`);
          for (const c of (t.comments || [])) {
            if (c.commentType === 'system') continue;
            lines.push(`  **${c.author?.displayName || 'Unknown'}** (${formatDate(c.publishedDate)}):`);
            lines.push(`  ${truncate(c.content, 300)}`);
          }
          lines.push('');
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_pull_request_commits',
    'Get the list of commits in a pull request.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      pullRequestId: z.number().describe('Pull request ID'),
    },
    async ({ project, repositoryId, pullRequestId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/commits`
        );
        const commits = data.value || [];
        if (!commits.length) return text('No commits in this PR.');

        const lines = [`# PR #${pullRequestId} — Commits (${commits.length})\n`];
        for (const c of commits) {
          lines.push(formatCommit(c));
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_pull_request_work_items',
    'Get work items linked to a pull request. Shows which user stories, bugs, or tasks a PR addresses.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      pullRequestId: z.number().describe('Pull request ID'),
    },
    async ({ project, repositoryId, pullRequestId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/workitems`
        );
        const items = data.value || [];
        if (!items.length) return text('No work items linked to this PR.');

        const lines = [`# PR #${pullRequestId} — Linked Work Items (${items.length})\n`];
        for (const wi of items) {
          lines.push(`- **#${wi.id}** | ${wi.url || 'N/A'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_file_content',
    'Get the content of a file from a Git repository at a specific branch or commit.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      path: z.string().describe('File path (e.g., /src/index.ts)'),
      branch: z.string().optional().describe('Branch name (defaults to default branch)'),
      commitId: z.string().optional().describe('Specific commit SHA to get file from'),
    },
    async ({ project, repositoryId, path, branch, commitId }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = {
          includeContent: 'true',
        };
        if (branch) {
          params['versionDescriptor.versionType'] = 'branch';
          params['versionDescriptor.version'] = branch;
        } else if (commitId) {
          params['versionDescriptor.versionType'] = 'commit';
          params['versionDescriptor.version'] = commitId;
        }

        const content = await client.getText(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/items`,
          { ...params, path }
        );
        return text(`# File: ${path}\n\n\`\`\`\n${truncate(content, 5000)}\n\`\`\``);
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'search_code',
    'Search for code across repositories in the organization. Supports keyword and advanced search syntax.',
    {
      searchText: z.string().describe('Search query text'),
      project: z.string().optional().describe('Limit search to a specific project'),
      repository: z.string().optional().describe('Limit search to a specific repository'),
      path: z.string().optional().describe('Limit search to a specific path (e.g., src/)'),
      top: z.number().optional().default(25).describe('Max results (default 25)'),
    },
    async ({ searchText, project, repository, path, top }) => {
      try {
        const filters: Record<string, string[]> = {};
        if (project) filters['Project'] = [project];
        if (repository) filters['Repository'] = [repository];
        if (path) filters['Path'] = [path];

        const projectPath = project ? `${encodeURIComponent(project)}/` : '';
        const data = await client.searchCode<any>(
          `${projectPath}_apis/search/codesearchresults`,
          { searchText, '$top': top, filters }
        );
        const results = data.results || [];
        if (!results.length) return text('No code search results found.');

        const lines = [`# Code Search Results (${data.count || results.length} total)\n`];
        for (const r of results) {
          lines.push(`### ${r.fileName} — ${r.repository?.name || 'N/A'} / ${r.project?.name || 'N/A'}`);
          lines.push(`  Path: ${r.path}`);
          if (r.matches?.content?.length) {
            for (const match of r.matches.content.slice(0, 3)) {
              lines.push(`  \`${truncate(match, 200)}\``);
            }
          }
          lines.push('');
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_repo_diff',
    'Compare two branches, tags, or commits in a repository. Shows files changed between two versions.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      baseVersion: z.string().describe('Base version (branch name, tag, or commit SHA)'),
      targetVersion: z.string().describe('Target version (branch name, tag, or commit SHA)'),
      baseVersionType: z.enum(['branch', 'tag', 'commit']).optional().default('branch'),
      targetVersionType: z.enum(['branch', 'tag', 'commit']).optional().default('branch'),
    },
    async ({ project, repositoryId, baseVersion, targetVersion, baseVersionType, targetVersionType }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/diffs/commits`,
          {
            'baseVersionDescriptor.version': baseVersion,
            'baseVersionDescriptor.versionType': baseVersionType,
            'targetVersionDescriptor.version': targetVersion,
            'targetVersionDescriptor.versionType': targetVersionType,
          }
        );

        const changes = data.changes || [];
        const lines = [
          `# Diff: ${baseVersion} ↔ ${targetVersion}`,
          `- **Ahead:** ${data.aheadCount ?? 'N/A'}`,
          `- **Behind:** ${data.behindCount ?? 'N/A'}`,
          `- **Files Changed:** ${changes.length}\n`,
        ];
        for (const ch of changes.slice(0, 100)) {
          lines.push(`- ${ch.changeType}: ${ch.item?.path || 'Unknown'}`);
        }
        if (changes.length > 100) {
          lines.push(`\n... and ${changes.length - 100} more files`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );
}
