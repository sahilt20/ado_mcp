import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdoClient } from '../client.js';
import { text, error, formatDate, formatWorkItem, truncate, stripHtml } from '../utils.js';

export function register(server: McpServer, client: AdoClient) {
  // ── Trace the full journey of a work item ──────────────────────────
  server.tool(
    'trace_work_item',
    'Trace the complete journey of a work item (PBI/Bug/Task) across Azure DevOps: from work item → linked commits → pull requests → builds → releases. Shows the full lifecycle and current deployment state.',
    {
      id: z.number().describe('Work item ID to trace'),
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ id, project }) => {
      try {
        const p = client.resolveProject(project);
        const lines: string[] = [];

        // 1. Get the work item with relations
        const wi = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wit/workitems/${id}`,
          { '$expand': 'All' }
        );
        const f = wi.fields || {};
        lines.push(`# Work Item Journey: #${id} — ${f['System.Title'] || 'Untitled'}`);
        lines.push(`**Type:** ${f['System.WorkItemType']} | **State:** ${f['System.State']} | **Assigned:** ${f['System.AssignedTo']?.displayName || 'Unassigned'}`);
        lines.push(`**Area:** ${f['System.AreaPath']} | **Iteration:** ${f['System.IterationPath']}`);
        lines.push('');

        // 2. Parse relations to find linked artifacts
        const relations = wi.relations || [];
        const commitLinks: { repoId: string; commitId: string; projectId: string }[] = [];
        const prLinks: { repoId: string; prId: number; projectId: string }[] = [];
        const buildLinks: number[] = [];
        const parentLinks: number[] = [];
        const childLinks: number[] = [];

        for (const rel of relations) {
          const url = rel.url || '';
          const relName = rel.attributes?.name || rel.rel || '';

          // Parse artifact links
          if (url.includes('vstfs:///Git/Commit/') || rel.rel === 'ArtifactLink') {
            const match = url.match(/Git%2FCommit%2F([^%]+)%2F([^%]+)%2F(.+)/) ||
                          url.match(/Git\/Commit\/([^/]+)\/([^/]+)\/(.+)/);
            if (match) {
              commitLinks.push({ projectId: match[1], repoId: match[2], commitId: match[3] });
            }
          }
          if (url.includes('vstfs:///Git/PullRequestId/') || url.includes('PullRequest')) {
            const match = url.match(/PullRequestId%2F([^%]+)%2F([^%]+)%2F(\d+)/) ||
                          url.match(/PullRequestId\/([^/]+)\/([^/]+)\/(\d+)/);
            if (match) {
              prLinks.push({ projectId: match[1], repoId: match[2], prId: parseInt(match[3]) });
            }
          }
          if (url.includes('vstfs:///Build/Build/')) {
            const match = url.match(/Build%2FBuild%2F(\d+)/) || url.match(/Build\/Build\/(\d+)/);
            if (match) buildLinks.push(parseInt(match[1]));
          }
          if (relName === 'Parent' || rel.rel === 'System.LinkTypes.Hierarchy-Reverse') {
            const idMatch = url.match(/workItems\/(\d+)/);
            if (idMatch) parentLinks.push(parseInt(idMatch[1]));
          }
          if (relName === 'Child' || rel.rel === 'System.LinkTypes.Hierarchy-Forward') {
            const idMatch = url.match(/workItems\/(\d+)/);
            if (idMatch) childLinks.push(parseInt(idMatch[1]));
          }
        }

        // 3. Show hierarchy
        if (parentLinks.length) {
          lines.push(`## Parent Work Items`);
          for (const pid of parentLinks) {
            try {
              const parent = await client.get<any>(`${encodeURIComponent(p)}/_apis/wit/workitems/${pid}`, { '$expand': 'Fields' });
              const pf = parent.fields || {};
              lines.push(`- **#${pid}** ${pf['System.WorkItemType'] || ''} | ${pf['System.State'] || ''} | ${pf['System.Title'] || ''}`);
            } catch {
              lines.push(`- **#${pid}** (unable to fetch)`);
            }
          }
          lines.push('');
        }

        if (childLinks.length) {
          lines.push(`## Child Work Items`);
          const childIds = childLinks.slice(0, 20).join(',');
          try {
            const childData = await client.get<any>(`${encodeURIComponent(p)}/_apis/wit/workitems`, { ids: childIds, '$expand': 'Fields' });
            for (const child of (childData.value || [])) {
              const cf = child.fields || {};
              lines.push(`- **#${child.id}** ${cf['System.WorkItemType'] || ''} | ${cf['System.State'] || ''} | ${cf['System.AssignedTo']?.displayName || 'Unassigned'} | ${cf['System.Title'] || ''}`);
            }
          } catch {
            for (const cid of childLinks) lines.push(`- **#${cid}** (unable to fetch)`);
          }
          lines.push('');
        }

        // 4. Show linked commits
        if (commitLinks.length) {
          lines.push(`## Linked Commits (${commitLinks.length})`);
          for (const cl of commitLinks.slice(0, 15)) {
            try {
              const commit = await client.get<any>(
                `${encodeURIComponent(p)}/_apis/git/repositories/${cl.repoId}/commits/${cl.commitId}`
              );
              lines.push(`- **${cl.commitId.slice(0, 8)}** | ${commit.author?.name || 'Unknown'} | ${formatDate(commit.author?.date)} | ${commit.comment || ''}`);
            } catch {
              lines.push(`- **${cl.commitId.slice(0, 8)}** (unable to fetch details)`);
            }
          }
          lines.push('');
        }

        // 5. Show linked PRs
        if (prLinks.length) {
          lines.push(`## Linked Pull Requests (${prLinks.length})`);
          for (const pl of prLinks.slice(0, 10)) {
            try {
              const pr = await client.get<any>(
                `${encodeURIComponent(p)}/_apis/git/repositories/${pl.repoId}/pullrequests/${pl.prId}`
              );
              const src = pr.sourceRefName?.replace('refs/heads/', '') || '?';
              const tgt = pr.targetRefName?.replace('refs/heads/', '') || '?';
              lines.push(`- **PR #${pl.prId}** | ${pr.status} | ${pr.createdBy?.displayName || 'Unknown'} | ${src} → ${tgt} | ${pr.title}`);
            } catch {
              lines.push(`- **PR #${pl.prId}** (unable to fetch details)`);
            }
          }
          lines.push('');
        }

        // 6. Show linked builds
        if (buildLinks.length) {
          lines.push(`## Linked Builds (${buildLinks.length})`);
          for (const bid of buildLinks.slice(0, 10)) {
            try {
              const build = await client.get<any>(`${encodeURIComponent(p)}/_apis/build/builds/${bid}`);
              lines.push(`- **Build #${bid}** | ${build.definition?.name || 'N/A'} | ${build.status} | ${build.result || 'Running'} | ${formatDate(build.finishTime || build.startTime)}`);
            } catch {
              lines.push(`- **Build #${bid}** (unable to fetch details)`);
            }
          }
          lines.push('');
        }

        // 7. If we found builds, look for releases that used them
        if (buildLinks.length) {
          lines.push(`## Related Releases`);
          let foundReleases = false;
          try {
            const releaseDefs = await client.getReleaseApi<any>(`${encodeURIComponent(p)}/_apis/release/definitions`, { '$top': '50' });
            for (const def of (releaseDefs.value || []).slice(0, 10)) {
              const releases = await client.getReleaseApi<any>(
                `${encodeURIComponent(p)}/_apis/release/releases`,
                { definitionId: def.id, '$top': '5', '$expand': 'Environments,Artifacts' }
              );
              for (const rel of (releases.value || [])) {
                for (const art of (rel.artifacts || [])) {
                  const artVersion = art.definitionReference?.version?.id;
                  if (artVersion && buildLinks.some(bid => String(bid) === artVersion)) {
                    foundReleases = true;
                    const envStatus = (rel.environments || [])
                      .map((e: any) => `${e.name}: ${e.status}`)
                      .join(' | ');
                    lines.push(`- **Release ${rel.id}** (${rel.name}) | ${rel.status} | Envs: ${envStatus} | ${formatDate(rel.createdOn)}`);
                  }
                }
              }
            }
          } catch { /* Release API may not be available */ }
          if (!foundReleases) lines.push('- No releases found linked to the associated builds.');
          lines.push('');
        }

        // 8. Show state transitions (abbreviated history)
        lines.push(`## State History`);
        try {
          const updates = await client.get<any>(`${encodeURIComponent(p)}/_apis/wit/workitems/${id}/updates`);
          const stateChanges = (updates.value || []).filter(
            (u: any) => u.fields?.['System.State']
          );
          if (stateChanges.length) {
            for (const u of stateChanges) {
              const sc = u.fields['System.State'];
              lines.push(`- ${formatDate(u.revisedDate)} | ${sc.oldValue || '(New)'} → **${sc.newValue}** | By: ${u.revisedBy?.displayName || 'Unknown'}`);
            }
          } else {
            lines.push('- No state changes recorded.');
          }
        } catch {
          lines.push('- Unable to fetch state history.');
        }

        if (!commitLinks.length && !prLinks.length && !buildLinks.length) {
          lines.push('\n> **Note:** No linked commits, PRs, or builds found. Link artifacts to the work item in Azure DevOps to enable full traceability.');
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  // ── Summarize recent changes in a repository ──────────────────────
  server.tool(
    'summarize_repo_changes',
    'Summarize recent changes in a repository: top contributors, most modified files, commit activity, and recent PRs. Great for understanding what has been happening in a repo.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      repositoryId: z.string().describe('Repository name or ID'),
      days: z.number().optional().default(7).describe('Number of days to look back (default 7)'),
    },
    async ({ project, repositoryId, days }) => {
      try {
        const p = client.resolveProject(project);
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        // Fetch commits and PRs in parallel
        const [commitsData, prsData, repoInfo] = await Promise.all([
          client.get<any>(
            `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/commits`,
            { 'searchCriteria.fromDate': fromDate, '$top': '500' }
          ),
          client.get<any>(
            `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests`,
            { 'searchCriteria.status': 'all', '$top': '50' }
          ),
          client.get<any>(
            `${encodeURIComponent(p)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}`
          ),
        ]);

        const commits = commitsData.value || [];
        const prs = (prsData.value || []).filter(
          (pr: any) => new Date(pr.creationDate) >= new Date(fromDate)
        );

        const lines = [`# Repository Summary: ${repoInfo.name} (last ${days} days)\n`];

        // Commit stats
        lines.push(`## Commits: ${commits.length}`);

        if (commits.length) {
          // Top authors
          const authorMap: Record<string, number> = {};
          for (const c of commits) {
            const author = c.author?.name || 'Unknown';
            authorMap[author] = (authorMap[author] || 0) + 1;
          }
          const topAuthors = Object.entries(authorMap)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);
          lines.push(`\n### Top Contributors`);
          for (const [author, count] of topAuthors) {
            lines.push(`- **${author}**: ${count} commits`);
          }

          // Commits by day
          const dayMap: Record<string, number> = {};
          for (const c of commits) {
            const day = new Date(c.author?.date || '').toLocaleDateString();
            dayMap[day] = (dayMap[day] || 0) + 1;
          }
          lines.push(`\n### Commits by Day`);
          for (const [day, count] of Object.entries(dayMap)) {
            const bar = '█'.repeat(Math.min(count, 30));
            lines.push(`- ${day}: ${bar} ${count}`);
          }

          // Recent commits
          lines.push(`\n### Recent Commits (latest 10)`);
          for (const c of commits.slice(0, 10)) {
            lines.push(`- **${(c.commitId || '').slice(0, 8)}** | ${c.author?.name || 'Unknown'} | ${formatDate(c.author?.date)} | ${c.comment || 'No message'}`);
          }
        }

        // PR stats
        lines.push(`\n## Pull Requests: ${prs.length}`);
        if (prs.length) {
          const statusMap: Record<string, number> = {};
          for (const pr of prs) {
            statusMap[pr.status || 'unknown'] = (statusMap[pr.status || 'unknown'] || 0) + 1;
          }
          lines.push(`**By Status:** ${Object.entries(statusMap).map(([k, v]) => `${k}: ${v}`).join(' | ')}`);

          lines.push(`\n### Recent PRs`);
          for (const pr of prs.slice(0, 10)) {
            const src = pr.sourceRefName?.replace('refs/heads/', '') || '?';
            const tgt = pr.targetRefName?.replace('refs/heads/', '') || '?';
            lines.push(`- **#${pr.pullRequestId}** | ${pr.status} | ${pr.createdBy?.displayName || 'Unknown'} | ${src} → ${tgt} | ${pr.title}`);
          }
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  // ── Sprint summary ────────────────────────────────────────────────
  server.tool(
    'get_sprint_summary',
    'Get a comprehensive summary of a sprint/iteration: work item counts by state and type, burndown info, team velocity, and assigned work breakdown.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      team: z.string().optional().describe('Team name'),
      iterationPath: z.string().optional().describe('Iteration path (e.g., "MyProject\\Sprint 5"). If not provided, uses the current iteration.'),
    },
    async ({ project, team, iterationPath }) => {
      try {
        const p = client.resolveProject(project);
        const teamPath = team ? encodeURIComponent(team) : `${encodeURIComponent(p)} Team`;

        // Get current iteration if not specified
        let iteration: any;
        if (iterationPath) {
          // Search for the specific iteration
          const iters = await client.get<any>(`${encodeURIComponent(p)}/${teamPath}/_apis/work/teamsettings/iterations`);
          iteration = (iters.value || []).find((it: any) => it.path === iterationPath || it.name === iterationPath);
          if (!iteration) return error(`Iteration "${iterationPath}" not found.`);
        } else {
          // Get current iteration
          const iters = await client.get<any>(`${encodeURIComponent(p)}/${teamPath}/_apis/work/teamsettings/iterations`, { '$timeframe': 'current' });
          iteration = (iters.value || [])[0];
          if (!iteration) return error('No current iteration found.');
        }

        const lines = [
          `# Sprint Summary: ${iteration.name}`,
          `**Period:** ${formatDate(iteration.attributes?.startDate)} → ${formatDate(iteration.attributes?.finishDate)}`,
          '',
        ];

        // Get work items in this iteration via WIQL
        const wiql = `SELECT [System.Id] FROM workitems WHERE [System.IterationPath] = '${iteration.path}' ORDER BY [System.WorkItemType]`;
        const queryResult = await client.post<any>(`${encodeURIComponent(p)}/_apis/wit/wiql`, { query: wiql }, { '$top': '500' });
        const wiRefs = queryResult.workItems || [];

        if (!wiRefs.length) {
          lines.push('No work items in this sprint.');
          return text(lines.join('\n'));
        }

        // Fetch work item details
        const ids = wiRefs.map((w: any) => w.id).slice(0, 200).join(',');
        const wiData = await client.get<any>(`${encodeURIComponent(p)}/_apis/wit/workitems`, { ids, '$expand': 'Fields' });
        const items = wiData.value || [];

        // Stats by state
        const stateMap: Record<string, number> = {};
        const typeMap: Record<string, number> = {};
        const assigneeMap: Record<string, { total: number; done: number }> = {};
        let totalEffort = 0;
        let completedEffort = 0;

        for (const wi of items) {
          const f = wi.fields || {};
          const state = f['System.State'] || 'Unknown';
          const type = f['System.WorkItemType'] || 'Unknown';
          const assignee = f['System.AssignedTo']?.displayName || 'Unassigned';
          const effort = f['Microsoft.VSTS.Scheduling.Effort'] || f['Microsoft.VSTS.Scheduling.StoryPoints'] || 0;
          const isDone = ['Closed', 'Done', 'Resolved', 'Completed'].includes(state);

          stateMap[state] = (stateMap[state] || 0) + 1;
          typeMap[type] = (typeMap[type] || 0) + 1;
          if (!assigneeMap[assignee]) assigneeMap[assignee] = { total: 0, done: 0 };
          assigneeMap[assignee].total++;
          if (isDone) assigneeMap[assignee].done++;
          totalEffort += effort;
          if (isDone) completedEffort += effort;
        }

        // Overall stats
        const totalItems = items.length;
        const doneItems = Object.entries(stateMap)
          .filter(([state]) => ['Closed', 'Done', 'Resolved', 'Completed'].includes(state))
          .reduce((sum, [, count]) => sum + count, 0);
        const completionPct = totalItems > 0 ? ((doneItems / totalItems) * 100).toFixed(0) : '0';

        lines.push(`## Overview`);
        lines.push(`- **Total Items:** ${totalItems} | **Completed:** ${doneItems} (${completionPct}%)`);
        if (totalEffort > 0) {
          lines.push(`- **Effort:** ${completedEffort}/${totalEffort} points (${((completedEffort / totalEffort) * 100).toFixed(0)}%)`);
        }

        lines.push(`\n## By State`);
        for (const [state, count] of Object.entries(stateMap).sort(([, a], [, b]) => b - a)) {
          const bar = '█'.repeat(Math.min(count, 30));
          lines.push(`- ${state}: ${bar} ${count}`);
        }

        lines.push(`\n## By Type`);
        for (const [type, count] of Object.entries(typeMap).sort(([, a], [, b]) => b - a)) {
          lines.push(`- ${type}: ${count}`);
        }

        lines.push(`\n## By Assignee`);
        for (const [assignee, stats] of Object.entries(assigneeMap).sort(([, a], [, b]) => b.total - a.total)) {
          const pct = stats.total > 0 ? ((stats.done / stats.total) * 100).toFixed(0) : '0';
          lines.push(`- **${assignee}**: ${stats.done}/${stats.total} done (${pct}%)`);
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  // ── Project dashboard ─────────────────────────────────────────────
  server.tool(
    'get_project_dashboard',
    'Get a high-level dashboard view of a project: recent builds, active PRs, current sprint status, and recent releases. Provides a quick overview of project health.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ project }) => {
      try {
        const p = client.resolveProject(project);
        const lines = [`# Project Dashboard: ${p}\n`];

        // Fetch data in parallel
        const [reposData, buildsData, prsAllData] = await Promise.all([
          client.get<any>(`${encodeURIComponent(p)}/_apis/git/repositories`).catch(() => ({ value: [] })),
          client.get<any>(`${encodeURIComponent(p)}/_apis/build/builds`, { '$top': '10' }).catch(() => ({ value: [] })),
          // Get all active PRs across repos
          client.get<any>(`${encodeURIComponent(p)}/_apis/git/pullrequests`, { 'searchCriteria.status': 'active', '$top': '15' }).catch(() => ({ value: [] })),
        ]);

        // Repos summary
        const repos = reposData.value || [];
        lines.push(`## Repositories: ${repos.length}`);
        for (const r of repos.slice(0, 10)) {
          lines.push(`- ${r.name} | ${r.defaultBranch?.replace('refs/heads/', '') || 'N/A'}`);
        }
        lines.push('');

        // Recent builds
        const builds = buildsData.value || [];
        lines.push(`## Recent Builds`);
        if (builds.length) {
          for (const b of builds) {
            const icon = b.result === 'succeeded' ? '✓' : b.result === 'failed' ? '✗' : '…';
            lines.push(`${icon} **#${b.id}** ${b.definition?.name || 'N/A'} | ${b.result || b.status} | ${b.sourceBranch?.replace('refs/heads/', '') || ''} | ${formatDate(b.finishTime || b.startTime)}`);
          }
        } else {
          lines.push('No recent builds.');
        }
        lines.push('');

        // Active PRs
        const prs = prsAllData.value || [];
        lines.push(`## Active Pull Requests: ${prs.length}`);
        if (prs.length) {
          for (const pr of prs.slice(0, 10)) {
            lines.push(`- **#${pr.pullRequestId}** | ${pr.repository?.name || 'N/A'} | ${pr.createdBy?.displayName || 'Unknown'} | ${pr.title}`);
          }
        } else {
          lines.push('No active pull requests.');
        }
        lines.push('');

        // Recent releases
        try {
          const releasesData = await client.getReleaseApi<any>(`${encodeURIComponent(p)}/_apis/release/releases`, { '$top': '5', '$expand': 'Environments' });
          const releases = releasesData.value || [];
          lines.push(`## Recent Releases`);
          if (releases.length) {
            for (const r of releases) {
              const envs = (r.environments || []).map((e: any) => `${e.name}: ${e.status}`).join(' | ');
              lines.push(`- **${r.name}** | ${r.status} | ${envs} | ${formatDate(r.createdOn)}`);
            }
          } else {
            lines.push('No recent releases.');
          }
        } catch {
          lines.push(`## Releases\nRelease API not available.`);
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  // ── Compare sprints ───────────────────────────────────────────────
  server.tool(
    'compare_sprints',
    'Compare work item stats between two iterations/sprints. Useful for tracking velocity trends.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      iteration1: z.string().describe('First iteration path or name'),
      iteration2: z.string().describe('Second iteration path or name'),
    },
    async ({ project, iteration1, iteration2 }) => {
      try {
        const p = client.resolveProject(project);

        async function getIterationStats(iterPath: string) {
          const wiql = `SELECT [System.Id] FROM workitems WHERE [System.IterationPath] = '${iterPath}' OR [System.IterationPath] UNDER '${iterPath}'`;
          const qr = await client.post<any>(`${encodeURIComponent(p)}/_apis/wit/wiql`, { query: wiql }, { '$top': '500' });
          const refs = qr.workItems || [];
          if (!refs.length) return { total: 0, stateMap: {}, typeMap: {}, effort: 0, completed: 0 };

          const ids = refs.map((w: any) => w.id).slice(0, 200).join(',');
          const wd = await client.get<any>(`${encodeURIComponent(p)}/_apis/wit/workitems`, { ids, '$expand': 'Fields' });
          const items = wd.value || [];

          const stateMap: Record<string, number> = {};
          const typeMap: Record<string, number> = {};
          let effort = 0;
          let completed = 0;

          for (const wi of items) {
            const f = wi.fields || {};
            const state = f['System.State'] || 'Unknown';
            const type = f['System.WorkItemType'] || 'Unknown';
            stateMap[state] = (stateMap[state] || 0) + 1;
            typeMap[type] = (typeMap[type] || 0) + 1;
            const eff = f['Microsoft.VSTS.Scheduling.Effort'] || f['Microsoft.VSTS.Scheduling.StoryPoints'] || 0;
            effort += eff;
            if (['Closed', 'Done', 'Resolved', 'Completed'].includes(state)) completed += eff;
          }

          return { total: items.length, stateMap, typeMap, effort, completed };
        }

        const [stats1, stats2] = await Promise.all([
          getIterationStats(iteration1),
          getIterationStats(iteration2),
        ]);

        const lines = [
          `# Sprint Comparison`,
          `| Metric | ${iteration1} | ${iteration2} |`,
          `|--------|------|------|`,
          `| Total Items | ${stats1.total} | ${stats2.total} |`,
          `| Total Effort | ${stats1.effort} | ${stats2.effort} |`,
          `| Completed Effort | ${stats1.completed} | ${stats2.completed} |`,
          `| Completion % | ${stats1.effort > 0 ? ((stats1.completed / stats1.effort) * 100).toFixed(0) : 0}% | ${stats2.effort > 0 ? ((stats2.completed / stats2.effort) * 100).toFixed(0) : 0}% |`,
        ];

        // State breakdown
        const allStates = new Set([...Object.keys(stats1.stateMap), ...Object.keys(stats2.stateMap)]);
        lines.push(`\n## By State`);
        lines.push(`| State | ${iteration1} | ${iteration2} |`);
        lines.push(`|-------|------|------|`);
        for (const state of allStates) {
          lines.push(`| ${state} | ${stats1.stateMap[state] || 0} | ${stats2.stateMap[state] || 0} |`);
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  // ── Pipeline health report ────────────────────────────────────────
  server.tool(
    'get_pipeline_health',
    'Get a health report for pipelines in a project: success/failure rates, average duration, and recent failures. Useful for CI/CD reliability monitoring.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      definitionId: z.number().optional().describe('Pipeline definition ID (optional, reports on all if omitted)'),
      days: z.number().optional().default(7).describe('Number of days to analyze (default 7)'),
    },
    async ({ project, definitionId, days }) => {
      try {
        const p = client.resolveProject(project);
        const minTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const params: Record<string, string | number | boolean | undefined> = {
          '$top': '200',
          minTime,
          statusFilter: 'completed',
        };
        if (definitionId) params['definitions'] = definitionId;

        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/build/builds`, params);
        const builds = data.value || [];

        if (!builds.length) return text('No completed builds found in the specified period.');

        const lines = [`# Pipeline Health Report (last ${days} days)\n`];

        // Group by definition
        const defMap: Record<string, any[]> = {};
        for (const b of builds) {
          const defName = b.definition?.name || `Def ${b.definition?.id}`;
          if (!defMap[defName]) defMap[defName] = [];
          defMap[defName].push(b);
        }

        for (const [defName, defBuilds] of Object.entries(defMap)) {
          const total = defBuilds.length;
          const succeeded = defBuilds.filter((b: any) => b.result === 'succeeded').length;
          const failed = defBuilds.filter((b: any) => b.result === 'failed').length;
          const partial = defBuilds.filter((b: any) => b.result === 'partiallySucceeded').length;
          const canceled = defBuilds.filter((b: any) => b.result === 'canceled').length;
          const successRate = ((succeeded / total) * 100).toFixed(0);

          // Average duration
          const durations = defBuilds
            .filter((b: any) => b.startTime && b.finishTime)
            .map((b: any) => new Date(b.finishTime).getTime() - new Date(b.startTime).getTime());
          const avgDuration = durations.length > 0
            ? (durations.reduce((a: number, b: number) => a + b, 0) / durations.length / 1000 / 60).toFixed(1)
            : 'N/A';

          lines.push(`## ${defName}`);
          lines.push(`- **Success Rate:** ${successRate}% (${succeeded}/${total})`);
          lines.push(`- **Results:** ✓ ${succeeded} | ✗ ${failed} | ◐ ${partial} | ⊘ ${canceled}`);
          lines.push(`- **Avg Duration:** ${avgDuration} min`);

          // List recent failures
          const failures = defBuilds.filter((b: any) => b.result === 'failed').slice(0, 5);
          if (failures.length) {
            lines.push(`- **Recent Failures:**`);
            for (const f of failures) {
              lines.push(`  - Build #${f.id} | ${formatDate(f.finishTime)} | ${f.sourceBranch?.replace('refs/heads/', '') || 'N/A'} | ${f.requestedFor?.displayName || 'N/A'}`);
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

  // ── Developer activity ────────────────────────────────────────────
  server.tool(
    'get_developer_activity',
    'Get a summary of a specific developer\'s recent activity across commits, PRs, and work items.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      developerName: z.string().describe('Developer display name or unique name (email)'),
      days: z.number().optional().default(14).describe('Number of days to look back (default 14)'),
    },
    async ({ project, developerName, days }) => {
      try {
        const p = client.resolveProject(project);
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const lines = [`# Developer Activity: ${developerName} (last ${days} days)\n`];

        // Work items assigned
        const wiql = `SELECT [System.Id] FROM workitems WHERE [System.AssignedTo] CONTAINS '${developerName}' AND [System.ChangedDate] >= '${fromDate}' ORDER BY [System.ChangedDate] DESC`;
        try {
          const qr = await client.post<any>(`${encodeURIComponent(p)}/_apis/wit/wiql`, { query: wiql }, { '$top': '50' });
          const refs = qr.workItems || [];
          if (refs.length) {
            const ids = refs.map((w: any) => w.id).slice(0, 50).join(',');
            const wd = await client.get<any>(`${encodeURIComponent(p)}/_apis/wit/workitems`, { ids, '$expand': 'Fields' });
            const items = wd.value || [];
            lines.push(`## Work Items (${items.length})`);
            for (const wi of items) {
              const f = wi.fields || {};
              lines.push(`- **#${wi.id}** | ${f['System.WorkItemType']} | ${f['System.State']} | ${f['System.Title']}`);
            }
          } else {
            lines.push(`## Work Items\nNo recent work items.`);
          }
        } catch {
          lines.push(`## Work Items\nUnable to fetch work items.`);
        }
        lines.push('');

        // Commits across repos
        try {
          const repos = await client.get<any>(`${encodeURIComponent(p)}/_apis/git/repositories`);
          let totalCommits = 0;
          const allCommits: any[] = [];

          for (const repo of (repos.value || []).slice(0, 20)) {
            try {
              const commits = await client.get<any>(
                `${encodeURIComponent(p)}/_apis/git/repositories/${repo.id}/commits`,
                { 'searchCriteria.author': developerName, 'searchCriteria.fromDate': fromDate, '$top': '50' }
              );
              for (const c of (commits.value || [])) {
                allCommits.push({ ...c, repoName: repo.name });
                totalCommits++;
              }
            } catch { /* skip repos with errors */ }
          }

          lines.push(`## Commits (${totalCommits})`);
          if (allCommits.length) {
            // Group by repo
            const byRepo: Record<string, any[]> = {};
            for (const c of allCommits) {
              if (!byRepo[c.repoName]) byRepo[c.repoName] = [];
              byRepo[c.repoName].push(c);
            }
            for (const [repoName, commits] of Object.entries(byRepo)) {
              lines.push(`### ${repoName} (${commits.length})`);
              for (const c of commits.slice(0, 10)) {
                lines.push(`- ${(c.commitId || '').slice(0, 8)} | ${formatDate(c.author?.date)} | ${c.comment || 'No message'}`);
              }
            }
          } else {
            lines.push('No recent commits.');
          }
        } catch {
          lines.push(`## Commits\nUnable to fetch commits.`);
        }
        lines.push('');

        // PRs created
        try {
          const repos = await client.get<any>(`${encodeURIComponent(p)}/_apis/git/repositories`);
          const allPrs: any[] = [];
          for (const repo of (repos.value || []).slice(0, 20)) {
            try {
              const prs = await client.get<any>(
                `${encodeURIComponent(p)}/_apis/git/repositories/${repo.id}/pullrequests`,
                { 'searchCriteria.status': 'all', '$top': '20' }
              );
              for (const pr of (prs.value || [])) {
                if ((pr.createdBy?.displayName || '').toLowerCase().includes(developerName.toLowerCase()) ||
                    (pr.createdBy?.uniqueName || '').toLowerCase().includes(developerName.toLowerCase())) {
                  if (new Date(pr.creationDate) >= new Date(fromDate)) {
                    allPrs.push({ ...pr, repoName: repo.name });
                  }
                }
              }
            } catch { /* skip */ }
          }

          lines.push(`## Pull Requests (${allPrs.length})`);
          if (allPrs.length) {
            for (const pr of allPrs.slice(0, 15)) {
              lines.push(`- **#${pr.pullRequestId}** (${pr.repoName}) | ${pr.status} | ${pr.title}`);
            }
          } else {
            lines.push('No recent pull requests.');
          }
        } catch {
          lines.push(`## Pull Requests\nUnable to fetch PRs.`);
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );
}
