import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdoClient } from '../client.js';
import { text, error, formatDate } from '../utils.js';

export function register(server: McpServer, client: AdoClient) {
  server.tool(
    'list_projects',
    'List all projects in the Azure DevOps organization. Returns project names, descriptions, and state.',
    {},
    async () => {
      try {
        const data = await client.get<any>('_apis/projects', { '$top': '100', stateFilter: 'all' });
        const projects = data.value || [];
        if (!projects.length) return text('No projects found.');
        const lines = ['# Projects\n'];
        for (const p of projects) {
          lines.push(`- **${p.name}** | ${p.state} | ${p.description || 'No description'} | Last updated: ${formatDate(p.lastUpdateTime)}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_project',
    'Get detailed information about a specific Azure DevOps project including capabilities, default team, and process template.',
    { project: z.string().describe('Project name or ID') },
    async ({ project }) => {
      try {
        const p = await client.get<any>(`_apis/projects/${encodeURIComponent(project)}`, { includeCapabilities: 'true' });
        const lines = [
          `# Project: ${p.name}`,
          `- **ID:** ${p.id}`,
          `- **State:** ${p.state}`,
          `- **Description:** ${p.description || 'None'}`,
          `- **URL:** ${p.url}`,
          `- **Default Team:** ${p.defaultTeam?.name || 'N/A'}`,
          `- **Last Updated:** ${formatDate(p.lastUpdateTime)}`,
          `- **Revision:** ${p.revision}`,
        ];
        if (p.capabilities) {
          const vcs = p.capabilities?.versioncontrol?.sourceControlType;
          const process = p.capabilities?.processTemplate?.templateName;
          if (vcs) lines.push(`- **Version Control:** ${vcs}`);
          if (process) lines.push(`- **Process Template:** ${process}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_teams',
    'List all teams in a project.',
    { project: z.string().optional().describe('Project name (uses default if not specified)') },
    async ({ project }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`_apis/projects/${encodeURIComponent(p)}/teams`, { '$top': '100' });
        const teams = data.value || [];
        if (!teams.length) return text('No teams found.');
        const lines = ['# Teams\n'];
        for (const t of teams) {
          lines.push(`- **${t.name}** | ${t.description || 'No description'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_team_members',
    'Get members of a specific team in a project.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      team: z.string().describe('Team name or ID'),
    },
    async ({ project, team }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`_apis/projects/${encodeURIComponent(p)}/teams/${encodeURIComponent(team)}/members`, { '$top': '200' });
        const members = data.value || [];
        if (!members.length) return text('No members found.');
        const lines = [`# Team Members — ${team}\n`];
        for (const m of members) {
          lines.push(`- ${m.identity?.displayName || 'Unknown'} (${m.identity?.uniqueName || 'N/A'})${m.isTeamAdmin ? ' ★ Admin' : ''}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );
}
