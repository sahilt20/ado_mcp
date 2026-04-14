import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdoClient } from '../client.js';
import { text, error, formatDate, formatBuild } from '../utils.js';

export function register(server: McpServer, client: AdoClient) {
  server.tool(
    'list_pipelines',
    'List all pipeline definitions in a project (YAML and classic pipelines).',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      top: z.number().optional().default(50).describe('Max results (default 50)'),
    },
    async ({ project, top }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/pipelines`, { '$top': top });
        const pipelines = data.value || [];
        if (!pipelines.length) return text('No pipelines found.');

        const lines = ['# Pipelines\n'];
        for (const pl of pipelines) {
          lines.push(`- **${pl.name}** | ID: ${pl.id} | Folder: ${pl.folder || '/'} | Revision: ${pl.revision || 'N/A'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_pipeline_runs',
    'List recent runs for a specific pipeline.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      pipelineId: z.number().describe('Pipeline definition ID'),
      top: z.number().optional().default(20).describe('Max results (default 20)'),
    },
    async ({ project, pipelineId, top }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/pipelines/${pipelineId}/runs`,
          { '$top': top }
        );
        const runs = data.value || [];
        if (!runs.length) return text('No pipeline runs found.');

        const lines = [`# Pipeline ${pipelineId} — Runs\n`];
        for (const r of runs) {
          lines.push(`- **Run #${r.id}** | ${r.state} | Result: ${r.result || 'In Progress'} | ${formatDate(r.createdDate)} | ${r.resources?.repositories?.self?.refName?.replace('refs/heads/', '') || 'N/A'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_pipeline_run',
    'Get detailed information about a specific pipeline run.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      pipelineId: z.number().describe('Pipeline definition ID'),
      runId: z.number().describe('Pipeline run ID'),
    },
    async ({ project, pipelineId, runId }) => {
      try {
        const p = client.resolveProject(project);
        const r = await client.get<any>(`${encodeURIComponent(p)}/_apis/pipelines/${pipelineId}/runs/${runId}`);
        const lines = [
          `# Pipeline Run #${r.id}`,
          `- **Pipeline:** ${r.pipeline?.name || pipelineId}`,
          `- **State:** ${r.state}`,
          `- **Result:** ${r.result || 'In Progress'}`,
          `- **Created:** ${formatDate(r.createdDate)}`,
          `- **Finished:** ${formatDate(r.finishedDate)}`,
          `- **Branch:** ${r.resources?.repositories?.self?.refName?.replace('refs/heads/', '') || 'N/A'}`,
          `- **Triggered By:** ${r.resources?.repositories?.self?.version || 'N/A'}`,
        ];
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_build_definitions',
    'List build/pipeline definitions (classic and YAML). Shows all configured build definitions.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      top: z.number().optional().default(50).describe('Max results (default 50)'),
      name: z.string().optional().describe('Filter by definition name (contains)'),
    },
    async ({ project, top, name }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = { '$top': top };
        if (name) params['name'] = name;

        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/build/definitions`, params);
        const defs = data.value || [];
        if (!defs.length) return text('No build definitions found.');

        const lines = ['# Build Definitions\n'];
        for (const d of defs) {
          lines.push(`- **${d.name}** | ID: ${d.id} | Type: ${d.type || 'N/A'} | Queue: ${d.queue?.name || 'N/A'} | Path: ${d.path || '/'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_builds',
    'List builds with optional filters for definition, status, branch, and date range.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      definitions: z.string().optional().describe('Comma-separated definition IDs to filter by'),
      statusFilter: z.enum(['all', 'cancelling', 'completed', 'inProgress', 'none', 'notStarted', 'postponed']).optional().describe('Build status filter'),
      resultFilter: z.enum(['canceled', 'failed', 'none', 'partiallySucceeded', 'succeeded']).optional().describe('Build result filter'),
      branchName: z.string().optional().describe('Filter by branch name (e.g., refs/heads/main)'),
      top: z.number().optional().default(25).describe('Max results (default 25)'),
      requestedFor: z.string().optional().describe('Filter by user who triggered the build'),
    },
    async ({ project, definitions, statusFilter, resultFilter, branchName, top, requestedFor }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = {
          '$top': top,
        };
        if (definitions) params['definitions'] = definitions;
        if (statusFilter) params['statusFilter'] = statusFilter;
        if (resultFilter) params['resultFilter'] = resultFilter;
        if (branchName) params['branchName'] = branchName.startsWith('refs/') ? branchName : `refs/heads/${branchName}`;
        if (requestedFor) params['requestedFor'] = requestedFor;

        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/build/builds`, params);
        const builds = data.value || [];
        if (!builds.length) return text('No builds found.');

        const lines = [`# Builds (${builds.length})\n`];
        for (const b of builds) {
          lines.push(formatBuild(b));
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_build',
    'Get detailed information about a specific build including source, timeline, and artifacts.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      buildId: z.number().describe('Build ID'),
    },
    async ({ project, buildId }) => {
      try {
        const p = client.resolveProject(project);
        const b = await client.get<any>(`${encodeURIComponent(p)}/_apis/build/builds/${buildId}`);
        const lines = [
          `# Build #${b.id}`,
          `- **Definition:** ${b.definition?.name || 'N/A'} (ID: ${b.definition?.id})`,
          `- **Build Number:** ${b.buildNumber}`,
          `- **Status:** ${b.status}`,
          `- **Result:** ${b.result || 'In Progress'}`,
          `- **Source Branch:** ${b.sourceBranch?.replace('refs/heads/', '') || 'N/A'}`,
          `- **Source Version:** ${b.sourceVersion?.slice(0, 8) || 'N/A'}`,
          `- **Requested By:** ${b.requestedFor?.displayName || 'N/A'}`,
          `- **Requested For:** ${b.requestedBy?.displayName || 'N/A'}`,
          `- **Queue Time:** ${formatDate(b.queueTime)}`,
          `- **Start Time:** ${formatDate(b.startTime)}`,
          `- **Finish Time:** ${formatDate(b.finishTime)}`,
          `- **Agent:** ${b.queue?.name || 'N/A'}`,
          `- **Reason:** ${b.reason || 'N/A'}`,
          `- **Priority:** ${b.priority || 'N/A'}`,
        ];

        if (b.triggerInfo) {
          lines.push(`- **Trigger:** PR #${b.triggerInfo['pr.number'] || 'N/A'} | ${b.triggerInfo['pr.title'] || ''}`);
        }

        if (b.repository) {
          lines.push(`- **Repository:** ${b.repository.name} (${b.repository.type})`);
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_build_timeline',
    'Get the timeline of a build showing all stages, jobs, and tasks with their status and duration. Essential for understanding build failures.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      buildId: z.number().describe('Build ID'),
    },
    async ({ project, buildId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/build/builds/${buildId}/timeline`);
        const records = data.records || [];
        if (!records.length) return text('No timeline records found.');

        // Build tree structure: Stage → Job → Task
        const stages = records.filter((r: any) => r.type === 'Stage');
        const jobs = records.filter((r: any) => r.type === 'Job');
        const tasks = records.filter((r: any) => r.type === 'Task');

        const lines = [`# Build #${buildId} — Timeline\n`];

        for (const stage of stages) {
          const duration = stage.startTime && stage.finishTime
            ? `${((new Date(stage.finishTime).getTime() - new Date(stage.startTime).getTime()) / 1000).toFixed(0)}s`
            : 'N/A';
          lines.push(`## Stage: ${stage.name} | ${stage.state} | ${stage.result || 'Running'} | ${duration}`);

          const stageJobs = jobs.filter((j: any) => j.parentId === stage.id);
          for (const job of stageJobs) {
            const jDuration = job.startTime && job.finishTime
              ? `${((new Date(job.finishTime).getTime() - new Date(job.startTime).getTime()) / 1000).toFixed(0)}s`
              : 'N/A';
            lines.push(`  ### Job: ${job.name} | ${job.state} | ${job.result || 'Running'} | ${jDuration}`);

            const jobTasks = tasks.filter((t: any) => t.parentId === job.id);
            for (const task of jobTasks) {
              const icon = task.result === 'succeeded' ? '✓' : task.result === 'failed' ? '✗' : task.result === 'skipped' ? '○' : '…';
              const tDuration = task.startTime && task.finishTime
                ? `${((new Date(task.finishTime).getTime() - new Date(task.startTime).getTime()) / 1000).toFixed(0)}s`
                : '';
              lines.push(`    ${icon} ${task.name} | ${task.result || task.state} ${tDuration ? `| ${tDuration}` : ''}`);
              if (task.result === 'failed' && task.issues?.length) {
                for (const issue of task.issues.slice(0, 5)) {
                  lines.push(`      ⚠ ${issue.message}`);
                }
              }
            }
          }
          lines.push('');
        }

        // Handle records not under stages (flat pipelines)
        if (!stages.length) {
          for (const r of records) {
            const icon = r.result === 'succeeded' ? '✓' : r.result === 'failed' ? '✗' : '…';
            lines.push(`${icon} ${r.name} | ${r.type} | ${r.state} | ${r.result || 'Running'}`);
          }
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_build_log',
    'Get the log output of a specific build log entry. Use get_build_timeline first to find log IDs.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      buildId: z.number().describe('Build ID'),
      logId: z.number().describe('Log ID (from build timeline)'),
    },
    async ({ project, buildId, logId }) => {
      try {
        const p = client.resolveProject(project);
        const logContent = await client.getText(`${encodeURIComponent(p)}/_apis/build/builds/${buildId}/logs/${logId}`);
        return text(`# Build #${buildId} — Log ${logId}\n\n\`\`\`\n${logContent.slice(0, 8000)}\n\`\`\``);
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_build_changes',
    'Get the source changes (commits) associated with a build. Shows what code changes triggered or are included in this build.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      buildId: z.number().describe('Build ID'),
    },
    async ({ project, buildId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/build/builds/${buildId}/changes`);
        const changes = data.value || [];
        if (!changes.length) return text('No source changes associated with this build.');

        const lines = [`# Build #${buildId} — Source Changes (${data.count || changes.length})\n`];
        for (const c of changes) {
          lines.push(`- **${(c.id || '').slice(0, 8)}** | ${c.author?.displayName || 'Unknown'} | ${formatDate(c.timestamp)} | ${c.message || 'No message'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_build_artifacts',
    'List artifacts produced by a build.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      buildId: z.number().describe('Build ID'),
    },
    async ({ project, buildId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/build/builds/${buildId}/artifacts`);
        const artifacts = data.value || [];
        if (!artifacts.length) return text('No artifacts found for this build.');

        const lines = [`# Build #${buildId} — Artifacts (${artifacts.length})\n`];
        for (const a of artifacts) {
          lines.push(`- **${a.name}** | Source: ${a.source || 'N/A'} | Type: ${a.resource?.type || 'N/A'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );
}
