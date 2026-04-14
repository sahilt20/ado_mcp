import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdoClient } from '../client.js';
import { text, error, formatDate, formatRelease } from '../utils.js';

export function register(server: McpServer, client: AdoClient) {
  server.tool(
    'list_release_definitions',
    'List all release pipeline definitions in a project. Shows the configured release pipelines with their stages/environments.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      top: z.number().optional().default(50).describe('Max results (default 50)'),
      searchText: z.string().optional().describe('Filter by name (contains)'),
    },
    async ({ project, top, searchText }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = {
          '$top': top,
          '$expand': 'Environments',
        };
        if (searchText) params['searchText'] = searchText;

        const data = await client.getReleaseApi<any>(`${encodeURIComponent(p)}/_apis/release/definitions`, params);
        const defs = data.value || [];
        if (!defs.length) return text('No release definitions found.');

        const lines = ['# Release Definitions\n'];
        for (const d of defs) {
          const envNames = (d.environments || []).map((e: any) => e.name).join(' → ');
          lines.push(`- **${d.name}** | ID: ${d.id} | Stages: ${envNames || 'N/A'} | Created by: ${d.createdBy?.displayName || 'N/A'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_release_definition',
    'Get detailed information about a release pipeline definition including all stages, triggers, and artifacts.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      definitionId: z.number().describe('Release definition ID'),
    },
    async ({ project, definitionId }) => {
      try {
        const p = client.resolveProject(project);
        const d = await client.getReleaseApi<any>(`${encodeURIComponent(p)}/_apis/release/definitions/${definitionId}`);

        const lines = [
          `# Release Definition: ${d.name}`,
          `- **ID:** ${d.id}`,
          `- **Path:** ${d.path || '/'}`,
          `- **Created By:** ${d.createdBy?.displayName || 'N/A'}`,
          `- **Modified By:** ${d.modifiedBy?.displayName || 'N/A'}`,
          `- **Modified On:** ${formatDate(d.modifiedOn)}`,
        ];

        if (d.artifacts?.length) {
          lines.push(`\n## Artifacts`);
          for (const a of d.artifacts) {
            lines.push(`- **${a.alias}** | Type: ${a.type} | Source: ${a.definitionReference?.definition?.name || 'N/A'} | Branch: ${a.definitionReference?.defaultVersionBranch?.id || 'N/A'}`);
          }
        }

        if (d.environments?.length) {
          lines.push(`\n## Stages`);
          for (const env of d.environments) {
            lines.push(`- **${env.name}** | ID: ${env.id} | Rank: ${env.rank}`);
            const preApprovals = (env.preDeployApprovals?.approvals || []).map((a: any) => a.approver?.displayName || 'Auto').join(', ');
            const postApprovals = (env.postDeployApprovals?.approvals || []).map((a: any) => a.approver?.displayName || 'Auto').join(', ');
            if (preApprovals) lines.push(`  - Pre-deploy approvers: ${preApprovals}`);
            if (postApprovals) lines.push(`  - Post-deploy approvers: ${postApprovals}`);
          }
        }

        if (d.triggers?.length) {
          lines.push(`\n## Triggers`);
          for (const t of d.triggers) {
            lines.push(`- Type: ${t.triggerType} | Artifact: ${t.artifactAlias || 'N/A'}`);
          }
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_releases',
    'List releases for a project, optionally filtered by release definition.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      definitionId: z.number().optional().describe('Filter by release definition ID'),
      top: z.number().optional().default(25).describe('Max results (default 25)'),
      statusFilter: z.enum(['abandoned', 'active', 'draft', 'undefined']).optional().describe('Filter by release status'),
    },
    async ({ project, definitionId, top, statusFilter }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = {
          '$top': top,
          '$expand': 'Environments',
        };
        if (definitionId) params['definitionId'] = definitionId;
        if (statusFilter) params['statusFilter'] = statusFilter;

        const data = await client.getReleaseApi<any>(`${encodeURIComponent(p)}/_apis/release/releases`, params);
        const releases = data.value || [];
        if (!releases.length) return text('No releases found.');

        const lines = [`# Releases (${releases.length})\n`];
        for (const r of releases) {
          lines.push(formatRelease(r));
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_release',
    'Get detailed information about a specific release including all environments, deployment status, and artifacts.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      releaseId: z.number().describe('Release ID'),
    },
    async ({ project, releaseId }) => {
      try {
        const p = client.resolveProject(project);
        const r = await client.getReleaseApi<any>(`${encodeURIComponent(p)}/_apis/release/releases/${releaseId}`);

        const lines = [
          `# Release ${r.id}: ${r.name}`,
          `- **Status:** ${r.status}`,
          `- **Created By:** ${r.createdBy?.displayName || 'N/A'}`,
          `- **Created On:** ${formatDate(r.createdOn)}`,
          `- **Description:** ${r.description || 'None'}`,
          `- **Reason:** ${r.reason || 'N/A'}`,
          `- **Release Definition:** ${r.releaseDefinition?.name || 'N/A'} (ID: ${r.releaseDefinition?.id || 'N/A'})`,
        ];

        if (r.artifacts?.length) {
          lines.push(`\n## Artifacts`);
          for (const a of r.artifacts) {
            lines.push(`- **${a.alias}** | Type: ${a.type} | Version: ${a.definitionReference?.version?.name || a.definitionReference?.version?.id || 'N/A'} | Branch: ${a.definitionReference?.branch?.id || 'N/A'}`);
          }
        }

        if (r.environments?.length) {
          lines.push(`\n## Environments`);
          for (const env of r.environments) {
            lines.push(`### ${env.name} (${env.status})`);
            lines.push(`- **Deploy Status:** ${env.status}`);
            lines.push(`- **Rank:** ${env.rank}`);

            if (env.preDeployApprovals?.length) {
              lines.push(`- **Pre-deploy Approvals:**`);
              for (const a of env.preDeployApprovals) {
                lines.push(`  - ${a.approver?.displayName || 'N/A'}: ${a.status} (${formatDate(a.modifiedOn)})`);
              }
            }

            if (env.deploySteps?.length) {
              const lastStep = env.deploySteps[env.deploySteps.length - 1];
              lines.push(`- **Last Deploy:** ${lastStep.status} | ${formatDate(lastStep.lastModifiedOn)}`);
              if (lastStep.releaseDeployPhases?.length) {
                for (const phase of lastStep.releaseDeployPhases) {
                  lines.push(`  - Phase: ${phase.name} | ${phase.status}`);
                }
              }
            }
          }
        }

        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_release_approvals',
    'List pending approvals for releases in a project. Useful for tracking deployment gates.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      statusFilter: z.enum(['approved', 'canceled', 'pending', 'reassigned', 'rejected', 'skipped', 'undefined']).optional().default('pending').describe('Approval status filter'),
    },
    async ({ project, statusFilter }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.getReleaseApi<any>(
          `${encodeURIComponent(p)}/_apis/release/approvals`,
          { statusFilter }
        );
        const approvals = data.value || [];
        if (!approvals.length) return text('No approvals found.');

        const lines = [`# Release Approvals (${approvals.length})\n`];
        for (const a of approvals) {
          lines.push(`- **Release:** ${a.release?.name || 'N/A'} | **Env:** ${a.releaseEnvironment?.name || 'N/A'} | **Approver:** ${a.approver?.displayName || 'N/A'} | **Status:** ${a.status} | ${formatDate(a.createdOn)}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );
}
