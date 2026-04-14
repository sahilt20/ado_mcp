import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdoClient } from '../client.js';
import { text, error, formatDate, formatWorkItem, truncate, stripHtml } from '../utils.js';

export function register(server: McpServer, client: AdoClient) {
  server.tool(
    'get_work_item',
    'Get a work item by ID with full details including fields, relations, and history link. Use $expand=All to get relations.',
    {
      id: z.number().describe('Work item ID'),
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ id, project }) => {
      try {
        const p = client.resolveProject(project);
        const wi = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wit/workitems/${id}`,
          { '$expand': 'All' }
        );
        return text(formatWorkItem(wi));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_work_items_batch',
    'Get multiple work items by IDs in a single call. Efficient for fetching several items at once.',
    {
      ids: z.array(z.number()).describe('Array of work item IDs (max 200)'),
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ ids, project }) => {
      try {
        const p = client.resolveProject(project);
        const batchIds = ids.slice(0, 200);
        const idsParam = batchIds.join(',');
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wit/workitems`,
          { ids: idsParam, '$expand': 'All' }
        );
        const items = data.value || [];
        if (!items.length) return text('No work items found.');
        return text(items.map(formatWorkItem).join('\n\n---\n\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'query_work_items',
    'Execute a WIQL (Work Item Query Language) query to search for work items. Returns matching work item details. Example WIQL: "SELECT [System.Id], [System.Title], [System.State] FROM workitems WHERE [System.WorkItemType] = \'Bug\' AND [System.State] = \'Active\' ORDER BY [System.CreatedDate] DESC"',
    {
      query: z.string().describe('WIQL query string'),
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      top: z.number().optional().default(50).describe('Maximum results to return (default 50)'),
    },
    async ({ query, project, top }) => {
      try {
        const p = client.resolveProject(project);
        const result = await client.post<any>(
          `${encodeURIComponent(p)}/_apis/wit/wiql`,
          { query },
          { '$top': top }
        );

        const workItemRefs = result.workItems || [];
        if (!workItemRefs.length) return text('No work items match the query.');

        // Fetch actual work item details
        const ids = workItemRefs.slice(0, top).map((wi: any) => wi.id);
        const idsParam = ids.join(',');
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wit/workitems`,
          { ids: idsParam, '$expand': 'Fields' }
        );

        const items = data.value || [];
        const lines = [`# Query Results (${items.length} items)\n`];
        for (const wi of items) {
          const f = wi.fields || {};
          lines.push(`- **#${wi.id}** | ${f['System.WorkItemType'] || ''} | ${f['System.State'] || ''} | ${f['System.AssignedTo']?.displayName || 'Unassigned'} | ${f['System.Title'] || 'Untitled'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_work_item_updates',
    'Get the full update history of a work item showing all field changes over time. Useful for tracking the journey of a work item.',
    {
      id: z.number().describe('Work item ID'),
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ id, project }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wit/workitems/${id}/updates`
        );
        const updates = data.value || [];
        if (!updates.length) return text('No updates found.');

        const lines = [`# Work Item #${id} — Update History (${updates.length} updates)\n`];
        for (const u of updates) {
          const changed: string[] = [];
          if (u.fields) {
            for (const [field, val] of Object.entries(u.fields) as [string, any][]) {
              const shortField = field.replace('System.', '').replace('Microsoft.VSTS.Common.', '');
              if (val.oldValue !== undefined || val.newValue !== undefined) {
                changed.push(`${shortField}: "${val.oldValue ?? ''}" → "${val.newValue ?? ''}"`);
              }
            }
          }
          if (changed.length) {
            lines.push(`**Rev ${u.rev}** | ${formatDate(u.revisedDate)} | By: ${u.revisedBy?.displayName || 'Unknown'}`);
            for (const c of changed) {
              lines.push(`  - ${c}`);
            }
            lines.push('');
          }
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_work_item_comments',
    'Get all discussion comments on a work item.',
    {
      id: z.number().describe('Work item ID'),
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ id, project }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wit/workitems/${id}/comments`,
          { '$top': '100', order: 'desc' }
        );
        const comments = data.comments || [];
        if (!comments.length) return text(`No comments on work item #${id}.`);

        const lines = [`# Work Item #${id} — Comments (${data.totalCount || comments.length})\n`];
        for (const c of comments) {
          lines.push(`**${c.createdBy?.displayName || 'Unknown'}** — ${formatDate(c.createdDate)}`);
          lines.push(truncate(stripHtml(c.text), 500));
          lines.push('');
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_iterations',
    'List sprints/iterations for a team in a project. Shows past, current, and future iterations.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      team: z.string().optional().describe('Team name (uses default team if not specified)'),
      timeframe: z.enum(['past', 'current', 'future']).optional().describe('Filter by timeframe'),
    },
    async ({ project, team, timeframe }) => {
      try {
        const p = client.resolveProject(project);
        const teamPath = team ? encodeURIComponent(team) : `${encodeURIComponent(p)} Team`;
        const params: Record<string, string> = {};
        if (timeframe) params['$timeframe'] = timeframe;
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/${teamPath}/_apis/work/teamsettings/iterations`,
          params
        );
        const iterations = data.value || [];
        if (!iterations.length) return text('No iterations found.');

        const lines = ['# Iterations\n'];
        for (const it of iterations) {
          const start = it.attributes?.startDate ? formatDate(it.attributes.startDate) : 'N/A';
          const end = it.attributes?.finishDate ? formatDate(it.attributes.finishDate) : 'N/A';
          const frame = it.attributes?.timeFrame || '';
          lines.push(`- **${it.name}** | ${frame} | ${start} → ${end} | Path: ${it.path}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_iteration_work_items',
    'Get all work items assigned to a specific iteration/sprint. Shows the sprint backlog.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      team: z.string().optional().describe('Team name'),
      iterationId: z.string().describe('Iteration ID (GUID from list_iterations)'),
    },
    async ({ project, team, iterationId }) => {
      try {
        const p = client.resolveProject(project);
        const teamPath = team ? encodeURIComponent(team) : `${encodeURIComponent(p)} Team`;
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/${teamPath}/_apis/work/teamsettings/iterations/${iterationId}/workitems`
        );
        const refs = data.workItemRelations || [];
        if (!refs.length) return text('No work items in this iteration.');

        const ids = refs.map((r: any) => r.target?.id).filter(Boolean);
        if (!ids.length) return text('No work items found.');

        const wiData = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wit/workitems`,
          { ids: ids.join(','), '$expand': 'Fields' }
        );
        const items = wiData.value || [];
        const lines = [`# Iteration Work Items (${items.length})\n`];
        for (const wi of items) {
          const f = wi.fields || {};
          lines.push(`- **#${wi.id}** | ${f['System.WorkItemType'] || ''} | ${f['System.State'] || ''} | ${f['System.AssignedTo']?.displayName || 'Unassigned'} | ${f['System.Title'] || 'Untitled'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_area_paths',
    'List area paths (classification nodes) for a project, useful for understanding team structure and work organization.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      depth: z.number().optional().default(3).describe('Depth of area path tree to return (default 3)'),
    },
    async ({ project, depth }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wit/classificationnodes/Areas`,
          { '$depth': depth }
        );

        function formatNode(node: any, indent = 0): string {
          const prefix = '  '.repeat(indent);
          let result = `${prefix}- ${node.name}`;
          if (node.children) {
            for (const child of node.children) {
              result += '\n' + formatNode(child, indent + 1);
            }
          }
          return result;
        }

        return text(`# Area Paths\n\n${formatNode(data)}`);
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_work_item_types',
    'List available work item types for a project (Bug, Task, User Story, Feature, Epic, etc.).',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ project }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/wit/workitemtypes`);
        const types = data.value || [];
        const lines = ['# Work Item Types\n'];
        for (const t of types) {
          lines.push(`- **${t.name}** | ${t.description || 'No description'} | Color: ${t.color || 'N/A'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );
}
